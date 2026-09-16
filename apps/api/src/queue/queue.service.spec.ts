// CTO review remediation (CODE-002): verifies QueueService.onModuleInit() fails
// startup loudly when QUEUE_BACKEND=bullmq but Redis is unreachable in
// staging/production, instead of silently degrading like every other BullMQ
// connection failure in this file (`.catch(() => undefined)`).

const mockConnect = jest.fn();
const mockQuit = jest.fn();

jest.mock("redis", () => ({
  createClient: jest.fn(() => ({
    connect: mockConnect,
    quit: mockQuit,
    isOpen: false,
  })),
}));

describe("QueueService.onModuleInit — Redis fail-fast", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    mockConnect.mockReset();
    mockQuit.mockReset();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  async function buildService() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { QueueService } = require("./queue.service");
    return new QueueService();
  }

  it("throws in production when Redis is unreachable", async () => {
    process.env.APP_ENV = "production";
    process.env.QUEUE_BACKEND = "bullmq";
    process.env.REDIS_URL = "redis://localhost:6379";
    mockConnect.mockRejectedValue(new Error("ECONNREFUSED"));

    const service = await buildService();
    await expect(service.onModuleInit()).rejects.toThrow(/Redis is unreachable/);
  });

  it("throws in staging when Redis is unreachable", async () => {
    process.env.APP_ENV = "staging";
    process.env.QUEUE_BACKEND = "bullmq";
    process.env.REDIS_URL = "redis://localhost:6379";
    mockConnect.mockRejectedValue(new Error("ECONNREFUSED"));

    const service = await buildService();
    await expect(service.onModuleInit()).rejects.toThrow(/Redis is unreachable/);
  });

  it("does not throw in development when Redis is unreachable (logs and continues)", async () => {
    process.env.APP_ENV = "development";
    process.env.QUEUE_BACKEND = "bullmq";
    process.env.REDIS_URL = "redis://localhost:6379";
    mockConnect.mockRejectedValue(new Error("ECONNREFUSED"));

    const service = await buildService();
    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it("does not touch Redis at all when QUEUE_BACKEND=memory", async () => {
    process.env.APP_ENV = "production";
    process.env.QUEUE_BACKEND = "memory";

    const service = await buildService();
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("resolves in production when Redis connects successfully", async () => {
    process.env.APP_ENV = "production";
    process.env.QUEUE_BACKEND = "bullmq";
    process.env.REDIS_URL = "redis://localhost:6379";
    mockConnect.mockResolvedValue(undefined);

    const service = await buildService();
    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });
});

describe("QueueService worker error authority capture", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV, QUEUE_BACKEND: "memory", QUEUE_WORKER_ENABLED: "true" };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  type WorkerCaptureHarness = {
    captureTerminalWorkerFailure(
      queueName: string,
      laneKey: string,
      payload: unknown,
      error: unknown,
      context?: { jobId?: string; sourceEventId?: string },
    ): Promise<void>;
  };

  function asWorkerCaptureHarness(service: unknown): WorkerCaptureHarness {
    return service as WorkerCaptureHarness;
  }

  it("captures unexpected terminal memory worker failures without raw payload", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { QueueService } = require("./queue.service");
    const captureUnexpected = jest.fn().mockResolvedValue(undefined);
    const service = new QueueService({ captureUnexpected });

    await asWorkerCaptureHarness(service).captureTerminalWorkerFailure(
      "bulk-import",
      "default",
      {
        tenantKey: "tenant-a",
        jobId: "job-a",
        operationId: "operation-a",
        installationId: "install-a",
        rawPayload: "must-not-be-forwarded",
      },
      new Error("Unexpected worker database crash"),
      { jobId: "job-a" },
    );

    expect(captureUnexpected).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: "worker",
        service: "vexa-pim-api",
        category: "database",
        routeTemplate: "queue:bulk-import:default",
        rawTenantKey: "tenant-a",
        jobId: "job-a",
        operationId: "operation-a",
        installationId: "install-a",
      }),
    );
    expect(JSON.stringify(captureUnexpected.mock.calls[0][0])).not.toContain("must-not-be-forwarded");
  });

  it("does not capture expected memory worker domain failures", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { QueueService } = require("./queue.service");
    const captureUnexpected = jest.fn().mockResolvedValue(undefined);
    const service = new QueueService({ captureUnexpected });

    await asWorkerCaptureHarness(service).captureTerminalWorkerFailure(
      "connector-submission",
      "default",
      { tenantKey: "tenant-a", jobId: "job-a" },
      new Error("Marketplace validation rejection"),
    );

    expect(captureUnexpected).not.toHaveBeenCalled();
  });
});

// PIM#817-outage-proof follow-up: metadataRedis.quit() on an already
// -established client can hang indefinitely if Redis becomes unreachable
// mid-shutdown (half-open socket, no QUIT response) — and since it's
// aggregated into closeTasks alongside every worker/queue close, that hang
// blocks Promise.all(closeTasks) from ever settling, so onModuleDestroy()
// never returns. Bounded with the same 300ms Promise.race pattern
// auth.service.ts's onModuleDestroy() already uses.
describe("QueueService.onModuleDestroy — bounded metadataRedis.quit() so shutdown can't hang", () => {
  it("resolves within the timeout bound even when quit() never settles", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { QueueService } = require("./queue.service");
    const service = new QueueService();
    const quit = jest.fn(() => new Promise(() => {}));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- seeding private connection state for the test
    (service as any).metadataRedis = { isOpen: true, quit };

    const start = Date.now();
    await service.onModuleDestroy();
    const elapsedMs = Date.now() - start;

    expect(quit).toHaveBeenCalledTimes(1);
    expect(elapsedMs).toBeLessThan(5_000);
  });

  it("still quits normally (no hang, no error) when quit() resolves quickly", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { QueueService } = require("./queue.service");
    const service = new QueueService();
    const quit = jest.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- seeding private connection state for the test
    (service as any).metadataRedis = { isOpen: true, quit };

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();

    expect(quit).toHaveBeenCalledTimes(1);
  });

  it("does nothing when metadataRedis is not open", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { QueueService } = require("./queue.service");
    const service = new QueueService();
    const quit = jest.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- seeding private connection state for the test
    (service as any).metadataRedis = { isOpen: false, quit };

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();

    expect(quit).not.toHaveBeenCalled();
  });
});
