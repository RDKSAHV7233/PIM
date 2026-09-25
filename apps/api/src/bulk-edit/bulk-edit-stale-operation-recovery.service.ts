import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { BulkEditOperationStatus } from "@prisma/client";
import { LoggerService } from "../common/logging/logger.service";
import { runWithAdvisoryLock } from "../common/scheduling/advisory-lock";
import { runWithTenantContext } from "../common/tenant/tenant-context";
import { PrismaDirectService } from "../prisma/prisma-direct.service";
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

@Injectable()
export class BulkEditStaleOperationRecoveryService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private recovering = false;

  constructor(
    private readonly prismaDirect: PrismaDirectService,
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
    }, RECOVERY_INITIAL_DELAY_MS);
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

  async recoverStaleOperations(now = new Date()): Promise<{ recoveredOperations: number }> {
    if (this.recovering) {
      return { recoveredOperations: 0 };
    }
    this.recovering = true;
    try {
      const staleBefore = new Date(now.getTime() - STALE_PROCESSING_THRESHOLD_MS);
      const client = this.prismaDirect.getClient();

      // Global (cross-tenant) read via the direct client, matching
      // BulkImportStaleRowRecoveryService's established pattern — tenant
      // isolation is enforced by PrismaService's per-tenant query extension,
      // not Postgres RLS, so this direct client legitimately sees every
      // tenant. markStuckOperationFailed() below restores per-tenant scoping.
      const staleOperations = await client.bulkEditOperation.findMany({
        where: {
          status: { in: [BulkEditOperationStatus.queued, BulkEditOperationStatus.processing] },
          updatedAt: { lte: staleBefore },
        },
        select: { id: true, tenantKey: true },
        take: RECOVERY_BATCH_LIMIT,
      });

      if (staleOperations.length === 0) {
        return { recoveredOperations: 0 };
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

      return { recoveredOperations };
    } finally {
      this.recovering = false;
    }
  }
}
