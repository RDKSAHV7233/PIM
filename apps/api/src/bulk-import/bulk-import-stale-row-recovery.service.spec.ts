import { Prisma } from "@prisma/client";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { BulkImportStaleRowRecoveryService } from "./bulk-import-stale-row-recovery.service";

type Row = { id: string; jobId: string; tenantKey: string; status?: string; lastAttemptAt?: Date };

// SEC-DB-RLS-001 P2.3b: the sweeper discovers stale rows PER TENANT (forEachTenant) inside that tenant's own transaction, then resets
// them in a second per-tenant transaction. The fake database models the property that matters: a transaction sees only the rows of
// the tenant whose context it set (as a restricted role would), unless `leakAcrossTenants` models a role that bypasses RLS.
function makeService(options?: {
  rows?: Row[];
  directory?: string[];
  failTenants?: string[];
  leakAcrossTenants?: boolean;
  directoryError?: Error;
}) {
  const rows: Row[] = (options?.rows ?? [
    { id: "row-1", jobId: "job-1", tenantKey: "admin" },
    { id: "row-2", jobId: "job-2", tenantKey: "default" },
  ]).map((row, index) => ({ status: "processing", lastAttemptAt: new Date(Date.UTC(2026, 8, 12, 0, index)), ...row }));
  const directory = options?.directory ?? ["admin"];
  const selectCalls: Array<{ tenantKey: string; staleBefore: Date; limit: number }> = [];
  const updateCalls: Array<{ tenantKey: string; ids: string[] }> = [];

  const makeTx = () => {
    let context = "";
    const run = (first: unknown, rest: unknown[], mode: "query" | "exec") => {
      if (Array.isArray(first)) {
        context = String(rest[0]);
        return [];
      }
      const sql = first as Prisma.Sql;
      const text = sql.strings.join("?");
      const filterTenant = String(sql.values[0]);
      if (options?.failTenants?.includes(filterTenant)) {
        throw Object.assign(new Error("connection postgres://user:SECRET@host/db reset"), { code: "P1001" });
      }
      const visible = (options?.leakAcrossTenants ? rows : rows.filter((r) => r.tenantKey === context)).filter(
        (r) => options?.leakAcrossTenants || r.tenantKey === filterTenant,
      );
      if (/UPDATE/.test(text)) {
        const ids = sql.values[1] as string[];
        updateCalls.push({ tenantKey: filterTenant, ids });
        const touched = visible.filter((r) => ids.includes(r.id) && r.status === "processing");
        touched.forEach((r) => (r.status = "retrying"));
        return mode === "exec" ? touched.length : touched;
      }
      const [staleBefore, limit] = [sql.values[1] as Date, Number(sql.values[2])];
      selectCalls.push({ tenantKey: filterTenant, staleBefore, limit });
      return visible
        .filter((r) => r.status === "processing" && (r.lastAttemptAt as Date) <= staleBefore)
        .sort((a, b) => (a.lastAttemptAt as Date).getTime() - (b.lastAttemptAt as Date).getTime())
        .slice(0, limit)
        .map(({ id, jobId, tenantKey, lastAttemptAt }) => ({ id, jobId, tenantKey, lastAttemptAt }));
    };
    return {
      $queryRaw: jest.fn(async (first: unknown, ...rest: unknown[]) => run(first, rest, "query")),
      $executeRaw: jest.fn(async (first: unknown, ...rest: unknown[]) => run(first, rest, "exec")),
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
  const processJobMock = jest.fn().mockResolvedValue(undefined);
  const bulkImportService = { processJob: processJobMock };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const service = new BulkImportStaleRowRecoveryService(prisma as never, bulkImportService as never, logger as never);
  return { service, rows, findManyMock, processJobMock, logger, selectCalls, updateCalls };
}

const NOW = new Date("2026-09-12T12:00:00Z");

describe("BulkImportStaleRowRecoveryService.recoverStaleRows", () => {
  it("does nothing when there are no rows stuck in processing", async () => {
    const { service, updateCalls, processJobMock } = makeService({ rows: [] });

    const result = await service.recoverStaleRows(NOW);

    expect(result).toMatchObject({ recoveredRows: 0, reprocessedJobs: 0, tenantsFailed: 0 });
    expect(updateCalls).toEqual([]);
    expect(processJobMock).not.toHaveBeenCalled();
  });

  it("queries each tenant for rows stuck in processing past the staleness threshold, filtered by that tenant", async () => {
    const { service, selectCalls } = makeService();

    await service.recoverStaleRows(NOW);

    expect(selectCalls.map((c) => c.tenantKey).sort()).toEqual(["admin", "default"]);
    for (const call of selectCalls) {
      expect(call.staleBefore).toEqual(new Date("2026-09-12T11:00:00Z"));
      expect(call.limit).toBe(500);
    }
  });

  it("resets stale rows to retrying and re-drives one processJob call per distinct affected job", async () => {
    const { service, rows, processJobMock } = makeService();

    const result = await service.recoverStaleRows(NOW);

    expect(rows.map((r) => r.status)).toEqual(["retrying", "retrying"]);
    expect(processJobMock).toHaveBeenCalledTimes(2);
    expect(processJobMock).toHaveBeenCalledWith("job-1");
    expect(processJobMock).toHaveBeenCalledWith("job-2");
    expect(result).toMatchObject({ recoveredRows: 2, reprocessedJobs: 2 });
  });

  it("re-drives a job once even when several of its rows were stuck", async () => {
    const { service, processJobMock } = makeService({
      rows: [
        { id: "r1", jobId: "job-1", tenantKey: "admin" },
        { id: "r2", jobId: "job-1", tenantKey: "admin" },
      ],
    });

    const result = await service.recoverStaleRows(NOW);

    expect(processJobMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ recoveredRows: 2, reprocessedJobs: 1 });
  });

  it("recovers the stale rows of every non-default directory tenant, not only the default tenant (the silent single-tenant failure)", async () => {
    const { service, rows, processJobMock } = makeService({
      directory: ["tenant-b", "tenant-c"],
      rows: [
        { id: "r-default", jobId: "j-default", tenantKey: "default" },
        { id: "r-b", jobId: "j-b", tenantKey: "tenant-b" },
        { id: "r-c", jobId: "j-c", tenantKey: "tenant-c" },
      ],
    });

    const result = await service.recoverStaleRows(NOW);

    expect(rows.every((r) => r.status === "retrying")).toBe(true);
    expect(processJobMock.mock.calls.map((c) => c[0]).sort()).toEqual(["j-b", "j-c", "j-default"]);
    expect(result).toMatchObject({ recoveredRows: 3, reprocessedJobs: 3, tenantsEvaluated: 3, tenantsFailed: 0 });
  });

  it("applies the 500-row bound across tenants, oldest first, and only resets the rows it chose", async () => {
    const many: Row[] = [];
    for (let i = 0; i < 300; i += 1) {
      many.push({ id: `b-${i}`, jobId: "j-b", tenantKey: "tenant-b", lastAttemptAt: new Date(Date.UTC(2026, 8, 12, 0, 0, i)) });
      many.push({ id: `c-${i}`, jobId: "j-c", tenantKey: "tenant-c", lastAttemptAt: new Date(Date.UTC(2026, 8, 12, 1, 0, i)) });
    }
    const { service, rows } = makeService({ directory: ["tenant-b", "tenant-c"], rows: many });

    const result = await service.recoverStaleRows(NOW);

    expect(result.recoveredRows).toBe(500);
    // every tenant-b row (older) is chosen before any tenant-c row, and exactly 200 of tenant-c's
    expect(rows.filter((r) => r.tenantKey === "tenant-b" && r.status === "retrying")).toHaveLength(300);
    expect(rows.filter((r) => r.tenantKey === "tenant-c" && r.status === "retrying")).toHaveLength(200);
  });

  it("with a role that bypasses row level security, no row is reset twice and none is acted on under the wrong tenant", async () => {
    const { service, updateCalls, processJobMock } = makeService({
      directory: ["tenant-b"],
      leakAcrossTenants: true,
      rows: [
        { id: "r-default", jobId: "j-default", tenantKey: "default" },
        { id: "r-b", jobId: "j-b", tenantKey: "tenant-b" },
      ],
    });

    const result = await service.recoverStaleRows(NOW);

    expect(processJobMock.mock.calls.map((c) => c[0]).sort()).toEqual(["j-b", "j-default"]);
    const resetIds = updateCalls.flatMap((c) => c.ids);
    expect(new Set(resetIds).size).toBe(resetIds.length);
    // Rows that belong to another tenant than the iteration's are reported as failures, never silently re-acted-on.
    expect(result.tenantsFailed).toBeGreaterThan(0);
  });

  it("re-drives each job under its OWN tenant context, not the caller's default", async () => {
    const observedTenants: string[] = [];
    const { service, processJobMock } = makeService({ rows: [{ id: "row-1", jobId: "job-1", tenantKey: "admin" }] });
    processJobMock.mockImplementation(async () => {
      observedTenants.push(getTenantKeyFromContext());
    });

    await service.recoverStaleRows(NOW);

    // This is exactly the class of bug called out in tenant-context.ts as
    // BUG-MKT-QUEUE-002: a background job with no request-scoped tenant
    // silently resolves to "default" unless it explicitly establishes the
    // right tenant context before touching tenant-scoped data.
    expect(observedTenants).toEqual(["admin"]);
  });

  it("logs and continues when one job's reprocessing throws, without losing the others", async () => {
    const { service, processJobMock, logger } = makeService();
    processJobMock.mockImplementation(async (jobId: string) => {
      if (jobId === "job-1") {
        throw new Error("boom");
      }
    });

    const result = await service.recoverStaleRows(NOW);

    expect(result).toMatchObject({ recoveredRows: 2, reprocessedJobs: 2 });
    expect(processJobMock).toHaveBeenCalledWith("job-2");
    expect(logger.warn).toHaveBeenCalledWith(
      "Failed to re-drive a bulk-import job after stale-row recovery.",
      expect.objectContaining({ jobId: "job-1", errorMessage: "boom" }),
    );
  });

  it("one unreadable tenant does not hide the others, and is logged by code, never by message", async () => {
    const { service, rows, logger } = makeService({
      directory: ["tenant-b", "tenant-c"],
      failTenants: ["tenant-b"],
      rows: [
        { id: "r-b", jobId: "j-b", tenantKey: "tenant-b" },
        { id: "r-c", jobId: "j-c", tenantKey: "tenant-c" },
      ],
    });

    const result = await service.recoverStaleRows(NOW);

    expect(rows.find((r) => r.id === "r-c")?.status).toBe("retrying");
    expect(rows.find((r) => r.id === "r-b")?.status).toBe("processing");
    expect(result).toMatchObject({ recoveredRows: 1, tenantsFailed: 1 });
    expect(logger.error).toHaveBeenCalled();
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("SECRET");
  });

  it("a directory read failure rejects instead of quietly recovering only the default tenant", async () => {
    const { service, rows } = makeService({
      directoryError: new Error("directory unreadable"),
      rows: [{ id: "r-default", jobId: "j-default", tenantKey: "default" }],
    });

    await expect(service.recoverStaleRows()).rejects.toThrow("directory unreadable");
    expect(rows[0].status).toBe("processing");
  });

  it("states that orphan detection by a runtime role is unverified", async () => {
    const { service } = makeService({ rows: [] });
    const result = await service.recoverStaleRows();
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

    const firstRun = service.recoverStaleRows();
    const secondRun = service.recoverStaleRows();
    resolveFirstFindMany();
    await Promise.all([firstRun, secondRun]);

    expect(await secondRun).toMatchObject({ recoveredRows: 0, reprocessedJobs: 0 });
    expect(findManyMock).toHaveBeenCalledTimes(1);
  });
});
