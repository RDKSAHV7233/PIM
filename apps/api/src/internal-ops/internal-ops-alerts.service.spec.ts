import { InternalOpsAlertsService } from "./internal-ops-alerts.service";

const ORIGINAL_ENV = process.env;

function makeService() {
  const tx = {
    marketplaceExportJob: { count: jest.fn().mockResolvedValue(0) },
    bulkImportJob: { count: jest.fn().mockResolvedValue(0) },
  };
  const db = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn((fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx)),
    kpiMetricEvent: { count: jest.fn().mockResolvedValue(0) },
  };
  const prismaDirect = { getClient: jest.fn().mockReturnValue(db) };
  const queueService = {
    enqueue: jest.fn().mockResolvedValue(undefined),
    processWithBackpressure: jest.fn(),
  };
  const moduleRef = {
    get: jest.fn().mockReturnValue(queueService),
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const service = new InternalOpsAlertsService(prismaDirect as never, moduleRef as never, logger as never);
  return { service, db, tx, queueService, moduleRef, logger };
}

function alertKeys(payload: unknown): string[] {
  return Object.keys((payload as { envelope?: Record<string, unknown> }).envelope ?? {}).sort();
}

describe("InternalOpsAlertsService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      APP_ENV: "test",
      ERROR_AUTHORITY_RELEASE: "test-sha",
      OPS_ALERT_WEBHOOK_URL: "http://localhost:3999/ops-alerts",
      PIM_WEB_BASE_URL: "https://ops.vexa.test",
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.restoreAllMocks();
  });

  it("queues one safe alert for a newly-created P0 issue", async () => {
    const { service, db, queueService } = makeService();
    db.$queryRaw.mockResolvedValueOnce([{ alert_key: "error:p0p1:iss_1" }]);

    await expect(service.captureNewP0P1Issue({ issueId: "iss_1", severity: "p0" })).resolves.toEqual({
      alerted: true,
      reason: "queued",
    });

    expect(queueService.enqueue).toHaveBeenCalledTimes(1);
    const payload = queueService.enqueue.mock.calls[0][1];
    expect(alertKeys(payload)).toEqual([
      "alertId",
      "alertType",
      "environment",
      "internalUrl",
      "issueId",
      "observedAt",
      "release",
      "severity",
      "version",
    ]);
    expect(payload.envelope).toMatchObject({
      version: 1,
      alertType: "error_authority_new_p0p1_issue",
      severity: "p0",
      environment: "test",
      release: "test-sha",
      internalUrl: "https://ops.vexa.test/internal/ops/errors",
      issueId: "iss_1",
    });
    expect(typeof payload.envelope.alertId).toBe("string");
    expect(payload.envelope.alertId.length).toBeGreaterThan(0);
    expect(queueService.enqueue.mock.calls[0][2].jobId).toBe("ops-alert-error-p0p1-iss_1");
    expect(JSON.stringify(payload)).not.toMatch(/tenant|product|connector|credential|headers|cookies|token|stack|payload/i);
  });

  it("dedupes the same P0/P1 issue through persistent alert state", async () => {
    const { service, db, queueService } = makeService();
    db.$queryRaw.mockResolvedValueOnce([]);

    await expect(service.captureNewP0P1Issue({ issueId: "iss_1", severity: "p1" })).resolves.toEqual({
      alerted: false,
      reason: "deduped",
    });

    expect(queueService.enqueue).not.toHaveBeenCalled();
  });

  it.each(["p2", "p3", "warning", ""])("does not alert for non-P0/P1 severity %s", async (severity) => {
    const { service, db, queueService } = makeService();

    await expect(service.captureNewP0P1Issue({ issueId: "iss_1", severity })).resolves.toEqual({
      alerted: false,
      reason: "severity_not_eligible",
    });

    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(queueService.enqueue).not.toHaveBeenCalled();
  });

  it("suppresses alert delivery when the destination is missing without throwing", async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = "";
    const { service, db, queueService, logger } = makeService();
    db.$queryRaw.mockResolvedValueOnce([{ alert_key: "error:p0p1:iss_1" }]);

    await expect(service.captureNewP0P1Issue({ issueId: "iss_1", severity: "p1" })).resolves.toEqual({
      alerted: true,
      reason: "queued",
    });

    expect(queueService.enqueue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "Internal ops alert delivery skipped because no destination is configured.",
      { alertType: "error_authority_new_p0p1_issue" },
    );
  });

  it("still enqueues for delivery when only the Slack webhook is configured (no legacy sink)", async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = "";
    process.env.OPS_ALERT_SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T000/B000/XXXX";
    const { service, db, queueService } = makeService();
    db.$queryRaw.mockResolvedValueOnce([{ alert_key: "error:p0p1:iss_1" }]);

    await expect(service.captureNewP0P1Issue({ issueId: "iss_1", severity: "p1" })).resolves.toEqual({
      alerted: true,
      reason: "queued",
    });

    expect(queueService.enqueue).toHaveBeenCalledTimes(1);
  });

  it("fails open when enqueue fails", async () => {
    const { service, db, queueService, logger } = makeService();
    db.$queryRaw.mockResolvedValueOnce([{ alert_key: "error:p0p1:iss_1" }]);
    queueService.enqueue.mockRejectedValueOnce(new Error("redis unavailable"));

    await expect(service.captureNewP0P1Issue({ issueId: "iss_1", severity: "p1" })).resolves.toEqual({
      alerted: true,
      reason: "queued",
    });

    expect(logger.warn).toHaveBeenCalledWith(
      "Internal ops alert enqueue failed open.",
      expect.objectContaining({
        alertType: "error_authority_new_p0p1_issue",
        errorMessage: "redis unavailable",
      }),
    );
  });

  it("does not alert when stuck count is zero and resets breach state", async () => {
    const { service, db, queueService } = makeService();

    await expect(service.processStuckJobCount(0, new Date("2026-08-23T10:00:00Z"))).resolves.toEqual({
      alerted: false,
      reason: "not_breached",
    });

    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(queueService.enqueue).not.toHaveBeenCalled();
  });

  it("alerts on first stuck-job breach", async () => {
    const { service, db, queueService } = makeService();
    db.$queryRaw.mockResolvedValueOnce([{ alert_key: "stuck_jobs:global" }]);

    await expect(service.processStuckJobCount(3, new Date("2026-08-23T10:00:00Z"))).resolves.toEqual({
      alerted: true,
      reason: "queued",
    });

    const payload = queueService.enqueue.mock.calls[0][1];
    expect(alertKeys(payload)).toEqual([
      "alertId",
      "alertType",
      "environment",
      "internalUrl",
      "observedAt",
      "release",
      "severity",
      "stuckAgeThresholdHours",
      "stuckCount",
      "version",
    ]);
    expect(payload.envelope).toMatchObject({
      alertType: "stuck_jobs_threshold_exceeded",
      severity: "p1",
      stuckCount: 3,
      stuckAgeThresholdHours: 6,
    });
    expect(queueService.enqueue.mock.calls[0][2].jobId).toBe("ops-alert-stuck-jobs-2026-08-23T10_00_00_000Z");
  });

  it("suppresses stuck-job alert while cooldown is active", async () => {
    const { service, db, queueService } = makeService();
    db.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expect(service.processStuckJobCount(2, new Date("2026-08-23T10:00:00Z"))).resolves.toEqual({
      alerted: false,
      reason: "cooldown_active",
    });

    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(queueService.enqueue).not.toHaveBeenCalled();
  });

  it("re-alerts for stuck jobs after cooldown expires", async () => {
    const { service, db, queueService } = makeService();
    db.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ alert_key: "stuck_jobs:global" }]);

    await expect(service.processStuckJobCount(2, new Date("2026-08-23T17:00:00Z"))).resolves.toEqual({
      alerted: true,
      reason: "queued",
    });

    expect(queueService.enqueue).toHaveBeenCalledTimes(1);
  });

  it("resets stuck breach and allows a later new breach", async () => {
    const { service, db, queueService } = makeService();
    await service.processStuckJobCount(0, new Date("2026-08-23T10:00:00Z"));
    db.$queryRaw.mockResolvedValueOnce([{ alert_key: "stuck_jobs:global" }]);

    await expect(service.processStuckJobCount(1, new Date("2026-08-23T11:00:00Z"))).resolves.toEqual({
      alerted: true,
      reason: "queued",
    });

    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(queueService.enqueue).toHaveBeenCalledTimes(1);
  });

  it("does not alert when auth-email failure count is at or below threshold and resets breach state", async () => {
    const { service, db, queueService } = makeService();

    await expect(service.processAuthEmailJobFailureCount(3, new Date("2026-08-23T10:00:00Z"))).resolves.toEqual({
      alerted: false,
      reason: "not_breached",
    });

    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(queueService.enqueue).not.toHaveBeenCalled();
  });

  it("alerts on first auth-email job-failure breach", async () => {
    const { service, db, queueService } = makeService();
    db.$queryRaw.mockResolvedValueOnce([{ alert_key: "auth_email_job_failure:global" }]);

    await expect(service.processAuthEmailJobFailureCount(4, new Date("2026-08-23T10:00:00Z"))).resolves.toEqual({
      alerted: true,
      reason: "queued",
    });

    const payload = queueService.enqueue.mock.calls[0][1];
    expect(alertKeys(payload)).toEqual([
      "alertId",
      "alertType",
      "authEmailFailureCount",
      "authEmailFailureThreshold",
      "authEmailFailureWindowMinutes",
      "environment",
      "internalUrl",
      "observedAt",
      "release",
      "severity",
      "version",
    ]);
    expect(payload.envelope).toMatchObject({
      alertType: "auth_email_job_failure_threshold_exceeded",
      severity: "p1",
      authEmailFailureCount: 4,
      authEmailFailureThreshold: 3,
      authEmailFailureWindowMinutes: 15,
    });
    expect(queueService.enqueue.mock.calls[0][2].jobId).toBe("ops-alert-auth-email-failures-2026-08-23T10_00_00_000Z");
    expect(JSON.stringify(payload)).not.toMatch(/tenant|product|connector|credential|headers|cookies|token|stack|payload/i);
  });

  it("suppresses auth-email job-failure alert while cooldown is active", async () => {
    const { service, db, queueService } = makeService();
    db.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(service.processAuthEmailJobFailureCount(5, new Date("2026-08-23T10:00:00Z"))).resolves.toEqual({
      alerted: false,
      reason: "cooldown_active",
    });

    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(queueService.enqueue).not.toHaveBeenCalled();
  });

  it("re-alerts for auth-email job failures after cooldown expires", async () => {
    const { service, db, queueService } = makeService();
    db.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ alert_key: "auth_email_job_failure:global" }]);

    await expect(service.processAuthEmailJobFailureCount(5, new Date("2026-08-23T10:31:00Z"))).resolves.toEqual({
      alerted: true,
      reason: "queued",
    });

    expect(queueService.enqueue).toHaveBeenCalledTimes(1);
  });

  it("resets auth-email job-failure breach and allows a later new breach", async () => {
    const { service, db, queueService } = makeService();
    await service.processAuthEmailJobFailureCount(0, new Date("2026-08-23T10:00:00Z"));
    db.$queryRaw.mockResolvedValueOnce([{ alert_key: "auth_email_job_failure:global" }]);

    await expect(service.processAuthEmailJobFailureCount(4, new Date("2026-08-23T11:00:00Z"))).resolves.toEqual({
      alerted: true,
      reason: "queued",
    });

    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(queueService.enqueue).toHaveBeenCalledTimes(1);
  });

  it("counts auth.email.job_failed rows in the trailing 15-minute window", async () => {
    const { service, db } = makeService();
    db.kpiMetricEvent.count.mockResolvedValue(2);

    const result = await service.evaluateAuthEmailJobFailures(new Date("2026-08-23T12:00:00Z"));

    expect(result.failureCount).toBe(2);
    expect(db.kpiMetricEvent.count).toHaveBeenCalledWith({
      where: {
        metricKey: "auth.email.job_failed",
        observedAt: { gte: new Date("2026-08-23T11:45:00Z"), lte: new Date("2026-08-23T12:00:00Z") },
      },
    });
  });

  it("queues one safe media-integrity alert when defects are detected", async () => {
    const { service, db, queueService } = makeService();
    db.$queryRaw.mockResolvedValueOnce([{ alert_key: "media_integrity:defects" }]);

    await expect(
      service.captureMediaIntegrityDefects({
        missingCount: 2,
        unverifiableCount: 3,
        invalidPathCount: 4,
        storageErrorCount: 5,
        affectedTenantCount: 2,
        observedAt: new Date("2026-08-25T10:00:00Z"),
      }),
    ).resolves.toEqual({
      alerted: true,
      reason: "queued",
    });

    expect(queueService.enqueue).toHaveBeenCalledTimes(1);
    const payload = queueService.enqueue.mock.calls[0][1];
    expect(alertKeys(payload)).toEqual([
      "affectedTenantCount",
      "alertId",
      "alertType",
      "environment",
      "internalUrl",
      "missingCount",
      "observedAt",
      "release",
      "severity",
      "unverifiableCount",
      "version",
    ]);
    expect(payload.envelope).toMatchObject({
      alertType: "media_integrity_defect_detected",
      severity: "p1",
      internalUrl: "https://ops.vexa.test/internal/ops",
      missingCount: 2,
      unverifiableCount: 3,
      affectedTenantCount: 2,
    });
    expect(queueService.enqueue.mock.calls[0][2].jobId).toBe("ops-alert-media-integrity-2026-08-25T10_00_00_000Z");
    expect(JSON.stringify(payload)).not.toMatch(/tenantKey|tenantName|asset|product|storagePath|objectKey|fileName|credential|headers|cookies|token|stack|payload/i);
  });

  it("does not alert for a clean media-integrity run and resets breach state", async () => {
    const { service, db, queueService } = makeService();

    await expect(
      service.captureMediaIntegrityDefects({
        missingCount: 0,
        unverifiableCount: 0,
        affectedTenantCount: 0,
        observedAt: new Date("2026-08-25T10:00:00Z"),
      }),
    ).resolves.toEqual({
      alerted: false,
      reason: "not_breached",
    });

    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(queueService.enqueue).not.toHaveBeenCalled();
  });

  it("suppresses repeated media-integrity alerts during cooldown", async () => {
    const { service, db, queueService } = makeService();
    db.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expect(
      service.captureMediaIntegrityDefects({
        missingCount: 1,
        unverifiableCount: 0,
        affectedTenantCount: 1,
        observedAt: new Date("2026-08-25T11:00:00Z"),
      }),
    ).resolves.toEqual({
      alerted: false,
      reason: "cooldown_active",
    });

    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(queueService.enqueue).not.toHaveBeenCalled();
  });

  it("re-alerts for media-integrity defects after cooldown expires", async () => {
    const { service, db, queueService } = makeService();
    db.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ alert_key: "media_integrity:defects" }]);

    await expect(
      service.captureMediaIntegrityDefects({
        missingCount: 0,
        unverifiableCount: 1,
        affectedTenantCount: 1,
        observedAt: new Date("2026-08-25T17:00:00Z"),
      }),
    ).resolves.toEqual({
      alerted: true,
      reason: "queued",
    });

    expect(queueService.enqueue).toHaveBeenCalledTimes(1);
  });

  it("uses the same stuck-job query bounds as internal ops summary", async () => {
    const { service, db, tx } = makeService();
    tx.marketplaceExportJob.count.mockResolvedValue(2);
    tx.bulkImportJob.count.mockResolvedValue(1);
    db.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service.evaluateStuckJobs(new Date("2026-08-23T12:00:00Z"));

    expect(result.stuckCount).toBe(3);
    expect(tx.marketplaceExportJob.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        updatedAt: {
          gte: new Date("2026-07-24T12:00:00Z"),
          lte: new Date("2026-08-23T06:00:00Z"),
        },
      }),
    }));
  });

  // #922: a healthy zero-count and a silently-dead watchdog were previously
  // indistinguishable in the logs. This test proves the heartbeat log fires on
  // every evaluation cycle regardless of the stuck count.
  it("logs a positive heartbeat on every evaluation cycle (zero-stuck case) — #922", async () => {
    const { service, logger } = makeService();

    await service.evaluateStuckJobs(new Date("2026-08-23T12:00:00Z"));

    expect(logger.info).toHaveBeenCalledWith(
      "Internal ops stuck-job evaluation complete.",
      expect.objectContaining({ stuckCount: 0 }),
    );
  });

  it("logs a positive heartbeat with per-type breakdown when jobs are found — #922", async () => {
    const { service, db, tx, logger } = makeService();
    tx.marketplaceExportJob.count.mockResolvedValue(2);
    tx.bulkImportJob.count.mockResolvedValue(1);
    db.$queryRaw.mockResolvedValueOnce([{ alert_key: "stuck_jobs:global" }]);

    await service.evaluateStuckJobs(new Date("2026-08-23T12:00:00Z"));

    expect(logger.info).toHaveBeenCalledWith(
      "Internal ops stuck-job evaluation complete.",
      { stuckCount: 3, stuckExports: 2, stuckImports: 1 },
    );
  });

  it("includes per-type breakdown in the alert envelope when jobs are found — #922", async () => {
    const { service, db, tx, queueService } = makeService();
    tx.marketplaceExportJob.count.mockResolvedValue(2);
    tx.bulkImportJob.count.mockResolvedValue(1);
    db.$queryRaw.mockResolvedValueOnce([{ alert_key: "stuck_jobs:global" }]);

    await service.evaluateStuckJobs(new Date("2026-08-23T12:00:00Z"));

    const payload = queueService.enqueue.mock.calls[0][1];
    expect(payload.envelope).toMatchObject({
      stuckCount: 3,
      stuckExportCount: 2,
      stuckImportCount: 1,
    });
  });

  it("delivers a safe payload (via Slack, the required human destination) and does not leak fields", async () => {
    process.env.OPS_ALERT_SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T000/B000/XXXX";
    const { service, queueService } = makeService();
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);

    service.onModuleInit();
    const handler = queueService.processWithBackpressure.mock.calls[0][2] as (payload: unknown) => Promise<void>;
    await handler({
      envelope: {
        version: 1,
        alertType: "stuck_jobs_threshold_exceeded",
        severity: "p1",
        environment: "test",
        release: "test-sha",
        observedAt: "2026-08-23T10:00:00.000Z",
        internalUrl: "/internal/ops",
        alertId: "alert-1",
        stuckCount: 2,
        stuckAgeThresholdHours: 6,
        tenantKey: "should-not-survive",
      },
    });

    // Legacy sink is still attempted best-effort alongside the required Slack call.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const legacyCall = fetchMock.mock.calls.find(([url]) => url === "http://localhost:3999/ops-alerts");
    expect(legacyCall).toBeDefined();
    const body = JSON.parse(String(legacyCall?.[1]?.body ?? "{}"));
    expect(Object.keys(body).sort()).toEqual([
      "alertId",
      "alertType",
      "environment",
      "internalUrl",
      "observedAt",
      "release",
      "severity",
      "stuckAgeThresholdHours",
      "stuckCount",
      "version",
    ]);
    expect(JSON.stringify(body)).not.toContain("should-not-survive");
  });

  it("delivers a safe media-integrity payload allowlist", async () => {
    process.env.OPS_ALERT_SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T000/B000/XXXX";
    const { service, queueService } = makeService();
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);

    service.onModuleInit();
    const handler = queueService.processWithBackpressure.mock.calls[0][2] as (payload: unknown) => Promise<void>;
    await handler({
      envelope: {
        version: 1,
        alertType: "media_integrity_defect_detected",
        severity: "p1",
        environment: "test",
        release: "test-sha",
        observedAt: "2026-08-25T10:00:00.000Z",
        internalUrl: "/internal/ops",
        missingCount: 2,
        unverifiableCount: 3,
        affectedTenantCount: 2,
        tenantKey: "should-not-survive",
        storagePath: "/app/storage/customer-private.jpg",
        objectKey: "customer/private.jpg",
      },
    });

    const legacyCall = fetchMock.mock.calls.find(([url]) => url === "http://localhost:3999/ops-alerts");
    expect(legacyCall).toBeDefined();
    const body = JSON.parse(String(legacyCall?.[1]?.body ?? "{}"));
    expect(Object.keys(body).sort()).toEqual([
      "affectedTenantCount",
      "alertType",
      "environment",
      "internalUrl",
      "missingCount",
      "observedAt",
      "release",
      "severity",
      "unverifiableCount",
      "version",
    ]);
    expect(JSON.stringify(body)).not.toMatch(/should-not-survive|storage|object|tenantKey|private/i);
  });

  it("throws from the queue handler when no human destination is reachable, so QueueService applies bounded retry (AT-921-05/AT-921-04)", async () => {
    // Default env has only the legacy sink configured (no Slack, no secondary) — a
    // legacy-sink-only failure must still surface as "no human destination reachable",
    // not the old legacy-sink-specific message.
    const { service, queueService, logger } = makeService();
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
    } as Response);

    service.onModuleInit();
    const handler = queueService.processWithBackpressure.mock.calls[0][2] as (payload: unknown) => Promise<void>;
    await expect(
      handler({
        envelope: {
          version: 1,
          alertType: "error_authority_new_p0p1_issue",
          severity: "p1",
          environment: "test",
          release: null,
          observedAt: "2026-08-23T10:00:00.000Z",
          internalUrl: "/internal/ops/errors",
          issueId: "iss_1",
        },
      }),
    ).rejects.toThrow(/no human destination reachable/);

    expect(logger.error).toHaveBeenCalledWith(
      "ALERT DELIVERY FAILURE: no independent human destination received this alert.",
      expect.objectContaining({ alertType: "error_authority_new_p0p1_issue" }),
    );
  });

  it("legacy sink alone reaching 200 is NOT human delivery — Slack unconfigured, legacy sink succeeds, still fails the job", async () => {
    // This is the exact invariant #921 exists to fix: a working legacy sink must never
    // be mistaken for a human having seen the alert.
    const { service, queueService } = makeService();
    jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, status: 200 } as Response);

    service.onModuleInit();
    const handler = queueService.processWithBackpressure.mock.calls[0][2] as (payload: unknown) => Promise<void>;
    await expect(
      handler({
        envelope: {
          version: 1,
          alertType: "stuck_jobs_threshold_exceeded",
          severity: "p1",
          environment: "test",
          release: null,
          observedAt: "2026-08-23T10:00:00.000Z",
          internalUrl: "/internal/ops",
          stuckCount: 2,
          stuckAgeThresholdHours: 6,
        },
      }),
    ).rejects.toThrow(/no human destination reachable/);
  });

  it("also posts a human-readable Slack message when OPS_ALERT_SLACK_WEBHOOK_URL is configured", async () => {
    process.env.OPS_ALERT_SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T000/B000/XXXX";
    const { service, queueService } = makeService();
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, status: 200 } as Response);

    service.onModuleInit();
    const handler = queueService.processWithBackpressure.mock.calls[0][2] as (payload: unknown) => Promise<void>;
    await handler({
      envelope: {
        version: 1,
        alertType: "stuck_jobs_threshold_exceeded",
        severity: "p1",
        environment: "test",
        release: "test-sha",
        observedAt: "2026-08-23T10:00:00.000Z",
        internalUrl: "https://ops.vexa.test/internal/ops",
        stuckCount: 5,
        stuckAgeThresholdHours: 6,
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const slackCall = fetchMock.mock.calls.find(([url]) => url === "https://hooks.slack.com/services/T000/B000/XXXX");
    expect(slackCall).toBeDefined();
    const slackBody = JSON.parse(String(slackCall?.[1]?.body ?? "{}"));
    expect(slackBody.text).toContain("5 job(s) stuck");
    expect(slackBody.text).toContain("https://ops.vexa.test/internal/ops");
  });

  it("still delivers to Slack when the legacy sink destination is not configured (AT-921-03)", async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = "";
    process.env.OPS_ALERT_SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T000/B000/XXXX";
    const { service, queueService, logger } = makeService();
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, status: 200 } as Response);

    service.onModuleInit();
    const handler = queueService.processWithBackpressure.mock.calls[0][2] as (payload: unknown) => Promise<void>;
    await handler({
      envelope: {
        version: 1,
        alertType: "error_authority_new_p0p1_issue",
        severity: "p0",
        environment: "test",
        release: null,
        observedAt: "2026-08-23T10:00:00.000Z",
        internalUrl: "/internal/ops/errors",
        issueId: "iss_1",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://hooks.slack.com/services/T000/B000/XXXX", expect.anything());
    expect(logger.info).toHaveBeenCalledWith(
      "Internal ops alert delivery attempted.",
      expect.objectContaining({
        alertType: "error_authority_new_p0p1_issue",
        humanDelivered: true,
        attempts: expect.arrayContaining([
          expect.objectContaining({ destination: "legacy_sink", result: "skipped_not_configured" }),
        ]),
      }),
    );
  });

  it("fails the queue handler when Slack fails even though the legacy sink succeeds (AT-921-10: legacy sink alone never counts)", async () => {
    process.env.OPS_ALERT_SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T000/B000/XXXX";
    const { service, queueService, logger } = makeService();
    jest.spyOn(global, "fetch").mockImplementation((async (url: string) => {
      if (url === "https://hooks.slack.com/services/T000/B000/XXXX") {
        return { ok: false, status: 500 } as Response;
      }
      return { ok: true, status: 200 } as Response;
    }) as typeof fetch);

    service.onModuleInit();
    const handler = queueService.processWithBackpressure.mock.calls[0][2] as (payload: unknown) => Promise<void>;
    await expect(
      handler({
        envelope: {
          version: 1,
          alertType: "error_authority_new_p0p1_issue",
          severity: "p1",
          environment: "test",
          release: null,
          observedAt: "2026-08-23T10:00:00.000Z",
          internalUrl: "/internal/ops/errors",
          issueId: "iss_1",
        },
      }),
    ).rejects.toThrow(/no human destination reachable/);

    expect(logger.error).toHaveBeenCalledWith(
      "ALERT DELIVERY FAILURE: no independent human destination received this alert.",
      expect.objectContaining({
        alertType: "error_authority_new_p0p1_issue",
        attempts: expect.arrayContaining([
          expect.objectContaining({ destination: "slack", result: "failure", statusCode: 500, errorClass: "http_5xx" }),
          expect.objectContaining({ destination: "legacy_sink", result: "success" }),
        ]),
      }),
    );
  });

  it("falls back to the secondary destination when Slack fails, and that counts as human delivery (AT-921 secondary-destination fallback)", async () => {
    process.env.OPS_ALERT_SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T000/B000/XXXX";
    process.env.OPS_ALERT_SECONDARY_WEBHOOK_URL = "https://example.com/secondary-ops-alerts";
    const { service, queueService, logger } = makeService();
    jest.spyOn(global, "fetch").mockImplementation((async (url: string) => {
      if (url === "https://hooks.slack.com/services/T000/B000/XXXX") {
        return { ok: false, status: 500 } as Response;
      }
      return { ok: true, status: 200 } as Response;
    }) as typeof fetch);

    service.onModuleInit();
    const handler = queueService.processWithBackpressure.mock.calls[0][2] as (payload: unknown) => Promise<void>;
    await expect(
      handler({
        envelope: {
          version: 1,
          alertType: "error_authority_new_p0p1_issue",
          severity: "p1",
          environment: "test",
          release: null,
          observedAt: "2026-08-23T10:00:00.000Z",
          internalUrl: "/internal/ops/errors",
          issueId: "iss_1",
        },
      }),
    ).resolves.toBeUndefined();

    expect(logger.info).toHaveBeenCalledWith(
      "Internal ops alert delivery attempted.",
      expect.objectContaining({
        humanDelivered: true,
        attempts: expect.arrayContaining([
          expect.objectContaining({ destination: "slack", result: "failure" }),
          expect.objectContaining({ destination: "secondary", result: "success" }),
        ]),
      }),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("does not attempt the secondary destination when Slack already succeeded (no duplicate human notification)", async () => {
    process.env.OPS_ALERT_SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T000/B000/XXXX";
    process.env.OPS_ALERT_SECONDARY_WEBHOOK_URL = "https://example.com/secondary-ops-alerts";
    const { service, queueService } = makeService();
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, status: 200 } as Response);

    service.onModuleInit();
    const handler = queueService.processWithBackpressure.mock.calls[0][2] as (payload: unknown) => Promise<void>;
    await handler({
      envelope: {
        version: 1,
        alertType: "error_authority_new_p0p1_issue",
        severity: "p1",
        environment: "test",
        release: null,
        observedAt: "2026-08-23T10:00:00.000Z",
        internalUrl: "/internal/ops/errors",
        issueId: "iss_1",
      },
    });

    const secondaryCall = fetchMock.mock.calls.find(([url]) => url === "https://example.com/secondary-ops-alerts");
    expect(secondaryCall).toBeUndefined();
  });

  it("only one concurrent reservation for the same alert key queues delivery", async () => {
    const { service, db, queueService } = makeService();
    db.$queryRaw
      .mockResolvedValueOnce([{ alert_key: "error:p0p1:iss_1" }])
      .mockResolvedValueOnce([]);

    await Promise.all([
      service.captureNewP0P1Issue({ issueId: "iss_1", severity: "p1" }),
      service.captureNewP0P1Issue({ issueId: "iss_1", severity: "p1" }),
    ]);

    expect(queueService.enqueue).toHaveBeenCalledTimes(1);
  });

  it("only one concurrent media-integrity reservation queues delivery", async () => {
    const { service, db, queueService } = makeService();
    db.$queryRaw
      .mockResolvedValueOnce([{ alert_key: "media_integrity:defects" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await Promise.all([
      service.captureMediaIntegrityDefects({ missingCount: 1, unverifiableCount: 0, affectedTenantCount: 1 }),
      service.captureMediaIntegrityDefects({ missingCount: 1, unverifiableCount: 0, affectedTenantCount: 1 }),
    ]);

    expect(queueService.enqueue).toHaveBeenCalledTimes(1);
  });
});
