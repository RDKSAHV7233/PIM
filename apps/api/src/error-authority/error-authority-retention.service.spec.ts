import { ErrorAuthorityRetentionService } from "./error-authority-retention.service";

const ORIGINAL_ENV = process.env;

function makeService() {
  const observabilityDb = {
    resolveInactiveOpenIssues: jest.fn().mockResolvedValue({ resolvedCount: 0, storageAvailable: true }),
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

    expect(observabilityDb.resolveInactiveOpenIssues).toHaveBeenCalledWith(90);
    expect(observabilityDb.purgeExpiredIssues).toHaveBeenCalledWith(90);
  });

  it("honors a configured ERROR_AUTHORITY_RETENTION_DAYS override", async () => {
    process.env.ERROR_AUTHORITY_RETENTION_DAYS = "30";
    const { service, observabilityDb } = makeService();

    await service.runPurge();

    expect(observabilityDb.resolveInactiveOpenIssues).toHaveBeenCalledWith(30);
    expect(observabilityDb.purgeExpiredIssues).toHaveBeenCalledWith(30);
  });

  it("honors a configured ERROR_AUTHORITY_AUTO_RESOLVE_DAYS override separately from purge retention", async () => {
    process.env.ERROR_AUTHORITY_RETENTION_DAYS = "90";
    process.env.ERROR_AUTHORITY_AUTO_RESOLVE_DAYS = "30";
    const { service, observabilityDb } = makeService();

    await service.runPurge();

    expect(observabilityDb.resolveInactiveOpenIssues).toHaveBeenCalledWith(30);
    expect(observabilityDb.purgeExpiredIssues).toHaveBeenCalledWith(90);
  });

  it("falls back to the default when ERROR_AUTHORITY_RETENTION_DAYS is not a valid positive number", async () => {
    process.env.ERROR_AUTHORITY_RETENTION_DAYS = "not-a-number";
    const { service, observabilityDb } = makeService();

    await service.runPurge();

    expect(observabilityDb.resolveInactiveOpenIssues).toHaveBeenCalledWith(90);
    expect(observabilityDb.purgeExpiredIssues).toHaveBeenCalledWith(90);
  });

  it("falls back to retention days when ERROR_AUTHORITY_AUTO_RESOLVE_DAYS is invalid", async () => {
    process.env.ERROR_AUTHORITY_RETENTION_DAYS = "45";
    process.env.ERROR_AUTHORITY_AUTO_RESOLVE_DAYS = "0";
    const { service, observabilityDb } = makeService();

    await service.runPurge();

    expect(observabilityDb.resolveInactiveOpenIssues).toHaveBeenCalledWith(45);
    expect(observabilityDb.purgeExpiredIssues).toHaveBeenCalledWith(45);
  });

  it("does not purge when inactive issue resolution storage is unavailable", async () => {
    const { service, observabilityDb } = makeService();
    observabilityDb.resolveInactiveOpenIssues.mockResolvedValueOnce({ resolvedCount: 0, storageAvailable: false });

    await service.runPurge();

    expect(observabilityDb.resolveInactiveOpenIssues).toHaveBeenCalledTimes(1);
    expect(observabilityDb.purgeExpiredIssues).not.toHaveBeenCalled();
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
