import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { LoggerService } from "../common/logging/logger.service";
import { runWithAdvisoryLock } from "../common/scheduling/advisory-lock";
import { runWithTenantContext } from "../common/tenant/tenant-context";
import { forEachTenant } from "../common/tenant/tenant-iteration";
import { PrismaService } from "../prisma/prisma.service";
import { BulkEditService } from "./bulk-edit.service";

// F-014: a worker that crashes mid-processApplyJob (deploy, OOM, transient DB
// outage) leaves the operation at queued/processing forever — its promise
// never resolves *or* rejects, so neither finalizeOperation() nor
// onModuleInit()'s own catch-and-mark-failed ever runs. Confirmed live: a
// production operation requesting 21,245 products sat at "processing" with
// 100 BulkEditOperationItem rows already recorded (all real per-item
// failures) but appliedCount/failedCount frozen at 0 and status never
// advancing — exactly this scenario. Mirrors
// BulkImportStaleRowRecoveryService's pattern; see markStuckOperationFailed's
// own doc comment for why this marks failed rather than resuming.
const STALE_PROCESSING_THRESHOLD_MS = 60 * 60 * 1000;
const RECOVERY_INITIAL_DELAY_MS = 3 * 60 * 1000;
const RECOVERY_INTERVAL_MS = 15 * 60 * 1000;
const RECOVERY_BATCH_LIMIT = 500;

/** BULK_EDIT_STALE_RECOVERY_INITIAL_DELAY_MS (>= 100) shortens the first sweep for tests; unset or invalid keeps the 3 minute default. */
function resolveInitialDelayMs(env: NodeJS.ProcessEnv = process.env): number {
  const requested = Number(env.BULK_EDIT_STALE_RECOVERY_INITIAL_DELAY_MS);
  return Number.isFinite(requested) && requested >= 100 ? Math.floor(requested) : RECOVERY_INITIAL_DELAY_MS;
}

export interface StaleOperationRecoveryResult {
  recoveredOperations: number;
  tenantsEvaluated: number;
  /** Tenants whose stale operations could not be read this run; their operations were NOT evaluated. */
  tenantsFailed: number;
  /** A runtime role cannot see tenants missing from the directory, so this is never reported as zero. */
  orphanDetection: "UNVERIFIED_BY_RUNTIME_ROLE";
}

type StaleOperationRow = { id: string; tenantKey: string; updatedAt: Date };

@Injectable()
export class BulkEditStaleOperationRecoveryService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private recovering = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bulkEditService: BulkEditService,
    private readonly logger: LoggerService,
  ) {}

  onApplicationBootstrap(): void {
    if (String(process.env.BULK_EDIT_STALE_OPERATION_RECOVERY_DISABLED ?? "").trim().toLowerCase() === "true") {
      this.logger.info("Bulk edit stale-operation recovery disabled.");
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
      await runWithAdvisoryLock("bulk-edit-stale-operation-recovery", () => this.recoverStaleOperations().then(() => undefined));
    } catch (error: unknown) {
      this.logger.error("Scheduler lock failure for bulk-edit-stale-operation-recovery.", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async recoverStaleOperations(now = new Date()): Promise<StaleOperationRecoveryResult> {
    if (this.recovering) {
      return { recoveredOperations: 0, tenantsEvaluated: 0, tenantsFailed: 0, orphanDetection: "UNVERIFIED_BY_RUNTIME_ROLE" };
    }
    this.recovering = true;
    try {
      const staleBefore = new Date(now.getTime() - STALE_PROCESSING_THRESHOLD_MS);

      // SEC-DB-RLS-001: this used to be ONE cross-tenant read through the context-free direct client, which under row level
      // security sees no tenant's rows, so stale operations would have stayed stuck while the sweep reported nothing to do. It now
      // discovers per tenant (forEachTenant), inside that tenant's own transaction, and the query ALSO filters by the tenant it is
      // given, so it is correct whether or not the runtime role bypasses RLS. A tenant that could not be read is reported, never
      // skipped silently. Per-tenant results are merged oldest-first under the overall batch limit.
      const found: StaleOperationRow[] = [];
      const summary = await forEachTenant(this.prisma.tenant(), async (tx, tenantKey) => {
        // RLS-BYPASS: manual tenant filter — WHERE "tenantKey" = ${tenantKey} below, on a transaction whose tenant context is that tenant.
        const rows = await tx.$queryRaw<StaleOperationRow[]>(Prisma.sql`
          SELECT id, "tenantKey", "updatedAt"
          FROM "BulkEditOperation"
          WHERE "tenantKey" = ${tenantKey}
            AND status IN ('queued'::"BulkEditOperationStatus", 'processing'::"BulkEditOperationStatus")
            AND "updatedAt" <= ${staleBefore}
          ORDER BY "updatedAt" ASC
          LIMIT ${RECOVERY_BATCH_LIMIT}
        `);
        // A row of another tenant means the filter above was bypassed: count it as a failure, never act on it.
        const own = rows.filter((row) => row.tenantKey === tenantKey);
        found.push(...own);
        return { examinedCount: rows.length, changedCount: 0, failedCount: rows.length - own.length };
      });

      if (summary.tenantsFailed > 0) {
        // A tenant we could not read is a tenant whose stuck operations we may have missed: an error, never a quiet success.
        this.logger.error("Bulk-edit stale-operation recovery could not read some tenants; their operations were NOT evaluated this run.", {
          tenantsFailed: summary.tenantsFailed,
          tenantsEvaluated: summary.tenantsEvaluated,
          failures: summary.results.filter((result) => result.status === "failed").map((result) => ({ tenantKey: result.tenantKey, errorCode: result.errorCode ?? "UNKNOWN" })),
        });
      }

      const staleOperations = found
        .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
        .slice(0, RECOVERY_BATCH_LIMIT);

      const result = (recoveredOperations: number): StaleOperationRecoveryResult => ({
        recoveredOperations,
        tenantsEvaluated: summary.tenantsEvaluated,
        tenantsFailed: summary.tenantsFailed,
        orphanDetection: summary.orphanDetection,
      });

      if (staleOperations.length === 0) {
        return result(0);
      }

      this.logger.warn("Recovering bulk-edit operations stuck past the staleness threshold.", {
        operationCount: staleOperations.length,
      });

      let recoveredOperations = 0;
      for (const operation of staleOperations) {
        try {
          // markStuckOperationFailed's own where-clause only writes if the operation
          // is still queued/processing at write time — recovered: false means it
          // legitimately finished on its own between this sweep's read and this call,
          // not that this loop did anything, so it must not count as a recovery.
          const { recovered } = await runWithTenantContext(operation.tenantKey, () =>
            this.bulkEditService.markStuckOperationFailed(operation.id),
          );
          if (recovered) {
            recoveredOperations += 1;
          }
        } catch (error: unknown) {
          this.logger.warn("Failed to mark a stale bulk-edit operation as failed.", {
            operationId: operation.id,
            errorMessage: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return result(recoveredOperations);
    } finally {
      this.recovering = false;
    }
  }
}
