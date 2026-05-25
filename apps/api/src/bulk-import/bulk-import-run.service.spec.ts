import { NotFoundException } from "@nestjs/common";
import { BulkImportJobStatus } from "@prisma/client";
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

    const service = new BulkImportRunService(
      prisma as never,
      accessPolicy as never,
      queueService as never,
      storageService as never,
      bulkImportService as never,
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
