import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { BulkImportStaleRowRecoveryService } from "./bulk-import-stale-row-recovery.service";

function makeService(options?: {
  staleRows?: { id: string; jobId: string }[];
  jobs?: { id: string; tenantKey: string }[];
}) {
  const staleRows = options?.staleRows ?? [
    { id: "row-1", jobId: "job-1" },
    { id: "row-2", jobId: "job-2" },
  ];
  const jobs = options?.jobs ?? [
    { id: "job-1", tenantKey: "admin" },
    { id: "job-2", tenantKey: "default" },
  ];
  const findManyRowsMock = jest.fn().mockResolvedValue(staleRows);
  const updateManyMock = jest.fn().mockResolvedValue({ count: staleRows.length });
  const findManyJobsMock = jest.fn().mockResolvedValue(jobs);
  const client = {
    bulkImportRow: {
      findMany: findManyRowsMock,
      updateMany: updateManyMock,
    },
    bulkImportJob: {
      findMany: findManyJobsMock,
    },
  };
  const prismaDirect = { getClient: jest.fn().mockReturnValue(client) };
  const processJobMock = jest.fn().mockResolvedValue(undefined);
  const bulkImportService = { processJob: processJobMock };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const service = new BulkImportStaleRowRecoveryService(
    prismaDirect as never,
    bulkImportService as never,
    logger as never,
  );
  return { service, findManyRowsMock, updateManyMock, findManyJobsMock, processJobMock, logger };
}

describe("BulkImportStaleRowRecoveryService.recoverStaleRows", () => {
  it("does nothing when there are no rows stuck in processing", async () => {
    const { service, updateManyMock, findManyJobsMock, processJobMock } = makeService({ staleRows: [] });

    const result = await service.recoverStaleRows(new Date("2026-09-12T12:00:00Z"));

    expect(result).toEqual({ recoveredRows: 0, reprocessedJobs: 0 });
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(findManyJobsMock).not.toHaveBeenCalled();
    expect(processJobMock).not.toHaveBeenCalled();
  });

  it("queries for rows stuck in processing past the staleness threshold", async () => {
    const { service, findManyRowsMock } = makeService();

    await service.recoverStaleRows(new Date("2026-09-12T12:00:00Z"));

    expect(findManyRowsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "processing",
          lastAttemptAt: { lte: new Date("2026-09-12T11:00:00Z") },
        }),
      }),
    );
  });

  it("resets stale rows to retrying and re-drives one processJob call per distinct affected job", async () => {
    const { service, updateManyMock, processJobMock } = makeService();

    const result = await service.recoverStaleRows(new Date("2026-09-12T12:00:00Z"));

    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["row-1", "row-2"] } },
      data: { status: "retrying" },
    });
    expect(processJobMock).toHaveBeenCalledTimes(2);
    expect(processJobMock).toHaveBeenCalledWith("job-1");
    expect(processJobMock).toHaveBeenCalledWith("job-2");
    expect(result).toEqual({ recoveredRows: 2, reprocessedJobs: 2 });
  });

  it("re-drives each job under its OWN tenant context, not the caller's default", async () => {
    const observedTenants: string[] = [];
    const { service, processJobMock } = makeService({
      staleRows: [{ id: "row-1", jobId: "job-1" }],
      jobs: [{ id: "job-1", tenantKey: "admin" }],
    });
    processJobMock.mockImplementation(async () => {
      observedTenants.push(getTenantKeyFromContext());
    });

    await service.recoverStaleRows(new Date("2026-09-12T12:00:00Z"));

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

    const result = await service.recoverStaleRows(new Date("2026-09-12T12:00:00Z"));

    expect(result).toEqual({ recoveredRows: 2, reprocessedJobs: 2 });
    expect(processJobMock).toHaveBeenCalledWith("job-2");
    expect(logger.warn).toHaveBeenCalledWith(
      "Failed to re-drive a bulk-import job after stale-row recovery.",
      expect.objectContaining({ jobId: "job-1", errorMessage: "boom" }),
    );
  });

  it("does not start a second recovery pass while one is already running", async () => {
    const { service, findManyRowsMock } = makeService();
    let resolveFirstFindMany!: () => void;
    findManyRowsMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstFindMany = () => resolve([]);
        }),
    );

    const firstRun = service.recoverStaleRows();
    const secondRun = service.recoverStaleRows();
    resolveFirstFindMany();
    await Promise.all([firstRun, secondRun]);

    expect(await secondRun).toEqual({ recoveredRows: 0, reprocessedJobs: 0 });
    expect(findManyRowsMock).toHaveBeenCalledTimes(1);
  });
});
