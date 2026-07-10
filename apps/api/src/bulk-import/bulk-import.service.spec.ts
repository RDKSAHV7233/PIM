import { BadRequestException } from "@nestjs/common";
import { BulkImportRowStatus } from "@prisma/client";
import { BulkImportRunService } from "./bulk-import-run.service";
import { BulkImportService } from "./bulk-import.service";

const MB = 1024 * 1024;

function buildCsv(rowCount: number) {
  const lines = ["title,description,brand,hsnCode,gstRate,attributes"];
  for (let index = 0; index < rowCount; index += 1) {
    lines.push(`Product ${index},Description ${index},Vexa PIM,62046200,18,{}`);
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
    const productFindUniqueMock = jest.fn().mockResolvedValue(options.productFindResult ?? null);
    const jobFindUniqueMock = jest.fn().mockResolvedValue({
      id: "job1", status: "queued", categoryId: "cat1", maxRetries: 3, chunkSize: 100,
      category: { id: "cat1", path: "/cat1" }, rows: [],
    });
    const rowUpdateMock = jest.fn().mockResolvedValue({});
    const rowUpdateManyMock = jest.fn().mockResolvedValue({ count: options.claimCount ?? 1 });
    const prisma = {
      tenant: jest.fn().mockReturnValue({
        bulkImportJob: { update: jest.fn().mockResolvedValue({}), findUnique: jobFindUniqueMock },
        // findMany must return the rows once then empty on subsequent calls so
        // processJob()'s while-loop terminates. Real Prisma behavior mirrors
        // this: after processRow() runs, rows leave "queued"/"retrying" and
        // stop matching the findMany filter. Without .mockResolvedValueOnce
        // the mock returns the same "queued" rows forever, spinning the loop
        // and leaking jest mock.calls until OOM.
        bulkImportRow: { findMany: jest.fn().mockResolvedValueOnce(options.rows).mockResolvedValue([]), update: rowUpdateMock, updateMany: rowUpdateManyMock, groupBy: jest.fn().mockResolvedValue([]) },
        product: { create: productCreateMock, findUnique: productFindUniqueMock },
        productTaxCode: { createMany: jest.fn() },
        taxRegime: { findMany: jest.fn().mockResolvedValue([]) },
        category: { findUnique: jest.fn().mockResolvedValue({ id: "cat1" }) },
      }),
    };
    const accessPolicy = {
      assertCategoryAccess: jest.fn().mockResolvedValue(undefined),
      applyBulkImportRowVisibility: jest.fn().mockImplementation((_a: unknown, j: unknown) => j),
    };
    const svc = new BulkImportService(
      prisma as never, { validateAndPersistProduct: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never, accessPolicy as never,
      { getImportRowLimit: jest.fn().mockResolvedValue(30_000) } as never,
      { emit: jest.fn() } as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      {} as never,
    );
    return { svc, productCreateMock, rowUpdateMock, rowUpdateManyMock, productFindUniqueMock };
  }

  it("reuses existing product when row already has a productId (idempotent retry)", async () => {
    const { svc, productCreateMock, rowUpdateMock } = makeRowProcessService({
      rows: [{ id: "row1", payload: { title: "Test" }, retryCount: 0, productId: "existing-product", rowNumber: 1, status: "retrying" }],
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
      rows: [{ id: "row2", payload: { title: "Test" }, retryCount: 0, productId: "deleted-product", rowNumber: 1, status: "retrying" }],
      productFindResult: null,
    });
    await svc.processJob("job1", 100, { actorId: "u1", actorRole: "admin" as never });
    expect(productCreateMock).toHaveBeenCalledTimes(1);
  });

  it("skips row when optimistic claim returns count=0 (concurrent worker already claimed)", async () => {
    const { svc, productCreateMock, rowUpdateMock } = makeRowProcessService({
      rows: [{ id: "row3", payload: { title: "Test" }, retryCount: 0, productId: null, rowNumber: 1, status: "queued" }],
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
      rows: [{ id: "row4", payload: { title: "Test" }, retryCount: 0, productId: "cross-tenant-product", rowNumber: 1, status: "retrying" }],
      productFindResult: null,
    });
    await svc.processJob("job1", 100, { actorId: "u1", actorRole: "admin" as never });
    expect(productFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "cross-tenant-product" } }),
    );
  });

  it("persists productId to row immediately after product creation (crash recovery)", async () => {
    const { svc, rowUpdateMock } = makeRowProcessService({
      rows: [{ id: "row5", payload: { title: "Test" }, retryCount: 0, productId: null, rowNumber: 1, status: "queued" }],
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
