import { Prisma } from "@prisma/client";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { BulkEditStaleOperationRecoveryService } from "./bulk-edit-stale-operation-recovery.service";

type StaleOp = { id: string; tenantKey: string; updatedAt?: Date };

// SEC-DB-RLS-001 P2.3a: the sweeper discovers stale operations PER TENANT (forEachTenant), inside that tenant's own transaction.
// The fake database models the one property that matters: a transaction sees only the rows of the tenant whose context it set (as a
// restricted role would), unless `leakAcrossTenants` models a role that bypasses row level security.
function makeService(options?: {
  staleOperations?: StaleOp[];
  directory?: string[];
  failTenants?: string[];
  leakAcrossTenants?: boolean;
  directoryError?: Error;
}) {
  const staleOperations = options?.staleOperations ?? [
    { id: "op-1", tenantKey: "admin" },
    { id: "op-2", tenantKey: "default" },
  ];
  const directory = options?.directory ?? ["admin"];
  const selectCalls: Array<{ tenantKey: string; staleBefore: Date; limit: number }> = [];

  const makeTx = () => {
    let context = "";
    return {
      $queryRaw: jest.fn(async (first: unknown, ...rest: unknown[]) => {
        if (Array.isArray(first)) {
          context = String(rest[0]);
          return [];
        }
        const sql = first as Prisma.Sql;
        const [filterTenant, staleBefore, limit] = [String(sql.values[0]), sql.values[1] as Date, Number(sql.values[2])];
        selectCalls.push({ tenantKey: filterTenant, staleBefore, limit });
        if (options?.failTenants?.includes(filterTenant)) {
          throw Object.assign(new Error("connection postgres://user:SECRET@host/db reset"), { code: "P1001" });
        }
        const visible = options?.leakAcrossTenants ? staleOperations : staleOperations.filter((o) => o.tenantKey === context);
        const filtered = options?.leakAcrossTenants ? visible : visible.filter((o) => o.tenantKey === filterTenant);
        return filtered.slice(0, limit).map(({ id, tenantKey }) => ({ id, tenantKey }));
      }),
    };
  };

  const findManyMock = jest.fn(async () => {
    if (options?.directoryError) {
      throw options.directoryError;
    }
    return directory.map((tenantKey) => ({ tenantKey }));
  });
  const baseClient = { workspaceDirectory: { findMany: findManyMock }, $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTx())) };
  const prisma = { tenant: jest.fn(() => baseClient) };
  const markStuckOperationFailedMock = jest.fn().mockResolvedValue({ recovered: true });
  const bulkEditService = { markStuckOperationFailed: markStuckOperationFailedMock };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const service = new BulkEditStaleOperationRecoveryService(prisma as never, bulkEditService as never, logger as never);
  return { service, findManyMock, markStuckOperationFailedMock, logger, selectCalls };
}

