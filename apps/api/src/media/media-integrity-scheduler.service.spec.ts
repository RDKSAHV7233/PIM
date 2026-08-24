import { MediaIntegritySchedulerService } from "./media-integrity-scheduler.service";

const ORIGINAL_ENV = process.env;

function makeService() {
  const mediaIntegrity = {
    runBoundedScan: jest.fn().mockResolvedValue({
      runId: "scan-1",
      status: "partial",
      coverage: {
        complete: false,
        rowsExamined: 10,
        rowsEligible: 12,
        continuationPending: true,
      },
      totals: {
        missing: 1,
        invalidPath: 2,
        unverifiable: 3,
        storageErrors: 4,
      },
      impact: {
        affectedTenantCount: 2,
        activeProductImpactCount: 1,
      },
    }),
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
  };
  const service = new MediaIntegritySchedulerService(mediaIntegrity as never, logger as never);
  return { service, mediaIntegrity, logger };
}

describe("MediaIntegritySchedulerService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      MEDIA_INTEGRITY_SCHEDULE_ENABLED: "true",
      MEDIA_INTEGRITY_SCAN_CHECKPOINT_KEY: "media-integrity:test",
      MEDIA_INTEGRITY_SCAN_PAGE_SIZE: "25",
      MEDIA_INTEGRITY_SCAN_MAX_ROWS_PER_RUN: "50",
      MEDIA_INTEGRITY_VERIFY_LOCAL_FILES: "false",
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.restoreAllMocks();
  });

  it("does not schedule unless explicitly enabled", () => {
    process.env.MEDIA_INTEGRITY_SCHEDULE_ENABLED = "false";
    const timeout = { unref: jest.fn() };
    const setTimeoutSpy = jest.spyOn(global, "setTimeout").mockReturnValue(timeout as never);
    const { service, logger } = makeService();

    service.onApplicationBootstrap();

    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("Media integrity scheduled scan disabled.");
  });

  it("does not schedule when worker execution is disabled", () => {
    process.env.QUEUE_WORKER_ENABLED = "false";
    const timeout = { unref: jest.fn() };
    const setTimeoutSpy = jest.spyOn(global, "setTimeout").mockReturnValue(timeout as never);
    const { service, logger } = makeService();

    service.onApplicationBootstrap();

    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("Media integrity scheduled scan skipped because workers are disabled.");
  });

  it("runs a bounded scan with environment-controlled limits", async () => {
    const { service, mediaIntegrity, logger } = makeService();

    await expect(service.runScheduledScan()).resolves.toEqual(expect.objectContaining({ ran: true }));

    expect(mediaIntegrity.runBoundedScan).toHaveBeenCalledWith({
      checkpointKey: "media-integrity:test",
      pageSize: 25,
      maxRowsPerRun: 50,
      localFileProbeEnabled: false,
    });
    expect(logger.info).toHaveBeenCalledWith(
      "Media integrity scheduled scan completed.",
      expect.objectContaining({
        event: "MEDIA_INTEGRITY_SCAN_COMPLETED",
        runId: "scan-1",
        missing: 1,
        invalidPath: 2,
        unverifiable: 3,
        storageErrors: 4,
        affectedTenantCount: 2,
      }),
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/tenantKey|storagePath|fileName|secret|token/i);
  });

  it("skips a tick while another scan is already running", async () => {
    let releaseScan!: (value: unknown) => void;
    const { service, mediaIntegrity, logger } = makeService();
    mediaIntegrity.runBoundedScan.mockReturnValueOnce(new Promise((resolve) => {
      releaseScan = resolve;
    }));

    const first = service.runScheduledScan();
    await expect(service.runScheduledScan()).resolves.toEqual({
      ran: false,
      reason: "already_running",
    });
    releaseScan({
      runId: "scan-1",
      status: "ok",
      coverage: { complete: true, rowsExamined: 1, rowsEligible: 1, continuationPending: false },
      totals: { missing: 0, invalidPath: 0, unverifiable: 0, storageErrors: 0 },
      impact: { affectedTenantCount: 0, activeProductImpactCount: 0 },
    });
    await first;

    expect(mediaIntegrity.runBoundedScan).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith("Media integrity scheduled scan already running; skipping tick.");
  });

  it("fails open when the scan throws", async () => {
    const { service, mediaIntegrity, logger } = makeService();
    mediaIntegrity.runBoundedScan.mockRejectedValueOnce(new Error("storage timeout"));

    await expect(service.runScheduledScan()).resolves.toEqual({
      ran: false,
      reason: "failed_open",
    });

    expect(logger.warn).toHaveBeenCalledWith(
      "Media integrity scheduled scan failed open.",
      expect.objectContaining({
        event: "MEDIA_INTEGRITY_SCAN_FAILED_OPEN",
        errorMessage: "storage timeout",
      }),
    );
  });
});
