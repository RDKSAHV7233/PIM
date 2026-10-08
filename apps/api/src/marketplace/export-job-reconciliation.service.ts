import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { ExportJobStatus, Prisma } from "@prisma/client";
import { LoggerService } from "../common/logging/logger.service";
import { runWithAdvisoryLock } from "../common/scheduling/advisory-lock";
import { runWithTenantContext } from "../common/tenant/tenant-context";
import { forEachTenant } from "../common/tenant/tenant-iteration";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { QUEUE_NAMES } from "../queue/queue.constants";

const RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 h
const INITIAL_DELAY_MS = 2 * 60 * 1000; // 2 min after boot
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 min — a job that's been active this long without progress is suspect
const BATCH_SIZE = 200;

/** EXPORT_JOB_RECONCILE_INITIAL_DELAY_MS (>= 100) shortens the first run for tests; unset or invalid keeps 2 minutes. */
function resolveInitialDelayMs(env: NodeJS.ProcessEnv = process.env): number {
  const requested = Number(env["EXPORT_JOB_RECONCILE_INITIAL_DELAY_MS"]);
  return Number.isFinite(requested) && requested >= 100 ? Math.floor(requested) : INITIAL_DELAY_MS;
}

export interface ExportJobReconciliationResult {
  examined: number;
  reconciled: number;
  errors: number;
  tenantsEvaluated: number;
  /** Tenants whose stale jobs could not be read this run; their jobs were NOT evaluated. */
  tenantsFailed: number;
  /** A runtime role cannot see tenants missing from the directory, so this is never reported as zero. */
  orphanDetection: "UNVERIFIED_BY_RUNTIME_ROLE";
}

type StaleExportJob = { id: string; tenantKey: string; status: ExportJobStatus; retryCount: number; updatedAt: Date };

const ACTIVE_STATUSES: ExportJobStatus[] = [
  ExportJobStatus.queued,
  ExportJobStatus.processing,
  ExportJobStatus.retrying,
];
const TERMINAL_QUEUE_STATES = new Set(["completed", "failed"]);

