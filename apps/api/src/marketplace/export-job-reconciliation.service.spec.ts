import { ExportJobStatus } from "@prisma/client";
import { ExportJobReconciliationService } from "./export-job-reconciliation.service";

function makeService() {
  const staleRows: Array<{
    id: string;
    tenantKey: string;
    status: ExportJobStatus;
    retryCount: number;
  }> = [];

  const updatedRows: Array<{ where: unknown; data: unknown }> = [];

  const prismaDirect = {
    getClient: jest.fn().mockReturnValue({
      marketplaceExportJob: {
        findMany: jest.fn().mockImplementation(() => Promise.resolve(staleRows)),
      },
    }),
  };

  const prisma = {
    tenant: jest.fn().mockReturnValue({
      marketplaceExportJob: {
        updateMany: jest.fn().mockImplementation((args: { where: unknown; data: unknown }) => {
          updatedRows.push(args);
          return Promise.resolve({ count: 1 });
        }),
      },
    }),
  };

  const queueService = {
    isJobPresent: jest.fn().mockResolvedValue(false),
    getJobSnapshot: jest.fn().mockResolvedValue({
      present: false,
      state: null,
      attemptsMade: null,
      attemptsStarted: null,
      processedOn: null,
      finishedOn: null,
      failedReasonPresent: false,
    }),
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const service = new ExportJobReconciliationService(
    prismaDirect as never,
    prisma as never,
    queueService as never,
    logger as never,
  );

  return { service, staleRows, updatedRows, prismaDirect, prisma, queueService, logger };
}

describe("ExportJobReconciliationService", () => {
  it("does nothing when no stale rows exist", async () => {
    const { service, queueService } = makeService();
    const result = await service.runReconciliation();
    expect(result).toEqual({ examined: 0, reconciled: 0, errors: 0 });
    expect(queueService.getJobSnapshot).not.toHaveBeenCalled();
  });

  it("reconciles a stale row with no queue job", async () => {
    const { service, staleRows, updatedRows, queueService } = makeService();
    staleRows.push({
      id: "job-1",
      tenantKey: "tenant-a",
      status: ExportJobStatus.queued,
      retryCount: 0,
    });
    queueService.getJobSnapshot.mockResolvedValue({
      present: false,
      state: null,
      attemptsMade: null,
      attemptsStarted: null,
      processedOn: null,
      finishedOn: null,
      failedReasonPresent: false,
    });

    const result = await service.runReconciliation();

    expect(result).toEqual({ examined: 1, reconciled: 1, errors: 0 });
    expect(queueService.getJobSnapshot).toHaveBeenCalledWith(
      "connector-submission",
      "job-1_0",
    );
    expect(updatedRows).toHaveLength(1);
    expect(updatedRows[0].data).toMatchObject({
      status: ExportJobStatus.failed,
      failureReason: expect.stringContaining("Reconciled"),
    });
  });

  it("skips a stale row whose queue job is still waiting or active", async () => {
    const { service, staleRows, updatedRows, queueService } = makeService();
    staleRows.push({
      id: "job-2",
      tenantKey: "tenant-a",
      status: ExportJobStatus.processing,
      retryCount: 1,
    });
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

    expect(result).toEqual({ examined: 1, reconciled: 0, errors: 0 });
    expect(queueService.getJobSnapshot).toHaveBeenCalledWith(
      "connector-submission",
      "job-2_1",
    );
    expect(updatedRows).toHaveLength(0);
  });

  it("reconciles a stale row when the queue job already completed", async () => {
    const { service, staleRows, updatedRows, queueService } = makeService();
    staleRows.push({
      id: "job-completed",
      tenantKey: "tenant-a",
      status: ExportJobStatus.processing,
      retryCount: 0,
    });
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

    expect(result).toEqual({ examined: 1, reconciled: 1, errors: 0 });
    expect(updatedRows).toHaveLength(1);
    expect(updatedRows[0].data).toMatchObject({
      status: ExportJobStatus.failed,
      failureReason: expect.stringContaining('queue job reached terminal state "completed"'),
    });
  });

  it("reconciles a stale row when the queue job already failed", async () => {
    const { service, staleRows, updatedRows, queueService } = makeService();
    staleRows.push({
      id: "job-failed",
      tenantKey: "tenant-a",
      status: ExportJobStatus.queued,
      retryCount: 0,
    });
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

    expect(result).toEqual({ examined: 1, reconciled: 1, errors: 0 });
    expect(updatedRows).toHaveLength(1);
    expect(updatedRows[0].data).toMatchObject({
      status: ExportJobStatus.failed,
      failureReason: expect.stringContaining('queue job reached terminal state "failed"'),
    });
  });

  it("uses the correct queue job ID with retryCount", async () => {
    const { service, staleRows, queueService } = makeService();
    staleRows.push({
      id: "job-3",
      tenantKey: "tenant-b",
      status: ExportJobStatus.retrying,
      retryCount: 2,
    });
    queueService.getJobSnapshot.mockResolvedValue({
      present: false,
      state: null,
      attemptsMade: null,
      attemptsStarted: null,
      processedOn: null,
      finishedOn: null,
      failedReasonPresent: false,
    });

    await service.runReconciliation();

    expect(queueService.getJobSnapshot).toHaveBeenCalledWith(
      "connector-submission",
      "job-3_2",
    );
  });

  it("handles multiple rows across tenants", async () => {
    const { service, staleRows, updatedRows, queueService, prisma } = makeService();
    staleRows.push(
      { id: "j1", tenantKey: "t1", status: ExportJobStatus.queued, retryCount: 0 },
      { id: "j2", tenantKey: "t2", status: ExportJobStatus.queued, retryCount: 0 },
      { id: "j3", tenantKey: "t1", status: ExportJobStatus.retrying, retryCount: 1 },
    );
    queueService.getJobSnapshot.mockResolvedValue({
      present: false,
      state: null,
      attemptsMade: null,
      attemptsStarted: null,
      processedOn: null,
      finishedOn: null,
      failedReasonPresent: false,
    });

    const result = await service.runReconciliation();

    expect(result).toEqual({ examined: 3, reconciled: 3, errors: 0 });
    expect(updatedRows).toHaveLength(3);
    // Verify tenant() is called for each row (runWithTenantContext wraps each call)
    expect(prisma.tenant).toHaveBeenCalledTimes(3);
  });

  it("counts errors but continues processing remaining rows", async () => {
    const { service, staleRows, queueService, updatedRows } = makeService();
    staleRows.push(
      { id: "j1", tenantKey: "t1", status: ExportJobStatus.queued, retryCount: 0 },
      { id: "j2", tenantKey: "t1", status: ExportJobStatus.queued, retryCount: 0 },
    );
    queueService.getJobSnapshot
      .mockRejectedValueOnce(new Error("Redis connection failed"))
      .mockResolvedValueOnce({
        present: false,
        state: null,
        attemptsMade: null,
        attemptsStarted: null,
        processedOn: null,
        finishedOn: null,
        failedReasonPresent: false,
      });

    const result = await service.runReconciliation();

    expect(result).toEqual({ examined: 2, reconciled: 1, errors: 1 });
    expect(updatedRows).toHaveLength(1);
  });

  it("is idempotent — running twice on same data produces same result", async () => {
    const { service, staleRows, queueService, prisma } = makeService();
    staleRows.push({
      id: "j1",
      tenantKey: "t1",
      status: ExportJobStatus.queued,
      retryCount: 0,
    });
    queueService.getJobSnapshot.mockResolvedValue({
      present: false,
      state: null,
      attemptsMade: null,
      attemptsStarted: null,
      processedOn: null,
      finishedOn: null,
      failedReasonPresent: false,
    });

    // First run: row is in active state, gets reconciled
    const updateMany1 = jest.fn().mockResolvedValue({ count: 1 });
    prisma.tenant.mockReturnValue({ marketplaceExportJob: { updateMany: updateMany1 } });
    const r1 = await service.runReconciliation();
    expect(r1.reconciled).toBe(1);

    // Second run: updateMany WHERE status IN active returns count=0 (already failed)
    const updateMany2 = jest.fn().mockResolvedValue({ count: 0 });
    prisma.tenant.mockReturnValue({ marketplaceExportJob: { updateMany: updateMany2 } });
    const r2 = await service.runReconciliation();
    expect(r2.reconciled).toBe(0);
  });

  it("prevents overlapping runs", async () => {
    const { service, staleRows, queueService } = makeService();
    staleRows.push({
      id: "j1",
      tenantKey: "t1",
      status: ExportJobStatus.queued,
      retryCount: 0,
    });
    // Make getJobSnapshot slow
    queueService.getJobSnapshot.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                present: false,
                state: null,
                attemptsMade: null,
                attemptsStarted: null,
                processedOn: null,
                finishedOn: null,
                failedReasonPresent: false,
              }),
            50,
          ),
        ),
    );

    const [r1, r2] = await Promise.all([
      service.runReconciliation(),
      service.runReconciliation(),
    ]);

    // One should have run, the other skipped
    const total = r1.examined + r2.examined;
    expect(total).toBe(1);
  });
});