describe("BulkEditStaleOperationRecoveryService.recoverStaleOperations", () => {
  it("does nothing when no operations are stuck in queued/processing", async () => {
    const { service, markStuckOperationFailedMock } = makeService({ staleOperations: [] });

    const result = await service.recoverStaleOperations(new Date("2026-09-22T12:00:00Z"));

    expect(result).toMatchObject({ recoveredOperations: 0, tenantsFailed: 0 });
    expect(markStuckOperationFailedMock).not.toHaveBeenCalled();
  });

  it("queries each tenant for operations stuck past the staleness threshold, filtered by that tenant", async () => {
    const { service, selectCalls } = makeService();

    await service.recoverStaleOperations(new Date("2026-09-22T12:00:00Z"));

    expect(selectCalls.map((c) => c.tenantKey).sort()).toEqual(["admin", "default"]);
    for (const call of selectCalls) {
      expect(call.staleBefore).toEqual(new Date("2026-09-22T11:00:00Z"));
      expect(call.limit).toBe(500);
    }
  });

  it("marks every stale operation failed and reports the recovered count", async () => {
    const { service, markStuckOperationFailedMock } = makeService();

    const result = await service.recoverStaleOperations(new Date("2026-09-22T12:00:00Z"));

    expect(markStuckOperationFailedMock).toHaveBeenCalledTimes(2);
    expect(markStuckOperationFailedMock).toHaveBeenCalledWith("op-1");
    expect(markStuckOperationFailedMock).toHaveBeenCalledWith("op-2");
    expect(result).toMatchObject({ recoveredOperations: 2 });
  });

  it("recovers the stale operations of every non-default directory tenant, not only the default tenant (the silent single-tenant failure)", async () => {
    const { service, markStuckOperationFailedMock } = makeService({
      directory: ["tenant-b", "tenant-c"],
      staleOperations: [
        { id: "op-default", tenantKey: "default" },
        { id: "op-b", tenantKey: "tenant-b" },
        { id: "op-c", tenantKey: "tenant-c" },
      ],
    });

    const result = await service.recoverStaleOperations(new Date("2026-09-22T12:00:00Z"));

    expect(markStuckOperationFailedMock.mock.calls.map((c) => c[0]).sort()).toEqual(["op-b", "op-c", "op-default"]);
    expect(result).toMatchObject({ recoveredOperations: 3, tenantsEvaluated: 3, tenantsFailed: 0 });
  });

  it("with a role that bypasses row level security, no operation is recovered once per tenant (no duplicate work)", async () => {
    const { service, markStuckOperationFailedMock } = makeService({
      directory: ["tenant-b"],
      leakAcrossTenants: true,
      staleOperations: [
        { id: "op-default", tenantKey: "default" },
        { id: "op-b", tenantKey: "tenant-b" },
      ],
    });

    const result = await service.recoverStaleOperations(new Date("2026-09-22T12:00:00Z"));

    expect(markStuckOperationFailedMock.mock.calls.map((c) => c[0]).sort()).toEqual(["op-b", "op-default"]);
    // The rows that belong to another tenant than the iteration's are reported as failures, never silently re-acted-on.
    expect(result.tenantsFailed).toBeGreaterThan(0);
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

    expect(result).toMatchObject({ recoveredOperations: 1 });
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

    expect(result).toMatchObject({ recoveredOperations: 1 });
  });

  it("one unreadable tenant does not hide the others, and is logged by code, never by message", async () => {
    const { service, markStuckOperationFailedMock, logger } = makeService({
      directory: ["tenant-b", "tenant-c"],
      failTenants: ["tenant-b"],
      staleOperations: [
        { id: "op-b", tenantKey: "tenant-b" },
        { id: "op-c", tenantKey: "tenant-c" },
      ],
    });

    const result = await service.recoverStaleOperations(new Date("2026-09-22T12:00:00Z"));

    expect(markStuckOperationFailedMock.mock.calls.map((c) => c[0])).toEqual(["op-c"]);
    expect(result).toMatchObject({ recoveredOperations: 1, tenantsFailed: 1 });
    expect(logger.error).toHaveBeenCalled();
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("SECRET");
  });

  it("a directory read failure rejects instead of quietly recovering only the default tenant", async () => {
    const { service, markStuckOperationFailedMock } = makeService({
      directoryError: new Error("directory unreadable"),
      staleOperations: [{ id: "op-default", tenantKey: "default" }],
    });

    await expect(service.recoverStaleOperations()).rejects.toThrow("directory unreadable");
    expect(markStuckOperationFailedMock).not.toHaveBeenCalled();
  });

  it("states that orphan detection by a runtime role is unverified", async () => {
    const { service } = makeService({ staleOperations: [] });
    const result = await service.recoverStaleOperations();
    expect(result.orphanDetection).toBe("UNVERIFIED_BY_RUNTIME_ROLE");
  });

  it("does not start a second recovery pass while one is already running", async () => {
    const { service, findManyMock } = makeService();
    let resolveFirstFindMany!: () => void;
    findManyMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstFindMany = () => resolve([]);
        }) as never,
    );

    const firstRun = service.recoverStaleOperations();
    const secondRun = service.recoverStaleOperations();
    resolveFirstFindMany();
    await Promise.all([firstRun, secondRun]);

    expect(await secondRun).toMatchObject({ recoveredOperations: 0 });
    expect(findManyMock).toHaveBeenCalledTimes(1);
  });
});
