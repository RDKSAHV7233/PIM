import { BadRequestException } from "@nestjs/common";
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
