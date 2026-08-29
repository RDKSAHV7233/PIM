import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { ExportJobStatus } from "@prisma/client";
import { LoggerService } from "../common/logging/logger.service";
import { runWithAdvisoryLock } from "../common/scheduling/advisory-lock";
import { runWithTenantContext } from "../common/tenant/tenant-context";
import { PrismaDirectService } from "../prisma/prisma-direct.service";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { QUEUE_NAMES } from "../queue/queue.constants";

const RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 h
const INITIAL_DELAY_MS = 2 * 60 * 1000; // 2 min after boot
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 min — a job that's been active this long without progress is suspect
const BATCH_SIZE = 200;

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
    private readonly prismaDirect: PrismaDirectService,
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
    }, INITIAL_DELAY_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.intervalId) clearInterval(this.intervalId);
  }

  async runReconciliation(): Promise<{ examined: number; reconciled: number; errors: number }> {
    if (this.running) {
      this.logger.warn(
        "Export job reconciliation already running — skipping tick.",
      );
      return { examined: 0, reconciled: 0, errors: 0 };
    }
    this.running = true;
    let examined = 0;
    let reconciled = 0;
    let errors = 0;

    try {
      const staleCutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

      const staleRows = await this.prismaDirect.getClient().marketplaceExportJob.findMany({
        where: {
          status: { in: ACTIVE_STATUSES },
          updatedAt: { lt: staleCutoff },
        },
        select: {
          id: true,
          tenantKey: true,
          status: true,
          retryCount: true,
        },
        take: BATCH_SIZE,
        orderBy: { updatedAt: "asc" },
      });

      if (staleRows.length === 0) {
        this.logger.info("Export job reconciliation completed.", {
          event: "EXPORT_JOB_RECONCILIATION_TICK",
          examined: 0,
          reconciled: 0,
          errors: 0,
        });
        return { examined: 0, reconciled: 0, errors: 0 };
      }

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
      });
    }

    return { examined, reconciled, errors };
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
