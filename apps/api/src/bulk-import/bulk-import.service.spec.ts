import { BadRequestException } from "@nestjs/common";
import { Readable } from "node:stream";
import { BulkImportRowStatus, Prisma } from "@prisma/client";
import { BulkImportRunService } from "./bulk-import-run.service";
import { BulkImportService } from "./bulk-import.service";

const MB = 1024 * 1024;

function buildCsv(rowCount: number) {
  const lines = ["title,description,brand,hsnCode,gstRate,attributes,skuCode"];
  for (let index = 0; index < rowCount; index += 1) {
    lines.push(`Product ${index},Description ${index},Vexa PIM,62046200,18,{},SKU-${index}`);
  }
  return lines.join("\n");
}

function makeService(options?: { importRowLimit?: number }) {
  const prisma = {
    tenant: jest.fn().mockReturnValue({
      category: {
        findUnique: jest.fn().mockResolvedValue({ id: "cat1", name: "Apparel" }),
      },
    }),
  };
  const complianceService = {};
  const notificationsService = {};
  const metricsService = {
    emit: jest.fn().mockResolvedValue(undefined),
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const accessPolicy = {
    assertCategoryAccess: jest.fn().mockResolvedValue(undefined),
    assertBulkImportAccess: jest.fn().mockResolvedValue(undefined),
  };
  const planUsageService = {
    getImportRowLimit: jest.fn().mockResolvedValue(options?.importRowLimit ?? 30_000),
  };
  return new BulkImportService(
    prisma as never,
    complianceService as never,
    notificationsService as never,
    accessPolicy as never,
    planUsageService as never,
    metricsService as never,
    logger as never,
    {} as never,
  );
}

describe("BulkImportService.validateImport", () => {
  describe("file format validation", () => {
    it("rejects unknown mime type with no recognized extension", async () => {
      const svc = makeService();
      const result = await svc.validateImport({
        fileName: "products.pdf",
        fileSize: 100,
        mimeType: "application/pdf",
      });
      expect(result.formatValid).toBe(false);
      expect(result.valid).toBe(false);
      expect(result.blockingCount).toBe(1);
    });

    it("accepts text/csv mime type", async () => {
      const svc = makeService();
      const result = await svc.validateImport({
        fileName: "products.csv",
        fileSize: 1000,
        mimeType: "text/csv",
        categoryId: "cat1",
      });
      expect(result.formatValid).toBe(true);
    });

    it("accepts xlsx by extension even with generic mime type", async () => {
      const svc = makeService();
      const result = await svc.validateImport({
        fileName: "products.xlsx",
        fileSize: 2000,
        mimeType: "application/octet-stream",
        categoryId: "cat1",
      });
      expect(result.formatValid).toBe(true);
    });
  });

  describe("8 MB file size limit", () => {
    it("passes when file is exactly at the limit", async () => {
      const svc = makeService();
      const result = await svc.validateImport({
        fileName: "products.csv",
        fileSize: 8 * MB,
        mimeType: "text/csv",
        categoryId: "cat1",
      });
      expect(result.schemaIssues).toHaveLength(0);
      expect(result.valid).toBe(true);
    });

    it("adds schema issue when file exceeds 8 MB", async () => {
      const svc = makeService();
      const result = await svc.validateImport({
        fileName: "products.csv",
        fileSize: 8 * MB + 1,
        mimeType: "text/csv",
        categoryId: "cat1",
      });
      expect(result.schemaIssues).toContain("File exceeds maximum allowed size of 8 MB.");
      expect(result.valid).toBe(false);
      expect(result.blockingCount).toBe(1);
    });

    it("includes size issue in blockingCount", async () => {
      const svc = makeService();
      const result = await svc.validateImport({
        fileName: "products.csv",
        fileSize: 100 * MB,
        mimeType: "text/csv",
        categoryId: "cat1",
      });
      expect(result.blockingCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("row count estimation", () => {
    it("estimates row count from file size", async () => {
      const svc = makeService();
      const result = await svc.validateImport({
        fileName: "products.csv",
        fileSize: 120 * 50,  // 50 rows at 120 bytes each
        mimeType: "text/csv",
        categoryId: "cat1",
      });
      expect(result.rowCount).toBe(50);
    });

    it("returns null for tiny files with estimated 0 rows", async () => {
      const svc = makeService();
      const result = await svc.validateImport({
        fileName: "products.csv",
        fileSize: 50,  // less than 120 bytes = 0 estimated rows
        mimeType: "text/csv",
        categoryId: "cat1",
      });
      expect(result.rowCount).toBeNull();
    });
  });

  describe("category validation", () => {
    it("adds warning when no categoryId is provided", async () => {
      const svc = makeService();
      const result = await svc.validateImport({
        fileName: "products.csv",
        fileSize: 1000,
        mimeType: "text/csv",
      });
      expect(result.categoryIssues.length).toBeGreaterThan(0);
      expect(result.warningCount).toBeGreaterThan(0);
    });

    it("adds category issue when categoryId is not found", async () => {
      const prisma = {
        tenant: jest.fn().mockReturnValue({
          category: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        }),
      };
      const svc = new BulkImportService(
        prisma as never,
        {} as never,
        {} as never,
        { assertBulkImportAccess: jest.fn() } as never,
        { getImportRowLimit: jest.fn().mockResolvedValue(30_000) } as never,
        { emit: jest.fn().mockResolvedValue(undefined) } as never,
        { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
        {} as never,
      );
      const result = await svc.validateImport({
        fileName: "products.csv",
        fileSize: 1000,
        mimeType: "text/csv",
        categoryId: "nonexistent-cat",
      });
      expect(result.categoryIssues).toContain(
        "Category 'nonexistent-cat' not found in this workspace.",
      );
    });

    it("returns valid:true when format and category are both fine", async () => {
      const svc = makeService();
      const result = await svc.validateImport({
        fileName: "products.csv",
        fileSize: 1000,
        mimeType: "text/csv",
        categoryId: "cat1",
      });
      expect(result.valid).toBe(true);
      expect(result.blockingCount).toBe(0);
    });
  });

  describe("field mapping summary", () => {
    it("always includes core field mappings", async () => {
      const svc = makeService();
      const result = await svc.validateImport({
        fileName: "products.csv",
        fileSize: 1000,
        mimeType: "text/csv",
        categoryId: "cat1",
      });
      const mappedFields = result.fieldMappingSummary.map((f) => f.sourceField);
      expect(mappedFields).toContain("title");
      expect(mappedFields).toContain("brand");
      expect(mappedFields).toContain("status");
    });
  });

  describe("validateJobInput row limits", () => {
    it("allows Enterprise-sized 10001-row CSV imports when the plan limit is 30000", async () => {
      const svc = makeService({ importRowLimit: 30_000 });
      const result = await svc.validateJobInput({
        categoryId: "cat1",
        sourceFormat: "csv",
        sourceName: "enterprise-import.csv",
        csvContent: buildCsv(10_001),
      });

      expect(result.totalRows).toBe(10_001);
      expect(result.canImport).toBe(true);
      expect(result.blockingIssueCount).toBe(0);
      expect(result.sampleIssues.some((issue) => issue.code === "ROW_LIMIT_EXCEEDED")).toBe(false);
    });

    it("still blocks rows above the plan limit for smaller plans", async () => {
      const svc = makeService({ importRowLimit: 2_000 });
      const result = await svc.validateJobInput({
        categoryId: "cat1",
        sourceFormat: "csv",
        sourceName: "starter-import.csv",
        csvContent: buildCsv(2_001),
      });

      expect(result.totalRows).toBe(2_001);
      expect(result.canImport).toBe(false);
      expect(result.blockingIssueCount).toBeGreaterThan(0);
      expect(result.sampleIssues).toContainEqual(
        expect.objectContaining({
          code: "ROW_LIMIT_EXCEEDED",
          message: "Maximum 2,000 rows per job.",
        }),
      );
    });
  });
});

describe("BulkImportService.processJob — terminal status guard", () => {
  function makeProcessService(jobStub: Record<string, unknown>) {
    const enrichedJob = { ...jobStub, category: { id: "cat1", path: "/cat1" }, rows: [] };
    const updateMock = jest.fn();
    const prisma = {
      tenant: jest.fn().mockReturnValue({
        bulkImportJob: { update: updateMock, findUnique: jest.fn().mockResolvedValue(enrichedJob) },
        bulkImportRow: { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
        category: { findUnique: jest.fn().mockResolvedValue({ id: "cat1" }) },
      }),
    };
    const accessPolicy = {
      assertCategoryAccess: jest.fn().mockResolvedValue(undefined),
      assertBulkImportAccess: jest.fn().mockResolvedValue(undefined),
      applyBulkImportRowVisibility: jest.fn().mockImplementation((_actor: unknown, job: unknown) => job),
    };
    const svc = new BulkImportService(
      prisma as never, {} as never, {} as never, accessPolicy as never,
      { getImportRowLimit: jest.fn().mockResolvedValue(30_000) } as never,
      { emit: jest.fn() } as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      {} as never,
    );
    return { svc, updateMock };
  }

  it("skips processing for completed jobs", async () => {
    const { svc, updateMock } = makeProcessService({ id: "j1", status: "completed", categoryId: "cat1" });
    await svc.processJob("j1", undefined, { actorId: "u1", actorRole: "admin" as never });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("skips processing for failed jobs", async () => {
    const { svc, updateMock } = makeProcessService({ id: "j2", status: "failed", categoryId: "cat1" });
    await svc.processJob("j2", undefined, { actorId: "u1", actorRole: "admin" as never });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("skips processing for dead_letter jobs", async () => {
    const { svc, updateMock } = makeProcessService({ id: "j3", status: "dead_letter", categoryId: "cat1" });
    await svc.processJob("j3", undefined, { actorId: "u1", actorRole: "admin" as never });
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("BulkImportService.processRow — idempotency and concurrency", () => {
  function makeRowProcessService(options: {
    rows: Array<Record<string, unknown>>;
    productFindResult?: Record<string, unknown> | null;
    claimCount?: number;
  }) {
    const productCreateMock = jest.fn().mockResolvedValue({ id: "new-product" });
    const variantCreateMock = jest.fn().mockResolvedValue({ id: "new-variant" });
    const productFindUniqueMock = jest.fn().mockResolvedValue(options.productFindResult ?? null);
    const jobFindUniqueMock = jest.fn().mockResolvedValue({
      id: "job1", status: "queued", categoryId: "cat1", maxRetries: 3, chunkSize: 100,
      category: { id: "cat1", path: "/cat1" }, rows: [],
    });
    const rowUpdateMock = jest.fn().mockResolvedValue({});
    const rowUpdateManyMock = jest.fn().mockResolvedValue({ count: options.claimCount ?? 1 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tenantClient: any = {
      bulkImportJob: { update: jest.fn().mockResolvedValue({ id: "job1", status: "completed", runId: null }), updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUnique: jobFindUniqueMock },
      // findMany must return the rows once then empty on subsequent calls so
      // processJob()'s while-loop terminates. Real Prisma behavior mirrors
      // this: after processRow() runs, rows leave "queued"/"retrying" and
      // stop matching the findMany filter. Without .mockResolvedValueOnce
      // the mock returns the same "queued" rows forever, spinning the loop
      // and leaking jest mock.calls until OOM.
      bulkImportRow: { findMany: jest.fn().mockResolvedValueOnce(options.rows).mockResolvedValue([]), update: rowUpdateMock, updateMany: rowUpdateManyMock, groupBy: jest.fn().mockResolvedValue([]) },
      product: { create: productCreateMock, findUnique: productFindUniqueMock },
      variant: { create: variantCreateMock },
      productTaxCode: { createMany: jest.fn() },
      taxRegime: { findMany: jest.fn().mockResolvedValue([]) },
      category: { findUnique: jest.fn().mockResolvedValue({ id: "cat1" }) },
    };
    // processRow wraps product+variant creation in $transaction — run the callback
    // against the same tenantClient so productCreateMock/variantCreateMock still fire.
    tenantClient.$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(tenantClient));
    const prisma = {
      tenant: jest.fn().mockReturnValue(tenantClient),
    };
    const accessPolicy = {
      assertCategoryAccess: jest.fn().mockResolvedValue(undefined),
      applyBulkImportRowVisibility: jest.fn().mockImplementation((_a: unknown, j: unknown) => j),
    };
    const svc = new BulkImportService(
      prisma as never, { validateAndPersistProduct: jest.fn().mockResolvedValue(undefined) } as never,
      { emitImportStatus: jest.fn().mockResolvedValue(undefined) } as never, accessPolicy as never,
      { getImportRowLimit: jest.fn().mockResolvedValue(30_000) } as never,
      { emit: jest.fn() } as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      {} as never,
    );
    return { svc, productCreateMock, variantCreateMock, rowUpdateMock, rowUpdateManyMock, productFindUniqueMock };
  }

  it("reuses existing product when row already has a productId (idempotent retry)", async () => {
    const { svc, productCreateMock, rowUpdateMock } = makeRowProcessService({
      rows: [{ id: "row1", payload: { title: "Test", skuCode: "SKU-TEST-1" }, retryCount: 0, productId: "existing-product", rowNumber: 1, status: "retrying" }],
      productFindResult: { id: "existing-product" },
    });
    await svc.processJob("job1", 100, { actorId: "u1", actorRole: "admin" as never });
    expect(productCreateMock).not.toHaveBeenCalled();
    const successUpdate = rowUpdateMock.mock.calls.find(
      (call: unknown[]) => (call[0] as { data?: { status?: string } })?.data?.status === "success"
    );
    expect(successUpdate).toBeDefined();
    expect((successUpdate![0] as { data: { productId: string } }).data.productId).toBe("existing-product");
  });

  it("creates new product when row.productId points to a deleted product", async () => {
    const { svc, productCreateMock } = makeRowProcessService({
      rows: [{ id: "row2", payload: { title: "Test", skuCode: "SKU-TEST-1" }, retryCount: 0, productId: "deleted-product", rowNumber: 1, status: "retrying" }],
      productFindResult: null,
    });
    await svc.processJob("job1", 100, { actorId: "u1", actorRole: "admin" as never });
    expect(productCreateMock).toHaveBeenCalledTimes(1);
  });

  it("skips row when optimistic claim returns count=0 (concurrent worker already claimed)", async () => {
    const { svc, productCreateMock, rowUpdateMock } = makeRowProcessService({
      rows: [{ id: "row3", payload: { title: "Test", skuCode: "SKU-TEST-1" }, retryCount: 0, productId: null, rowNumber: 1, status: "queued" }],
      claimCount: 0,
    });
    await svc.processJob("job1", 100, { actorId: "u1", actorRole: "admin" as never });
    expect(productCreateMock).not.toHaveBeenCalled();
    const successUpdates = rowUpdateMock.mock.calls.filter(
      (call: unknown[]) => (call[0] as { data?: { status?: string } })?.data?.status === "success"
    );
    expect(successUpdates).toHaveLength(0);
  });

  it("productId reuse is tenant-safe: cross-tenant ID returns null and creates new product", async () => {
    const { svc, productFindUniqueMock } = makeRowProcessService({
      rows: [{ id: "row4", payload: { title: "Test", skuCode: "SKU-TEST-1" }, retryCount: 0, productId: "cross-tenant-product", rowNumber: 1, status: "retrying" }],
      productFindResult: null,
    });
    await svc.processJob("job1", 100, { actorId: "u1", actorRole: "admin" as never });
    expect(productFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "cross-tenant-product" } }),
    );
  });

  it("persists productId to row immediately after product creation (crash recovery)", async () => {
    const { svc, rowUpdateMock } = makeRowProcessService({
      rows: [{ id: "row5", payload: { title: "Test", skuCode: "SKU-TEST-1" }, retryCount: 0, productId: null, rowNumber: 1, status: "queued" }],
    });
    await svc.processJob("job1", 100, { actorId: "u1", actorRole: "admin" as never });
    const productIdUpdate = rowUpdateMock.mock.calls.find(
      (call: unknown[]) => {
        const data = (call[0] as { data?: Record<string, unknown> })?.data;
        return data?.productId && !data?.status;
      }
    );
    expect(productIdUpdate).toBeDefined();
    expect((productIdUpdate![0] as { data: { productId: string } }).data.productId).toBe("new-product");
  });
});

// F-2 regression tests: bulk import must create a Variant (with SKU/price) alongside
// the Product, in the same transaction, and must classify a SKU collision as a
// non-retryable failure rather than retrying a deterministic error until dead-letter.
describe("BulkImportService.processRow — Variant creation (F-2)", () => {
  function makeRowProcessService(options: {
    rows: Array<Record<string, unknown>>;
    productFindResult?: Record<string, unknown> | null;
    claimCount?: number;
    variantCreateImpl?: () => Promise<unknown>;
  }) {
    const productCreateMock = jest.fn().mockResolvedValue({ id: "new-product" });
    const variantCreateMock = options.variantCreateImpl
      ? jest.fn().mockImplementation(options.variantCreateImpl)
      : jest.fn().mockResolvedValue({ id: "new-variant" });
    const productFindUniqueMock = jest.fn().mockResolvedValue(options.productFindResult ?? null);
    const jobFindUniqueMock = jest.fn().mockResolvedValue({
      id: "job1", status: "queued", categoryId: "cat1", maxRetries: 3, chunkSize: 100,
      category: { id: "cat1", path: "/cat1" }, rows: [],
    });
    const rowUpdateMock = jest.fn().mockResolvedValue({});
    const rowUpdateManyMock = jest.fn().mockResolvedValue({ count: options.claimCount ?? 1 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tenantClient: any = {
      bulkImportJob: { update: jest.fn().mockResolvedValue({ id: "job1", status: "completed", runId: null }), updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUnique: jobFindUniqueMock },
      bulkImportRow: { findMany: jest.fn().mockResolvedValueOnce(options.rows).mockResolvedValue([]), update: rowUpdateMock, updateMany: rowUpdateManyMock, groupBy: jest.fn().mockResolvedValue([]) },
      product: { create: productCreateMock, findUnique: productFindUniqueMock },
      variant: { create: variantCreateMock },
      productTaxCode: { createMany: jest.fn() },
      taxRegime: { findMany: jest.fn().mockResolvedValue([]) },
      category: { findUnique: jest.fn().mockResolvedValue({ id: "cat1" }) },
    };
    tenantClient.$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(tenantClient));
    const prisma = { tenant: jest.fn().mockReturnValue(tenantClient) };
    const accessPolicy = {
      assertCategoryAccess: jest.fn().mockResolvedValue(undefined),
      applyBulkImportRowVisibility: jest.fn().mockImplementation((_a: unknown, j: unknown) => j),
    };
    const svc = new BulkImportService(
      prisma as never, { validateAndPersistProduct: jest.fn().mockResolvedValue(undefined) } as never,
      { emitImportStatus: jest.fn().mockResolvedValue(undefined) } as never, accessPolicy as never,
      { getImportRowLimit: jest.fn().mockResolvedValue(30_000) } as never,
      { emit: jest.fn() } as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      {} as never,
    );
    return { svc, productCreateMock, variantCreateMock, rowUpdateMock };
  }

  it("creates a Variant with skuCode/mrp/sellingPrice alongside the Product", async () => {
    const { svc, variantCreateMock } = makeRowProcessService({
      rows: [{
        id: "row1",
        payload: { title: "Test Product", skuCode: "SKU-100", mrp: 999, sellingPrice: 799 },
        retryCount: 0, productId: null, rowNumber: 1, status: "queued",
      }],
    });

    await svc.processJob("job1", 100, { actorId: "u1", actorRole: "admin" as never });

    expect(variantCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: "new-product",
          skuCode: "SKU-100",
          mrp: 999,
          sellingPrice: 799,
        }),
      }),
    );
  });

  it("a duplicate skuCode (P2002 on variant.create) fails the row cleanly and is NOT retried", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
    });
    const { svc, rowUpdateMock } = makeRowProcessService({
      rows: [{
        id: "row1",
        payload: { title: "Test Product", skuCode: "SKU-DUP" },
        retryCount: 0, productId: null, rowNumber: 1, status: "queued",
      }],
      variantCreateImpl: () => Promise.reject(p2002),
    });

    await svc.processJob("job1", 100, { actorId: "u1", actorRole: "admin" as never });

    const failureUpdate = rowUpdateMock.mock.calls.find(
      (call: unknown[]) => (call[0] as { data?: { status?: string } })?.data?.status !== undefined,
    );
    expect(failureUpdate).toBeDefined();
    const data = (failureUpdate![0] as { data: { status: string; retryCount: number; errorMessage: string } }).data;
    // Non-retryable: status goes straight to "failed" (never "retrying"/"dead_letter"),
    // and retryCount is NOT incremented — a real Postgres transaction rollback (see
    // processRow's $transaction) means this row is left clean, not variant-less.
    expect(data.status).toBe(BulkImportRowStatus.failed);
    expect(data.retryCount).toBe(0);
    expect(data.errorMessage).toMatch(/duplicate sku/i);
  });

  it("does not persist row.productId when variant creation fails (no orphaned Product on the retry path)", async () => {
    const { svc, rowUpdateMock } = makeRowProcessService({
      rows: [{
        id: "row1",
        payload: { title: "Test Product", skuCode: "SKU-FAIL" },
        retryCount: 0, productId: null, rowNumber: 1, status: "queued",
      }],
      variantCreateImpl: () => Promise.reject(new Error("simulated transient DB error")),
    });

    await svc.processJob("job1", 100, { actorId: "u1", actorRole: "admin" as never });

    const productIdPersisted = rowUpdateMock.mock.calls.some(
      (call: unknown[]) => Boolean((call[0] as { data?: { productId?: unknown } })?.data?.productId),
    );
    expect(productIdPersisted).toBe(false);
  });
});

describe("BulkImportService.preflightValidateJob — skuCode check (F-2)", () => {
  function makeService(rows: Array<Record<string, unknown>>) {
    const prisma = {
      tenant: jest.fn().mockReturnValue({
        bulkImportJob: { findUnique: jest.fn().mockResolvedValue({ id: "job1", categoryId: "cat1" }) },
        bulkImportRow: { findMany: jest.fn().mockResolvedValue(rows) },
      }),
    };
    const accessPolicy = { assertCategoryAccess: jest.fn().mockResolvedValue(undefined) };
    return new BulkImportService(
      prisma as never, {} as never, {} as never, accessPolicy as never,
      {} as never, {} as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      {} as never,
    );
  }

  it("no longer flags a row with a mapped skuCode as missing it, now that normalizeCanonicalPayload persists the field", async () => {
    const svc = makeService([
      { rowNumber: 1, payload: { title: "T", skuCode: "SKU-1" } },
    ]);
    const result = await svc.preflightValidateJob("job1");
    expect((result as { blockingErrors: string[] }).blockingErrors).not.toContain(
      "One or more rows are missing required field: skuCode",
    );
  });

  it("still flags a row whose payload genuinely has no skuCode", async () => {
    const svc = makeService([
      { rowNumber: 1, payload: { title: "T" } },
    ]);
    const result = await svc.preflightValidateJob("job1");
    expect((result as { blockingErrors: string[] }).blockingErrors).toContain(
      "One or more rows are missing required field: skuCode",
    );
  });
});

describe("BulkImportService.suggestMapping", () => {
  it("returns a mapping object for standard headers", () => {
    const svc = makeService();
    const suggestions = svc.suggestMapping(["product_name", "brand", "sku_code"]);
    expect(typeof suggestions).toBe("object");
    expect(suggestions).not.toBeNull();
  });

  it("maps 'brand' header to the brand field in mapping", () => {
    const svc = makeService();
    const suggestions = svc.suggestMapping(["title", "brand", "description"]);
    expect(suggestions).toHaveProperty("mapping");
    expect((suggestions as { mapping: Record<string, string> }).mapping).toHaveProperty("brand", "brand");
  });

  it("returns structured result with mapping and confidence keys", () => {
    const svc = makeService();
    const suggestions = svc.suggestMapping(["title", "brand"]);
    expect(suggestions).toHaveProperty("mapping");
    expect(suggestions).toHaveProperty("confidence");
    expect(suggestions).toHaveProperty("unmappedFields");
    expect(suggestions).toHaveProperty("unusedHeaders");
  });
});

// ─── normalizeCanonicalPayloadForImport — taxCodes collection ─────────────────

describe("BulkImportService — international tax code collection", () => {
  function makeDefaultMapping() {
    return {
      title: "title", description: "description", brand: "brand",
      hsnCode: "hsnCode", gstRate: "gstRate", status: "status", attributes: "attributes",
    };
  }

  it("collects GB commodity code from flat CSV column", () => {
    const svc = makeService();
    const row = { title: "Tee", gb_commodity_code: "6204420000" };
    const result = svc.normalizeCanonicalPayloadForImport(row, makeDefaultMapping());
    expect(result.taxCodes).toBeDefined();
    expect(result.taxCodes!.length).toBe(1);
    expect(result.taxCodes![0]).toMatchObject({ regimeKey: "GB", key: "COMMODITY_CODE", value: "6204420000" });
  });

  it("collects AE hs code from flat CSV column", () => {
    const svc = makeService();
    const row = { title: "Tee", ae_hs_code: "620442" };
    const result = svc.normalizeCanonicalPayloadForImport(row, makeDefaultMapping());
    expect(result.taxCodes).toBeDefined();
    expect(result.taxCodes!.some((tc) => tc.regimeKey === "AE" && tc.key === "HS_CODE" && tc.value === "620442")).toBe(true);
  });

  it("collects US tax category from flat CSV column", () => {
    const svc = makeService();
    const row = { title: "Tee", us_tax_category: "CLOTHING" };
    const result = svc.normalizeCanonicalPayloadForImport(row, makeDefaultMapping());
    expect(result.taxCodes).toBeDefined();
    expect(result.taxCodes!.some((tc) => tc.regimeKey === "US" && tc.key === "TAX_CATEGORY" && tc.value === "CLOTHING")).toBe(true);
  });

  it("collects AU commodity code from flat CSV column", () => {
    const svc = makeService();
    const row = { title: "Tee", au_commodity_code: "62044200" };
    const result = svc.normalizeCanonicalPayloadForImport(row, makeDefaultMapping());
    expect(result.taxCodes).toBeDefined();
    expect(result.taxCodes!.some((tc) => tc.regimeKey === "AU" && tc.key === "COMMODITY_CODE")).toBe(true);
  });

  it("collects multiple flat columns in a single row", () => {
    const svc = makeService();
    const row = { title: "Tee", gb_commodity_code: "6204420000", ae_hs_code: "620442", us_tax_category: "CLOTHING" };
    const result = svc.normalizeCanonicalPayloadForImport(row, makeDefaultMapping());
    expect(result.taxCodes).toBeDefined();
    expect(result.taxCodes!.length).toBe(3);
  });

  it("includes optional rate when gb_tax_rate column is present", () => {
    const svc = makeService();
    const row = { title: "Tee", gb_commodity_code: "6204420000", gb_tax_rate: "20" };
    const result = svc.normalizeCanonicalPayloadForImport(row, makeDefaultMapping());
    const gb = result.taxCodes?.find((tc) => tc.regimeKey === "GB");
    expect(gb?.rate).toBe(20);
  });

  it("returns undefined taxCodes when no tax code columns are present", () => {
    const svc = makeService();
    const row = { title: "Tee", brand: "Vexa", hsnCode: "61091000", gstRate: "12" };
    const result = svc.normalizeCanonicalPayloadForImport(row, makeDefaultMapping());
    expect(result.taxCodes).toBeUndefined();
  });

  it("skips empty flat columns and returns empty array (not undefined) when column is present but blank", () => {
    const svc = makeService();
    const row = { title: "Tee", gb_commodity_code: "" };
    const result = svc.normalizeCanonicalPayloadForImport(row, makeDefaultMapping());
    // Column was present (so hasAnyFlatColumn=true) but value is blank → empty array
    expect(result.taxCodes).toBeDefined();
    expect(result.taxCodes!.length).toBe(0);
  });

  it("collects taxCodes from JSON array format", () => {
    const svc = makeService();
    const row = {
      title: "Tee",
      taxCodes: [
        { regimeKey: "GB", key: "COMMODITY_CODE", value: "6204420000" },
        { regimeKey: "AE", key: "HS_CODE", value: "620442", rate: 5 },
      ],
    };
    const result = svc.normalizeCanonicalPayloadForImport(row, makeDefaultMapping());
    expect(result.taxCodes).toBeDefined();
    expect(result.taxCodes!.length).toBe(2);
    expect(result.taxCodes!.find((tc) => tc.regimeKey === "AE")?.rate).toBe(5);
  });

  it("accepts case-insensitive flat column aliases (UK_COMMODITY_CODE)", () => {
    const svc = makeService();
    const row = { title: "Tee", UK_COMMODITY_CODE: "6204420000" };
    const result = svc.normalizeCanonicalPayloadForImport(row, makeDefaultMapping());
    expect(result.taxCodes?.some((tc) => tc.regimeKey === "GB")).toBe(true);
  });

  it("fieldMappingSummary includes international tax code entries", async () => {
    const svc = makeService();
    const result = await svc.validateImport({
      fileName: "products.csv",
      fileSize: 1000,
      mimeType: "text/csv",
      categoryId: "cat1",
    });
    const mappedSources = result.fieldMappingSummary.map((f) => f.sourceField);
    expect(mappedSources).toContain("gb_commodity_code");
    expect(mappedSources).toContain("ae_hs_code");
    expect(mappedSources).toContain("us_tax_category");
    expect(mappedSources).toContain("au_commodity_code");
  });
});

describe("Bulk import error report CSV", () => {
  function makeAccessPolicy() {
    return {
      assertCategoryAccess: jest.fn().mockResolvedValue(undefined),
      assertBulkImportAccess: jest.fn().mockResolvedValue(undefined),
      applyBulkImportRowVisibility: jest.fn().mockImplementation((_actor: unknown, payload: unknown) => payload),
    };
  }

  it("exports visible legacy job problem rows with repair context", async () => {
    const findRows = jest.fn().mockResolvedValue([
      {
        jobId: "job_1",
        runId: null,
        rowNumber: 4,
        status: BulkImportRowStatus.failed,
        retryCount: 0,
        errorMessage: "INVALID_HSN: HSN codes must be 4, 6, or 8 digits.",
        payload: {
          skuCode: "SKU-004",
          title: "Broken row",
          hsnCode: "12",
        },
      },
    ]);
    const prisma = {
      tenant: jest.fn().mockReturnValue({
        bulkImportJob: {
          findUnique: jest.fn().mockResolvedValue({ id: "job_1", categoryId: "cat_1" }),
        },
        bulkImportRow: {
          findMany: findRows,
        },
      }),
    };
    const accessPolicy = makeAccessPolicy();
    const service = new BulkImportService(
      prisma as never,
      {} as never,
      {} as never,
      accessPolicy as never,
      { getImportRowLimit: jest.fn().mockResolvedValue(30_000) } as never,
      { emit: jest.fn() } as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      {} as never,
    );

    const csv = await service.buildErrorReportCsv("job_1", { actorId: "admin", actorRole: "admin" as never });

    expect(findRows).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          jobId: "job_1",
          OR: expect.arrayContaining([
            expect.objectContaining({
              status: expect.objectContaining({
                in: expect.arrayContaining([
                  BulkImportRowStatus.failed,
                  BulkImportRowStatus.retrying,
                  BulkImportRowStatus.dead_letter,
                ]),
              }),
            }),
            { errorMessage: { not: null } },
          ]),
        }),
      }),
    );
    expect(csv).toContain('"runId","jobId","rowNumber","skuCode","status","errorCode","errorMessage","attemptCount","originalData"');
    expect(csv).toContain('"job_1"');
    expect(csv).toContain('"4"');
    expect(csv).toContain('"SKU-004"');
    expect(csv).toContain('"INVALID_HSN"');
    expect(csv).toContain('"INVALID_HSN: HSN codes must be 4, 6, or 8 digits."');
    expect(csv).toContain("Broken row");
    expect(accessPolicy.assertCategoryAccess).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "admin" }),
      "import",
      "cat_1",
      "BulkImportJob",
      "job_1",
    );
  });

  it("exports run-centric problem rows with original row data", async () => {
    const findRows = jest.fn().mockResolvedValue([
      {
        jobId: "job_2",
        runId: "run_1",
        rowNumber: 6,
        rowNumberGlobal: 106,
        status: BulkImportRowStatus.dead_letter,
        retryCount: 3,
        errorMessage: "REQUIRED_FIELD: Title is required.",
        payload: {
          title: "",
          attributes: { sku: "SKU-106" },
        },
        productId: null,
      },
    ]);
    const prisma = {
      tenant: jest.fn().mockReturnValue({
        bulkImportRun: {
          findUnique: jest.fn().mockResolvedValue({
            id: "run_1",
            categoryId: "cat_1",
            category: { id: "cat_1", path: "/cat_1" },
          }),
        },
        bulkImportRow: {
          findMany: findRows,
        },
      }),
    };
    const accessPolicy = makeAccessPolicy();
    const service = new BulkImportRunService(
      prisma as never,
      accessPolicy as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const csv = await service.buildRunErrorReportCsv("run_1", {
      actorId: "admin",
      actorRole: "admin" as never,
    });

    expect(findRows).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          runId: "run_1",
          OR: expect.arrayContaining([
            expect.objectContaining({
              status: expect.objectContaining({
                in: expect.arrayContaining([
                  BulkImportRowStatus.failed,
                  BulkImportRowStatus.retrying,
                  BulkImportRowStatus.dead_letter,
                ]),
              }),
            }),
            { errorMessage: { not: null } },
          ]),
        }),
        take: 10_000,
      }),
    );
    expect(csv).toContain('"runId","jobId","rowNumber","skuCode","status","errorCode","errorMessage","attemptCount","originalData"');
    expect(csv).toContain('"run_1"');
    expect(csv).toContain('"job_2"');
    expect(csv).toContain('"106"');
    expect(csv).toContain('"SKU-106"');
    expect(csv).toContain('"REQUIRED_FIELD"');
    expect(csv).toContain('"3"');
    expect(csv).toContain("SKU-106");
    expect(accessPolicy.assertCategoryAccess).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "admin" }),
      "import",
      "cat_1",
      "BulkImportRun",
      "run_1",
    );
  });
});

