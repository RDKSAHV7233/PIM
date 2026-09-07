import { ObservabilityDbService } from "./observability-db.service";

/**
 * PIM#649: focused unit coverage for ObservabilityDbService.purgeExpiredIssues,
 * the one new method this fix adds. The service's `client` is normally set by
 * onModuleInit() (a real Prisma connect), which unit tests correctly avoid —
 * a fake client is injected directly, matching how this service already
 * fails open (`storageAvailable: false`) whenever `client` is null.
 */
function makeServiceWithClient(clientOverrides: Record<string, unknown> = {}) {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const service = new ObservabilityDbService(logger as never);
  const deleteMany = jest.fn().mockResolvedValue({ count: 3 });
  const updateMany = jest.fn().mockResolvedValue({ count: 2 });
  const client = { errorIssue: { deleteMany, updateMany }, ...clientOverrides };
  (service as unknown as { client: unknown }).client = client;
  return { service, client, deleteMany, updateMany, logger };
}

describe("ObservabilityDbService.purgeExpiredIssues", () => {
  it("deletes ErrorIssue rows with lastSeenAt older than the given retention window", async () => {
    const { service, deleteMany } = makeServiceWithClient();

    const result = await service.purgeExpiredIssues(90);

    expect(result).toEqual({ deletedCount: 3, storageAvailable: true });
    expect(deleteMany).toHaveBeenCalledTimes(1);
    const callArg = deleteMany.mock.calls[0][0] as { where: { lastSeenAt: { lt: Date }; updatedAt: { lt: Date } } };
    const cutoff = callArg.where.lastSeenAt.lt;
    const expectedCutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    // Allow a small tolerance for real wall-clock time elapsing between
    // computing expectedCutoff here and inside the method under test.
    expect(Math.abs(cutoff.getTime() - expectedCutoff)).toBeLessThan(5000);
    expect(Math.abs(callArg.where.updatedAt.lt.getTime() - expectedCutoff)).toBeLessThan(5000);
  });

  it("PIM#756: only purges issues in state 'resolved', exempting 'open' and 'muted' regardless of age", async () => {
    const { service, deleteMany } = makeServiceWithClient();

    await service.purgeExpiredIssues(90);

    expect(deleteMany).toHaveBeenCalledTimes(1);
    const callArg = deleteMany.mock.calls[0][0] as { where: { state: string } };
    expect(callArg.where.state).toBe("resolved");
  });

  it("PIM#766: requires resolved issues to remain resolved for the retention window before purge", async () => {
    const { service, deleteMany } = makeServiceWithClient();

    await service.purgeExpiredIssues(90);

    expect(deleteMany).toHaveBeenCalledTimes(1);
    const callArg = deleteMany.mock.calls[0][0] as { where: { updatedAt: { lt: Date } } };
    expect(callArg.where.updatedAt.lt).toBeInstanceOf(Date);
  });

  it("reports storageAvailable: false without deleting anything when no client is connected", async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const service = new ObservabilityDbService(logger as never);
    // client is null until onModuleInit() runs a real connect — not invoked here.

    const result = await service.purgeExpiredIssues(90);

    expect(result).toEqual({ deletedCount: 0, storageAvailable: false });
  });

  it("fails open (no throw) and reports storageAvailable: false when the delete itself rejects", async () => {
    const { service, deleteMany, logger } = makeServiceWithClient();
    deleteMany.mockRejectedValueOnce(new Error("connection reset"));

    const result = await service.purgeExpiredIssues(90);

    expect(result).toEqual({ deletedCount: 0, storageAvailable: false });
    expect(logger.warn).toHaveBeenCalledWith(
      "Error authority retention purge failed.",
      expect.objectContaining({ errorMessage: "connection reset" }),
    );
  });
});

describe("ObservabilityDbService.resolveInactiveOpenIssues", () => {
  it("marks only stale open issues resolved, leaving muted and recent open issues untouched", async () => {
    const { service, updateMany } = makeServiceWithClient();

    const result = await service.resolveInactiveOpenIssues(90);

    expect(result).toEqual({ resolvedCount: 2, storageAvailable: true });
    expect(updateMany).toHaveBeenCalledTimes(1);
    const callArg = updateMany.mock.calls[0][0] as {
      where: { state: string; lastSeenAt: { lt: Date } };
      data: { state: string };
    };
    expect(callArg.where.state).toBe("open");
    expect(callArg.data.state).toBe("resolved");
    const expectedCutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    expect(Math.abs(callArg.where.lastSeenAt.lt.getTime() - expectedCutoff)).toBeLessThan(5000);
  });

  it("reports storageAvailable: false without updating anything when no client is connected", async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const service = new ObservabilityDbService(logger as never);

    const result = await service.resolveInactiveOpenIssues(90);

    expect(result).toEqual({ resolvedCount: 0, storageAvailable: false });
  });

  it("fails open and reports storageAvailable: false when inactive resolution rejects", async () => {
    const { service, updateMany, logger } = makeServiceWithClient();
    updateMany.mockRejectedValueOnce(new Error("connection reset"));

    const result = await service.resolveInactiveOpenIssues(90);

    expect(result).toEqual({ resolvedCount: 0, storageAvailable: false });
    expect(logger.warn).toHaveBeenCalledWith(
      "Error authority inactive issue resolution failed.",
      expect.objectContaining({ errorMessage: "connection reset" }),
    );
  });
});
