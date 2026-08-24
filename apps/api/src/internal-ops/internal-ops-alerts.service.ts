import { Injectable, OnApplicationBootstrap, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { BulkImportJobStatus, ExportJobStatus, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { LoggerService } from "../common/logging/logger.service";
import { PrismaDirectService } from "../prisma/prisma-direct.service";
import { QUEUE_NAMES } from "../queue/queue.constants";
import {
  INTERNAL_OPS_STUCK_LOOKBACK_DAYS,
  INTERNAL_OPS_STUCK_THRESHOLD_HOURS,
} from "./internal-ops.constants";

export type InternalOpsAlertType = "error_authority_new_p0p1_issue" | "stuck_jobs_threshold_exceeded";
export type InternalOpsAlertSeverity = "p0" | "p1";

export type InternalOpsAlertEnvelope = {
  version: 1;
  alertType: InternalOpsAlertType;
  severity: InternalOpsAlertSeverity;
  environment: string;
  release: string | null;
  observedAt: string;
  internalUrl: string;
  issueId?: string;
  stuckCount?: number;
  stuckAgeThresholdHours?: number;
};

type OpsAlertQueuePayload = {
  envelope: InternalOpsAlertEnvelope;
};

type AlertStateRow = {
  alert_key: string;
};

type InternalOpsQueuePort = {
  enqueue(queueName: string, payload: unknown, options?: { jobId?: string }): Promise<unknown>;
  processWithBackpressure<TPayload>(
    queueName: string,
    options: unknown,
    handler: (payload: TPayload) => Promise<void> | void,
  ): void;
};

const OPS_ALERT_VERSION = 1;
const OPS_ALERT_WEBHOOK_TIMEOUT_MS = 10_000;
const OPS_ALERT_INITIAL_DELAY_MS = 2 * 60 * 1000;
const OPS_ALERT_STUCK_EVALUATION_INTERVAL_MS = 5 * 60 * 1000;
const OPS_ALERT_STUCK_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const STUCK_ALERT_KEY = "stuck_jobs:global";

const EXPORT_ACTIVE_STATUSES = [ExportJobStatus.queued, ExportJobStatus.processing, ExportJobStatus.retrying] as const;
const IMPORT_JOB_ACTIVE_STATUSES = [
  BulkImportJobStatus.queued,
  BulkImportJobStatus.processing,
  BulkImportJobStatus.retrying,
] as const;

@Injectable()
export class InternalOpsAlertsService implements OnModuleInit, OnApplicationBootstrap, OnApplicationShutdown {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private evaluatingStuckJobs = false;
  private queueService: InternalOpsQueuePort | null | undefined;

  constructor(
    private readonly prismaDirect: PrismaDirectService,
    private readonly moduleRef: ModuleRef,
    private readonly logger: LoggerService,
  ) {}

  onModuleInit(): void {
    const queueService = this.resolveQueueService();
    if (!queueService) {
      this.logger.warn("Internal ops alert queue registration skipped because queue service is unavailable.");
      return;
    }

    queueService.processWithBackpressure<OpsAlertQueuePayload>(
      QUEUE_NAMES.INTERNAL_OPS_ALERT,
      {
        laneResolver: () => "default",
        defaultLanePolicy: {
          concurrency: 1,
          minIntervalMs: 1_000,
          rateLimitFailureThreshold: 3,
          pauseDurationMs: 30_000,
        },
      },
      async (payload) => {
        await this.deliverAlert(payload.envelope);
      },
    );
  }

  onApplicationBootstrap(): void {
    if (String(process.env.OPS_ALERT_STUCK_JOB_CHECK_DISABLED ?? "").trim().toLowerCase() === "true") {
      this.logger.info("Internal ops stuck-job alert evaluation disabled.");
      return;
    }
    if (String(process.env.QUEUE_WORKER_ENABLED ?? "true").trim().toLowerCase() === "false") {
      return;
    }
    this.timer = setTimeout(() => {
      void this.evaluateStuckJobs();
      this.intervalId = setInterval(() => void this.evaluateStuckJobs(), OPS_ALERT_STUCK_EVALUATION_INTERVAL_MS);
      this.intervalId.unref();
    }, OPS_ALERT_INITIAL_DELAY_MS);
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

  async captureNewP0P1Issue(input: {
    issueId: string;
    severity: string;
    observedAt?: Date;
  }): Promise<{ alerted: boolean; reason: string }> {
    const severity = this.normalizeSeverity(input.severity);
    if (!severity) {
      return { alerted: false, reason: "severity_not_eligible" };
    }

    const issueId = String(input.issueId ?? "").trim();
    if (!issueId) {
      return { alerted: false, reason: "issue_id_missing" };
    }

    const observedAt = input.observedAt ?? new Date();
    const alertKey = `error:p0p1:${issueId}`;
    const reserved = await this.reserveNewIssueAlert(alertKey, observedAt);
    if (!reserved) {
      return { alerted: false, reason: "deduped" };
    }

    await this.enqueueAlert({
      version: OPS_ALERT_VERSION,
      alertType: "error_authority_new_p0p1_issue",
      severity,
      environment: this.resolveEnvironment(),
      release: this.resolveRelease(),
      observedAt: observedAt.toISOString(),
      internalUrl: this.buildInternalUrl("/internal/ops/errors"),
      issueId,
    });

    return { alerted: true, reason: "queued" };
  }

  async evaluateStuckJobs(now = new Date()): Promise<{ alerted: boolean; stuckCount: number; reason: string }> {
    if (this.evaluatingStuckJobs) {
      return { alerted: false, stuckCount: 0, reason: "already_running" };
    }
    this.evaluatingStuckJobs = true;
    try {
      const stuckCount = await this.countStuckJobs(now);
      const result = await this.processStuckJobCount(stuckCount, now);
      return { ...result, stuckCount };
    } catch (error: unknown) {
      this.logger.warn("Internal ops stuck-job alert evaluation failed open.", {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return { alerted: false, stuckCount: 0, reason: "evaluation_failed_open" };
    } finally {
      this.evaluatingStuckJobs = false;
    }
  }

  async processStuckJobCount(
    stuckCountInput: number,
    observedAt = new Date(),
  ): Promise<{ alerted: boolean; reason: string }> {
    const stuckCount = Math.max(0, Math.floor(Number(stuckCountInput) || 0));
    if (stuckCount <= 0) {
      await this.resetStuckJobBreach(observedAt);
      return { alerted: false, reason: "not_breached" };
    }

    const cooldownUntil = new Date(observedAt.getTime() + OPS_ALERT_STUCK_COOLDOWN_MS);
    const reserved = await this.reserveStuckJobAlert(observedAt, cooldownUntil);
    if (!reserved) {
      await this.touchAlertState(STUCK_ALERT_KEY, observedAt);
      return { alerted: false, reason: "cooldown_active" };
    }

    await this.enqueueAlert({
      version: OPS_ALERT_VERSION,
      alertType: "stuck_jobs_threshold_exceeded",
      severity: "p1",
      environment: this.resolveEnvironment(),
      release: this.resolveRelease(),
      observedAt: observedAt.toISOString(),
      internalUrl: this.buildInternalUrl("/internal/ops"),
      stuckCount,
      stuckAgeThresholdHours: INTERNAL_OPS_STUCK_THRESHOLD_HOURS,
    });

    return { alerted: true, reason: "queued" };
  }

  private async countStuckJobs(now: Date): Promise<number> {
    const stuckFrom = subtractDays(now, INTERNAL_OPS_STUCK_LOOKBACK_DAYS);
    const stuckBefore = new Date(now.getTime() - INTERNAL_OPS_STUCK_THRESHOLD_HOURS * 60 * 60 * 1000);
    const db = this.prismaDirect.getClient();
    const [stuckExports, stuckImports] = await db.$transaction(
      async (tx) =>
        Promise.all([
          tx.marketplaceExportJob.count({
            where: {
              status: { in: [...EXPORT_ACTIVE_STATUSES] },
              updatedAt: { gte: stuckFrom, lte: stuckBefore },
            },
          }),
          tx.bulkImportJob.count({
            where: {
              status: { in: [...IMPORT_JOB_ACTIVE_STATUSES] },
              updatedAt: { gte: stuckFrom, lte: stuckBefore },
            },
          }),
        ]),
      { timeout: 3_000 },
    );
    return Number(stuckExports ?? 0) + Number(stuckImports ?? 0);
  }

  private async reserveNewIssueAlert(alertKey: string, observedAt: Date): Promise<boolean> {
    const rows = await this.prismaDirect.getClient().$queryRaw<AlertStateRow[]>(Prisma.sql`
      INSERT INTO ops_alert_states (
        id,
        alert_key,
        alert_type,
        first_observed_at,
        last_observed_at,
        last_sent_at,
        cooldown_until,
        created_at,
        updated_at
      )
      VALUES (
        ${randomUUID()},
        ${alertKey},
        ${"error_authority_new_p0p1_issue"},
        ${observedAt},
        ${observedAt},
        ${observedAt},
        NULL,
        ${observedAt},
        ${observedAt}
      )
      ON CONFLICT (alert_key) DO NOTHING
      RETURNING alert_key
    `);
    return rows.length > 0;
  }

  private async reserveStuckJobAlert(observedAt: Date, cooldownUntil: Date): Promise<boolean> {
    const inserted = await this.prismaDirect.getClient().$queryRaw<AlertStateRow[]>(Prisma.sql`
      INSERT INTO ops_alert_states (
        id,
        alert_key,
        alert_type,
        first_observed_at,
        last_observed_at,
        last_sent_at,
        cooldown_until,
        created_at,
        updated_at
      )
      VALUES (
        ${randomUUID()},
        ${STUCK_ALERT_KEY},
        ${"stuck_jobs_threshold_exceeded"},
        ${observedAt},
        ${observedAt},
        ${observedAt},
        ${cooldownUntil},
        ${observedAt},
        ${observedAt}
      )
      ON CONFLICT (alert_key) DO NOTHING
      RETURNING alert_key
    `);
    if (inserted.length > 0) {
      return true;
    }

    const updated = await this.prismaDirect.getClient().$queryRaw<AlertStateRow[]>(Prisma.sql`
      UPDATE ops_alert_states
      SET
        last_observed_at = ${observedAt},
        last_sent_at = ${observedAt},
        cooldown_until = ${cooldownUntil},
        updated_at = ${observedAt}
      WHERE alert_key = ${STUCK_ALERT_KEY}
        AND (cooldown_until IS NULL OR cooldown_until <= ${observedAt})
      RETURNING alert_key
    `);
    return updated.length > 0;
  }

  private async touchAlertState(alertKey: string, observedAt: Date): Promise<void> {
    await this.prismaDirect.getClient().$executeRaw(Prisma.sql`
      UPDATE ops_alert_states
      SET last_observed_at = ${observedAt}, updated_at = ${observedAt}
      WHERE alert_key = ${alertKey}
    `);
  }

  private async resetStuckJobBreach(observedAt: Date): Promise<void> {
    await this.prismaDirect.getClient().$executeRaw(Prisma.sql`
      UPDATE ops_alert_states
      SET
        first_observed_at = ${observedAt},
        last_observed_at = ${observedAt},
        last_sent_at = NULL,
        cooldown_until = NULL,
        updated_at = ${observedAt}
      WHERE alert_key = ${STUCK_ALERT_KEY}
    `);
  }

  private async enqueueAlert(envelope: InternalOpsAlertEnvelope): Promise<void> {
    if (!this.resolveDestinationUrl()) {
      this.logger.warn("Internal ops alert delivery skipped because destination is not configured.", {
        alertType: envelope.alertType,
      });
      return;
    }

    try {
      const queueService = this.resolveQueueService();
      if (!queueService) {
        this.logger.warn("Internal ops alert enqueue skipped because queue service is unavailable.", {
          alertType: envelope.alertType,
        });
        return;
      }

      await queueService.enqueue(
        QUEUE_NAMES.INTERNAL_OPS_ALERT,
        { envelope },
        { jobId: this.buildQueueJobId(envelope) },
      );
    } catch (error: unknown) {
      this.logger.warn("Internal ops alert enqueue failed open.", {
        alertType: envelope.alertType,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async deliverAlert(envelope: InternalOpsAlertEnvelope): Promise<void> {
    const destinationUrl = this.resolveDestinationUrl();
    if (!destinationUrl) {
      this.logger.warn("Internal ops alert delivery skipped because destination is not configured.", {
        alertType: envelope.alertType,
      });
      return;
    }

    const response = await fetch(destinationUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Vexa-PIM-InternalOpsAlert/1.0",
      },
      body: JSON.stringify(this.filterEnvelope(envelope)),
      signal: AbortSignal.timeout(OPS_ALERT_WEBHOOK_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Internal ops alert destination returned ${response.status}`);
    }
  }

  private filterEnvelope(envelope: InternalOpsAlertEnvelope): InternalOpsAlertEnvelope {
    const base: InternalOpsAlertEnvelope = {
      version: OPS_ALERT_VERSION,
      alertType: envelope.alertType,
      severity: envelope.severity,
      environment: envelope.environment,
      release: envelope.release,
      observedAt: envelope.observedAt,
      internalUrl: envelope.internalUrl,
    };
    if (envelope.alertType === "error_authority_new_p0p1_issue" && envelope.issueId) {
      return { ...base, issueId: envelope.issueId };
    }
    if (envelope.alertType === "stuck_jobs_threshold_exceeded") {
      return {
        ...base,
        stuckCount: Number(envelope.stuckCount ?? 0),
        stuckAgeThresholdHours: INTERNAL_OPS_STUCK_THRESHOLD_HOURS,
      };
    }
    return base;
  }

  private resolveDestinationUrl(): string | null {
    const raw = String(process.env.OPS_ALERT_WEBHOOK_URL ?? "").trim();
    if (!raw) {
      return null;
    }
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === "https:") {
        return parsed.toString();
      }
      const env = this.resolveEnvironment().toLowerCase();
      const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
      if ((env === "development" || env === "test") && parsed.protocol === "http:" && isLocalhost) {
        return parsed.toString();
      }
    } catch {
      // fall through to the redacted warning below
    }
    this.logger.warn("Internal ops alert destination is invalid; delivery disabled.");
    return null;
  }

  private resolveEnvironment(): string {
    return String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "development").trim() || "development";
  }

  private resolveRelease(): string | null {
    const release = String(process.env.ERROR_AUTHORITY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "").trim();
    return release || null;
  }

  private buildInternalUrl(path: string): string {
    const baseUrl = String(process.env.PIM_WEB_BASE_URL ?? "").trim().replace(/\/+$/, "");
    return baseUrl ? `${baseUrl}${path}` : path;
  }

  private buildQueueJobId(envelope: InternalOpsAlertEnvelope): string {
    if (envelope.alertType === "error_authority_new_p0p1_issue") {
      return `ops-alert-error-p0p1-${this.sanitizeQueueJobId(envelope.issueId ?? "unknown")}`;
    }
    return `ops-alert-stuck-jobs-${this.sanitizeQueueJobId(envelope.observedAt)}`;
  }

  private sanitizeQueueJobId(value: unknown): string {
    return String(value ?? "unknown")
      .trim()
      .replace(/[^A-Za-z0-9_-]/g, "_")
      .slice(0, 180) || "unknown";
  }

  private normalizeSeverity(value: string): InternalOpsAlertSeverity | null {
    const normalized = String(value ?? "").trim().toLowerCase();
    return normalized === "p0" || normalized === "p1" ? normalized : null;
  }

  private resolveQueueService(): InternalOpsQueuePort | null {
    if (this.queueService !== undefined) {
      return this.queueService;
    }
    try {
      // QueueService imports Error Authority capture, which may import this service.
      // Resolve the provider lazily to avoid a constructor metadata cycle at bootstrap.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { QueueService } = require("../queue/queue.service") as {
        QueueService: new (...args: unknown[]) => InternalOpsQueuePort;
      };
      this.queueService = this.moduleRef.get<InternalOpsQueuePort>(QueueService, { strict: false });
    } catch (error: unknown) {
      this.queueService = null;
      this.logger.warn("Internal ops alert queue service resolution failed open.", {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
    return this.queueService;
  }
}

function subtractDays(value: Date, days: number): Date {
  return new Date(value.getTime() - days * 24 * 60 * 60 * 1000);
}