describe("BulkImportService.createJob — staged CSV read path", () => {
  const CSV_CONTENT = "title,description,brand\nWidget A,A desc,Vexa\nWidget B,B desc,Vexa\n";

  function makeCreateJobService(options: {
    runRecord?: { sourceFileKey: string | null; sourceExpiresAt: Date | null; sourceFormat?: "csv" | "json" } | null;
    sourceContent?: string;
  }) {
    const runFindUnique = jest.fn().mockResolvedValue(options.runRecord ?? null);
    const jobCreateMock = jest.fn().mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "job-1", ...args.data }),
    );
    const rowCreateManyMock = jest.fn().mockResolvedValue({ count: 2 });
    const txMock = {
      bulkImportJob: { create: jobCreateMock },
      bulkImportRow: { createMany: rowCreateManyMock },
    };
    const prisma = {
      tenant: jest.fn().mockReturnValue({
        category: { findUnique: jest.fn().mockResolvedValue({ id: "cat1", name: "Test", path: "/test" }) },
        bulkImportRun: {
          findUnique: jest.fn().mockResolvedValue({
            id: "run-1", categoryId: "cat1", status: "preflight_ready", effectiveMode: "standard",
          }),
          findUniqueOrThrow: runFindUnique,
        },
        bulkImportJob: {
          findUnique: jest.fn().mockResolvedValue({
            id: "job-1", categoryId: "cat1", status: "queued", totalRows: 2,
            category: { id: "cat1", path: "/test" }, rows: [],
          }),
        },
        bulkImportRow: {
          groupBy: jest.fn().mockResolvedValue([]),
          findMany: jest.fn().mockResolvedValue([]),
        },
        $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txMock)),
      }),
    };
    const accessPolicy = {
      assertCategoryAccess: jest.fn().mockResolvedValue(undefined),
      assertBulkImportAccess: jest.fn().mockResolvedValue(undefined),
      assertBulkImportAllowed: jest.fn().mockResolvedValue(undefined),
      assertRequestedProductScopeAllowed: jest.fn().mockResolvedValue(undefined),
      applyBulkImportRowVisibility: jest.fn().mockImplementation((_a: unknown, j: unknown) => j),
    };
    const storageService = {
      readStagedSourceStream: jest.fn().mockReturnValue(
        Readable.from(options.sourceContent ?? CSV_CONTENT),
      ),
    };
    const svc = new BulkImportService(
      prisma as never,
      {} as never,
      {} as never,
      accessPolicy as never,
      { getImportRowLimit: jest.fn().mockResolvedValue(30_000) } as never,
      { emit: jest.fn() } as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      storageService as never,
    );
    return { svc, storageService, runFindUnique, jobCreateMock, rowCreateManyMock };
  }

  it("reads rows from staged CSV when runId is provided and no inline data", async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    const { svc, storageService, rowCreateManyMock } = makeCreateJobService({
      runRecord: { sourceFileKey: "staged/run-1.csv", sourceExpiresAt: futureDate },
    });
    await svc.createJob(
      { categoryId: "cat1", runId: "run-1", sourceFormat: "csv", mapping: {} } as never,
      { actorId: "u1", actorRole: "admin" as never },
    );
    expect(storageService.readStagedSourceStream).toHaveBeenCalledWith("staged/run-1.csv");
    expect(rowCreateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ rowNumber: 1 }),
          expect.objectContaining({ rowNumber: 2 }),
        ]),
      }),
    );
  });

  it("reads rows from staged JSON when the validated run was uploaded as JSON", async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    const { svc, storageService, rowCreateManyMock } = makeCreateJobService({
      runRecord: { sourceFileKey: "staged/run-1.json", sourceExpiresAt: futureDate, sourceFormat: "json" },
      sourceContent: JSON.stringify([
        { title: "Widget A", skuCode: "SKU-A", description: "A desc", brand: "Vexa" },
        { title: "Widget B", skuCode: "SKU-B", description: "B desc", brand: "Vexa" },
      ]),
    });
    await svc.createJob(
      { categoryId: "cat1", runId: "run-1", sourceFormat: "json", mapping: {} } as never,
      { actorId: "u1", actorRole: "admin" as never },
    );
    expect(storageService.readStagedSourceStream).toHaveBeenCalledWith("staged/run-1.json");
    expect(rowCreateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ rowNumber: 1, payload: expect.objectContaining({ title: "Widget A", skuCode: "SKU-A" }) }),
          expect.objectContaining({ rowNumber: 2, payload: expect.objectContaining({ title: "Widget B", skuCode: "SKU-B" }) }),
        ]),
      }),
    );
  });

  it("does not require csvContent or fileContentBase64 when runId is provided", async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    const { svc } = makeCreateJobService({
      runRecord: { sourceFileKey: "staged/run-1.csv", sourceExpiresAt: futureDate },
    });
    await expect(
      svc.createJob(
        { categoryId: "cat1", runId: "run-1", sourceFormat: "csv", mapping: {} } as never,
        { actorId: "u1", actorRole: "admin" as never },
      ),
    ).resolves.toBeDefined();
  });

  it("rejects expired staged source", async () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);
    const { svc } = makeCreateJobService({
      runRecord: { sourceFileKey: "staged/run-1.csv", sourceExpiresAt: pastDate },
    });
    await expect(
      svc.createJob(
        { categoryId: "cat1", runId: "run-1", sourceFormat: "csv", mapping: {} } as never,
        { actorId: "u1", actorRole: "admin" as never },
      ),
    ).rejects.toThrow("expired");
  });

  it("rejects when staged run has no stored file", async () => {
    const { svc } = makeCreateJobService({
      runRecord: { sourceFileKey: null, sourceExpiresAt: null },
    });
    await expect(
      svc.createJob(
        { categoryId: "cat1", runId: "run-1", sourceFormat: "csv", mapping: {} } as never,
        { actorId: "u1", actorRole: "admin" as never },
      ),
    ).rejects.toThrow("no stored file");
  });

  it("rejects when run record does not exist (foreign tenant)", async () => {
    const { svc, runFindUnique } = makeCreateJobService({});
    runFindUnique.mockRejectedValue(new Error("No BulkImportRun found"));
    await expect(
      svc.createJob(
        { categoryId: "cat1", runId: "run-foreign", sourceFormat: "csv", mapping: {} } as never,
        { actorId: "u1", actorRole: "admin" as never },
      ),
    ).rejects.toThrow();
  });
});

