import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { BulkImportRowStatus } from "@prisma/client";
import { LoggerService } from "../common/logging/logger.service";
import { runWithAdvisoryLock } from "../common/scheduling/advisory-lock";
import { runWithTenantContext } from "../common/tenant/tenant-context";
import { PrismaDirectService } from "../prisma/prisma-direct.service";
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

@Injectable()
export class BulkImportStaleRowRecoveryService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private recovering = false;

  constructor(
    private readonly prismaDirect: PrismaDirectService,
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
      await runWithAdvisoryLock("bulk-import-stale-row-recovery", () => this.recoverStaleRows().then(() => undefined));
    } catch (error: unknown) {
      this.logger.error("Scheduler lock failure for bulk-import-stale-row-recovery.", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async recoverStaleRows(now = new Date()): Promise<{ recoveredRows: number; reprocessedJobs: number }> {
    if (this.recovering) {
      return { recoveredRows: 0, reprocessedJobs: 0 };
    }
    this.recovering = true;
    try {
      const staleBefore = new Date(now.getTime() - STALE_PROCESSING_THRESHOLD_MS);
      const client = this.prismaDirect.getClient();

      // Global (cross-tenant) read/write via the direct client, matching the
      // established pattern in InternalOpsAlertsService.countStuckJobs — tenant
      // isolation here is enforced by PrismaService's per-tenant query
      // extension, not Postgres RLS, so this direct client legitimately sees
      // every tenant. Re-driving each job below restores per-tenant scoping.
      const staleRows = await client.bulkImportRow.findMany({
        where: {
          status: BulkImportRowStatus.processing,
          lastAttemptAt: { lte: staleBefore },
        },
        select: { id: true, jobId: true },
        take: RECOVERY_BATCH_LIMIT,
      });

      if (staleRows.length === 0) {
        return { recoveredRows: 0, reprocessedJobs: 0 };
      }

      await client.bulkImportRow.updateMany({
        where: { id: { in: staleRows.map((row) => row.id) } },
        data: { status: BulkImportRowStatus.retrying },
      });

      const affectedJobIds = [...new Set(staleRows.map((row) => row.jobId))];
      const affectedJobs = await client.bulkImportJob.findMany({
        where: { id: { in: affectedJobIds } },
        select: { id: true, tenantKey: true },
      });

      this.logger.warn("Recovered bulk-import rows stuck in processing past the staleness threshold.", {
        rowCount: staleRows.length,
        jobCount: affectedJobs.length,
      });

      for (const job of affectedJobs) {
        try {
          await runWithTenantContext(job.tenantKey, () => this.bulkImportService.processJob(job.id));
        } catch (error: unknown) {
          this.logger.warn("Failed to re-drive a bulk-import job after stale-row recovery.", {
            jobId: job.id,
            errorMessage: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return { recoveredRows: staleRows.length, reprocessedJobs: affectedJobs.length };
    } finally {
      this.recovering = false;
    }
  }
}
