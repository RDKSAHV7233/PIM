import { BulkEditOperationStatus } from "@prisma/client";
import { runWithTenantContext } from "../common/tenant/tenant-context";
import { BulkEditService } from "./bulk-edit.service";

// CTO review remediation (CODE-004): apply() used to load up to 10,000
// products and process them synchronously inline in the HTTP request
// handler. It now only creates the BulkEditOperation and enqueues one job;
// the actual product updates happen in the queue handler registered by
// onModuleInit(), which must be idempotent/resumable across redelivery.

type FakeProduct = {
  id: string;
  title: string;
  description: string;
  brand: string;
  status: string;
  hsnCode: string | null;
  gstRate: number | null;
  categoryId: string;
  version: number;
};

function fakeProduct(id: string, overrides: Partial<FakeProduct> = {}): FakeProduct {
  return {
    id,
    title: `Product ${id}`,
    description: "desc",
    brand: "Vexa",
    status: "draft",
    hsnCode: null,
    gstRate: null,
    categoryId: "cat_1",
    version: 1,
    ...overrides,
  };
}

function createService(options: { products?: FakeProduct[]; existingItems?: Array<{ productId: string | null; status: string }> } = {}) {
  const products = options.products ?? [];
  const existingItems = options.existingItems ?? [];

  const operations = new Map<string, Record<string, unknown>>();
  const items: Array<{ operationId: string; productId: string | null; status: string }> = [
    ...existingItems.map((item) => ({ operationId: "op_1", ...item })),
  ];

  const productCount = jest.fn(async () => products.length);
  const productFindMany = jest.fn(async ({ cursor, take }: { cursor?: { id: string }; take: number }) => {
    const startIndex = cursor ? products.findIndex((p) => p.id === cursor.id) + 1 : 0;
    return products.slice(startIndex, startIndex + take);
  });
  // Mirrors the real optimistic-concurrency check in applyToProduct(): only
  // mutates the live row (and bumps version) when the caller's `where.version`
  // still matches storage, otherwise reports count 0 like Prisma's updateMany.
  const productUpdateMany = jest.fn(
    async ({ where, data }: { where: { id: string; version: number }; data: Record<string, unknown> }) => {
      const existing = products.find((p) => p.id === where.id);
      if (!existing || existing.version !== where.version) {
        return { count: 0 };
      }
      const { version: _versionOp, ...rest } = data;
      Object.assign(existing, rest);
      existing.version += 1;
      return { count: 1 };
    },
  );
  const productFindUnique = jest.fn(async ({ where }: { where: { id: string } }) => {
    const existing = products.find((p) => p.id === where.id);
    return existing ? { ...existing } : null;
  });
  const productFindUniqueOrThrow = jest.fn(async ({ where }: { where: { id: string } }) => {
    const existing = products.find((p) => p.id === where.id);
    if (!existing) {
      throw new Error(`Product ${where.id} not found`);
    }
    return { ...existing };
  });

  const bulkEditOperationCreate = jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
    const id = `op_${operations.size + 1}`;
    const record = { id, appliedCount: 0, failedCount: 0, ...data };
    operations.set(id, record);
    return record;
  });
  const bulkEditOperationFindUnique = jest.fn(async ({ where }: { where: { id: string } }) => operations.get(where.id) ?? null);
  const bulkEditOperationUpdate = jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    const existing = operations.get(where.id) ?? {};
    const updated = { ...existing, ...data };
    operations.set(where.id, updated);
    return updated;
  });

  const bulkEditOperationItemCreate = jest.fn(async ({ data }: { data: { operationId: string; productId: string; status: string } }) => {
    items.push(data);
    return data;
  });
  const bulkEditOperationItemFindMany = jest.fn(async ({ where }: { where: { operationId: string } }) =>
    items.filter((item) => item.operationId === where.operationId).map((item) => ({ productId: item.productId })),
  );
  const bulkEditOperationItemGroupBy = jest.fn(async ({ where }: { where: { operationId: string } }) => {
    const scoped = items.filter((item) => item.operationId === where.operationId);
    const counts = new Map<string, number>();
    for (const item of scoped) {
      counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([status, count]) => ({ status, _count: { status: count } }));
  });

  const tenantClient = {
    product: {
      count: productCount,
      findMany: productFindMany,
      updateMany: productUpdateMany,
      findUnique: productFindUnique,
      findUniqueOrThrow: productFindUniqueOrThrow,
    },
    bulkEditOperation: {
      create: bulkEditOperationCreate,
      findUnique: bulkEditOperationFindUnique,
      update: bulkEditOperationUpdate,
    },
    bulkEditOperationItem: {
      create: bulkEditOperationItemCreate,
      findMany: bulkEditOperationItemFindMany,
      groupBy: bulkEditOperationItemGroupBy,
    },
  };

  const prisma = { tenant: jest.fn().mockReturnValue(tenantClient) };
  const complianceService = { validateAndPersistProduct: jest.fn().mockResolvedValue(undefined) };
  const accessPolicy = {
    assertCategoryAccess: jest.fn().mockResolvedValue(undefined),
    assertBulkEditAllowed: jest.fn().mockResolvedValue(undefined),
    buildProductScopeWhere: jest.fn().mockResolvedValue(undefined),
    assertRequestedProductScopeAllowed: jest.fn().mockResolvedValue(undefined),
  };
  const queueEnqueue = jest.fn().mockResolvedValue(undefined);
  let capturedHandler: ((payload: unknown) => Promise<void>) | null = null;
  const queueService = {
    enqueue: queueEnqueue,
    processWithBackpressure: jest.fn((_name: string, _opts: unknown, handler: (payload: unknown) => Promise<void>) => {
      capturedHandler = handler;
    }),
  };

  const service = new BulkEditService(prisma as never, complianceService as never, accessPolicy as never, queueService as never);
  service.onModuleInit();

  return {
    service,
    prisma,
    operations,
    items,
    queueEnqueue,
    accessPolicy,
    async runQueueHandler(payload: unknown) {
      if (!capturedHandler) {
        throw new Error("Queue handler was not registered — onModuleInit() must run first.");
      }
      await capturedHandler(payload);
    },
  };
}

