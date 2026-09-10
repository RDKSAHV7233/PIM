import { BadRequestException, NotFoundException } from "@nestjs/common";
import { BulkImportJobStatus, BulkImportRunStatus } from "@prisma/client";
import { QUEUE_NAMES } from "../queue/queue.constants";
import { BulkImportRunService } from "./bulk-import-run.service";

describe("BulkImportRunService.enqueueProcessJob", () => {
  function createService(jobStub: Record<string, unknown> = { id: "job_1", status: BulkImportJobStatus.queued }) {
    const enqueueMock = jest.fn().mockResolvedValue(undefined);
    const processWithBackpressureMock = jest.fn(); // onModuleInit registers here — no-op in tests

    const prisma = { tenant: jest.fn() };
    const accessPolicy = {};
    const queueService = {
      enqueue: enqueueMock,
      processWithBackpressure: processWithBackpressureMock,
    };
    const storageService = {};
    const bulkImportService = {
      getJob: jest.fn().mockResolvedValue(jobStub),
      processJob: jest.fn(),
    };
    const planUsageService = {
      getImportRowLimit: jest.fn().mockResolvedValue(30000),
    };

    const service = new BulkImportRunService(
      prisma as never,
      accessPolicy as never,
      queueService as never,
      storageService as never,
      bulkImportService as never,
      planUsageService as never,
    );

    return { service, enqueueMock, bulkImportService };
  }

  it("enqueues a bulk_import_job payload and returns the current job state immediately", async () => {
    const jobStub = { id: "job_1", status: BulkImportJobStatus.queued };
    const { service, enqueueMock, bulkImportService } = createService(jobStub);

    const actor = { actorId: "user_1", actorRole: "admin" as never, tenantId: "acme" };
    const result = await service.enqueueProcessJob("job_1", 50, actor);

    // Returns the current job state — not a post-processing snapshot
    expect(result).toBe(jobStub);

    // Validates existence + access via getJob
    expect(bulkImportService.getJob).toHaveBeenCalledWith("job_1", actor);

    // Enqueues exactly once with the correct payload shape
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledWith(
      QUEUE_NAMES.BULK_IMPORT,
      expect.objectContaining({
        kind: "bulk_import_job",
        jobId: "job_1",
        chunkSize: 50,
        actorId: "user_1",
        actorRole: "admin",
      }),
    );

    // The enqueued payload carries a tenantKey so the worker can set context
    const payload = enqueueMock.mock.calls[0][1] as Record<string, unknown>;
    expect(typeof payload.tenantKey).toBe("string");
    expect((payload.tenantKey as string).length).toBeGreaterThan(0);
  });

  it("does NOT enqueue when the job is already completed — no-op fast-path", async () => {
    const { service, enqueueMock } = createService({ id: "job_2", status: BulkImportJobStatus.completed });

    await service.enqueueProcessJob("job_2", undefined, { actorId: "user_1", actorRole: "admin" as never });

    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("does NOT enqueue when the job is failed — terminal guard", async () => {
    const { service, enqueueMock } = createService({ id: "job_f", status: BulkImportJobStatus.failed });
    await service.enqueueProcessJob("job_f", undefined, { actorId: "user_1", actorRole: "admin" as never });
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("does NOT enqueue when the job is dead_letter — terminal guard", async () => {
    const { service, enqueueMock } = createService({ id: "job_d", status: BulkImportJobStatus.dead_letter });
    await service.enqueueProcessJob("job_d", undefined, { actorId: "user_1", actorRole: "admin" as never });
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("does NOT enqueue when the job is already processing — double-click guard", async () => {
    const { service, enqueueMock } = createService({ id: "job_p", status: BulkImportJobStatus.processing });
    await service.enqueueProcessJob("job_p", undefined, { actorId: "user_1", actorRole: "admin" as never });
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("propagates NotFoundException from getJob without calling enqueue", async () => {
    const { service, enqueueMock, bulkImportService } = createService();
    (bulkImportService.getJob as jest.Mock).mockRejectedValue(new NotFoundException("not found"));

    await expect(
      service.enqueueProcessJob("missing", undefined, { actorId: "user_1", actorRole: "admin" as never }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("handles undefined chunkSize — forwards it to the payload so the worker uses the job default", async () => {
    const { service, enqueueMock } = createService({ id: "job_3", status: BulkImportJobStatus.queued });

    await service.enqueueProcessJob("job_3", undefined, { actorId: "user_1", actorRole: "editor" as never });

    const payload = enqueueMock.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.chunkSize).toBeUndefined();
    expect(payload.kind).toBe("bulk_import_job");
  });
});

describe("BulkImportRunService.startRun — concurrent import guard", () => {
  function createStartRunService(runStub: Record<string, unknown>) {
    const enqueueMock = jest.fn().mockResolvedValue(undefined);
    const processWithBackpressureMock = jest.fn();

    const updateManyMock = jest.fn().mockResolvedValue({ count: 1 });
    const createMock = jest.fn().mockResolvedValue({});
    const findUniqueMock = jest.fn().mockResolvedValue(runStub);

    const txMock = jest.fn().mockImplementation(async (fn) => {
      return fn({
        bulkImportRun: { updateMany: updateManyMock },
        bulkImportJob: { create: createMock },
      });
    });

    const prisma = {
      tenant: jest.fn().mockReturnValue({
        bulkImportRun: { findUnique: findUniqueMock, updateMany: updateManyMock },
        bulkImportJob: { create: createMock, findMany: jest.fn().mockResolvedValue([]) },
        $transaction: txMock,
      }),
    };

    const accessPolicy = {
      assertCategoryAccess: jest.fn().mockResolvedValue(undefined),
    };
    const queueService = {
      enqueue: enqueueMock,
      processWithBackpressure: processWithBackpressureMock,
    };
    const storageService = {};
    const bulkImportService = {
      getJob: jest.fn(),
      processJob: jest.fn(),
      parseCsvLineForImport: jest.fn(),
    };
    const planUsageService = {
      getImportRowLimit: jest.fn().mockResolvedValue(30000),
    };

    const service = new BulkImportRunService(
      prisma as never,
      accessPolicy as never,
      queueService as never,
      storageService as never,
      bulkImportService as never,
      planUsageService as never,
    );

    return { service, enqueueMock, updateManyMock, createMock, findUniqueMock };
  }

  const readyRun = {
    id: "run_1",
    status: BulkImportRunStatus.preflight_ready,
    effectiveMode: "large",
    totalRows: 2500,
    categoryId: "cat_1",
    sourceFormat: "csv",
    sourceName: "import.csv",
    maxRetries: 3,
    category: { id: "cat_1", path: "Apparel" },
  };

  it("creates batch jobs and enqueues when run is preflight_ready (first request wins)", async () => {
    const { service, enqueueMock, createMock, updateManyMock } = createStartRunService(readyRun);

    await service.startRun("run_1", { actorId: "user_1", actorRole: "admin" as never });

    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run_1", status: BulkImportRunStatus.preflight_ready },
        data: expect.objectContaining({
          status: BulkImportRunStatus.processing,
          acceptedRows: 0,
          failedRows: 0,
          deadLetterRows: 0,
        }),
      }),
    );
    expect(createMock).toHaveBeenCalled();
    expect(enqueueMock).toHaveBeenCalled();
  });

  it("does NOT create jobs when optimistic claim returns count=0 (second concurrent request)", async () => {
    const { service, enqueueMock, createMock, updateManyMock } = createStartRunService(readyRun);
    updateManyMock.mockResolvedValue({ count: 0 });

    await service.startRun("run_1", { actorId: "user_1", actorRole: "admin" as never });

    expect(createMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("returns current run state idempotently when already processing", async () => {
    const processingRun = { ...readyRun, status: BulkImportRunStatus.processing };
    const { service, enqueueMock } = createStartRunService(processingRun);

    const result = await service.startRun("run_1", { actorId: "user_1", actorRole: "admin" as never });

    expect(result).toEqual(processingRun);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("returns current run state idempotently when already completed", async () => {
    const completedRun = { ...readyRun, status: BulkImportRunStatus.completed };
    const { service, enqueueMock } = createStartRunService(completedRun);

    const result = await service.startRun("run_1", { actorId: "user_1", actorRole: "admin" as never });

    expect(result).toEqual(completedRun);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("rejects non-large runs", async () => {
    const standardRun = { ...readyRun, effectiveMode: "standard" };
    const { service } = createStartRunService(standardRun);

    await expect(
      service.startRun("run_1", { actorId: "user_1", actorRole: "admin" as never }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
