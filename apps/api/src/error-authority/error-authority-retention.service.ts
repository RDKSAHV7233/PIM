import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { runWithAdvisoryLock } from "../common/scheduling/advisory-lock";
import { ObservabilityDbService } from "./observability-db.service";

/**
 * PIM#649: Error Authority retention/purge.
 *
 * Captured error records (ErrorIssue/ErrorOccurrence) had no retention period
 * and nothing ever purged them — the tables grew indefinitely. This service
 * runs on a timer and deletes ErrorIssue rows (and their occurrence/
 * tenant-impact children, via schema cascade) once they've been inactive
 * longer than ERROR_AUTHORITY_RETENTION_DAYS.
 *
 * PIM#766: before purging, stale open issues are automatically moved to
 * resolved after ERROR_AUTHORITY_AUTO_RESOLVE_DAYS so retention has an
 * explicit closed-state path without adding mutable operator controls to the
 * read-only Internal Ops Errors MVP.
 *
 * Follows the same lifecycle pattern as GracePeriodEscalationService:
 * - Gated by QUEUE_WORKER_ENABLED (runs on the worker process only)
 * - Initial delay to let the app boot cleanly before hitting the DB
 * - setInterval with .unref() so the timer doesn't prevent process exit
 */

const DEFAULT_RETENTION_DAYS = 90;
const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PURGE_INITIAL_DELAY_MS = 5 * 60 * 1000; // 5 minutes after boot

@Injectable()
export class ErrorAuthorityRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ErrorAuthorityRetentionService.name);
  private initialTimeout: NodeJS.Timeout | null = null;
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(private readonly observabilityDb: ObservabilityDbService) {}

  onModuleInit(): void {
    if (!this.isEnabled()) {
      return;
    }
    this.logger.log(
      `Error Authority retention purge timer scheduled (24-hour interval, ${this.retentionDays()}-day retention).`,
    );
    this.initialTimeout = setTimeout(() => {
      void this.runScheduledPurge();
      this.intervalHandle = setInterval(() => void this.runScheduledPurge(), PURGE_INTERVAL_MS);
      this.intervalHandle.unref();
    }, PURGE_INITIAL_DELAY_MS);
    this.initialTimeout.unref();
  }

  onModuleDestroy(): void {
    if (this.initialTimeout) {
      clearTimeout(this.initialTimeout);
      this.initialTimeout = null;
    }
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async runPurge(): Promise<void> {
    try {
      const { resolvedCount, storageAvailable: resolutionStorageAvailable } =
        await this.observabilityDb.resolveInactiveOpenIssues(this.autoResolveDays());
      if (!resolutionStorageAvailable) {
        return;
      }
      if (resolvedCount > 0) {
        this.logger.log(`Error Authority retention resolved ${resolvedCount} inactive open issue(s).`);
      }
      const { deletedCount, storageAvailable } = await this.observabilityDb.purgeExpiredIssues(this.retentionDays());
      if (!storageAvailable) {
        return;
      }
      if (deletedCount > 0) {
        this.logger.log(`Error Authority retention purge complete: ${deletedCount} expired issue(s) deleted.`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error ?? "unknown");
      this.logger.error(`Error Authority retention purge run failed: ${message}`);
    }
  }

  private async runScheduledPurge(): Promise<void> {
    let ran = false;
    try {
      ran = await runWithAdvisoryLock("error-authority-retention", () => this.runPurge());
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error ?? "unknown");
      this.logger.error(`Scheduler lock failure for error-authority-retention: ${message}`);
      return;
    }
    if (!ran) {
      this.logger.debug("Skipped Error Authority retention purge: another replica holds the scheduler lock.");
    }
  }

  private retentionDays(): number {
    const raw = Number(process.env.ERROR_AUTHORITY_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RETENTION_DAYS;
  }

  private autoResolveDays(): number {
    const fallback = this.retentionDays();
    const raw = Number(process.env.ERROR_AUTHORITY_AUTO_RESOLVE_DAYS ?? fallback);
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  }

  private isEnabled(): boolean {
    const workerEnabled = String(process.env.QUEUE_WORKER_ENABLED ?? "true").trim().toLowerCase();
    return workerEnabled === "true";
  }
}