describe("BulkImportService.createJob — duplicate prevention (idempotent)", () => {
  const CSV_CONTENT = "title,description,brand\nWidget A,A desc,Vexa\nWidget B,B desc,Vexa\n";
  const { PrismaClientKnownRequestError } = jest.requireActual("@prisma/client").Prisma;

  function makeDuplicateTestService(options?: { existingJobId?: string }) {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    const makeJobRecord = (id: string) => ({
      id, categoryId: "cat1", status: "queued", totalRows: 2,
      category: { id: "cat1", path: "/test" }, rows: [],
      runId: "run-1", jobRole: "standard", sourceFormat: "csv",
      sourceName: null, mapping: {}, chunkSize: 100, maxRetries: 3,
      processedRows: 0, successRows: 0, failedRows: 0, deadLetterRows: 0,
      batchIndex: null, rowStart: null, rowEnd: null,
      createdAt: new Date(), updatedAt: new Date(), tenantKey: "default",
    });
    const jobCreateMock = jest.fn();
    const rowCreateManyMock = jest.fn().mockResolvedValue({ count: 2 });
    const findFirstMock = jest.fn().mockImplementation(() =>
      Promise.resolve(options?.existingJobId ? makeJobRecord(options.existingJobId) : null),
    );
    const findUniqueMock = jest.fn().mockImplementation((args: { where: { id: string } }) =>
      Promise.resolve(makeJobRecord(args?.where?.id ?? options?.existingJobId ?? "job-new")),
    );
    const txMock = {
      bulkImportJob: { create: jobCreateMock },
      bulkImportRow: { createMany: rowCreateManyMock },
    };
    const prisma = {
      tenant: jest.fn().mockReturnValue({
        category: { findUnique: jest.fn().mockResolvedValue({ id: "cat1", name: "Test", path: "/test" }) },
        bulkImportRun: {
          findUnique: jest.fn().mockResolvedValue({
            id: "run-1", categoryId: "cat1", status: "preflight_ready", effectiveMode: "standard",
          }),
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            sourceFileKey: "staged/run-1.csv", sourceExpiresAt: futureDate,
          }),
        },
        bulkImportJob: {
          findFirst: findFirstMock,
          findUnique: findUniqueMock,
        },
        bulkImportRow: {
          groupBy: jest.fn().mockResolvedValue([]),
          findMany: jest.fn().mockResolvedValue([]),
        },
        $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txMock)),
      }),
    };
    const accessPolicy = {
      assertCategoryAccess: jest.fn().mockResolvedValue(undefined),
      assertBulkImportAccess: jest.fn().mockResolvedValue(undefined),
      assertBulkImportAllowed: jest.fn().mockResolvedValue(undefined),
      assertRequestedProductScopeAllowed: jest.fn().mockResolvedValue(undefined),
      applyBulkImportRowVisibility: jest.fn().mockImplementation((_a: unknown, j: unknown) => j),
    };
    const storageService = {
      readStagedSourceStream: jest.fn().mockReturnValue(Readable.from(CSV_CONTENT)),
    };
    const svc = new BulkImportService(
      prisma as never,
      {} as never,
      {} as never,
      accessPolicy as never,
      { getImportRowLimit: jest.fn().mockResolvedValue(30_000) } as never,
      { emit: jest.fn() } as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      storageService as never,
    );
    return { svc, jobCreateMock, rowCreateManyMock, findFirstMock, prisma };
  }

  it("first request creates the job normally", async () => {
    const { svc, jobCreateMock, rowCreateManyMock } = makeDuplicateTestService();
    jobCreateMock.mockResolvedValue({ id: "job-new", categoryId: "cat1" });
    await svc.createJob(
      { categoryId: "cat1", runId: "run-1", sourceFormat: "csv", mapping: {} } as never,
      { actorId: "u1", actorRole: "admin" as never },
    );
    expect(jobCreateMock).toHaveBeenCalledTimes(1);
    expect(rowCreateManyMock).toHaveBeenCalledTimes(1);
  });

  it("returns existing job on P2002 unique constraint violation", async () => {
    const { svc, jobCreateMock, findFirstMock } = makeDuplicateTestService({ existingJobId: "job-existing" });
    const p2002 = new PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "6.0.0",
      meta: { target: ["tenantKey", "runId"] },
    });
    jobCreateMock.mockRejectedValue(p2002);
    const result = await svc.createJob(
      { categoryId: "cat1", runId: "run-1", sourceFormat: "csv", mapping: {} } as never,
      { actorId: "u1", actorRole: "admin" as never },
    );
    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ runId: "run-1", jobRole: "standard" }) }),
    );
    expect(result).toBeDefined();
  });

  it("does not create rows when returning existing job", async () => {
    const { svc, jobCreateMock, rowCreateManyMock } = makeDuplicateTestService({ existingJobId: "job-existing" });
    const p2002 = new PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "6.0.0",
      meta: { target: ["tenantKey", "runId"] },
    });
    jobCreateMock.mockRejectedValue(p2002);
    await svc.createJob(
      { categoryId: "cat1", runId: "run-1", sourceFormat: "csv", mapping: {} } as never,
      { actorId: "u1", actorRole: "admin" as never },
    );
    expect(rowCreateManyMock).not.toHaveBeenCalled();
  });

  it("rethrows non-P2002 errors", async () => {
    const { svc, jobCreateMock } = makeDuplicateTestService();
    jobCreateMock.mockRejectedValue(new Error("Connection timeout"));
    await expect(
      svc.createJob(
        { categoryId: "cat1", runId: "run-1", sourceFormat: "csv", mapping: {} } as never,
        { actorId: "u1", actorRole: "admin" as never },
      ),
    ).rejects.toThrow("Connection timeout");
  });

  it("rethrows P2002 when runId is null (inline import)", async () => {
    const { svc, jobCreateMock } = makeDuplicateTestService();
    const p2002 = new PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "6.0.0",
      meta: { target: ["tenantKey", "runId"] },
    });
    jobCreateMock.mockRejectedValue(p2002);
    await expect(
      svc.createJob(
        { categoryId: "cat1", sourceFormat: "csv", mapping: {}, csvContent: "title\nTest" } as never,
        { actorId: "u1", actorRole: "admin" as never },
      ),
    ).rejects.toThrow();
  });

  it("rethrows P2002 from an unrelated constraint (different target fields)", async () => {
    const { svc, jobCreateMock } = makeDuplicateTestService();
    const p2002 = new PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "6.0.0",
      meta: { target: ["categoryId", "sourceName"] },
    });
    jobCreateMock.mockRejectedValue(p2002);
    await expect(
      svc.createJob(
        { categoryId: "cat1", runId: "run-1", sourceFormat: "csv", mapping: {} } as never,
        { actorId: "u1", actorRole: "admin" as never },
      ),
    ).rejects.toThrow("Unique constraint failed");
  });

  it("rethrows P2002 when error.meta is missing", async () => {
    const { svc, jobCreateMock } = makeDuplicateTestService();
    const p2002 = new PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "6.0.0",
    });
    jobCreateMock.mockRejectedValue(p2002);
    await expect(
      svc.createJob(
        { categoryId: "cat1", runId: "run-1", sourceFormat: "csv", mapping: {} } as never,
        { actorId: "u1", actorRole: "admin" as never },
      ),
    ).rejects.toThrow();
  });

  it("rethrows P2002 when existing job not found (tenant isolation)", async () => {
    const { svc, jobCreateMock, findFirstMock } = makeDuplicateTestService();
    const p2002 = new PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "6.0.0",
      meta: { target: ["tenantKey", "runId"] },
    });
    jobCreateMock.mockRejectedValue(p2002);
    findFirstMock.mockResolvedValue(null);
    await expect(
      svc.createJob(
        { categoryId: "cat1", runId: "run-1", sourceFormat: "csv", mapping: {} } as never,
        { actorId: "u1", actorRole: "admin" as never },
      ),
    ).rejects.toThrow();
  });

  it("returns created: true for new jobs", async () => {
    const { svc, jobCreateMock, rowCreateManyMock } = makeDuplicateTestService();
    jobCreateMock.mockResolvedValue({ id: "job-new", categoryId: "cat1" });
    const result = await svc.createJob(
      { categoryId: "cat1", runId: "run-1", sourceFormat: "csv", mapping: {} } as never,
      { actorId: "u1", actorRole: "admin" as never },
    );
    expect(result).toHaveProperty("created", true);
  });

  it("returns created: false for existing (duplicate) jobs", async () => {
    const { svc, jobCreateMock } = makeDuplicateTestService({ existingJobId: "job-existing" });
    const p2002 = new PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "6.0.0",
      meta: { target: ["tenantKey", "runId"] },
    });
    jobCreateMock.mockRejectedValue(p2002);
    const result = await svc.createJob(
      { categoryId: "cat1", runId: "run-1", sourceFormat: "csv", mapping: {} } as never,
      { actorId: "u1", actorRole: "admin" as never },
    );
    expect(result).toHaveProperty("created", false);
  });

  it("accepts P2002 with string target matching the index name", async () => {
    const { svc, jobCreateMock } = makeDuplicateTestService({ existingJobId: "job-existing" });
    const p2002 = new PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "6.0.0",
      meta: { target: "BulkImportJob_unique_standard_run" },
    });
    jobCreateMock.mockRejectedValue(p2002);
    const result = await svc.createJob(
      { categoryId: "cat1", runId: "run-1", sourceFormat: "csv", mapping: {} } as never,
      { actorId: "u1", actorRole: "admin" as never },
    );
    expect(result).toHaveProperty("created", false);
  });
});

