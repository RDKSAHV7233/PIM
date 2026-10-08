import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { LoggerService } from "../common/logging/logger.service";
import { runWithAdvisoryLock } from "../common/scheduling/advisory-lock";
import { runWithTenantContext } from "../common/tenant/tenant-context";
import { forEachTenant } from "../common/tenant/tenant-iteration";
import { PrismaService } from "../prisma/prisma.service";
import { BulkImportService } from "./bulk-import.service";

// A worker that crashes (deploy, OOM, transient DB outage) mid-processRow leaves
// the row's optimistic claim at "processing" forever — processRow only ever
// claims rows in "queued"/"retrying", so nothing else can ever pick a
// "processing" row back up. Two production imports from 2026-07-01 sat with 39
// combined rows stuck at "processing" since a DB-connection-exhaustion incident
// on 2026-07-02/03, undetected because their jobs eventually aged out of the
// stuck_jobs_threshold_exceeded alert's 30-day lookback window before anyone
// noticed. This periodically resets rows stuck at "processing" well past any
// realistic single-row processing time back to "retrying" and re-drives their
// job, the same way the requeue-dlq fix re-drives processing after a reset.
const STALE_PROCESSING_THRESHOLD_MS = 60 * 60 * 1000;
const RECOVERY_INITIAL_DELAY_MS = 3 * 60 * 1000;
const RECOVERY_INTERVAL_MS = 15 * 60 * 1000;
const RECOVERY_BATCH_LIMIT = 500;

/** BULK_IMPORT_STALE_ROW_RECOVERY_INITIAL_DELAY_MS (>= 100) shortens the first sweep for tests; unset or invalid keeps the 3 minute default. */
function resolveInitialDelayMs(env: NodeJS.ProcessEnv = process.env): number {
  const requested = Number(env.BULK_IMPORT_STALE_ROW_RECOVERY_INITIAL_DELAY_MS);
  return Number.isFinite(requested) && requested >= 100 ? Math.floor(requested) : RECOVERY_INITIAL_DELAY_MS;
}

export interface StaleRowRecoveryResult {
  recoveredRows: number;
  reprocessedJobs: number;
  tenantsEvaluated: number;
  /** Tenants whose stale rows could not be read or reset this run; their rows were NOT fully evaluated. */
  tenantsFailed: number;
  /** A runtime role cannot see tenants missing from the directory, so this is never reported as zero. */
  orphanDetection: "UNVERIFIED_BY_RUNTIME_ROLE";
}

type StaleRow = { id: string; jobId: string; tenantKey: string; lastAttemptAt: Date };

