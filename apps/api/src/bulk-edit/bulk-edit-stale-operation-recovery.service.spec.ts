import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { BulkEditStaleOperationRecoveryService } from "./bulk-edit-stale-operation-recovery.service";

function makeService(options?: {
  staleOperations?: { id: string; tenantKey: string }[];
}) {
  const staleOperations = options?.staleOperations ?? [
    { id: "op-1", tenantKey: "admin" },
    { id: "op-2", tenantKey: "default" },
  ];
  const findManyMock = jest.fn().mockResolvedValue(staleOperations);
  const client = {
    bulkEditOperation: {
      findMany: findManyMock,
    },
  };
  const prismaDirect = { getClient: jest.fn().mockReturnValue(client) };
  const markStuckOperationFailedMock = jest.fn().mockResolvedValue({ recovered: true });
  const bulkEditService = { markStuckOperationFailed: markStuckOperationFailedMock };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const service = new BulkEditStaleOperationRecoveryService(
    prismaDirect as never,
    bulkEditService as never,
    logger as never,
  );
  return { service, findManyMock, markStuckOperationFailedMock, logger };
}

describe("BulkEditStaleOperationRecoveryService.recoverStaleOperations", () => {
  it("does nothing when no operations are stuck in queued/processing", async () => {
    const { service, markStuckOperationFailedMock } = makeService({ staleOperations: [] });

    const result = await service.recoverStaleOperations(new Date("2026-09-22T12:00:00Z"));

    expect(result).toEqual({ recoveredOperations: 0 });
    expect(markStuckOperationFailedMock).not.toHaveBeenCalled();
  });

  it("queries for operations stuck in queued/processing past the staleness threshold", async () => {
    const { service, findManyMock } = makeService();

    await service.recoverStaleOperations(new Date("2026-09-22T12:00:00Z"));

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["queued", "processing"] },
          updatedAt: { lte: new Date("2026-09-22T11:00:00Z") },
        }),
      }),
    );
  });

  it("marks every stale operation failed and reports the recovered count", async () => {
    const { service, markStuckOperationFailedMock } = makeService();

    const result = await service.recoverStaleOperations(new Date("2026-09-22T12:00:00Z"));

    expect(markStuckOperationFailedMock).toHaveBeenCalledTimes(2);
    expect(markStuckOperationFailedMock).toHaveBeenCalledWith("op-1");
    expect(markStuckOperationFailedMock).toHaveBeenCalledWith("op-2");
    expect(result).toEqual({ recoveredOperations: 2 });
  });

  it("recovers each operation under its OWN tenant context, not the caller's default", async () => {
    const observedTenants: string[] = [];
    const { service, markStuckOperationFailedMock } = makeService({
      staleOperations: [{ id: "op-1", tenantKey: "admin" }],
    });
    markStuckOperationFailedMock.mockImplementation(async () => {
      observedTenants.push(getTenantKeyFromContext());
    });

    await service.recoverStaleOperations(new Date("2026-09-22T12:00:00Z"));

    // Same bug class as BUG-MKT-QUEUE-002 (tenant-context.ts): a background
    // job with no request-scoped tenant silently resolves to "default"
    // unless it explicitly establishes the right tenant context first.
    expect(observedTenants).toEqual(["admin"]);
  });

  it("logs and continues when one operation's recovery throws, without losing the others", async () => {
    const { service, markStuckOperationFailedMock, logger } = makeService();
    markStuckOperationFailedMock.mockImplementation(async (operationId: string) => {
      if (operationId === "op-1") {
        throw new Error("boom");
      }
      return { recovered: true };
    });

    const result = await service.recoverStaleOperations(new Date("2026-09-22T12:00:00Z"));

    expect(result).toEqual({ recoveredOperations: 1 });
    expect(markStuckOperationFailedMock).toHaveBeenCalledWith("op-2");
    expect(logger.warn).toHaveBeenCalledWith(
      "Failed to mark a stale bulk-edit operation as failed.",
      expect.objectContaining({ operationId: "op-1", errorMessage: "boom" }),
    );
  });

  it("does not count an operation that finished on its own between read and write (recovered: false)", async () => {
    // markStuckOperationFailed's own where-clause only actually writes if the
    // operation is still queued/processing at write time — recovered: false means
    // a real finalizeOperation() call won the race, not that this loop failed.
    const { service, markStuckOperationFailedMock } = makeService();
    markStuckOperationFailedMock.mockImplementation(async (operationId: string) => ({
      recovered: operationId === "op-2",
    }));

    const result = await service.recoverStaleOperations(new Date("2026-09-22T12:00:00Z"));

    expect(result).toEqual({ recoveredOperations: 1 });
  });

  it("does not start a second recovery pass while one is already running", async () => {
    const { service, findManyMock } = makeService();
    let resolveFirstFindMany!: () => void;
    findManyMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstFindMany = () => resolve([]);
        }),
    );

    const firstRun = service.recoverStaleOperations();
    const secondRun = service.recoverStaleOperations();
    resolveFirstFindMany();
    await Promise.all([firstRun, secondRun]);

    expect(await secondRun).toEqual({ recoveredOperations: 0 });
    expect(findManyMock).toHaveBeenCalledTimes(1);
  });
});