describe("BulkImportService.processJob — atomic claim", () => {
  function makeProcessJobService(options?: { claimCount?: number }) {
    const makeJobRecord = (id: string, status = "queued") => ({
      id, categoryId: "cat1", status, totalRows: 2,
      category: { id: "cat1", path: "/test" }, rows: [],
      runId: "run-1", jobRole: "standard", sourceFormat: "csv",
      sourceName: null, mapping: {}, chunkSize: 100, maxRetries: 3,
      processedRows: 0, successRows: 0, failedRows: 0, deadLetterRows: 0,
      batchIndex: null, rowStart: null, rowEnd: null,
      createdAt: new Date(), updatedAt: new Date(), tenantKey: "default",
    });
    const updateManyMock = jest.fn().mockResolvedValue({ count: options?.claimCount ?? 1 });
    const findUniqueMock = jest.fn().mockImplementation((args: { where: { id: string } }) =>
      Promise.resolve(makeJobRecord(args?.where?.id ?? "job-1")),
    );
    const findManyMock = jest.fn().mockResolvedValue([]);
    const groupByMock = jest.fn().mockResolvedValue([]);
    const prisma = {
      tenant: jest.fn().mockReturnValue({
        category: { findUnique: jest.fn().mockResolvedValue({ id: "cat1", name: "Test", path: "/test" }) },
        bulkImportJob: {
          findUnique: findUniqueMock,
          updateMany: updateManyMock,
          update: jest.fn().mockImplementation((args: { where: { id: string } }) =>
            Promise.resolve({ ...makeJobRecord(args?.where?.id ?? "job-1", "completed"), runId: null }),
          ),
        },
        bulkImportRow: {
          findMany: findManyMock,
          groupBy: groupByMock,
        },
      }),
    };
    const accessPolicy = {
      assertCategoryAccess: jest.fn().mockResolvedValue(undefined),
      applyBulkImportRowVisibility: jest.fn().mockImplementation((_a: unknown, j: unknown) => j),
    };
    const svc = new BulkImportService(
      prisma as never,
      {} as never,
      { emitImportStatus: jest.fn().mockResolvedValue(undefined) } as never,
      accessPolicy as never,
      { getImportRowLimit: jest.fn().mockResolvedValue(30_000) } as never,
      { emit: jest.fn() } as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      {} as never,
    );
    return { svc, updateManyMock, findManyMock };
  }

  it("claims the job atomically via updateMany with status condition", async () => {
    const { svc, updateManyMock } = makeProcessJobService({ claimCount: 1 });
    await svc.processJob("job-1", undefined, { actorId: "u1", actorRole: "admin" as never });
    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "job-1",
          status: expect.objectContaining({ in: expect.arrayContaining(["queued"]) }),
        }),
        data: expect.objectContaining({ status: "processing" }),
      }),
    );
  });

  it("returns current job state without processing when claim fails (concurrent worker)", async () => {
    const { svc, updateManyMock, findManyMock } = makeProcessJobService({ claimCount: 0 });
    await svc.processJob("job-1", undefined, { actorId: "u1", actorRole: "admin" as never });
    expect(updateManyMock).toHaveBeenCalled();
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("skips processing for terminal statuses", async () => {
    const { svc, updateManyMock } = makeProcessJobService();
    const findUniqueMock = (svc as unknown as { prisma: { tenant: () => { bulkImportJob: { findUnique: jest.Mock } } } }).prisma.tenant().bulkImportJob.findUnique;
    findUniqueMock.mockResolvedValue({
      id: "job-1", categoryId: "cat1", status: "completed", totalRows: 2,
      category: { id: "cat1", path: "/test" }, rows: [],
      runId: "run-1", jobRole: "standard", sourceFormat: "csv",
      sourceName: null, mapping: {}, chunkSize: 100, maxRetries: 3,
      processedRows: 2, successRows: 2, failedRows: 0, deadLetterRows: 0,
      batchIndex: null, rowStart: null, rowEnd: null,
      createdAt: new Date(), updatedAt: new Date(), tenantKey: "default",
    });
    await svc.processJob("job-1", undefined, { actorId: "u1", actorRole: "admin" as never });
    expect(updateManyMock).not.toHaveBeenCalled();
  });
});
describe("BulkImportService.requeueDlq — reprocessing after reset", () => {
  function makeRequeueService(options?: { deadLetterRowIds?: string[] }) {
    const deadLetterRowIds = options?.deadLetterRowIds ?? ["row-1", "row-2"];
    const findManyMock = jest.fn().mockResolvedValue(deadLetterRowIds.map((id) => ({ id })));
    const updateManyMock = jest.fn().mockResolvedValue({ count: deadLetterRowIds.length });
    const groupByMock = jest.fn().mockResolvedValue([]);
    const jobFindUniqueMock = jest.fn().mockResolvedValue({ id: "job-1", status: "dead_letter", categoryId: "cat1" });
    const jobUpdateMock = jest.fn().mockResolvedValue({ id: "job-1", status: "retrying" });
    const prisma = {
      tenant: jest.fn().mockReturnValue({
        bulkImportRow: {
          findMany: findManyMock,
          updateMany: updateManyMock,
          groupBy: groupByMock,
        },
        bulkImportJob: {
          findUnique: jobFindUniqueMock,
          update: jobUpdateMock,
        },
      }),
    };
    const accessPolicy = {
      assertCategoryAccess: jest.fn().mockResolvedValue(undefined),
    };
    const svc = new BulkImportService(
      prisma as never,
      {} as never,
      { emitImportStatus: jest.fn().mockResolvedValue(undefined) } as never,
      accessPolicy as never,
      {} as never,
      {} as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      {} as never,
    );
    return { svc, findManyMock, updateManyMock };
  }

  it("resets dead-letter rows to queued and immediately re-drives processing instead of leaving them stuck", async () => {
    const { svc, findManyMock, updateManyMock } = makeRequeueService();
    const processJobSpy = jest.spyOn(svc, "processJob").mockResolvedValue({ id: "job-1", status: "processing" } as never);

    const actor = { actorId: "u1", actorRole: "admin" as never };
    const result = await svc.requeueDlq("job-1", 100, actor);

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ jobId: "job-1", status: BulkImportRowStatus.dead_letter }) }),
    );
    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: BulkImportRowStatus.queued, retryCount: 0, errorMessage: null }),
      }),
    );
    expect(processJobSpy).toHaveBeenCalledWith("job-1", undefined, actor);
    expect(result).toEqual({ id: "job-1", status: "processing" });
  });

  it("does not call processJob when there are no dead-letter rows to requeue", async () => {
    const { svc } = makeRequeueService({ deadLetterRowIds: [] });
    const processJobSpy = jest.spyOn(svc, "processJob").mockResolvedValue({ id: "job-1" } as never);
    const getJobSpy = jest.spyOn(svc, "getJob").mockResolvedValue({ id: "job-1", status: "completed" } as never);

    await svc.requeueDlq("job-1", 100, { actorId: "u1", actorRole: "admin" as never });

    expect(processJobSpy).not.toHaveBeenCalled();
    expect(getJobSpy).toHaveBeenCalledWith("job-1", expect.objectContaining({ actorId: "u1" }));
  });
});
// Regression tests for the preflight-vs-processing validation gap found in
// production QA: a GST rate outside the standard slabs, and malformed JSON in
// `attributes`, both used to pass preflight with zero warnings and only
// surface downstream (a post-creation compliance warning for GST; silent data
// loss for attributes). See compliance.service.ts's GST_RATE_UNCOMMON check
// for the allowed-rate list this preflight check mirrors.
describe("BulkImportService.validateCanonicalRowForImport — GST rate and attributes JSON", () => {
  it("flags a GST rate outside the standard slabs as a non-blocking warning", () => {
    const svc = makeService();
    const issues = svc.validateCanonicalRowForImport({
      title: "T-Shirt",
      skuCode: "SKU-1",
      gstRate: 40,
      attributes: {},
    });
    const gstIssue = issues.find((issue) => issue.code === "GST_RATE_UNCOMMON");
    expect(gstIssue).toBeDefined();
    expect(gstIssue?.severity).toBe("warning");
    // A warning must not block preflight — only "blocking"-severity issues do.
    expect(issues.some((issue) => issue.severity === "blocking")).toBe(false);
  });

  it("does not flag a GST rate that is on the standard slab list", () => {
    const svc = makeService();
    for (const rate of [0, 3, 5, 12, 18, 28]) {
      const issues = svc.validateCanonicalRowForImport({
        title: "T-Shirt",
        skuCode: "SKU-1",
        gstRate: rate,
        attributes: {},
      });
      expect(issues.some((issue) => issue.code === "GST_RATE_UNCOMMON")).toBe(false);
    }
  });

  it("still blocks a genuinely invalid (negative/non-finite) GST rate, and does not also raise GST_RATE_UNCOMMON for it", () => {
    const svc = makeService();
    const issues = svc.validateCanonicalRowForImport({
      title: "T-Shirt",
      skuCode: "SKU-1",
      gstRate: -5,
      attributes: {},
    });
    expect(issues.some((issue) => issue.code === "GST_RATE_INVALID" && issue.severity === "blocking")).toBe(true);
    expect(issues.some((issue) => issue.code === "GST_RATE_UNCOMMON")).toBe(false);
  });

  it("blocks a row whose attributes cell failed to parse as JSON, via normalizeCanonicalPayloadForImport's attributesParseError flag", () => {
    const svc = makeService();
    const row = svc.normalizeCanonicalPayloadForImport(
      { title: "T-Shirt", skuCode: "SKU-1", attributes: "{not valid json here}" },
      { title: "title", skuCode: "skuCode", attributes: "attributes" },
    );
    // Previously this silently became {} with no trace it had ever been invalid.
    expect(row.attributes).toEqual({});
    expect(row.attributesParseError).toBe(true);

    const issues = svc.validateCanonicalRowForImport(row);
    const attrIssue = issues.find((issue) => issue.code === "ATTRIBUTES_INVALID_JSON");
    expect(attrIssue).toBeDefined();
    expect(attrIssue?.severity).toBe("blocking");
  });

  it("does not flag valid JSON attributes", () => {
    const svc = makeService();
    const row = svc.normalizeCanonicalPayloadForImport(
      { title: "T-Shirt", skuCode: "SKU-1", attributes: '{"material":"cotton"}' },
      { title: "title", skuCode: "skuCode", attributes: "attributes" },
    );
    expect(row.attributes).toEqual({ material: "cotton" });
    expect(row.attributesParseError).toBe(false);
    const issues = svc.validateCanonicalRowForImport(row);
    expect(issues.some((issue) => issue.code === "ATTRIBUTES_INVALID_JSON")).toBe(false);
  });
});

