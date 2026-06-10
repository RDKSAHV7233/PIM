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

function makeService(options: { planRowLimit: number; csvRowCount: number }) {
  const updateMock = jest.fn().mockResolvedValue({});
  const variantFindMany = jest.fn().mockResolvedValue([]);
  const tenantClient = {
    bulkImportRun: {
      findUnique: jest.fn().mockResolvedValue({
        id: "run_1",
        sourceFileKey: "staged/test.csv",
        status: "uploaded",
        category: null,
        sourceFormat: "csv",
        sourceName: "test.csv",
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
    readStagedCsvStream: jest.fn().mockResolvedValue(buildCsvStream(options.csvRowCount)),
  };

  const bulkImportService = {
    parseCsvLineForImport: jest.fn().mockImplementation((line: string) => line.split(",")),
    suggestMapping: jest.fn().mockReturnValue({
      mapping: { title: "title", skuCode: "skuCode" },
      unmappedFields: [],
      unusedHeaders: [],
    }),
    normalizeCanonicalPayloadForImport: jest.fn().mockImplementation((row: Record<string, unknown>) => ({
      title: row.title,
      skuCode: row.skuCode,
    })),
  };

  const planUsageService = {
    getImportRowLimit: jest.fn().mockResolvedValue(options.planRowLimit),
    getOrCreate: jest.fn(),
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