@Injectable()
export class ExportJobReconciliationService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer: ReturnType<typeof setTimeout> | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly logger: LoggerService,
  ) {}

  onApplicationBootstrap(): void {
    if (
      String(process.env["EXPORT_JOB_RECONCILE_DISABLED"] ?? "")
        .trim()
        .toLowerCase() === "true"
    ) {
      this.logger.info(
        "Export job reconciliation disabled via EXPORT_JOB_RECONCILE_DISABLED.",
      );
      return;
    }
    this.timer = setTimeout(() => {
      void this.runScheduledReconciliation();
      this.intervalId = setInterval(
        () => void this.runScheduledReconciliation(),
        RECONCILE_INTERVAL_MS,
      );
      this.intervalId.unref();
    }, resolveInitialDelayMs());
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.intervalId) clearInterval(this.intervalId);
  }

  async runReconciliation(): Promise<ExportJobReconciliationResult> {
    const emptyResult = (): ExportJobReconciliationResult => ({
      examined: 0,
      reconciled: 0,
      errors: 0,
      tenantsEvaluated: 0,
      tenantsFailed: 0,
      orphanDetection: "UNVERIFIED_BY_RUNTIME_ROLE",
    });
    if (this.running) {
      this.logger.warn(
        "Export job reconciliation already running — skipping tick.",
      );
      return emptyResult();
    }
    this.running = true;
    let examined = 0;
    let reconciled = 0;
    let errors = 0;
    let tenantsEvaluated = 0;
    let tenantsFailed = 0;

    try {
      const staleCutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

      // SEC-DB-RLS-001: this used to be ONE cross-tenant read through the context-free direct client, which under row level
      // security sees no tenant's rows, so stale export jobs would have stayed active while the run reported nothing to do. It now
      // scans per tenant (forEachTenant), inside that tenant's own transaction, and the query ALSO filters by the tenant it is
      // given, so it is correct whether or not the runtime role bypasses RLS. A tenant that could not be read is reported, never
      // skipped silently. Per-tenant results are merged oldest-first under the original batch bound. The per-row step below
      // (queue check, then a tenant-scoped update) is unchanged.
      const found: StaleExportJob[] = [];
      const discovery = await forEachTenant(this.prisma.tenant(), async (tx, tenantKey) => {
        // ACTIVE_STATUSES: queued, processing, retrying.
        // RLS-BYPASS: manual tenant filter — WHERE "tenantKey" = ${tenantKey} below, on a transaction whose tenant context is that tenant.
        const rows = await tx.$queryRaw<StaleExportJob[]>(Prisma.sql`
          SELECT id, "tenantKey", status, "retryCount", "updatedAt"
          FROM "MarketplaceExportJob"
          WHERE "tenantKey" = ${tenantKey}
            AND status IN ('queued'::"ExportJobStatus", 'processing'::"ExportJobStatus", 'retrying'::"ExportJobStatus")
            AND "updatedAt" < ${staleCutoff}
          ORDER BY "updatedAt" ASC
          LIMIT ${BATCH_SIZE}
        `);
        // A row of another tenant means the filter above was bypassed: count it as a failure, never act on it.
        const own = rows.filter((row) => row.tenantKey === tenantKey);
        found.push(...own);
        return { examinedCount: rows.length, changedCount: 0, failedCount: rows.length - own.length };
      });
      tenantsEvaluated = discovery.tenantsEvaluated;
      tenantsFailed = discovery.tenantsFailed;
      if (discovery.tenantsFailed > 0) {
        // A tenant we could not read is a tenant whose stale export jobs we may have missed: an error, never a quiet success.
        this.logger.error("Export job reconciliation could not read some tenants; their jobs were NOT evaluated this run.", {
          event: "EXPORT_JOB_RECONCILIATION_TENANT_READ_FAILED",
          tenantsFailed: discovery.tenantsFailed,
          tenantsEvaluated: discovery.tenantsEvaluated,
          failures: discovery.results
            .filter((result) => result.status === "failed")
            .map((result) => ({ tenantKey: result.tenantKey, errorCode: result.errorCode ?? "UNKNOWN" })),
        });
      }

      const staleRows = found
        .sort((x, y) => new Date(x.updatedAt).getTime() - new Date(y.updatedAt).getTime())
        .slice(0, BATCH_SIZE);

      for (const row of staleRows) {
        examined++;
        try {
          const queueJobId = `${row.id}_${row.retryCount}`;
          const queueJob = await this.queueService.getJobSnapshot(
            QUEUE_NAMES.CONNECTOR_SUBMISSION,
            queueJobId,
          );

          if (queueJob.present && !TERMINAL_QUEUE_STATES.has(String(queueJob.state ?? ""))) {
            continue;
          }

          const failureReason = queueJob.present
            ? `Reconciled: queue job reached terminal state "${queueJob.state}" while export job remained "${row.status}"`
            : "Reconciled: no corresponding queue job found after staleness threshold";

          await runWithTenantContext(row.tenantKey, async () => {
            const updated = await this.prisma
              .tenant()
              .marketplaceExportJob.updateMany({
                where: {
                  id: row.id,
                  status: { in: ACTIVE_STATUSES },
                },
                data: {
                  status: ExportJobStatus.failed,
                  failureReason,
                },
              });

            if (updated.count > 0) {
              reconciled++;
            }
          });
        } catch (err) {
          errors++;
          this.logger.warn("Export job reconciliation: error processing row", {
            event: "EXPORT_JOB_RECONCILIATION_ERROR",
            rowStatus: row.status,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } finally {
      this.running = false;
      this.logger.info("Export job reconciliation completed.", {
        event: "EXPORT_JOB_RECONCILIATION_TICK",
        examined,
        reconciled,
        errors,
        tenantsEvaluated,
        tenantsFailed,
      });
    }

    return { examined, reconciled, errors, tenantsEvaluated, tenantsFailed, orphanDetection: "UNVERIFIED_BY_RUNTIME_ROLE" };
  }

  private async runScheduledReconciliation(): Promise<void> {
    let ran = false;
    try {
      ran = await runWithAdvisoryLock("export-job-reconciliation", async () => {
        try {
          await this.runReconciliation();
        } catch (error: unknown) {
          this.logger.warn("Export job reconciliation scheduled run failed open.", {
            event: "EXPORT_JOB_RECONCILIATION_SCHEDULED_FAILED_OPEN",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    } catch (error: unknown) {
      this.logger.error("Scheduler lock failure for export-job-reconciliation.", {
        event: "EXPORT_JOB_RECONCILIATION_LOCK_FAILURE",
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (!ran) {
      this.logger.info("Skipped export job reconciliation: another replica holds the scheduler lock.", {
        event: "EXPORT_JOB_RECONCILIATION_LOCK_SKIPPED",
      });
    }
  }
}