// Regression test for the CSV embedded-newline parsing bug found in production
// QA: a single row with a quoted, multi-line description (a very common export
// pattern from Excel/Sheets/Shopify) was previously split into two malformed
// rows because parsing split on raw `\n` before honoring CSV quoting.
describe("BulkImportService.parseCsvForImport — embedded newline inside a quoted field", () => {
  it("keeps a quoted multi-line field as a single row, not two", () => {
    const svc = makeService();
    const csv = [
      "title,description,skuCode",
      '"Classic Tee","Line one\nLine two, with a comma",SKU-1',
    ].join("\n");

    const { headers, rows } = svc.parseCsvForImport(csv);

    expect(headers).toEqual(["title", "description", "skuCode"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      title: "Classic Tee",
      description: "Line one\nLine two, with a comma",
      skuCode: "SKU-1",
    });
  });

  it("still parses multiple ordinary (non-quoted-newline) rows correctly", () => {
    const svc = makeService();
    const csv = ["title,skuCode", "Tee A,SKU-1", "Tee B,SKU-2"].join("\n");
    const { rows } = svc.parseCsvForImport(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].skuCode).toBe("SKU-1");
    expect(rows[1].skuCode).toBe("SKU-2");
  });

  it("handles CRLF line endings without introducing blank rows", () => {
    const svc = makeService();
    const csv = ["title,skuCode", "Tee A,SKU-1", "Tee B,SKU-2"].join("\r\n");
    const { rows } = svc.parseCsvForImport(csv);
    expect(rows).toHaveLength(2);
  });
});

