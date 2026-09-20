import { Injectable, OnApplicationBootstrap, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { BulkImportJobStatus, ExportJobStatus, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { LoggerService } from "../common/logging/logger.service";
import { runWithAdvisoryLock } from "../common/scheduling/advisory-lock";
import { PrismaDirectService } from "../prisma/prisma-direct.service";
import { QUEUE_NAMES } from "../queue/queue.constants";
import {
  INTERNAL_OPS_STUCK_LOOKBACK_DAYS,
  INTERNAL_OPS_STUCK_THRESHOLD_HOURS,
} from "./internal-ops.constants";

export type InternalOpsAlertType =
  | "error_authority_new_p0p1_issue"
  | "stuck_jobs_threshold_exceeded"
  | "media_integrity_defect_detected"
  | "auth_email_job_failure_threshold_exceeded";
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
  missingCount?: number;
  unverifiableCount?: number;
  affectedTenantCount?: number;
  authEmailFailureCount?: number;
  authEmailFailureThreshold?: number;
  authEmailFailureWindowMinutes?: number;
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
const MEDIA_INTEGRITY_ALERT_KEY = "media_integrity:defects";
const MEDIA_INTEGRITY_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

// H-2 follow-up: auth.email.job_failed threshold alert. This is the "reset/unlock/
// signup mail never left the building" signal (BullMQ auth-email consumer failure) —
// distinct from Resend delivery/bounce visibility (H-2's webhook path), which
// requires a Resend plan upgrade that was checked and declined. This alert needs
// no such upgrade: it counts the metric the API already emits on its own.
const AUTH_EMAIL_JOB_FAILURE_ALERT_KEY = "auth_email_job_failure:global";
const AUTH_EMAIL_JOB_FAILURE_EVALUATION_INTERVAL_MS = 5 * 60 * 1000;
const AUTH_EMAIL_JOB_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const AUTH_EMAIL_JOB_FAILURE_THRESHOLD = 3;
const AUTH_EMAIL_JOB_FAILURE_COOLDOWN_MS = 30 * 60 * 1000;

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
  private authEmailFailureTimer: ReturnType<typeof setTimeout> | null = null;
  private authEmailFailureIntervalId: ReturnType<typeof setInterval> | null = null;
  private evaluatingAuthEmailJobFailures = false;
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
      void this.runScheduledStuckJobEvaluation();
      this.intervalId = setInterval(() => void this.runScheduledStuckJobEvaluation(), OPS_ALERT_STUCK_EVALUATION_INTERVAL_MS);
      this.intervalId.unref();
    }, OPS_ALERT_INITIAL_DELAY_MS);
    this.timer.unref();

    if (String(process.env.OPS_ALERT_AUTH_EMAIL_JOB_FAILURE_CHECK_DISABLED ?? "").trim().toLowerCase() === "true") {
      this.logger.info("Internal ops auth-email job-failure alert evaluation disabled.");
      return;
    }
    this.authEmailFailureTimer = setTimeout(() => {
      void this.runScheduledAuthEmailJobFailureEvaluation();
      this.authEmailFailureIntervalId = setInterval(
        () => void this.runScheduledAuthEmailJobFailureEvaluation(),
        AUTH_EMAIL_JOB_FAILURE_EVALUATION_INTERVAL_MS,
      );
      this.authEmailFailureIntervalId.unref();
    }, OPS_ALERT_INITIAL_DELAY_MS);
    this.authEmailFailureTimer.unref();
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
    if (this.authEmailFailureTimer) {
      clearTimeout(this.authEmailFailureTimer);
      this.authEmailFailureTimer = null;
    }
    if (this.authEmailFailureIntervalId) {
      clearInterval(this.authEmailFailureIntervalId);
      this.authEmailFailureIntervalId = null;
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

  private async runScheduledStuckJobEvaluation(): Promise<void> {
    let ran = false;
    try {
      ran = await runWithAdvisoryLock("internal-ops-alerts", () => this.evaluateStuckJobs().then(() => undefined));
    } catch (error: unknown) {
      this.logger.error("Scheduler lock failure for internal-ops-alerts.", {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (!ran) {
      this.logger.info("Skipped internal ops stuck-job alert evaluation: another replica holds the scheduler lock.");
    }
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

  private async runScheduledAuthEmailJobFailureEvaluation(): Promise<void> {
    let ran = false;
    try {
      ran = await runWithAdvisoryLock("internal-ops-alerts-auth-email", () =>
        this.evaluateAuthEmailJobFailures().then(() => undefined),
      );
    } catch (error: unknown) {
      this.logger.error("Scheduler lock failure for internal-ops-alerts-auth-email.", {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (!ran) {
      this.logger.info(
        "Skipped internal ops auth-email job-failure alert evaluation: another replica holds the scheduler lock.",
      );
    }
  }

  async evaluateAuthEmailJobFailures(
    now = new Date(),
  ): Promise<{ alerted: boolean; failureCount: number; reason: string }> {
    if (this.evaluatingAuthEmailJobFailures) {
      return { alerted: false, failureCount: 0, reason: "already_running" };
    }
    this.evaluatingAuthEmailJobFailures = true;
    try {
      const failureCount = await this.countRecentAuthEmailJobFailures(now);
      const result = await this.processAuthEmailJobFailureCount(failureCount, now);
      return { ...result, failureCount };
    } catch (error: unknown) {
      this.logger.warn("Internal ops auth-email job-failure alert evaluation failed open.", {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return { alerted: false, failureCount: 0, reason: "evaluation_failed_open" };
    } finally {
      this.evaluatingAuthEmailJobFailures = false;
    }
  }

  async processAuthEmailJobFailureCount(
    failureCountInput: number,
    observedAt = new Date(),
  ): Promise<{ alerted: boolean; reason: string }> {
    const failureCount = Math.max(0, Math.floor(Number(failureCountInput) || 0));
    if (failureCount <= AUTH_EMAIL_JOB_FAILURE_THRESHOLD) {
      await this.resetAuthEmailJobFailureBreach(observedAt);
      return { alerted: false, reason: "not_breached" };
    }

    const cooldownUntil = new Date(observedAt.getTime() + AUTH_EMAIL_JOB_FAILURE_COOLDOWN_MS);
    const reserved = await this.reserveAuthEmailJobFailureAlert(observedAt, cooldownUntil);
    if (!reserved) {
      await this.touchAlertState(AUTH_EMAIL_JOB_FAILURE_ALERT_KEY, observedAt);
      return { alerted: false, reason: "cooldown_active" };
    }

    await this.enqueueAlert({
      version: OPS_ALERT_VERSION,
      alertType: "auth_email_job_failure_threshold_exceeded",
      severity: "p1",
      environment: this.resolveEnvironment(),
      release: this.resolveRelease(),
      observedAt: observedAt.toISOString(),
      internalUrl: this.buildInternalUrl("/internal/ops"),
      authEmailFailureCount: failureCount,
      authEmailFailureThreshold: AUTH_EMAIL_JOB_FAILURE_THRESHOLD,
      authEmailFailureWindowMinutes: AUTH_EMAIL_JOB_FAILURE_WINDOW_MS / (60 * 1000),
    });

    return { alerted: true, reason: "queued" };
  }

  private async countRecentAuthEmailJobFailures(now: Date): Promise<number> {
    const windowStart = new Date(now.getTime() - AUTH_EMAIL_JOB_FAILURE_WINDOW_MS);
    const db = this.prismaDirect.getClient();
    const count = await db.kpiMetricEvent.count({
      where: {
        metricKey: "auth.email.job_failed",
        observedAt: { gte: windowStart, lte: now },
      },
    });
    return Number(count ?? 0);
  }

  async captureMediaIntegrityDefects(input: {
    missingCount: number;
    unverifiableCount: number;
    invalidPathCount?: number;
    storageErrorCount?: number;
    affectedTenantCount: number;
    observedAt?: Date;
  }): Promise<{ alerted: boolean; reason: string }> {
    const observedAt = input.observedAt ?? new Date();
    const missingCount = normalizeCount(input.missingCount);
    const unverifiableCount = normalizeCount(input.unverifiableCount);
    const invalidPathCount = normalizeCount(input.invalidPathCount);
    const storageErrorCount = normalizeCount(input.storageErrorCount);
    const affectedTenantCount = normalizeCount(input.affectedTenantCount);
    const defectCount = missingCount + unverifiableCount + invalidPathCount + storageErrorCount;

    if (defectCount <= 0) {
      await this.resetMediaIntegrityBreach(observedAt);
      return { alerted: false, reason: "not_breached" };
    }

    const cooldownUntil = new Date(observedAt.getTime() + MEDIA_INTEGRITY_ALERT_COOLDOWN_MS);
    const reserved = await this.reserveMediaIntegrityAlert(observedAt, cooldownUntil);
    if (!reserved) {
      await this.touchAlertState(MEDIA_INTEGRITY_ALERT_KEY, observedAt);
      return { alerted: false, reason: "cooldown_active" };
    }

    await this.enqueueAlert({
      version: OPS_ALERT_VERSION,
      alertType: "media_integrity_defect_detected",
      severity: "p1",
      environment: this.resolveEnvironment(),
      release: this.resolveRelease(),
      observedAt: observedAt.toISOString(),
      internalUrl: this.buildInternalUrl("/internal/ops"),
      missingCount,
      unverifiableCount,
      affectedTenantCount,
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
    // RLS-BYPASS: ops_alert_states is a global platform-ops table by design, keyed on
    // alert_key (not per-tenant) — it dedupes/cooldowns internal alerting across the
    // whole deployment, same reasoning as tenant-directory.service.ts's deliberate
    // unscoped-client use during provisioning. Every raw call in this file targets
    // this same table for this same reason.
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
    // RLS-BYPASS: ops_alert_states is global by design — see reserveNewIssueAlert.
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

    // RLS-BYPASS: ops_alert_states is global by design — see reserveNewIssueAlert.
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

  private async reserveMediaIntegrityAlert(observedAt: Date, cooldownUntil: Date): Promise<boolean> {
    // RLS-BYPASS: ops_alert_states is global by design — see reserveNewIssueAlert.
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
        ${MEDIA_INTEGRITY_ALERT_KEY},
        ${"media_integrity_defect_detected"},
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

    // RLS-BYPASS: ops_alert_states is global by design — see reserveNewIssueAlert.
    const updated = await this.prismaDirect.getClient().$queryRaw<AlertStateRow[]>(Prisma.sql`
      UPDATE ops_alert_states
      SET
        last_observed_at = ${observedAt},
        last_sent_at = ${observedAt},
        cooldown_until = ${cooldownUntil},
        updated_at = ${observedAt}
      WHERE alert_key = ${MEDIA_INTEGRITY_ALERT_KEY}
        AND (cooldown_until IS NULL OR cooldown_until <= ${observedAt})
      RETURNING alert_key
    `);
    return updated.length > 0;
  }

  private async reserveAuthEmailJobFailureAlert(observedAt: Date, cooldownUntil: Date): Promise<boolean> {
    // RLS-BYPASS: ops_alert_states is global by design — see reserveNewIssueAlert.
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
        ${AUTH_EMAIL_JOB_FAILURE_ALERT_KEY},
        ${"auth_email_job_failure_threshold_exceeded"},
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

    // RLS-BYPASS: ops_alert_states is global by design — see reserveNewIssueAlert.
    const updated = await this.prismaDirect.getClient().$queryRaw<AlertStateRow[]>(Prisma.sql`
      UPDATE ops_alert_states
      SET
        last_observed_at = ${observedAt},
        last_sent_at = ${observedAt},
        cooldown_until = ${cooldownUntil},
        updated_at = ${observedAt}
      WHERE alert_key = ${AUTH_EMAIL_JOB_FAILURE_ALERT_KEY}
        AND (cooldown_until IS NULL OR cooldown_until <= ${observedAt})
      RETURNING alert_key
    `);
    return updated.length > 0;
  }

  private async resetAuthEmailJobFailureBreach(observedAt: Date): Promise<void> {
    // RLS-BYPASS: ops_alert_states is global by design — see reserveNewIssueAlert.
    await this.prismaDirect.getClient().$executeRaw(Prisma.sql`
      UPDATE ops_alert_states
      SET
        first_observed_at = ${observedAt},
        last_observed_at = ${observedAt},
        last_sent_at = NULL,
        cooldown_until = NULL,
        updated_at = ${observedAt}
      WHERE alert_key = ${AUTH_EMAIL_JOB_FAILURE_ALERT_KEY}
    `);
  }

  private async touchAlertState(alertKey: string, observedAt: Date): Promise<void> {
    // RLS-BYPASS: ops_alert_states is global by design — see reserveNewIssueAlert.
    await this.prismaDirect.getClient().$executeRaw(Prisma.sql`
      UPDATE ops_alert_states
      SET last_observed_at = ${observedAt}, updated_at = ${observedAt}
      WHERE alert_key = ${alertKey}
    `);
  }

  private async resetStuckJobBreach(observedAt: Date): Promise<void> {
    // RLS-BYPASS: ops_alert_states is global by design — see reserveNewIssueAlert.
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

  private async resetMediaIntegrityBreach(observedAt: Date): Promise<void> {
    // RLS-BYPASS: ops_alert_states is global by design — see reserveNewIssueAlert.
    await this.prismaDirect.getClient().$executeRaw(Prisma.sql`
      UPDATE ops_alert_states
      SET
        first_observed_at = ${observedAt},
        last_observed_at = ${observedAt},
        last_sent_at = NULL,
        cooldown_until = NULL,
        updated_at = ${observedAt}
      WHERE alert_key = ${MEDIA_INTEGRITY_ALERT_KEY}
    `);
  }

  private async enqueueAlert(envelope: InternalOpsAlertEnvelope): Promise<void> {
    if (!this.resolveDestinationUrl() && !this.resolveSlackWebhookUrl()) {
      this.logger.warn("Internal ops alert delivery skipped because no destination is configured.", {
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
    // Slack delivery is best-effort and independent of the legacy sink below: it
    // must never block or fail the primary delivery (which drives this queue
    // consumer's retry/backpressure behavior), and it must still fire even when
    // the legacy sink destination isn't configured at all.
    await this.deliverSlackAlert(envelope);

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
        "X-Alert-Contact": String(process.env.PIM_EMAIL_TEAM_EMAIL ?? "team@vexapim.com").trim(),
      },
      body: JSON.stringify(this.filterEnvelope(envelope)),
      signal: AbortSignal.timeout(OPS_ALERT_WEBHOOK_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Internal ops alert destination returned ${response.status}`);
    }
  }

  private async deliverSlackAlert(envelope: InternalOpsAlertEnvelope): Promise<void> {
    const slackWebhookUrl = this.resolveSlackWebhookUrl();
    if (!slackWebhookUrl) {
      return;
    }

    try {
      const response = await fetch(slackWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: this.buildSlackMessageText(envelope) }),
        signal: AbortSignal.timeout(OPS_ALERT_WEBHOOK_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`Slack webhook returned ${response.status}`);
      }
    } catch (error: unknown) {
      this.logger.warn("Internal ops Slack alert delivery failed.", {
        alertType: envelope.alertType,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private buildSlackMessageText(envelope: InternalOpsAlertEnvelope): string {
    const severityLabel = envelope.severity.toUpperCase();
    const envLabel = envelope.environment;
    const link = envelope.internalUrl;
    switch (envelope.alertType) {
      case "error_authority_new_p0p1_issue":
        return `:rotating_light: [${severityLabel}] New ${severityLabel} issue in ${envLabel} — issue \`${envelope.issueId ?? "unknown"}\`. <${link}|View in Error Authority>`;
      case "stuck_jobs_threshold_exceeded":
        return `:warning: [${severityLabel}] ${normalizeCount(envelope.stuckCount)} job(s) stuck for over ${envelope.stuckAgeThresholdHours ?? INTERNAL_OPS_STUCK_THRESHOLD_HOURS}h in ${envLabel}. <${link}|View stuck jobs>`;
      case "media_integrity_defect_detected":
        return `:warning: [${severityLabel}] Media integrity defects in ${envLabel}: ${normalizeCount(envelope.missingCount)} missing, ${normalizeCount(envelope.unverifiableCount)} unverifiable across ${normalizeCount(envelope.affectedTenantCount)} tenant(s). <${link}|View details>`;
      case "auth_email_job_failure_threshold_exceeded":
        return `:warning: [${severityLabel}] ${normalizeCount(envelope.authEmailFailureCount)} auth email job failures in the last ${envelope.authEmailFailureWindowMinutes ?? AUTH_EMAIL_JOB_FAILURE_WINDOW_MS / (60 * 1000)} min in ${envLabel} (threshold ${envelope.authEmailFailureThreshold ?? AUTH_EMAIL_JOB_FAILURE_THRESHOLD}). <${link}|View details>`;
      default:
        return `:warning: [${severityLabel}] Internal ops alert (${envelope.alertType}) in ${envLabel}. <${link}|View details>`;
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
    if (envelope.alertType === "media_integrity_defect_detected") {
      return {
        ...base,
        missingCount: normalizeCount(envelope.missingCount),
        unverifiableCount: normalizeCount(envelope.unverifiableCount),
        affectedTenantCount: normalizeCount(envelope.affectedTenantCount),
      };
    }
    if (envelope.alertType === "auth_email_job_failure_threshold_exceeded") {
      return {
        ...base,
        authEmailFailureCount: normalizeCount(envelope.authEmailFailureCount),
        authEmailFailureThreshold: AUTH_EMAIL_JOB_FAILURE_THRESHOLD,
        authEmailFailureWindowMinutes: AUTH_EMAIL_JOB_FAILURE_WINDOW_MS / (60 * 1000),
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

  private resolveSlackWebhookUrl(): string | null {
    const raw = String(process.env.OPS_ALERT_SLACK_WEBHOOK_URL ?? "").trim();
    if (!raw) {
      return null;
    }
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === "https:") {
        return parsed.toString();
      }
    } catch {
      // fall through to the warning below
    }
    this.logger.warn("Internal ops Slack alert webhook is invalid; Slack delivery disabled.");
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
    if (envelope.alertType === "media_integrity_defect_detected") {
      return `ops-alert-media-integrity-${this.sanitizeQueueJobId(envelope.observedAt)}`;
    }
    if (envelope.alertType === "auth_email_job_failure_threshold_exceeded") {
      return `ops-alert-auth-email-failures-${this.sanitizeQueueJobId(envelope.observedAt)}`;
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

function normalizeCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}
