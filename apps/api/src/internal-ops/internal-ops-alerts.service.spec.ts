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
      "Internal ops alert delivery skipped because destination is not configured.",
      { alertType: "error_authority_new_p0p1_issue" },
    );
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

  it("delivers a safe payload and does not persist or log the destination URL", async () => {
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
        stuckCount: 2,
        stuckAgeThresholdHours: 6,
        tenantKey: "should-not-survive",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body ?? "{}"));
    expect(Object.keys(body).sort()).toEqual([
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

  it("throws from the queue handler on destination failure so QueueService applies bounded retry", async () => {
    const { service, queueService } = makeService();
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
    ).rejects.toThrow("Internal ops alert destination returned 503");
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
});
