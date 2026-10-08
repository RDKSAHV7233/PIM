import { Prisma } from "@prisma/client";
import { ExportJobStatus } from "@prisma/client";
import { ExportJobReconciliationService } from "./export-job-reconciliation.service";

type StaleRow = {
  id: string;
  tenantKey: string;
  status: ExportJobStatus;
  retryCount: number;
  updatedAt?: Date;
};

const NO_QUEUE_JOB = {
  present: false,
  state: null,
  attemptsMade: null,
  attemptsStarted: null,
  processedOn: null,
  finishedOn: null,
  failedReasonPresent: false,
};

// SEC-DB-RLS-001 P2.3d: the reconciliation discovers stale jobs PER TENANT (forEachTenant) inside that tenant's own transaction.
// The fake database models the one property that matters: a transaction sees only the rows of the tenant whose context it set (as a
// restricted role would), unless `leakAcrossTenants` models a role that bypasses row level security.
function makeService(options: { directory?: string[]; failTenants?: string[]; leakAcrossTenants?: boolean; directoryError?: Error } = {}) {
  const staleRows: StaleRow[] = [];
  const updatedRows: Array<{ where: unknown; data: unknown }> = [];
  const selectCalls: Array<{ tenantKey: string; staleCutoff: Date; limit: number }> = [];

  const makeTx = () => {
    let context = "";
    return {
      $queryRaw: jest.fn(async (first: unknown, ...rest: unknown[]) => {
        if (Array.isArray(first)) {
          context = String(rest[0]);
          return [];
        }
        const sql = first as Prisma.Sql;
        const filterTenant = String(sql.values[0]);
        const limit = Number(sql.values[2]);
        selectCalls.push({ tenantKey: filterTenant, staleCutoff: sql.values[1] as Date, limit });
        if (options.failTenants?.includes(filterTenant)) {
          throw Object.assign(new Error("connection postgres://user:SECRET@host/db reset"), { code: "P1001" });
        }
        const visible = options.leakAcrossTenants ? staleRows : staleRows.filter((r) => r.tenantKey === context);
        const filtered = options.leakAcrossTenants ? visible : visible.filter((r) => r.tenantKey === filterTenant);
        return filtered.slice(0, limit).map((r, index) => ({ updatedAt: new Date(Date.UTC(2026, 9, 1, 0, index)), ...r }));
      }),
    };
  };

  const updateMany = jest.fn().mockImplementation((args: { where: unknown; data: unknown }) => {
    updatedRows.push(args);
    return Promise.resolve({ count: 1 });
  });
  const directoryFindMany = jest.fn(async () => {
    if (options.directoryError) {
      throw options.directoryError;
    }
    return (options.directory ?? []).map((tenantKey) => ({ tenantKey }));
  });
  const client = {
    workspaceDirectory: { findMany: directoryFindMany },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTx())),
    marketplaceExportJob: { updateMany },
  };
  const prisma = { tenant: jest.fn().mockReturnValue(client) };

  const queueService = {
    isJobPresent: jest.fn().mockResolvedValue(false),
    getJobSnapshot: jest.fn().mockResolvedValue(NO_QUEUE_JOB),
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const service = new ExportJobReconciliationService(prisma as never, queueService as never, logger as never);

  return { service, staleRows, updatedRows, selectCalls, updateMany, prisma, queueService, logger, directoryFindMany };
}

