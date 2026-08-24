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
  const client = { errorIssue: { deleteMany }, ...clientOverrides };
  (service as unknown as { client: unknown }).client = client;
  return { service, client, deleteMany, logger };
}

describe("ObservabilityDbService.purgeExpiredIssues", () => {
  it("deletes ErrorIssue rows with lastSeenAt older than the given retention window", async () => {
    const { service, deleteMany } = makeServiceWithClient();

    const result = await service.purgeExpiredIssues(90);

    expect(result).toEqual({ deletedCount: 3, storageAvailable: true });
    expect(deleteMany).toHaveBeenCalledTimes(1);
    const callArg = deleteMany.mock.calls[0][0] as { where: { lastSeenAt: { lt: Date } } };
    const cutoff = callArg.where.lastSeenAt.lt;
    const expectedCutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    // Allow a small tolerance for real wall-clock time elapsing between
    // computing expectedCutoff here and inside the method under test.
    expect(Math.abs(cutoff.getTime() - expectedCutoff)).toBeLessThan(5000);
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
