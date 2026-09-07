// Unit tests for BulkImportRunService.validateRun — row-ceiling plan enforcement.
// Verifies that uploading more rows than the plan limit produces status=preflight_blocked
// and preflightSummary.mvpCeilingExceeded=true.

import { Readable } from "stream";
import { BulkImportRunStatus } from "@prisma/client";
import { BulkImportRunService } from "./bulk-import-run.service";

function buildCsvStream(dataRowCount: number): Readable {
  const lines = ["title,skuCode"];
  for (let i = 1; i <= dataRowCount; i++) {
    lines.push(`Product ${i},SKU${i}`);
  }
  return Readable.from(lines.join("\n"));
}

function makeService(options: {
  planRowLimit: number;
  csvRowCount: number;
  sourceFormat?: "csv" | "json";
  sourceContent?: string;
  skuCount?: number;
  maxSkus?: number;
}) {
  const sourceFormat = options.sourceFormat ?? "csv";
  const updateMock = jest.fn().mockResolvedValue({});
  const variantFindMany = jest.fn().mockResolvedValue([]);
  const tenantClient = {
    bulkImportRun: {
      findUnique: jest.fn().mockResolvedValue({
        id: "run_1",
        sourceFileKey: sourceFormat === "json" ? "staged/test.json" : "staged/test.csv",
        status: "uploaded",
        category: null,
        sourceFormat,
        sourceName: sourceFormat === "json" ? "test.json" : "test.csv",
        maxRetries: 3,
        totalRows: null,
        preflightSummary: null,
      }),
      update: updateMock,
    },
    variant: { findMany: variantFindMany },
  };
  const prisma = { tenant: jest.fn().mockReturnValue(tenantClient) };

  const storageService = {
    readStagedSourceStream: jest.fn().mockResolvedValue(
      Readable.from(options.sourceContent ?? buildCsvStream(options.csvRowCount)),
    ),
  };

  const bulkImportService = {
    parseCsvLineForImport: jest.fn().mockImplementation((line: string) => line.split(",")),
    inferHeadersForImportRows: jest.fn().mockImplementation((rows: Record<string, unknown>[]) =>
      Array.from(new Set(rows.flatMap((row) => Object.keys(row)))),
    ),
    suggestMapping: jest.fn().mockReturnValue({
      mapping: { title: "title", skuCode: "skuCode" },
      unmappedFields: [],
      unusedHeaders: [],
    }),
    normalizeCanonicalPayloadForImport: jest.fn().mockImplementation((row: Record<string, unknown>) => ({
      title: row.title,
      skuCode: row.skuCode,
    })),
    validateCanonicalRowForImport: jest.fn().mockImplementation((row: Record<string, unknown>) => {
      const issues: Array<{
        rowNumber: number;
        severity: "blocking";
        code: string;
        message: string;
        fieldPath: string;
      }> = [];
      if (typeof row.title !== "string" || !row.title.trim()) {
        issues.push({
          rowNumber: 0,
          severity: "blocking",
          code: "TITLE_REQUIRED",
          message: "Title is required.",
          fieldPath: "title",
        });
      }
      if (typeof row.skuCode !== "string" || !row.skuCode.trim()) {
        issues.push({
          rowNumber: 0,
          severity: "blocking",
          code: "SKU_REQUIRED",
          message: "SKU code is required.",
          fieldPath: "skuCode",
        });
      }
      return issues;
    }),
  };

  // Defaults keep existing row-ceiling-only tests unaffected: a huge maxSkus
  // ceiling that the small fixture CSVs will never come close to.
  const skuCount = options.skuCount ?? 0;
  const maxSkus = options.maxSkus ?? 1_000_000;
  const planUsageService = {
    getImportRowLimit: jest.fn().mockResolvedValue(options.planRowLimit),
    getOrCreate: jest.fn(),
    checkLimit: jest.fn().mockImplementation((_resource: string, delta: number) => {
      const current = skuCount + delta;
      return Promise.resolve({ allowed: current <= maxSkus, resource: "skus", limit: maxSkus, current });
    }),
  };

  const accessPolicy = {
    assertCategoryAccess: jest.fn().mockResolvedValue(undefined),
  };

  const service = new BulkImportRunService(
    prisma as never,
    accessPolicy as never,
    {} as never,     // queueService
    storageService as never,
    bulkImportService as never,
    planUsageService as never,
  );

  return { service, updateMock, storageService, planUsageService };
}