describe("ExportJobReconciliationService", () => {
  it("does nothing when no stale rows exist", async () => {
    const { service, queueService } = makeService();
    const result = await service.runReconciliation();
    expect(result).toMatchObject({ examined: 0, reconciled: 0, errors: 0, tenantsFailed: 0 });
    expect(queueService.getJobSnapshot).not.toHaveBeenCalled();
  });

  it("reconciles a stale row with no queue job", async () => {
    const { service, staleRows, updatedRows, queueService } = makeService({ directory: ["tenant-a"] });
    staleRows.push({ id: "job-1", tenantKey: "tenant-a", status: ExportJobStatus.queued, retryCount: 0 });

    const result = await service.runReconciliation();

    expect(result).toMatchObject({ examined: 1, reconciled: 1, errors: 0 });
    expect(queueService.getJobSnapshot).toHaveBeenCalledWith("connector-submission", "job-1_0");
    expect(updatedRows).toHaveLength(1);
    expect(updatedRows[0].data).toMatchObject({
      status: ExportJobStatus.failed,
      failureReason: expect.stringContaining("Reconciled"),
    });
  });

  it("skips a stale row whose queue job is still waiting or active", async () => {
    const { service, staleRows, updatedRows, queueService } = makeService({ directory: ["tenant-a"] });
    staleRows.push({ id: "job-2", tenantKey: "tenant-a", status: ExportJobStatus.processing, retryCount: 1 });
    queueService.getJobSnapshot.mockResolvedValue({
      present: true,
      state: "active",
      attemptsMade: 0,
      attemptsStarted: 1,
      processedOn: new Date().toISOString(),
      finishedOn: null,
      failedReasonPresent: false,
    });

    const result = await service.runReconciliation();

    expect(result).toMatchObject({ examined: 1, reconciled: 0, errors: 0 });
    expect(queueService.getJobSnapshot).toHaveBeenCalledWith("connector-submission", "job-2_1");
    expect(updatedRows).toHaveLength(0);
  });

  it("reconciles a stale row when the queue job already completed", async () => {
    const { service, staleRows, updatedRows, queueService } = makeService({ directory: ["tenant-a"] });
    staleRows.push({ id: "job-completed", tenantKey: "tenant-a", status: ExportJobStatus.processing, retryCount: 0 });
    queueService.getJobSnapshot.mockResolvedValue({
      present: true,
      state: "completed",
      attemptsMade: 1,
      attemptsStarted: 1,
      processedOn: new Date(Date.now() - 60_000).toISOString(),
      finishedOn: new Date().toISOString(),
      failedReasonPresent: false,
    });

    const result = await service.runReconciliation();

    expect(result).toMatchObject({ examined: 1, reconciled: 1, errors: 0 });
    expect(updatedRows).toHaveLength(1);
    expect(updatedRows[0].data).toMatchObject({
      status: ExportJobStatus.failed,
      failureReason: expect.stringContaining('queue job reached terminal state "completed"'),
    });
  });

  it("reconciles a stale row when the queue job already failed", async () => {
    const { service, staleRows, updatedRows, queueService } = makeService({ directory: ["tenant-a"] });
    staleRows.push({ id: "job-failed", tenantKey: "tenant-a", status: ExportJobStatus.queued, retryCount: 0 });
    queueService.getJobSnapshot.mockResolvedValue({
      present: true,
      state: "failed",
      attemptsMade: 3,
      attemptsStarted: 3,
      processedOn: new Date(Date.now() - 60_000).toISOString(),
      finishedOn: new Date().toISOString(),
      failedReasonPresent: true,
    });

    const result = await service.runReconciliation();

    expect(result).toMatchObject({ examined: 1, reconciled: 1, errors: 0 });
    expect(updatedRows).toHaveLength(1);
    expect(updatedRows[0].data).toMatchObject({
      status: ExportJobStatus.failed,
      failureReason: expect.stringContaining('queue job reached terminal state "failed"'),
    });
  });

  it("uses the correct queue job ID with retryCount", async () => {
    const { service, staleRows, queueService } = makeService({ directory: ["tenant-b"] });
    staleRows.push({ id: "job-3", tenantKey: "tenant-b", status: ExportJobStatus.retrying, retryCount: 2 });

    await service.runReconciliation();

    expect(queueService.getJobSnapshot).toHaveBeenCalledWith("connector-submission", "job-3_2");
  });

  it("handles multiple rows across tenants", async () => {
    const { service, staleRows, updatedRows } = makeService({ directory: ["t1", "t2"] });
    staleRows.push(
      { id: "j1", tenantKey: "t1", status: ExportJobStatus.queued, retryCount: 0 },
      { id: "j2", tenantKey: "t2", status: ExportJobStatus.queued, retryCount: 0 },
      { id: "j3", tenantKey: "t1", status: ExportJobStatus.retrying, retryCount: 1 },
    );

    const result = await service.runReconciliation();

    expect(result).toMatchObject({ examined: 3, reconciled: 3, errors: 0, tenantsEvaluated: 3, tenantsFailed: 0 });
    expect(updatedRows).toHaveLength(3);
  });

  it("counts errors but continues processing remaining rows", async () => {
    const { service, staleRows, queueService, updatedRows } = makeService({ directory: ["t1"] });
    staleRows.push(
      { id: "j1", tenantKey: "t1", status: ExportJobStatus.queued, retryCount: 0 },
      { id: "j2", tenantKey: "t1", status: ExportJobStatus.queued, retryCount: 0 },
    );
    queueService.getJobSnapshot.mockRejectedValueOnce(new Error("Redis connection failed")).mockResolvedValueOnce(NO_QUEUE_JOB);

    const result = await service.runReconciliation();

    expect(result).toMatchObject({ examined: 2, reconciled: 1, errors: 1 });
    expect(updatedRows).toHaveLength(1);
  });

  it("is idempotent — running twice on same data produces same result", async () => {
    const { service, staleRows, updateMany } = makeService({ directory: ["t1"] });
    staleRows.push({ id: "j1", tenantKey: "t1", status: ExportJobStatus.queued, retryCount: 0 });

    // First run: row is in active state, gets reconciled
    updateMany.mockResolvedValueOnce({ count: 1 });
    const r1 = await service.runReconciliation();
    expect(r1.reconciled).toBe(1);

    // Second run: updateMany WHERE status IN active returns count=0 (already failed)
    updateMany.mockResolvedValueOnce({ count: 0 });
    const r2 = await service.runReconciliation();
    expect(r2.reconciled).toBe(0);
  });

  it("prevents overlapping runs", async () => {
    const { service, staleRows, queueService } = makeService({ directory: ["t1"] });
    staleRows.push({ id: "j1", tenantKey: "t1", status: ExportJobStatus.queued, retryCount: 0 });
    // Make getJobSnapshot slow
    queueService.getJobSnapshot.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(NO_QUEUE_JOB), 50)));

    const [r1, r2] = await Promise.all([service.runReconciliation(), service.runReconciliation()]);

    // One should have run, the other skipped
    expect(r1.examined + r2.examined).toBe(1);
  });

  // ---- SEC-DB-RLS-001 P2.3d: tenant discovery -------------------------------------------------------------------------------------

  it("reconciles the stale jobs of every non-default directory tenant, not only the default tenant (the silent single-tenant failure)", async () => {
    const { service, staleRows, updatedRows } = makeService({ directory: ["tenant-b", "tenant-c"] });
    staleRows.push(
      { id: "j-default", tenantKey: "default", status: ExportJobStatus.queued, retryCount: 0 },
      { id: "j-b", tenantKey: "tenant-b", status: ExportJobStatus.processing, retryCount: 0 },
      { id: "j-c", tenantKey: "tenant-c", status: ExportJobStatus.retrying, retryCount: 1 },
    );

    const result = await service.runReconciliation();

    expect(updatedRows.map((u) => (u.where as { id: string }).id).sort()).toEqual(["j-b", "j-c", "j-default"]);
    expect(result).toMatchObject({ examined: 3, reconciled: 3, tenantsEvaluated: 3, tenantsFailed: 0 });
  });

  it("filters every per-tenant query by that tenant, the staleness cutoff and the batch bound", async () => {
    const { service, selectCalls } = makeService({ directory: ["tenant-b"] });
    const before = Date.now();

    await service.runReconciliation();

    expect(selectCalls.map((c) => c.tenantKey).sort()).toEqual(["default", "tenant-b"]);
    for (const call of selectCalls) {
      expect(call.limit).toBe(200);
      expect(before - call.staleCutoff.getTime()).toBeGreaterThanOrEqual(30 * 60 * 1000 - 5);
    }
  });

  it("with a role that bypasses row level security, no job is reconciled once per tenant (no duplicate work)", async () => {
    const { service, staleRows, updatedRows } = makeService({ directory: ["tenant-b"], leakAcrossTenants: true });
    staleRows.push(
      { id: "j-default", tenantKey: "default", status: ExportJobStatus.queued, retryCount: 0 },
      { id: "j-b", tenantKey: "tenant-b", status: ExportJobStatus.queued, retryCount: 0 },
    );

    const result = await service.runReconciliation();

    expect(updatedRows.map((u) => (u.where as { id: string }).id).sort()).toEqual(["j-b", "j-default"]);
    // Rows that belong to another tenant than the iteration's are reported as failures, never silently re-acted-on.
    expect(result.tenantsFailed).toBeGreaterThan(0);
  });

  it("applies the batch bound across tenants, oldest first", async () => {
    const { service, staleRows, queueService } = makeService({ directory: ["tenant-b", "tenant-c"] });
    for (let i = 0; i < 150; i += 1) {
      staleRows.push({ id: `b-${i}`, tenantKey: "tenant-b", status: ExportJobStatus.queued, retryCount: 0 });
      staleRows.push({ id: `c-${i}`, tenantKey: "tenant-c", status: ExportJobStatus.queued, retryCount: 0 });
    }

    const result = await service.runReconciliation();

    // 150 + 150 stale jobs, bound 200 per run
    expect(result.examined).toBe(200);
    expect(queueService.getJobSnapshot).toHaveBeenCalledTimes(200);
  });

  it("one unreadable tenant does not hide the others, and is logged by code, never by message", async () => {
    const { service, staleRows, updatedRows, logger } = makeService({ directory: ["tenant-b", "tenant-c"], failTenants: ["tenant-b"] });
    staleRows.push(
      { id: "j-b", tenantKey: "tenant-b", status: ExportJobStatus.queued, retryCount: 0 },
      { id: "j-c", tenantKey: "tenant-c", status: ExportJobStatus.queued, retryCount: 0 },
    );

    const result = await service.runReconciliation();

    expect(updatedRows.map((u) => (u.where as { id: string }).id)).toEqual(["j-c"]);
    expect(result).toMatchObject({ examined: 1, reconciled: 1, tenantsFailed: 1 });
    expect(logger.error).toHaveBeenCalled();
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("SECRET");
  });

  it("a directory read failure rejects instead of quietly reconciling only the default tenant", async () => {
    const { service, staleRows, updatedRows } = makeService({ directoryError: new Error("directory unreadable") });
    staleRows.push({ id: "j-default", tenantKey: "default", status: ExportJobStatus.queued, retryCount: 0 });

    await expect(service.runReconciliation()).rejects.toThrow("directory unreadable");
    expect(updatedRows).toHaveLength(0);
  });

  it("states that orphan detection by a runtime role is unverified", async () => {
    const { service } = makeService();
    const result = await service.runReconciliation();
    expect(result.orphanDetection).toBe("UNVERIFIED_BY_RUNTIME_ROLE");
  });
});