describe("BulkEditService.apply — enqueues instead of processing synchronously", () => {
  it("creates a queued operation and enqueues a job when products match", async () => {
    const { service, operations, queueEnqueue } = createService({ products: [fakeProduct("p1"), fakeProduct("p2")] });

    const operation = await runWithTenantContext("acme", () =>
      service.apply({ categoryId: "cat_1" }, { status: "active" }, { actorId: "u1", actorRole: "admin" }),
    );

    expect(operation.status).toBe(BulkEditOperationStatus.queued);
    expect(operation.requestedCount).toBe(2);
    expect(operations.size).toBe(1);
    expect(queueEnqueue).toHaveBeenCalledTimes(1);
    expect(queueEnqueue).toHaveBeenCalledWith(
      "bulk-edit",
      expect.objectContaining({ operationId: operation.id, tenantKey: "acme" }),
    );
  });

  it("marks the operation completed with zero requestedCount and does not enqueue when nothing matches", async () => {
    const { service, queueEnqueue } = createService({ products: [] });

    const operation = await service.apply({ categoryId: "cat_empty" }, { status: "active" });

    expect(operation.status).toBe(BulkEditOperationStatus.completed);
    expect(operation.requestedCount).toBe(0);
    expect(queueEnqueue).not.toHaveBeenCalled();
  });
});

