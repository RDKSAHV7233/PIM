import { Injectable, OnApplicationBootstrap, OnApplicationShutdown, Optional } from "@nestjs/common";
import { LoggerService } from "../common/logging/logger.service";
import { InternalOpsAlertsService } from "../internal-ops/internal-ops-alerts.service";
import { MediaIntegrityService, MediaIntegrityScanResult } from "./media-integrity.service";

const DEFAULT_INITIAL_DELAY_MS = 10 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MIN_INTERVAL_MS = 60 * 1000;

type ScheduledMediaIntegrityResult =
  | { ran: true; result: MediaIntegrityScanResult }
  | { ran: false; reason: "already_running" | "failed_open" };

@Injectable()
export class MediaIntegritySchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly mediaIntegrity: MediaIntegrityService,
    private readonly logger: LoggerService,
    @Optional() private readonly internalOpsAlertsService?: InternalOpsAlertsService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.isScheduleEnabled()) {
      this.logger.info("Media integrity scheduled scan disabled.");
      return;
    }
    if (String(process.env.QUEUE_WORKER_ENABLED ?? "true").trim().toLowerCase() === "false") {
      this.logger.info("Media integrity scheduled scan skipped because workers are disabled.");
      return;
    }

    const initialDelayMs = resolveInteger(process.env.MEDIA_INTEGRITY_SCAN_INITIAL_DELAY_MS, DEFAULT_INITIAL_DELAY_MS, 0);
    const intervalMs = Math.max(
      MIN_INTERVAL_MS,
      resolveInteger(process.env.MEDIA_INTEGRITY_SCAN_INTERVAL_MS, DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS),
    );

    this.initialTimer = setTimeout(() => {
      void this.runScheduledScan();
      this.intervalTimer = setInterval(() => void this.runScheduledScan(), intervalMs);
      this.intervalTimer.unref();
    }, initialDelayMs);
    this.initialTimer.unref();
  }

  onApplicationShutdown(): void {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  async runScheduledScan(): Promise<ScheduledMediaIntegrityResult> {
    if (this.running) {
      this.logger.warn("Media integrity scheduled scan already running; skipping tick.");
      return { ran: false, reason: "already_running" };
    }

    this.running = true;
    try {
      const result = await this.mediaIntegrity.runBoundedScan({
        checkpointKey: normalizeText(process.env.MEDIA_INTEGRITY_SCAN_CHECKPOINT_KEY) || undefined,
        pageSize: resolveOptionalInteger(process.env.MEDIA_INTEGRITY_SCAN_PAGE_SIZE),
        maxRowsPerRun: resolveOptionalInteger(process.env.MEDIA_INTEGRITY_SCAN_MAX_ROWS_PER_RUN),
        localFileProbeEnabled: isTrue(process.env.MEDIA_INTEGRITY_VERIFY_LOCAL_FILES),
      });

      this.logger.info("Media integrity scheduled scan completed.", {
        event: "MEDIA_INTEGRITY_SCAN_COMPLETED",
        runId: result.runId,
        status: result.status,
        rowsExamined: result.coverage.rowsExamined,
        rowsEligible: result.coverage.rowsEligible,
        coverageComplete: result.coverage.complete,
        continuationPending: result.coverage.continuationPending,
        missing: result.totals.missing,
        invalidPath: result.totals.invalidPath,
        unverifiable: result.totals.unverifiable,
        storageErrors: result.totals.storageErrors,
        affectedTenantCount: result.impact.affectedTenantCount,
        activeProductImpactCount: result.impact.activeProductImpactCount,
      });
      await this.captureMediaIntegrityAlert(result);
      return { ran: true, result };
    } catch (error: unknown) {
      this.logger.warn("Media integrity scheduled scan failed open.", {
        event: "MEDIA_INTEGRITY_SCAN_FAILED_OPEN",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return { ran: false, reason: "failed_open" };
    } finally {
      this.running = false;
    }
  }

  private isScheduleEnabled(): boolean {
    return isTrue(process.env.MEDIA_INTEGRITY_SCHEDULE_ENABLED);
  }

  private async captureMediaIntegrityAlert(result: MediaIntegrityScanResult): Promise<void> {
    if (!this.internalOpsAlertsService) {
      return;
    }
    try {
      const alertResult = await this.internalOpsAlertsService.captureMediaIntegrityDefects({
        missingCount: result.totals.missing,
        unverifiableCount: result.totals.unverifiable,
        invalidPathCount: result.totals.invalidPath,
        storageErrorCount: result.totals.storageErrors,
        affectedTenantCount: result.impact.affectedTenantCount,
      });
      this.logger.info("Media integrity alert evaluation completed.", {
        event: "MEDIA_INTEGRITY_ALERT_EVALUATED",
        runId: result.runId,
        alerted: alertResult.alerted,
        reason: alertResult.reason,
      });
    } catch (error: unknown) {
      this.logger.warn("Media integrity alert evaluation failed open.", {
        event: "MEDIA_INTEGRITY_ALERT_FAILED_OPEN",
        runId: result.runId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function isTrue(value: unknown): boolean {
  return String(value ?? "").trim().toLowerCase() === "true";
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function resolveOptionalInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function resolveInteger(value: unknown, fallback: number, min: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.floor(parsed));
}
