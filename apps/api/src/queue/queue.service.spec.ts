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