describe("BulkEditService queue handler — processApplyJob via onModuleInit registration", () => {
  it("processes all matching products and finalizes as completed", async () => {
    // draft -> in_review is a valid WORKFLOW_TRANSITIONS entry.
    const products = [fakeProduct("p1"), fakeProduct("p2"), fakeProduct("p3")];
    const { service, operations, items, runQueueHandler } = createService({ products });

    const operation = await service.apply({ categoryId: "cat_1" }, { status: "in_review" });
    await runQueueHandler({ operationId: operation.id, tenantKey: "default", actor: {} });

    const finalOp = operations.get(operation.id) as { status: string; appliedCount: number; failedCount: number };
    expect(finalOp.status).toBe(BulkEditOperationStatus.completed);
    expect(finalOp.appliedCount).toBe(3);
    expect(finalOp.failedCount).toBe(0);
    expect(items.filter((i) => i.status === "success")).toHaveLength(3);
  });

  it("finalizes as completed_with_errors when some products fail and some succeed", async () => {
    const products = [fakeProduct("p1", { status: "draft" }), fakeProduct("p2", { status: "approved" })];
    const { service, operations, runQueueHandler } = createService({ products });

    // WORKFLOW_TRANSITIONS["approved"] only allows -> "archived", so
    // approved -> in_review is invalid and p2 should fail while p1 succeeds.
    const operation = await service.apply({ categoryId: "cat_1" }, { status: "in_review" });
    await runQueueHandler({ operationId: operation.id, tenantKey: "default", actor: {} });

    const finalOp = operations.get(operation.id) as { status: string; appliedCount: number; failedCount: number };
    expect(finalOp.status).toBe(BulkEditOperationStatus.completed_with_errors);
    expect(finalOp.appliedCount).toBe(1);
    expect(finalOp.failedCount).toBe(1);
  });

  it("allows approved -> draft transition (issue #549)", async () => {
    const products = [fakeProduct("p1", { status: "approved" })];
    const { service, operations, runQueueHandler } = createService({ products });

    const operation = await service.apply({ categoryId: "cat_1" }, { status: "draft" });
    await runQueueHandler({ operationId: operation.id, tenantKey: "default", actor: {} });

    const finalOp = operations.get(operation.id) as { status: string; appliedCount: number; failedCount: number };
    expect(finalOp.status).toBe(BulkEditOperationStatus.completed);
    expect(finalOp.appliedCount).toBe(1);
    expect(finalOp.failedCount).toBe(0);
  });

  it("finalizes as failed when every product fails", async () => {
    const products = [fakeProduct("p1", { status: "approved" }), fakeProduct("p2", { status: "approved" })];
    const { service, operations, runQueueHandler } = createService({ products });

    const operation = await service.apply({ categoryId: "cat_1" }, { status: "in_review" });
    await runQueueHandler({ operationId: operation.id, tenantKey: "default", actor: {} });

    const finalOp = operations.get(operation.id) as { status: string; appliedCount: number; failedCount: number };
    expect(finalOp.status).toBe(BulkEditOperationStatus.failed);
    expect(finalOp.appliedCount).toBe(0);
    expect(finalOp.failedCount).toBe(2);
  });

  it("is idempotent on redelivery — skips products already recorded as processed", async () => {
    const products = [fakeProduct("p1"), fakeProduct("p2")];
    const { service, operations, items, runQueueHandler } = createService({
      products,
      existingItems: [{ productId: "p1", status: "success" }],
    });

    const operation = await service.apply({ categoryId: "cat_1" }, { status: "in_review" });
    // Pre-seed operation status as "processing" to simulate a prior partial attempt.
    operations.set(operation.id, { ...operations.get(operation.id), status: BulkEditOperationStatus.processing });

    await runQueueHandler({ operationId: operation.id, tenantKey: "default", actor: {} });

    // p1 should NOT be reprocessed (no duplicate item), only p2 is newly processed.
    const p1Items = items.filter((i) => i.productId === "p1");
    expect(p1Items).toHaveLength(1);
    const p2Items = items.filter((i) => i.productId === "p2");
    expect(p2Items).toHaveLength(1);

    const finalOp = operations.get(operation.id) as { appliedCount: number };
    expect(finalOp.appliedCount).toBe(2); // p1's pre-existing success + p2's new success
  });

  it("no-ops on redelivery once the operation is already terminal", async () => {
    const products = [fakeProduct("p1")];
    const { service, operations, items, runQueueHandler } = createService({ products });

    const operation = await service.apply({ categoryId: "cat_1" }, { status: "active" });
    operations.set(operation.id, { ...operations.get(operation.id), status: BulkEditOperationStatus.completed });

    await runQueueHandler({ operationId: operation.id, tenantKey: "default", actor: {} });

    expect(items).toHaveLength(0); // never touched — already terminal
  });

  it("is a no-op if the operation record can't be found", async () => {
    const { runQueueHandler, items } = createService({ products: [fakeProduct("p1")] });
    await expect(runQueueHandler({ operationId: "missing", tenantKey: "default", actor: {} })).resolves.toBeUndefined();
    expect(items).toHaveLength(0);
  });

  it("bumps the product's version on each successful apply (#559)", async () => {
    const products = [fakeProduct("p1", { version: 1 }), fakeProduct("p2", { version: 4 })];
    const { service, operations, runQueueHandler } = createService({ products });

    const operation = await service.apply({ categoryId: "cat_1" }, { status: "in_review" });
    await runQueueHandler({ operationId: operation.id, tenantKey: "default", actor: {} });

    const finalOp = operations.get(operation.id) as { appliedCount: number; failedCount: number };
    expect(finalOp.appliedCount).toBe(2);
    expect(finalOp.failedCount).toBe(0);
    // Each product's own version must have moved forward exactly once — this is
    // the concurrency signal single-product edits and future bulk edits rely on.
    expect(products.find((p) => p.id === "p1")?.version).toBe(2);
    expect(products.find((p) => p.id === "p2")?.version).toBe(5);
  });

  it("fails an item with a version conflict when it changed after the batch was scanned (#559)", async () => {
    // The live row is already at version 6 (another writer bumped it since this
    // run's batch scan), but the scan that fed this run only saw version 5.
    const liveProduct = fakeProduct("p1", { version: 6 });
    const { service, prisma, operations, items, runQueueHandler } = createService({ products: [liveProduct] });
    const staleScannedProduct = { ...liveProduct, version: 5 };
    prisma.tenant().product.findMany.mockResolvedValueOnce([staleScannedProduct]);

    const operation = await service.apply({ categoryId: "cat_1" }, { status: "in_review" });
    await runQueueHandler({ operationId: operation.id, tenantKey: "default", actor: {} });

    const finalOp = operations.get(operation.id) as { status: string; appliedCount: number; failedCount: number };
    expect(finalOp.appliedCount).toBe(0);
    expect(finalOp.failedCount).toBe(1);
    expect(finalOp.status).toBe(BulkEditOperationStatus.failed);
    // The row was never touched by this run — the live version stayed exactly
    // where the concurrent writer left it, proving no silent overwrite happened.
    expect(liveProduct.version).toBe(6);
    const failedItem = items.find((item) => item.productId === "p1") as { errorMessage?: string };
    expect(failedItem?.errorMessage).toMatch(/version/i);
    expect(failedItem?.errorMessage).toMatch(/had version 5/);
  });
});