@Injectable()
export class BulkImportStaleRowRecoveryService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private recovering = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bulkImportService: BulkImportService,
    private readonly logger: LoggerService,
  ) {}

  onApplicationBootstrap(): void {
    if (String(process.env.BULK_IMPORT_STALE_ROW_RECOVERY_DISABLED ?? "").trim().toLowerCase() === "true") {
      this.logger.info("Bulk import stale-row recovery disabled.");
      return;
    }
    if (String(process.env.QUEUE_WORKER_ENABLED ?? "true").trim().toLowerCase() === "false") {
      return;
    }
    this.timer = setTimeout(() => {
      void this.runScheduledRecovery();
      this.intervalId = setInterval(() => void this.runScheduledRecovery(), RECOVERY_INTERVAL_MS);
      this.intervalId.unref();
    }, resolveInitialDelayMs());
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async runScheduledRecovery(): Promise<void> {
    try {
      await runWithAdvisoryLock("bulk-import-stale-row-recovery", () => this.recoverStaleRows().then(() => undefined));
    } catch (error: unknown) {
      this.logger.error("Scheduler lock failure for bulk-import-stale-row-recovery.", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async recoverStaleRows(now = new Date()): Promise<StaleRowRecoveryResult> {
    if (this.recovering) {
      return { recoveredRows: 0, reprocessedJobs: 0, tenantsEvaluated: 0, tenantsFailed: 0, orphanDetection: "UNVERIFIED_BY_RUNTIME_ROLE" };
    }
    this.recovering = true;
    try {
      const staleBefore = new Date(now.getTime() - STALE_PROCESSING_THRESHOLD_MS);

      // SEC-DB-RLS-001: this used to be a cross-tenant read AND write through the context-free direct client, which under row level
      // security sees no tenant's rows, so rows stuck at "processing" would have stayed stuck while the sweep found nothing to do.
      // It now works per tenant (forEachTenant), inside that tenant's own transaction, and every query ALSO filters by the tenant it
      // is given, so it is correct whether or not the runtime role bypasses RLS. A tenant that could not be read is reported, never
      // skipped silently.
      //
      // Two passes keep the original overall bound (RECOVERY_BATCH_LIMIT rows per run, oldest first): pass 1 reads each tenant's
      // oldest stale rows, the results are merged and cut to the bound, and pass 2 resets exactly the chosen rows per tenant. The
      // reset only touches a row that is STILL "processing", so a row that finished between the two passes is left alone.
      const found: StaleRow[] = [];
      const discovery = await forEachTenant(this.prisma.tenant(), async (tx, tenantKey) => {
        // RLS-BYPASS: manual tenant filter — WHERE "tenantKey" = ${tenantKey} below, on a transaction whose tenant context is that tenant.
        const rows = await tx.$queryRaw<StaleRow[]>(Prisma.sql`
          SELECT id, "jobId", "tenantKey", "lastAttemptAt"
          FROM "BulkImportRow"
          WHERE "tenantKey" = ${tenantKey}
            AND status = 'processing'::"BulkImportRowStatus"
            AND "lastAttemptAt" <= ${staleBefore}
          ORDER BY "lastAttemptAt" ASC
          LIMIT ${RECOVERY_BATCH_LIMIT}
        `);
        // A row of another tenant means the filter above was bypassed: count it as a failure, never act on it.
        const own = rows.filter((row) => row.tenantKey === tenantKey);
        found.push(...own);
        return { examinedCount: rows.length, changedCount: 0, failedCount: rows.length - own.length };
      });

      const chosen = found
        .sort((a, b) => new Date(a.lastAttemptAt).getTime() - new Date(b.lastAttemptAt).getTime())
        .slice(0, RECOVERY_BATCH_LIMIT);
      const idsByTenant = new Map<string, string[]>();
      const jobIdByRow = new Map<string, string>();
      for (const row of chosen) {
        idsByTenant.set(row.tenantKey, [...(idsByTenant.get(row.tenantKey) ?? []), row.id]);
        jobIdByRow.set(`${row.tenantKey}:${row.id}`, row.jobId);
      }

      const resetJobs = new Map<string, { jobId: string; tenantKey: string }>();
      let recoveredRows = 0;
      let resetFailed = 0;
      if (idsByTenant.size > 0) {
        const reset = await forEachTenant(
          this.prisma.tenant(),
          async (tx, tenantKey) => {
            const ids = idsByTenant.get(tenantKey) ?? [];
            // RLS-BYPASS: manual tenant filter — WHERE "tenantKey" = ${tenantKey} below, on a transaction whose tenant context is that tenant.
            const updated = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
              UPDATE "BulkImportRow"
              SET status = 'retrying'::"BulkImportRowStatus", "updatedAt" = NOW()
              WHERE "tenantKey" = ${tenantKey}
                AND id = ANY(${ids}::text[])
                AND status = 'processing'::"BulkImportRowStatus"
              RETURNING id
            `);
            for (const { id } of updated) {
              const jobId = jobIdByRow.get(`${tenantKey}:${id}`);
              if (jobId) {
                resetJobs.set(`${tenantKey}:${jobId}`, { jobId, tenantKey });
              }
            }
            recoveredRows += updated.length;
            return { examinedCount: ids.length, changedCount: updated.length, failedCount: 0 };
          },
          { tenantKeys: [...idsByTenant.keys()] },
        );
        resetFailed = reset.tenantsFailed;
      }

      const tenantsFailed = discovery.tenantsFailed + resetFailed;
      if (tenantsFailed > 0) {
        // A tenant we could not read or reset is a tenant whose stuck rows we may have missed: an error, never a quiet success.
        this.logger.error("Bulk-import stale-row recovery could not read or reset some tenants; their rows were NOT fully evaluated this run.", {
          tenantsFailed,
          tenantsEvaluated: discovery.tenantsEvaluated,
          failures: discovery.results
            .filter((result) => result.status === "failed")
            .map((result) => ({ tenantKey: result.tenantKey, errorCode: result.errorCode ?? "UNKNOWN" })),
        });
      }

      const result = (): StaleRowRecoveryResult => ({
        recoveredRows,
        reprocessedJobs: resetJobs.size,
        tenantsEvaluated: discovery.tenantsEvaluated,
        tenantsFailed,
        orphanDetection: discovery.orphanDetection,
      });

      if (recoveredRows === 0) {
        return result();
      }

      this.logger.warn("Recovered bulk-import rows stuck in processing past the staleness threshold.", {
        rowCount: recoveredRows,
        jobCount: resetJobs.size,
      });

      for (const job of resetJobs.values()) {
        try {
          await runWithTenantContext(job.tenantKey, () => this.bulkImportService.processJob(job.jobId));
        } catch (error: unknown) {
          this.logger.warn("Failed to re-drive a bulk-import job after stale-row recovery.", {
            jobId: job.jobId,
            errorMessage: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return result();
    } finally {
      this.recovering = false;
    }
  }
}
