import { ErrorAuthorityRetentionService } from "./error-authority-retention.service";

const ORIGINAL_ENV = process.env;

function makeService() {
  const observabilityDb = {
    purgeExpiredIssues: jest.fn().mockResolvedValue({ deletedCount: 0, storageAvailable: true }),
  };
  const service = new ErrorAuthorityRetentionService(observabilityDb as never);
  return { service, observabilityDb };
}

describe("ErrorAuthorityRetentionService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.restoreAllMocks();
  });

  it("purges with the default 90-day retention window when ERROR_AUTHORITY_RETENTION_DAYS is unset", async () => {
    delete process.env.ERROR_AUTHORITY_RETENTION_DAYS;
    const { service, observabilityDb } = makeService();

    await service.runPurge();

    expect(observabilityDb.purgeExpiredIssues).toHaveBeenCalledWith(90);
  });

  it("honors a configured ERROR_AUTHORITY_RETENTION_DAYS override", async () => {
    process.env.ERROR_AUTHORITY_RETENTION_DAYS = "30";
    const { service, observabilityDb } = makeService();

    await service.runPurge();

    expect(observabilityDb.purgeExpiredIssues).toHaveBeenCalledWith(30);
  });

  it("falls back to the default when ERROR_AUTHORITY_RETENTION_DAYS is not a valid positive number", async () => {
    process.env.ERROR_AUTHORITY_RETENTION_DAYS = "not-a-number";
    const { service, observabilityDb } = makeService();

    await service.runPurge();

    expect(observabilityDb.purgeExpiredIssues).toHaveBeenCalledWith(90);
  });

  it("does not throw when the purge call itself rejects", async () => {
    const { service, observabilityDb } = makeService();
    observabilityDb.purgeExpiredIssues.mockRejectedValueOnce(new Error("db unavailable"));

    await expect(service.runPurge()).resolves.toBeUndefined();
  });

  it("does not schedule a timer when QUEUE_WORKER_ENABLED=false", () => {
    process.env.QUEUE_WORKER_ENABLED = "false";
    const { service } = makeService();

    service.onModuleInit();

    // @ts-expect-error accessing private field for the test
    expect(service.initialTimeout).toBeNull();
    service.onModuleDestroy();
  });

  it("schedules a timer when QUEUE_WORKER_ENABLED is unset (defaults to enabled)", () => {
    delete process.env.QUEUE_WORKER_ENABLED;
    const { service } = makeService();

    service.onModuleInit();

    // @ts-expect-error accessing private field for the test
    expect(service.initialTimeout).not.toBeNull();
    service.onModuleDestroy();
  });
});