describe("BulkImportRunService.validateRun — plan row-ceiling enforcement", () => {
  it("STARTER limit=2000, CSV has 2001 rows: final update sets preflight_blocked with mvpCeilingExceeded", async () => {
    const { service, updateMock } = makeService({ planRowLimit: 2000, csvRowCount: 2001 });

    await service.validateRun("run_1");

    // The final update (last call) should record preflight_blocked
    const lastCall = updateMock.mock.calls[updateMock.mock.calls.length - 1][0];
    expect(lastCall.data.status).toBe(BulkImportRunStatus.preflight_blocked);

    const summary = lastCall.data.preflightSummary as Record<string, unknown>;
    expect(summary.mvpCeilingExceeded).toBe(true);
    expect(lastCall.data.totalRows).toBe(2001);
  });

  it("GROWTH limit=10000, CSV has 10001 rows: blocked with mvpCeilingExceeded", async () => {
    const { service, updateMock } = makeService({ planRowLimit: 10000, csvRowCount: 10001 });

    await service.validateRun("run_1");

    const lastCall = updateMock.mock.calls[updateMock.mock.calls.length - 1][0];
    expect(lastCall.data.status).toBe(BulkImportRunStatus.preflight_blocked);
    expect((lastCall.data.preflightSummary as Record<string, unknown>).mvpCeilingExceeded).toBe(true);
  });

  it("STARTER limit=2000, CSV has exactly 2000 rows: allowed (not blocked by ceiling)", async () => {
    const { service, updateMock } = makeService({ planRowLimit: 2000, csvRowCount: 2000 });

    await service.validateRun("run_1");

    const lastCall = updateMock.mock.calls[updateMock.mock.calls.length - 1][0];
    expect(lastCall.data.status).toBe(BulkImportRunStatus.preflight_ready);
    expect((lastCall.data.preflightSummary as Record<string, unknown>).mvpCeilingExceeded).toBe(false);
  });

  it("row limit is read from planUsageService — not hardcoded", async () => {
    const { service, planUsageService } = makeService({ planRowLimit: 5000, csvRowCount: 5001 });

    await service.validateRun("run_1");

    expect(planUsageService.getImportRowLimit).toHaveBeenCalledTimes(1);
  });

  it("validates JSON staged uploads and stores user-readable issue messages", async () => {
    const { service, updateMock, storageService } = makeService({
      planRowLimit: 2000,
      csvRowCount: 0,
      sourceFormat: "json",
      sourceContent: JSON.stringify([{ skuCode: "SKU-1" }]),
    });

    await service.validateRun("run_1");

    expect(storageService.readStagedSourceStream).toHaveBeenCalledWith("staged/test.json");
    const lastCall = updateMock.mock.calls[updateMock.mock.calls.length - 1][0];
    expect(lastCall.data.status).toBe(BulkImportRunStatus.preflight_blocked);
    const summary = lastCall.data.preflightSummary as Record<string, unknown>;
    const sampleIssues = summary.sampleIssues as Array<Record<string, unknown>>;
    expect(sampleIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowNumber: 1,
          code: "TITLE_REQUIRED",
          message: "Title is required.",
          fieldPath: "title",
        }),
      ]),
    );
    expect(sampleIssues[0]).not.toHaveProperty("issues");
  });

  it("system ceiling (30000) caps the effective limit even if planRowLimit is higher", async () => {
    // ENTERPRISE plan reports 30000 (same as system ceiling) — not above it.
    // This test verifies the min() is applied: 30001 rows against limit=30000 → blocked.
    const { service, updateMock } = makeService({ planRowLimit: 30000, csvRowCount: 30001 });

    await service.validateRun("run_1");

    const lastCall = updateMock.mock.calls[updateMock.mock.calls.length - 1][0];
    expect(lastCall.data.status).toBe(BulkImportRunStatus.preflight_blocked);
    expect((lastCall.data.preflightSummary as Record<string, unknown>).mvpCeilingExceeded).toBe(true);
  });
});

// A Rev. 7 revision of this file added a checkLimit("skus", ...) preflight here, on the
// theory that bulk import needed the same enforcement PlanGuard gives the single-product
// endpoint. That was itself wrong: every row bulk import creates lands as RecordStatus.draft,
// and draft/parent-only records never count toward SKU usage (Plan & Usage's own copy, and
// PlanUsageService's SELLABLE_VARIANT_WHERE, both say so). This regression-guards the
// correction — bulk import must never call checkLimit("skus", ...) or block on it, no
// matter how large the batch, because it never creates anything billable.
describe("BulkImportRunService.validateRun — does not enforce the SKU limit (drafts don't count)", () => {
  it("a large import that would vastly exceed a Trial tenant's maxSkus=500 is still preflight_ready — draft creation is never blocked by the SKU limit", async () => {
    const { service, updateMock, planUsageService } = makeService({
      planRowLimit: 2000,
      csvRowCount: 400, // well under Trial's maxImportRowsPerJob=2000, but 400 > 500-498=2 headroom
      skuCount: 498,
      maxSkus: 500,
    });

    await service.validateRun("run_1");

    expect(planUsageService.checkLimit).not.toHaveBeenCalled();
    const lastCall = updateMock.mock.calls[updateMock.mock.calls.length - 1][0];
    expect(lastCall.data.status).toBe(BulkImportRunStatus.preflight_ready);
    expect(lastCall.data.totalRows).toBe(400);
  });

  it("importing when the tenant is already at its SKU limit is still allowed — the limit only applies at approval, not at draft creation", async () => {
    const { service, updateMock, planUsageService } = makeService({
      planRowLimit: 2000,
      csvRowCount: 50,
      skuCount: 500,
      maxSkus: 500, // already at 100% of plan
    });

    await service.validateRun("run_1");

    expect(planUsageService.checkLimit).not.toHaveBeenCalled();
    const lastCall = updateMock.mock.calls[updateMock.mock.calls.length - 1][0];
    expect(lastCall.data.status).toBe(BulkImportRunStatus.preflight_ready);
  });

  it("preflightSummary no longer carries a planSkuLimitExceeded field", async () => {
    const { service, updateMock } = makeService({ planRowLimit: 2000, csvRowCount: 10 });

    await service.validateRun("run_1");

    const lastCall = updateMock.mock.calls[updateMock.mock.calls.length - 1][0];
    const summary = lastCall.data.preflightSummary as Record<string, unknown>;
    expect(summary.planSkuLimitExceeded).toBeUndefined();
  });
});