// Regression tests for QA-10 (github.com/VBPIM/PIM#875): refreshJobCounters bucketed
// queued/processing rows together with genuinely-retrying ones under a single "pending"
// count, so any job with even one untouched row (e.g. after an operator manually retries
// a single row via processRowById while hundreds of others are still queued) was labeled
// "Retrying failed rows" -- indistinguishable from a job where something had actually
// failed. This asserts the fixed derivation keeps "retrying" reserved for rows that have
// actually failed at least once.
describe("BulkImportService.processRowById -- job status must reflect reality, not merely 'not finished'", () => {
  function makeService(rowStatusGroups: Array<{ status: string; count: number }>) {
    const jobRecord = { id: "job-1", categoryId: "cat1", status: "processing", totalRows: 500, maxRetries: 3, runId: null };
    const rowRecord = { id: "row-1", jobId: "job-1", status: "retrying", retryCount: 1, productId: null, payload: {} };
    const groupByMock = jest.fn().mockResolvedValue(
      rowStatusGroups.map((g) => ({ status: g.status, _count: { status: g.count } })),
    );
    const jobUpdateMock = jest.fn().mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "job-1", runId: null, ...args.data }),
    );
    const prisma = {
      tenant: jest.fn().mockReturnValue({
        bulkImportJob: {
          findUnique: jest.fn().mockResolvedValue(jobRecord),
          update: jobUpdateMock,
        },
        bulkImportRow: {
          findFirst: jest.fn().mockResolvedValue(rowRecord),
          groupBy: groupByMock,
        },
      }),
    };
    const accessPolicy = {
      assertCategoryAccess: jest.fn().mockResolvedValue(undefined),
      applyBulkImportRowVisibility: jest.fn().mockImplementation((_a: unknown, r: unknown) => r),
    };
    const svc = new BulkImportService(
      prisma as never,
      {} as never,
      { emitImportStatus: jest.fn().mockResolvedValue(undefined) } as never,
      accessPolicy as never,
      {} as never,
      {} as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      {} as never,
    );
    // processRow itself is exercised by other describe blocks above; stub it here so
    // this test is purely about refreshJobCounters' status derivation from row counts.
    jest
      .spyOn(svc as unknown as { processRow: (...args: unknown[]) => Promise<void> }, "processRow")
      .mockResolvedValue(undefined);
    return { svc, jobUpdateMock };
  }

  it("does NOT label the job 'retrying' when the only non-terminal rows are still queued/processing", async () => {
    const { svc, jobUpdateMock } = makeService([
      { status: "success", count: 1 },
      { status: "queued", count: 498 }, // untouched, never attempted -- not a retry
    ]);

    await svc.processRowById("job-1", "row-1", { actorId: "u1", actorRole: "admin" as never });

    expect(jobUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "processing" }) }),
    );
  });

  it("DOES label the job 'retrying' when at least one row has actually failed and is queued for retry", async () => {
    const { svc, jobUpdateMock } = makeService([
      { status: "success", count: 1 },
      { status: "retrying", count: 2 },
      { status: "queued", count: 100 },
    ]);

    await svc.processRowById("job-1", "row-1", { actorId: "u1", actorRole: "admin" as never });

    expect(jobUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "retrying" }) }),
    );
  });

  it("still labels the job 'dead_letter' once nothing is left in progress and something failed permanently", async () => {
    const { svc, jobUpdateMock } = makeService([
      { status: "success", count: 498 },
      { status: "dead_letter", count: 2 },
    ]);

    await svc.processRowById("job-1", "row-1", { actorId: "u1", actorRole: "admin" as never });

    expect(jobUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "dead_letter" }) }),
    );
  });
});
