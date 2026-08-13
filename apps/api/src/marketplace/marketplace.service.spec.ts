import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ExportJobStatus } from "@prisma/client";
import { UnrecoverableError } from "bullmq";
import { MarketplaceService } from "./marketplace.service";

function makeService(productOverride?: Record<string, unknown>) {
  const product = productOverride ?? {
    id: "prod1",
    status: "approved",
    categoryId: "cat1",
    brand: "TestBrand",
  };

  const prisma = {
    tenant: jest.fn().mockReturnValue({
      product: {
        findUnique: jest.fn().mockResolvedValue(product),
        update: jest.fn().mockResolvedValue(product),
      },
      marketplaceExportJob: {
        create: jest.fn().mockResolvedValue({ id: "job1" }),
      },
    }),
  };

  const connectorFramework = {
    getCurrentTenantKey: jest.fn().mockReturnValue("tenant1"),
    requireCurrentTenantKey: jest.fn().mockReturnValue("tenant1"),
    requireInstallation: jest.fn().mockResolvedValue({
      slug: "flipkart",
      capabilities: ["PUBLISH", "VALIDATE"],
    }),
  };

  const connectorRegistry = {
    get: jest.fn(),
    list: jest.fn().mockReturnValue([]),
  };

  const planUsageService = {
    assertExportJobQuota: jest.fn().mockResolvedValue(undefined),
    recordExportJobUsage: jest.fn().mockResolvedValue(undefined),
  };

  const queueService = {
    enqueueExportJob: jest.fn().mockResolvedValue(undefined),
  };

  const metricsService = {
    recordExportEvent: jest.fn(),
  };

  const connectorMappingService = {
    evaluateConnectorPublishReadiness: jest.fn().mockResolvedValue({ ok: true, blockers: [], warnings: [] }),
  };

  const notificationsService = {
    notifyExportJobCreated: jest.fn().mockResolvedValue(undefined),
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const accessPolicy = {
    assertSensitivePayloadAccessAllowed: jest.fn().mockResolvedValue(undefined),
    assertProductAccess: jest.fn().mockResolvedValue(undefined),
    assertChannelAccess: jest.fn().mockResolvedValue(undefined),
  };

  const mediaStorage = {
    isLocalMode: jest.fn().mockReturnValue(false),
  };

  return new MarketplaceService(
    prisma as never,
    connectorFramework as never,
    connectorRegistry as never,
    planUsageService as never,
    queueService as never,
    metricsService as never,
    connectorMappingService as never,
    notificationsService as never,
    logger as never,
    accessPolicy as never,
    { fromRows: jest.fn().mockReturnValue([]), findDefault: jest.fn().mockReturnValue(undefined) } as never,
    mediaStorage as never,
  );
}

describe("MarketplaceService.createExportJob — approval gate", () => {
  const dto = { channel: "flipkart", fallbackAcknowledged: false };

  it("does not throw approval gate error when product is approved", async () => {
    const svc = makeService({ id: "p1", status: "approved", categoryId: "cat1", brand: "B" });
    // Approved products pass the gate — any subsequent error is a deeper mock gap, not approval policy
    const error = await svc.createExportJob("p1", dto as never).catch((e: unknown) => e);
    if (error instanceof Error) {
      expect(error.message).not.toMatch(/must be approved/);
    }
  });

  it("does not throw approval gate error when product is active", async () => {
    const svc = makeService({ id: "p1", status: "active", categoryId: "cat1", brand: "B" });
    const error = await svc.createExportJob("p1", dto as never).catch((e: unknown) => e);
    if (error instanceof Error) {
      expect(error.message).not.toMatch(/must be approved/);
    }
  });

  it("blocks export when product is draft", async () => {
    const svc = makeService({ id: "p1", status: "draft", categoryId: "cat1", brand: "B" });
    await expect(svc.createExportJob("p1", dto as never)).rejects.toThrow(BadRequestException);
  });

  it("blocks export when product is in_review", async () => {
    const svc = makeService({ id: "p1", status: "in_review", categoryId: "cat1", brand: "B" });
    await expect(svc.createExportJob("p1", dto as never)).rejects.toThrow(BadRequestException);
  });

  it("blocks export when product is rejected", async () => {
    const svc = makeService({ id: "p1", status: "rejected", categoryId: "cat1", brand: "B" });
    await expect(svc.createExportJob("p1", dto as never)).rejects.toThrow(BadRequestException);
  });

  it("blocks export when product is archived", async () => {
    const svc = makeService({ id: "p1", status: "archived", categoryId: "cat1", brand: "B" });
    await expect(svc.createExportJob("p1", dto as never)).rejects.toThrow(BadRequestException);
  });

  it("error message includes current status", async () => {
    const svc = makeService({ id: "p1", status: "draft", categoryId: "cat1", brand: "B" });
    await expect(svc.createExportJob("p1", dto as never)).rejects.toThrow(
      /Current status: draft/,
    );
  });

  it("throws NotFoundException when product does not exist", async () => {
    const prisma = {
      tenant: jest.fn().mockReturnValue({
        product: { findUnique: jest.fn().mockResolvedValue(null) },
      }),
    };
    const svc = new MarketplaceService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      { assertSensitivePayloadAccessAllowed: jest.fn().mockResolvedValue(undefined) } as never,
      { fromRows: jest.fn().mockReturnValue([]), findDefault: jest.fn().mockReturnValue(undefined) } as never,
      { isLocalMode: jest.fn().mockReturnValue(false) } as never,
    );
    await expect(svc.createExportJob("missing-id", dto as never)).rejects.toThrow(NotFoundException);
  });
});

describe("MarketplaceService.listChannels", () => {
  it("returns an array of channel objects", () => {
    const svc = makeService();
    const channels = svc.listChannels();
    expect(Array.isArray(channels)).toBe(true);
    expect(channels.length).toBeGreaterThan(0);
  });

  it("each channel has a channel field", () => {
    const svc = makeService();
    const channels = svc.listChannels();
    for (const ch of channels) {
      expect(ch).toHaveProperty("channel");
    }
  });
});

// ─── MarketplaceService.triggerConnectorExport ────────────────────────────────

describe("MarketplaceService.triggerConnectorExport", () => {
  const MOCK_EXPORT_FILE = {
    buffer: Buffer.from("xlsx"),
    filename: "meesho_kurtis_20260528.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };

  const MOCK_INSTALLATION_ROW = { id: "inst_1", connectorId: "conn_1", tenantKey: "tenant1" };

  // Shape returned by resolveInstallationWithSlug ($queryRaw JOIN result)
  const MOCK_RESOLVED_ROW = {
    id: "inst_1",
    connectorId: "conn_1",
    tenantKey: "tenant1",
    connectorSlug: "meesho",
    capabilities: [],
  };

  function makeExportService(installationRow: unknown = MOCK_INSTALLATION_ROW) {
    // resolveInstallationWithSlug uses $queryRaw; return [] when installationRow is null
    // (simulates missing installation → NotFoundException path)
    const queryRawResult = installationRow ? [MOCK_RESOLVED_ROW] : [];

    const tenantDb = {
      // $queryRaw is called by resolveInstallationWithSlug
      $queryRaw: jest.fn().mockResolvedValue(queryRawResult),
      connectorInstallation: {
        findFirst: jest.fn().mockResolvedValue(installationRow),
      },
      connectorDefinition: {
        findUnique: jest.fn().mockResolvedValue({ slug: "meesho" }),
      },
      product: {
        // product.findUnique used by buildConnectorProductPayload — spied away in happy-path tests
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    const prisma = {
      tenant: jest.fn().mockReturnValue(tenantDb),
    };

    const connectorFramework = {
      getCurrentTenantKey: jest.fn().mockReturnValue("tenant1"),
      requireCurrentTenantKey: jest.fn().mockReturnValue("tenant1"),
      requireInstallation: jest.fn().mockResolvedValue({
        id: "inst_1",
        slug: "meesho",
        capabilities: ["VALIDATE", "EXCEL_EXPORT"],
      }),
      exportProducts: jest.fn().mockResolvedValue(MOCK_EXPORT_FILE),
    };

    const svc = new MarketplaceService(
      prisma as never,
      connectorFramework as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      { assertSensitivePayloadAccessAllowed: jest.fn().mockResolvedValue(undefined) } as never,
      { fromRows: jest.fn().mockReturnValue([]), findDefault: jest.fn().mockReturnValue(undefined) } as never,
      { isLocalMode: jest.fn().mockReturnValue(false) } as never,
    );

    return { svc, prisma, connectorFramework, tenantDb };
  }

  it("throws BadRequestException when productIds is empty", async () => {
    const { svc } = makeExportService();
    await expect(svc.triggerConnectorExport("inst_1", [])).rejects.toThrow(BadRequestException);
  });

  it("error message mentions productIds when empty", async () => {
    const { svc } = makeExportService();
    await expect(svc.triggerConnectorExport("inst_1", [])).rejects.toThrow(/productIds/);
  });

  it("throws NotFoundException when installation row is not found", async () => {
    const { svc } = makeExportService(null /* no installation row */);
    await expect(svc.triggerConnectorExport("missing_inst", ["p1"])).rejects.toThrow(NotFoundException);
  });

  it("returns buffer, filename, and mimeType from connectorFramework.exportProducts", async () => {
    const { svc, connectorFramework } = makeExportService();
    // Bypass the complex buildConnectorProductPayload internal DB chain
    jest.spyOn(svc as unknown as Record<string, jest.Mock>, "buildConnectorProductPayload")
      .mockResolvedValue({ sku: "SKU-001", title: "Test Kurti", mrp: 999, sellingPrice: 799, productType: "kurtis" });

    const result = await svc.triggerConnectorExport("inst_1", ["prod_1"]);
    expect(result.buffer).toEqual(MOCK_EXPORT_FILE.buffer);
    expect(result.filename).toBe(MOCK_EXPORT_FILE.filename);
    expect(result.mimeType).toBe(MOCK_EXPORT_FILE.mimeType);
    expect(connectorFramework.exportProducts).toHaveBeenCalledTimes(1);
  });

  it("passes resolved installation record and mapped products to exportProducts", async () => {
    const { svc, connectorFramework } = makeExportService();
    const fakePayload = { sku: "SKU-001", title: "Test Kurti", mrp: 999, sellingPrice: 799, productType: "kurtis" };
    jest.spyOn(svc as unknown as Record<string, jest.Mock>, "buildConnectorProductPayload")
      .mockResolvedValue(fakePayload);

    await svc.triggerConnectorExport("inst_1", ["p1", "p2"]);

    expect(connectorFramework.exportProducts).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "meesho", capabilities: expect.arrayContaining(["EXCEL_EXPORT"]) }),
      [fakePayload, fakePayload],
    );
  });
});

// ─── MarketplaceService.triggerBulkPublish — F-4 approval/readiness gate ──────

describe("MarketplaceService.triggerBulkPublish — approval/readiness gate", () => {
  const MOCK_RESOLVED_ROW = {
    id: "inst_1",
    connectorId: "conn_1",
    tenantKey: "tenant1",
    connectorSlug: "amazon",
    capabilities: [],
  };

  function makeBulkPublishService(
    productsById: Record<string, { status: string; categoryId: string }>,
    options: { connectorSlug?: string; capabilities?: string[] } = {},
  ) {
    const connectorSlug = options.connectorSlug ?? "amazon";
    const capabilities = options.capabilities ?? ["BULK_PUBLISH"];

    const tenantDb = {
      $queryRaw: jest.fn().mockResolvedValue([{ ...MOCK_RESOLVED_ROW, connectorSlug }]),
      product: {
        findUnique: jest.fn(({ where: { id } }: { where: { id: string } }) =>
          Promise.resolve(productsById[id] ? { id, ...productsById[id] } : null),
        ),
      },
      connectorSubmission: {
        upsert: jest.fn(({ create }: { create: { id?: string } }) =>
          Promise.resolve({ id: `sub_${create.id ?? Math.random()}` }),
        ),
      },
    };

    const prisma = { tenant: jest.fn().mockReturnValue(tenantDb) };

    const connectorFramework = {
      getCurrentTenantKey: jest.fn().mockReturnValue("tenant1"),
      requireCurrentTenantKey: jest.fn().mockReturnValue("tenant1"),
      requireInstallation: jest.fn().mockResolvedValue({ id: "inst_1", slug: connectorSlug, capabilities }),
      publishBulk: jest.fn().mockImplementation((_installation: unknown, products: unknown[]) =>
        Promise.resolve({
          feedId: "feed_1",
          feedDocumentId: "doc_1",
          productCount: products.length,
          skus: products.map((_p, i) => `SKU-${i}`),
        }),
      ),
    };

    const connectorMappingService = {
      evaluatePublishReadiness: jest.fn().mockResolvedValue({ ok: true, blockers: [], warnings: [] }),
    };

    const svc = new MarketplaceService(
      prisma as never,
      connectorFramework as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      connectorMappingService as never,
      {} as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      { assertSensitivePayloadAccessAllowed: jest.fn().mockResolvedValue(undefined) } as never,
      { fromRows: jest.fn().mockReturnValue([]), findDefault: jest.fn().mockReturnValue(undefined) } as never,
      { isLocalMode: jest.fn().mockReturnValue(false) } as never,
    );
    jest.spyOn(svc as unknown as Record<string, jest.Mock>, "buildConnectorProductPayload")
      .mockImplementation((id: unknown) => Promise.resolve({ sku: `SKU-${id}`, title: "T", mrp: 1, sellingPrice: 1 }));

    return { svc, connectorFramework, connectorMappingService, tenantDb };
  }

  it("excludes a draft product and only submits the approved, ready one", async () => {
    const { svc, connectorFramework, connectorMappingService } = makeBulkPublishService({
      "draft-1": { status: "draft", categoryId: "cat1" },
      "approved-1": { status: "approved", categoryId: "cat1" },
    });
    connectorMappingService.evaluatePublishReadiness.mockResolvedValue({ ok: true, blockers: [], warnings: [] });

    const result = await svc.triggerBulkPublish("inst_1", ["draft-1", "approved-1"]);

    expect(result.submissionIds).toHaveLength(1);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0].productId).toBe("draft-1");
    expect(result.excluded[0].reason).toMatch(/must be approved/i);
    expect(connectorFramework.publishBulk).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ sku: "SKU-approved-1" })]),
    );
    // the draft product's payload must never have been built or submitted
    expect(connectorFramework.publishBulk.mock.calls[0][1]).toHaveLength(1);
  });

  it("excludes an approved product that fails destination readiness", async () => {
    const { svc, connectorMappingService } = makeBulkPublishService({
      "approved-not-ready": { status: "approved", categoryId: "cat1" },
    });
    connectorMappingService.evaluatePublishReadiness.mockResolvedValue({
      ok: false,
      blockers: ["required_attribute_mapping_missing"],
      warnings: [],
    });

    await expect(svc.triggerBulkPublish("inst_1", ["approved-not-ready"])).rejects.toMatchObject({
      response: expect.objectContaining({ error: "no_eligible_products" }),
    });
  });

  it("submits all products when every one is approved and ready", async () => {
    const { svc, connectorFramework } = makeBulkPublishService({
      "a1": { status: "approved", categoryId: "cat1" },
      "a2": { status: "active", categoryId: "cat1" },
    });

    const result = await svc.triggerBulkPublish("inst_1", ["a1", "a2"]);

    expect(result.excluded).toHaveLength(0);
    expect(result.submissionIds).toHaveLength(2);
    expect(connectorFramework.publishBulk.mock.calls[0][1]).toHaveLength(2);
  });

  it("falls back to queued per-product export jobs for a connector without BULK_PUBLISH (Shopify)", async () => {
    const { svc, connectorFramework } = makeBulkPublishService(
      {
        "a1": { status: "approved", categoryId: "cat1" },
        "a2": { status: "active", categoryId: "cat1" },
      },
      { connectorSlug: "shopify", capabilities: ["PUBLISH", "VALIDATE", "STATUS_SYNC", "WEBHOOK_RECEIVE"] },
    );
    const createExportJobSpy = jest
      .spyOn(svc as unknown as Record<string, jest.Mock>, "createExportJob")
      .mockImplementation((productId: unknown) => Promise.resolve({ id: `job_${productId as string}` }));

    const result = await svc.triggerBulkPublish("inst_1", ["a1", "a2"]);

    // the Amazon feed path must never be invoked for a connector lacking BULK_PUBLISH
    expect(connectorFramework.publishBulk).not.toHaveBeenCalled();
    expect(createExportJobSpy).toHaveBeenCalledTimes(2);
    expect(createExportJobSpy).toHaveBeenCalledWith(
      "a1",
      expect.objectContaining({ channel: "shopify", installationId: "inst_1" }),
      undefined,
    );
    expect(result.excluded).toHaveLength(0);
    expect(result.submissionIds.sort()).toEqual(["job_a1", "job_a2"]);
    expect(result.feedId).toMatch(/^queued-batch:/);
    expect(result.feedDocumentId).toBe(result.feedId);
    expect(result.productCount).toBe(2);
  });

  it("excludes only the product whose queued export job fails, in the Shopify fallback path", async () => {
    const { svc } = makeBulkPublishService(
      {
        "ok-1": { status: "approved", categoryId: "cat1" },
        "bad-1": { status: "approved", categoryId: "cat1" },
      },
      { connectorSlug: "shopify", capabilities: [] },
    );
    jest
      .spyOn(svc as unknown as Record<string, jest.Mock>, "createExportJob")
      .mockImplementation((productId: unknown) => {
        if (productId === "bad-1") {
          return Promise.reject(new Error("readiness check failed"));
        }
        return Promise.resolve({ id: `job_${productId as string}` });
      });

    const result = await svc.triggerBulkPublish("inst_1", ["ok-1", "bad-1"]);

    expect(result.submissionIds).toEqual(["job_ok-1"]);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]).toMatchObject({ productId: "bad-1", reason: "readiness check failed" });
  });

  // ─── TC-06 / #545: non-BULK_PUBLISH batch-size ceiling ──────────────────────
  // Wave 1 fix for the timeout that made bulk publish fail atomically at 46
  // products for connectors without a native batch-feed API (Shopify, WooCommerce).

  it("rejects a non-BULK_PUBLISH batch over the 50-product ceiling before any product lookup runs", async () => {
    const productIds = Array.from({ length: 51 }, (_, i) => `p${i}`);
    const productsById: Record<string, { status: string; categoryId: string }> = {};
    for (const id of productIds) {
      productsById[id] = { status: "approved", categoryId: "cat1" };
    }
    const { svc, tenantDb } = makeBulkPublishService(productsById, {
      connectorSlug: "shopify",
      capabilities: ["PUBLISH", "VALIDATE", "STATUS_SYNC", "WEBHOOK_RECEIVE"],
    });

    await expect(svc.triggerBulkPublish("inst_1", productIds)).rejects.toMatchObject({
      response: expect.objectContaining({ error: "batch_too_large", ceiling: 50, submittedCount: 51 }),
    });
    // the ceiling must reject up front — the expensive per-product eligibility loop
    // (the actual root cause of the timeout) must never run for an oversized batch.
    expect(tenantDb.product.findUnique).not.toHaveBeenCalled();
  });

  it("does not apply the non-BULK_PUBLISH ceiling to a native BULK_PUBLISH connector (Amazon)", async () => {
    const productIds = Array.from({ length: 60 }, (_, i) => `p${i}`);
    const productsById: Record<string, { status: string; categoryId: string }> = {};
    for (const id of productIds) {
      productsById[id] = { status: "approved", categoryId: "cat1" };
    }
    const { svc, connectorFramework } = makeBulkPublishService(productsById, {
      connectorSlug: "amazon",
      capabilities: ["BULK_PUBLISH"],
    });

    const result = await svc.triggerBulkPublish("inst_1", productIds);

    expect(result.excluded).toHaveLength(0);
    expect(result.submissionIds).toHaveLength(60);
    expect(connectorFramework.publishBulk).toHaveBeenCalled();
  });
});

describe("MarketplaceService.getBatchReadiness", () => {
  function mockResolvedMapping() {
    return {
      channel: "amazon",
      displayName: "Amazon",
      requiredFields: ["title"],
      fieldMap: { title: "item_name" },
      templateId: null,
      templateName: null,
      source: "system_pack",
    };
  }

  it("returns one readiness summary per requested product and requested channel only", async () => {
    const svc = makeService();
    const svcInternal = svc as unknown as Record<string, jest.Mock>;

    jest.spyOn(svcInternal, "getProductsForSimulation").mockResolvedValue([
      { id: "prod-1", categoryId: "cat-1", validationIssues: [] },
      { id: "prod-2", categoryId: "cat-2", validationIssues: [] },
    ]);
    jest.spyOn(svcInternal, "getEffectiveMappingCached").mockResolvedValue(mockResolvedMapping());
    // No publish-capable connector installed for this tenant — every channel picks up
    // the "nowhere to publish to" error alongside its content/mapping errors.
    jest.spyOn(svcInternal, "getPublishCapableChannels").mockResolvedValue(new Set());
    jest.spyOn(svcInternal, "buildSimulationFromProduct").mockImplementation(async (_product, channel) => ({
      missingFields: channel === "amazon" ? ["title", "brand"] : ["attributes.mainImageUrl"],
      channelIssues: [
        {
          severity: "error",
          code: "CHANNEL_REQUIRED_FIELD",
          fieldPath: channel === "amazon" ? "title" : "attributes.mainImageUrl",
          sellerMessage: "Required field missing",
          message: "Required field missing",
        },
      ],
      complianceSummary: { errorCount: 1, warningCount: 0 },
    }));

    const result = await svc.getBatchReadiness(["prod-1", "prod-2"], ["amazon", "shopify"]);

    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.productId)).toEqual(["prod-1", "prod-2"]);
    expect(result.items[0]?.readiness.map((entry) => entry.channel)).toEqual(["amazon", "shopify"]);
    expect(result.items[1]?.readiness.map((entry) => entry.channel)).toEqual(["amazon", "shopify"]);
    expect(result.items[0]?.readiness[0]).toMatchObject({
      channel: "amazon",
      status: "errors",
      errorCount: 4,
      warningCount: 0,
    });
    expect(result.items[0]?.readiness[1]).toMatchObject({
      channel: "shopify",
      status: "errors",
      errorCount: 3,
      warningCount: 0,
    });
  });

  it("dedupes required field channel errors and refreshes counts after simulation changes", async () => {
    const svc = makeService();
    const svcInternal = svc as unknown as Record<string, jest.Mock>;

    jest.spyOn(svcInternal, "getProductsForSimulation").mockResolvedValue([
      { id: "prod-1", categoryId: "cat-1", validationIssues: [] },
    ]);
    jest.spyOn(svcInternal, "getEffectiveMappingCached").mockResolvedValue(mockResolvedMapping());
    jest.spyOn(svcInternal, "getPublishCapableChannels").mockResolvedValue(new Set());

    const buildSimulationFromProduct = jest.spyOn(svcInternal, "buildSimulationFromProduct");
    buildSimulationFromProduct
      .mockResolvedValueOnce({
        missingFields: ["title", "brand"],
        channelIssues: [
          {
            severity: "error",
            code: "CHANNEL_REQUIRED_FIELD",
            fieldPath: "title",
            sellerMessage: "Title is required",
            message: "Title is required",
          },
          {
            severity: "error",
            code: "CHANNEL_REQUIRED_FIELD",
            fieldPath: "brand",
            sellerMessage: "Brand is required",
            message: "Brand is required",
          },
          {
            severity: "error",
            code: "CHANNEL_IMAGE",
            fieldPath: "attributes.mainImageUrl",
            sellerMessage: "Main image missing",
            message: "Main image missing",
          },
          {
            severity: "warning",
            code: "CHANNEL_COPY",
            fieldPath: "description",
            sellerMessage: "Description should be longer",
            message: "Description should be longer",
          },
        ],
        complianceSummary: { errorCount: 1, warningCount: 2 },
      })
      .mockResolvedValueOnce({
        missingFields: [],
        channelIssues: [
          {
            severity: "warning",
            code: "CHANNEL_COPY",
            fieldPath: "description",
            sellerMessage: "Description should be longer",
            message: "Description should be longer",
          },
        ],
        complianceSummary: { errorCount: 0, warningCount: 1 },
      });

    const initial = await svc.getBatchReadiness(["prod-1"], ["amazon"]);
    const refreshed = await svc.getBatchReadiness(["prod-1"], ["amazon"]);

    expect(initial.items[0]?.readiness[0]).toMatchObject({
      channel: "amazon",
      status: "errors",
      errorCount: 5,
      warningCount: 3,
    });
    // Still "errors" (not "warnings") after content/mapping issues clear — no
    // publish-capable connector is installed, so the channel stays blocked.
    expect(refreshed.items[0]?.readiness[0]).toMatchObject({
      channel: "amazon",
      status: "errors",
      errorCount: 1,
      warningCount: 2,
    });
    expect(refreshed.items[0]?.readiness[0]?.errorCount).toBeLessThan(initial.items[0]?.readiness[0]?.errorCount ?? 0);
  });

  it("returns unknown readiness for requested products that are no longer found", async () => {
    const svc = makeService();
    const svcInternal = svc as unknown as Record<string, jest.Mock>;

    jest.spyOn(svcInternal, "getProductsForSimulation").mockResolvedValue([
      { id: "prod-1", categoryId: "cat-1", validationIssues: [] },
    ]);
    jest.spyOn(svcInternal, "getEffectiveMappingCached").mockResolvedValue(mockResolvedMapping());
    jest.spyOn(svcInternal, "getPublishCapableChannels").mockResolvedValue(new Set());
    jest.spyOn(svcInternal, "buildSimulationFromProduct").mockResolvedValue({
      missingFields: [],
      channelIssues: [],
      complianceSummary: { errorCount: 0, warningCount: 0 },
    });

    const result = await svc.getBatchReadiness(["prod-1", "prod-missing"], ["flipkart"]);

    expect(result.items).toHaveLength(2);
    expect(result.items[1]).toEqual({
      productId: "prod-missing",
      readiness: [
        {
          channel: "flipkart",
          status: "unknown",
          errorCount: 0,
          warningCount: 0,
        },
      ],
    });
  });
});

describe("MarketplaceService.getPublishCapableChannels (VEXA-202)", () => {
  function makeServiceWithRawRows(rows: Array<{ slug: string; capabilities: string[]; metadata: unknown; credentialsValidated?: boolean }>) {
    const prisma = {
      tenant: jest.fn().mockReturnValue({
        $queryRawUnsafe: jest.fn().mockResolvedValue(rows), // RLS-BYPASS: manual tenant filter
      }),
    };
    const connectorFramework = {
      getCurrentTenantKey: jest.fn().mockReturnValue("tenant1"),
      requireCurrentTenantKey: jest.fn().mockReturnValue("tenant1"),
    };
    const connectorRegistry = { get: jest.fn(), list: jest.fn().mockReturnValue([]) };
    const planUsageService = {};
    const queueService = {};
    const metricsService = {};
    const connectorMappingService = {};
    const notificationsService = {};
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const accessPolicy = {};
    const mediaStorage = {};

    return new MarketplaceService(
      prisma as never,
      connectorFramework as never,
      connectorRegistry as never,
      planUsageService as never,
      queueService as never,
      metricsService as never,
      connectorMappingService as never,
      notificationsService as never,
      logger as never,
      accessPolicy as never,
      { fromRows: jest.fn().mockReturnValue([]), findDefault: jest.fn().mockReturnValue(undefined) } as never,
      mediaStorage as never,
    );
  }

  it("excludes a Shopify installation that is ACTIVE but has not completed OAuth (no metadata.shopId)", async () => {
    const svc = makeServiceWithRawRows([
      { slug: "shopify", capabilities: ["PUBLISH"], metadata: { authMode: "guided_managed_install", shopDomain: "qa-managed-test.myshopify.com" } },
    ]);
    const result = await (svc as unknown as { getPublishCapableChannels: () => Promise<Set<string>> }).getPublishCapableChannels();
    expect(result.has("shopify")).toBe(false);
  });

  it("includes a Shopify installation once metadata.shopId is recorded (OAuth completed)", async () => {
    const svc = makeServiceWithRawRows([
      { slug: "shopify", capabilities: ["PUBLISH"], metadata: { shopDomain: "qa-managed-test.myshopify.com", shopId: "gid://shopify/Shop/1" } },
    ]);
    const result = await (svc as unknown as { getPublishCapableChannels: () => Promise<Set<string>> }).getPublishCapableChannels();
    expect(result.has("shopify")).toBe(true);
  });

  it("does not require metadata.shopId for non-Shopify connectors", async () => {
    const svc = makeServiceWithRawRows([
      { slug: "flipkart", capabilities: ["PUBLISH", "VALIDATE"], metadata: {}, credentialsValidated: true },
    ]);
    const result = await (svc as unknown as { getPublishCapableChannels: () => Promise<Set<string>> }).getPublishCapableChannels();
    expect(result.has("flipkart")).toBe(true);
  });

  it("excludes a Flipkart installation that is ACTIVE but has no validated credentials (VEXA-301-SPIKE: blank-credentials install)", async () => {
    const svc = makeServiceWithRawRows([
      { slug: "flipkart", capabilities: ["PUBLISH", "VALIDATE"], metadata: {}, credentialsValidated: false },
    ]);
    const result = await (svc as unknown as { getPublishCapableChannels: () => Promise<Set<string>> }).getPublishCapableChannels();
    expect(result.has("flipkart")).toBe(false);
  });

  it("includes a Flipkart installation once credentials have been validated", async () => {
    const svc = makeServiceWithRawRows([
      { slug: "flipkart", capabilities: ["PUBLISH", "VALIDATE"], metadata: {}, credentialsValidated: true },
    ]);
    const result = await (svc as unknown as { getPublishCapableChannels: () => Promise<Set<string>> }).getPublishCapableChannels();
    expect(result.has("flipkart")).toBe(true);
  });

  it("excludes an Amazon installation that is ACTIVE but has no validated credentials", async () => {
    const svc = makeServiceWithRawRows([
      { slug: "amazon-in", capabilities: ["PUBLISH", "VALIDATE"], metadata: {}, credentialsValidated: false },
    ]);
    const result = await (svc as unknown as { getPublishCapableChannels: () => Promise<Set<string>> }).getPublishCapableChannels();
    expect(result.has("amazon")).toBe(false);
  });
});

// ─── MarketplaceService.queueDeltaSync — connector-submission enqueue handoff ──
//
// Regression coverage for the bug where scheduled/manual delta sync created
// MarketplaceExportJob rows at status=queued but never handed them to the
// connector-submission worker (queueService.enqueue was never called), so the
// rows sat at `queued` forever. createExportJob and requeueExportJob always
// enqueued after creating; queueDeltaSync was the one path that didn't.

describe("MarketplaceService.queueDeltaSync — connector-submission enqueue handoff", () => {
  const INSTALLATION_ROW = {
    id: "inst_1",
    connectorId: "conn_1",
    tenantKey: "tenant1",
    connectorSlug: "shopify",
    capabilities: ["PUBLISH"],
  };

  function makeDeltaSyncService(options: {
    candidates?: Array<{ product_id: string; version: number; category_id: string }>;
    createImpl?: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
    enqueueImpl?: (...args: unknown[]) => Promise<void>;
    isJobPresentImpl?: (...args: unknown[]) => Promise<boolean>;
  } = {}) {
    const candidates = options.candidates ?? [
      { product_id: "p1", version: 2, category_id: "cat1" },
      { product_id: "p2", version: 3, category_id: "cat1" },
    ];

    const marketplaceExportJob = {
      create: jest.fn(
        options.createImpl ??
          (({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve({ id: `job-${data.productId as string}` })),
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };

    const db = {
      $queryRaw: jest.fn().mockResolvedValue([INSTALLATION_ROW]),
      $queryRawUnsafe: jest.fn().mockResolvedValue(candidates), // RLS-BYPASS: manual tenant filter
      marketplaceExportJob,
    };

    const prisma = {
      // Same mock regardless of args: covers both `this.prisma.tenant(tenantKey)`
      // (used directly in queueDeltaSync) and `this.prisma.tenant()` (used inside
      // the shared enqueueExportJobForExecution helper).
      tenant: jest.fn().mockReturnValue(db),
    };

    const connectorFramework = {
      getCurrentTenantKey: jest.fn().mockReturnValue("tenant1"),
      requireCurrentTenantKey: jest.fn().mockReturnValue("tenant1"),
    };

    const queueService = {
      enqueue: jest.fn(options.enqueueImpl ?? (() => Promise.resolve(undefined))),
      isJobPresent: jest.fn(options.isJobPresentImpl ?? (() => Promise.resolve(false))),
      processScheduledSync: jest.fn(),
      processWithBackpressure: jest.fn(),
    };

    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const svc = new MarketplaceService(
      prisma as never,
      connectorFramework as never,
      {} as never,
      {} as never,
      queueService as never,
      {} as never,
      {} as never,
      {} as never,
      logger as never,
      {} as never,
      { fromRows: jest.fn().mockReturnValue([]), findDefault: jest.fn().mockReturnValue(undefined) } as never,
      {} as never,
    );

    return { svc, db, queueService, marketplaceExportJob, logger };
  }

  it("enqueues a CONNECTOR_SUBMISSION job for every export job it creates", async () => {
    const { svc, queueService } = makeDeltaSyncService();

    const result = await svc.queueDeltaSync("inst_1");

    expect(result).toEqual({ queued: 2, skipped: 0 });
    expect(queueService.enqueue).toHaveBeenCalledTimes(2);
    expect(queueService.enqueue).toHaveBeenCalledWith(
      "connector-submission",
      { jobId: "job-p1", connectorSlug: "shopify", tenantKey: "tenant1" },
      { jobId: "job-p1_0" },
    );
    expect(queueService.enqueue).toHaveBeenCalledWith(
      "connector-submission",
      { jobId: "job-p2", connectorSlug: "shopify", tenantKey: "tenant1" },
      { jobId: "job-p2_0" },
    );
  });

  it("the scheduled-sync cron handler drives the same enqueue path as a manual run (not a separate, divergeable copy)", async () => {
    // There are two distinct queue layers here: registerRepeatableSync's BullMQ
    // schedule only queues the *orchestration* trigger — processScheduledSync's
    // handler still has to call queueDeltaSync, which is what actually creates
    // and enqueues the CONNECTOR_SUBMISSION work. A fix applied only to a manual
    // "run sync now" call site (and not to queueDeltaSync itself) would leave the
    // cron path silently broken; this test exercises the cron wiring directly so
    // that scenario cannot pass.
    const { svc, queueService } = makeDeltaSyncService();

    svc.onModuleInit();
    expect(queueService.processScheduledSync).toHaveBeenCalledTimes(1);
    const scheduledHandler = queueService.processScheduledSync.mock.calls[0][0] as (
      payload: unknown,
    ) => Promise<void>;

    await scheduledHandler({ tenantKey: "tenant1", installationId: "inst_1" });

    expect(queueService.enqueue).toHaveBeenCalledTimes(2);
    expect(queueService.enqueue).toHaveBeenCalledWith(
      "connector-submission",
      { jobId: "job-p1", connectorSlug: "shopify", tenantKey: "tenant1" },
      { jobId: "job-p1_0" },
    );
  });

  it("enqueues nothing when there are no delta-sync candidates", async () => {
    const { svc, queueService, marketplaceExportJob } = makeDeltaSyncService({ candidates: [] });

    const result = await svc.queueDeltaSync("inst_1");

    expect(result).toEqual({ queued: 0, skipped: 0 });
    expect(marketplaceExportJob.create).not.toHaveBeenCalled();
    expect(queueService.enqueue).not.toHaveBeenCalled();
  });

  it("does not enqueue for a candidate whose DB row creation failed", async () => {
    const { svc, queueService } = makeDeltaSyncService({
      createImpl: ({ data }) => {
        if (data.productId === "p1") {
          return Promise.reject(new Error("db unavailable"));
        }
        return Promise.resolve({ id: `job-${data.productId as string}` });
      },
    });

    const result = await svc.queueDeltaSync("inst_1");

    expect(result).toEqual({ queued: 1, skipped: 1 });
    expect(queueService.enqueue).toHaveBeenCalledTimes(1);
    expect(queueService.enqueue).toHaveBeenCalledWith(
      "connector-submission",
      { jobId: "job-p2", connectorSlug: "shopify", tenantKey: "tenant1" },
      { jobId: "job-p2_0" },
    );
  });

  it("marks the row failed (not silently queued) when the queue enqueue call itself fails", async () => {
    const { svc, db, marketplaceExportJob } = makeDeltaSyncService({
      candidates: [{ product_id: "p1", version: 2, category_id: "cat1" }],
      enqueueImpl: () => Promise.reject(new Error("redis unreachable")),
      isJobPresentImpl: () => Promise.resolve(false), // the add() genuinely never landed
    });

    const result = await svc.queueDeltaSync("inst_1");

    // The row was created but the handoff failed — it must NOT be counted as
    // a genuinely queued (worker-visible) job.
    expect(result).toEqual({ queued: 0, skipped: 1 });
    expect(marketplaceExportJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-p1", status: ExportJobStatus.queued },
      data: { status: ExportJobStatus.failed, failureReason: "Queue enqueue failed" },
    });
    void db;
  });

  it("leaves the row queued (not falsely marked failed) when isJobPresent itself cannot answer", async () => {
    // enqueue fails AND the presence check fails too (e.g. same Redis outage) — this
    // is genuinely unknown, not confirmed-absent, so the row must not be asserted as
    // `failed`. It still counts as `skipped` in this call's return value because no
    // enqueue was ever confirmed to succeed.
    //
    // The underlying errors intentionally carry sensitive-looking content (host,
    // port, a credential-bearing URL, a stack) to prove the diagnostic log never
    // forwards raw error text — only a coarse, non-sensitive error code.
    const enqueueError = Object.assign(
      new Error("connect ECONNREFUSED redis://default:s3cr3t-pass@10.0.4.12:6379"),
      { code: "ECONNREFUSED", stack: "Error: connect ECONNREFUSED\n    at TCPConnectWrap.afterConnect (net.js:1)" },
    );
    const presenceCheckError = Object.assign(
      new Error("getaddrinfo ENOTFOUND internal-redis.vexapim-prod.svc.cluster.local"),
      { code: "ENOTFOUND" },
    );

    const { svc, marketplaceExportJob, logger } = makeDeltaSyncService({
      candidates: [{ product_id: "p1", version: 2, category_id: "cat1" }],
      enqueueImpl: () => Promise.reject(enqueueError),
      isJobPresentImpl: () => Promise.reject(presenceCheckError),
    });

    const result = await svc.queueDeltaSync("inst_1");

    expect(result).toEqual({ queued: 0, skipped: 1 });
    expect(marketplaceExportJob.updateMany).not.toHaveBeenCalled();

    // Operator-visible signal distinguishing "queued" from "queued but the
    // execution handoff could not be verified" without a DB status/enum change.
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [, loggedContext] = logger.error.mock.calls[0] as [string, Record<string, unknown>];
    expect(loggedContext).toEqual({
      event: "QUEUE_HANDOFF_UNVERIFIED",
      jobId: "job-p1",
      connectorSlug: "shopify",
      retryCount: 0,
      queueJobId: "job-p1_0",
      enqueueErrorCode: "ECONNREFUSED",
      presenceCheckErrorCode: "ENOTFOUND",
    });

    // Narrow data-safety regression: no raw message/stack/connection material of any
    // kind should reach the log, under any key name.
    const serializedContext = JSON.stringify(loggedContext);
    expect(serializedContext).not.toContain("s3cr3t-pass");
    expect(serializedContext).not.toContain("10.0.4.12");
    expect(serializedContext).not.toContain("internal-redis.vexapim-prod");
    expect(serializedContext).not.toContain("ECONNREFUSED redis://");
    expect(loggedContext).not.toHaveProperty("stack");
    expect(loggedContext).not.toHaveProperty("payload");
    expect(loggedContext).not.toHaveProperty("credentials");
    expect(loggedContext).not.toHaveProperty("redisUrl");
    expect(loggedContext).not.toHaveProperty("connectionString");
    expect(loggedContext).not.toHaveProperty("enqueueError");
    expect(loggedContext).not.toHaveProperty("presenceCheckError");
  });

  it("does not mark the row failed if isJobPresent shows the enqueue actually landed", async () => {
    const { svc, marketplaceExportJob } = makeDeltaSyncService({
      candidates: [{ product_id: "p1", version: 2, category_id: "cat1" }],
      enqueueImpl: () => Promise.reject(new Error("client-side timeout after add() succeeded")),
      isJobPresentImpl: () => Promise.resolve(true), // BullMQ confirms the job is really there
    });

    const result = await svc.queueDeltaSync("inst_1");

    expect(result).toEqual({ queued: 1, skipped: 0 });
    expect(marketplaceExportJob.updateMany).not.toHaveBeenCalled();
  });

  it("counts a P2002 (concurrent-active) conflict as skipped, not queued", async () => {
    const { Prisma } = require("@prisma/client"); // eslint-disable-line @typescript-eslint/no-var-requires
    const p2002 = Object.assign(
      new Error("Unique constraint failed on the fields: (`tenantKey`,`productId`,`installation_id`)"),
      { code: "P2002", meta: { target: ["tenantKey", "productId", "installation_id"] } },
    );
    Object.setPrototypeOf(p2002, (Prisma?.PrismaClientKnownRequestError ?? Error).prototype);

    const { svc, queueService } = makeDeltaSyncService({
      candidates: [
        { product_id: "p1", version: 2, category_id: "cat1" },
        { product_id: "p2", version: 3, category_id: "cat1" },
      ],
      createImpl: ({ data }) => {
        if (data.productId === "p1") return Promise.reject(p2002);
        return Promise.resolve({ id: `job-${data.productId as string}` });
      },
    });

    const result = await svc.queueDeltaSync("inst_1");

    expect(result).toEqual({ queued: 1, skipped: 1 });
    expect(queueService.enqueue).toHaveBeenCalledTimes(1);
    expect(queueService.enqueue).toHaveBeenCalledWith(
      "connector-submission",
      { jobId: "job-p2", connectorSlug: "shopify", tenantKey: "tenant1" },
      { jobId: "job-p2_0" },
    );
  });

  it("throws NotFoundException when the installation does not exist", async () => {
    const { svc, db } = makeDeltaSyncService();
    (db.$queryRaw as jest.Mock).mockResolvedValue([]);
    await expect(svc.queueDeltaSync("missing-inst")).rejects.toThrow(NotFoundException);
  });

  it("rejects delta sync for a connector installation without PUBLISH capability", async () => {
    const { svc, db } = makeDeltaSyncService();
    (db.$queryRaw as jest.Mock).mockResolvedValue([{ ...INSTALLATION_ROW, capabilities: ["VALIDATE"] }]);
    await expect(svc.queueDeltaSync("inst_1")).rejects.toThrow(BadRequestException);
  });
});

// ─── CONNECTOR_SUBMISSION worker boundary — tenant context restoration ────────
// (BUG-MKT-QUEUE-002)
//
// Root cause: the worker callback registered via processWithBackpressure has no
// HTTP request to inherit AsyncLocalStorage tenant context from, so every
// ambient `this.prisma.tenant()` call inside processExportJob (and its
// siblings) silently fell back to DEFAULT_TENANT_KEY and could never find a
// real tenant's row. The fix restores context once at the top of the worker
// callback, sourced from a required `tenantKey` field on the queue payload,
// before dispatching to any mode. These tests exercise the REAL
// runWithTenantContext/getTenantKeyFromContext machinery (not mocked) against
// a small per-tenant fake Prisma client, so a regression that reintroduces the
// ambient-fallback bug would make the "correct tenant" test fail exactly the
// way production did.

describe("CONNECTOR_SUBMISSION worker boundary — tenant context restoration", () => {
  const { getTenantKeyFromContext } = require("../common/tenant/tenant-context");

  function emptyTenantDb() {
    return {
      marketplaceExportJob: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
  }

  function makeWorkerBoundaryService(dbByTenant: Record<string, unknown> = {}) {
    const prisma = {
      // Mirrors the real PrismaService.tenant(): explicit arg wins, otherwise
      // ambient AsyncLocalStorage context — genuinely exercised here, not stubbed.
      tenant: jest.fn((explicitKey?: string) => {
        const key = explicitKey ?? getTenantKeyFromContext();
        return dbByTenant[key] ?? emptyTenantDb();
      }),
    };
    const connectorFramework = {
      getCurrentTenantKey: jest.fn(() => getTenantKeyFromContext()),
    };
    const queueService = {
      processScheduledSync: jest.fn(),
      processWithBackpressure: jest.fn(),
      enqueue: jest.fn(),
      isJobPresent: jest.fn(),
    };
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const svc = new MarketplaceService(
      prisma as never,
      connectorFramework as never,
      {} as never,
      {} as never,
      queueService as never,
      {} as never,
      {} as never,
      {} as never,
      logger as never,
      {} as never,
      { fromRows: jest.fn().mockReturnValue([]), findDefault: jest.fn().mockReturnValue(undefined) } as never,
      {} as never,
    );
    return { svc, prisma, queueService, logger };
  }

  function captureWorkerHandler(svc: MarketplaceService, queueService: { processWithBackpressure: jest.Mock }) {
    svc.onModuleInit();
    expect(queueService.processWithBackpressure).toHaveBeenCalledTimes(1);
    // processWithBackpressure(queueName, options, handler)
    return queueService.processWithBackpressure.mock.calls[0][2] as (payload: unknown) => Promise<void>;
  }

  it("restores the payload's tenant before dispatch — the job is found under the correct tenant", async () => {
    // ExportJobStatus.completed short-circuits processExportJob immediately after
    // the tenant-scoped lookup, which is exactly the boundary this test needs to
    // prove crossed correctly — no need to stub the rest of the publish pipeline.
    const completedJob = { id: "job-1", status: ExportJobStatus.completed, tenantKey: "tenantA" };
    const { svc, queueService } = makeWorkerBoundaryService({
      tenantA: { marketplaceExportJob: { findUnique: jest.fn().mockResolvedValue(completedJob) } },
    });
    const handler = captureWorkerHandler(svc, queueService);

    await handler({ jobId: "job-1", connectorSlug: "shopify", tenantKey: "tenantA" });
    // No throw = success: processExportJob found the row and its own tenant-
    // consistency assertion (existing.tenantKey === activeTenantKey) passed.
  });

  it("does not leak another tenant's job when the payload names a different tenant", async () => {
    // The same job id exists — but only under tenantA. A payload claiming tenantB
    // must not be able to see it: this is the isolation half of the fix, proving
    // the restored context actually scopes the lookup rather than merely existing.
    const completedJob = { id: "job-1", status: ExportJobStatus.completed, tenantKey: "tenantA" };
    const { svc, queueService } = makeWorkerBoundaryService({
      tenantA: { marketplaceExportJob: { findUnique: jest.fn().mockResolvedValue(completedJob) } },
    });
    const handler = captureWorkerHandler(svc, queueService);

    await expect(
      handler({ jobId: "job-1", connectorSlug: "shopify", tenantKey: "tenantB" }),
    ).rejects.toThrow("Export job not found");
  });

  it.each(["export-job" as const, "status-sync" as const, "submission-retry" as const])(
    "fails closed with UnrecoverableError for mode=%s when tenantKey is missing — never falls back to a default tenant",
    async (mode) => {
      const { svc, queueService, prisma, logger } = makeWorkerBoundaryService();
      const handler = captureWorkerHandler(svc, queueService);
      const processExportJobSpy = jest.spyOn(svc, "processExportJob");
      const autoSyncSpy = jest.spyOn(svc as unknown as { autoSyncSubmissionStatus: () => unknown }, "autoSyncSubmissionStatus" as never);
      const retrySpy = jest.spyOn(svc as unknown as { processLiveSubmissionRetry: () => unknown }, "processLiveSubmissionRetry" as never);

      const payload =
        mode === "export-job"
          ? { jobId: "job-1", connectorSlug: "shopify" }
          : mode === "status-sync"
            ? { mode, submissionId: "sub-1", connectorSlug: "shopify" }
            : { mode, submissionId: "sub-1", connectorSlug: "shopify" };

      await expect(handler(payload)).rejects.toThrow(UnrecoverableError);

      expect(processExportJobSpy).not.toHaveBeenCalled();
      expect(autoSyncSpy).not.toHaveBeenCalled();
      expect(retrySpy).not.toHaveBeenCalled();
      // The ambient-fallback bug this fix closes is specifically "silently resolve
      // to DEFAULT_TENANT_KEY and query anyway" — so no tenant-scoped client should
      // ever be requested for a payload with no tenant identity at all.
      expect(prisma.tenant).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ event: "QUEUE_TENANT_CONTEXT_MISSING" }),
      );
    },
  );

  it("logs no raw payload content for the missing-tenantKey diagnostic — mode only", async () => {
    const { svc, queueService, logger } = makeWorkerBoundaryService();
    const handler = captureWorkerHandler(svc, queueService);

    await expect(
      handler({ mode: "submission-retry", submissionId: "sub-secret-1", connectorSlug: "shopify" }),
    ).rejects.toThrow(UnrecoverableError);

    const [, loggedContext] = logger.error.mock.calls[0] as [string, Record<string, unknown>];
    expect(loggedContext).toEqual({ event: "QUEUE_TENANT_CONTEXT_MISSING", mode: "submission-retry" });
    expect(JSON.stringify(loggedContext)).not.toContain("sub-secret-1");
  });
});

describe("MarketplaceService.processExportJob — tenant-consistency self-check", () => {
  it("throws if the loaded row's tenantKey does not match the active tenant (defense-in-depth)", async () => {
    // Structurally this should be unreachable in production (the tenant-scope
    // Prisma extension already injects tenantKey into the query), but the check
    // exists to fail loudly if that guarantee is ever broken — verify it actually
    // fires rather than being dead code.
    const prisma = {
      tenant: jest.fn().mockReturnValue({
        marketplaceExportJob: {
          findUnique: jest.fn().mockResolvedValue({ id: "job-1", status: "queued", tenantKey: "tenantB" }),
        },
      }),
    };
    const connectorFramework = { getCurrentTenantKey: jest.fn().mockReturnValue("tenantA") };
    const svc = new MarketplaceService(
      prisma as never,
      connectorFramework as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      {} as never,
      { fromRows: jest.fn().mockReturnValue([]), findDefault: jest.fn().mockReturnValue(undefined) } as never,
      {} as never,
    );

    await expect(svc.processExportJob("job-1")).rejects.toThrow(/[Tt]enant/);
  });
});

// ─── Producer-side strict tenant accessor (BUG-MKT-QUEUE-002, Gate 2) ─────────
//
// getCurrentTenantKey() is intentionally lenient — it silently resolves to
// DEFAULT_TENANT_KEY when no AsyncLocalStorage context exists, which is fine
// for the many read paths that tolerate it. requireCurrentTenantKey() is the
// strict sibling used specifically to stamp queue payloads: a contextless
// producer must fail loudly, never mint a payload that looks valid but names
// the wrong tenant. These tests use the REAL context implementation (not
// mocked) so a regression that swaps requireCurrentTenantKey() back to the
// lenient accessor at a producer call site would make the first test fail.

describe("Producer tenant resolution cannot silently synthesize a default tenant", () => {
  const { requireTenantKeyFromContext, runWithTenantContext } = require("../common/tenant/tenant-context");

  function makeDeltaSyncServiceWithRealTenantAccessor(candidates: Array<{ product_id: string; version: number; category_id: string }>) {
    const marketplaceExportJob = {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: `job-${data.productId as string}` }),
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([
        { id: "inst_1", connectorId: "conn_1", tenantKey: "tenant1", connectorSlug: "shopify", capabilities: ["PUBLISH"] },
      ]),
      $queryRawUnsafe: jest.fn().mockResolvedValue(candidates), // RLS-BYPASS: manual tenant filter
      marketplaceExportJob,
    };
    const prisma = { tenant: jest.fn().mockReturnValue(db) };
    const connectorFramework = {
      // Real implementations, not hardcoded strings — genuinely exercises
      // "is there an established context" rather than asserting it.
      getCurrentTenantKey: jest.fn(() => require("../common/tenant/tenant-context").getTenantKeyFromContext()),
      requireCurrentTenantKey: jest.fn(() => requireTenantKeyFromContext()),
    };
    const queueService = { enqueue: jest.fn().mockResolvedValue(undefined), isJobPresent: jest.fn().mockResolvedValue(false) };
    const svc = new MarketplaceService(
      prisma as never,
      connectorFramework as never,
      {} as never,
      {} as never,
      queueService as never,
      {} as never,
      {} as never,
      {} as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      {} as never,
      { fromRows: jest.fn().mockReturnValue([]), findDefault: jest.fn().mockReturnValue(undefined) } as never,
      {} as never,
    );
    return { svc, queueService, marketplaceExportJob };
  }

  it("never enqueues (and is honestly counted as skipped, not queued) when invoked with no tenant context at all", async () => {
    const { svc, queueService, marketplaceExportJob } = makeDeltaSyncServiceWithRealTenantAccessor([
      { product_id: "p1", version: 2, category_id: "cat1" },
    ]);

    // Deliberately NOT wrapped in runWithTenantContext — simulates a future
    // caller that forgets to establish one before reaching a producer.
    // queueDeltaSync's per-item Promise.allSettled absorbs the resulting throw
    // as a skip rather than failing the whole batch — the invariant this test
    // actually enforces is narrower and non-negotiable: the enqueue call itself
    // must never happen, and never with a fabricated tenantKey="default".
    const result = await svc.queueDeltaSync("inst_1");

    expect(result).toEqual({ queued: 0, skipped: 1 });
    expect(marketplaceExportJob.create).toHaveBeenCalled();
    expect(queueService.enqueue).not.toHaveBeenCalled();
  });

  it("requeueExportJob rejects outright (no Promise.allSettled to absorb it) when invoked with no tenant context", async () => {
    // Unlike queueDeltaSync's bulk loop, requeueExportJob is a single direct
    // call — a missing tenant context here must surface as a genuine failure
    // to the caller, not be silently swallowed.
    const exportJobDb = {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue({ id: "job-1", retryCount: 0, status: "queued", channel: "shopify" }),
    };
    const prisma = { tenant: jest.fn().mockReturnValue({ marketplaceExportJob: exportJobDb }) };
    const connectorFramework = {
      getCurrentTenantKey: jest.fn(() => require("../common/tenant/tenant-context").getTenantKeyFromContext()),
      requireCurrentTenantKey: jest.fn(() => requireTenantKeyFromContext()),
    };
    const queueService = { enqueue: jest.fn().mockResolvedValue(undefined), isJobPresent: jest.fn().mockResolvedValue(false) };
    const svc = new MarketplaceService(
      prisma as never,
      connectorFramework as never,
      {} as never,
      {} as never,
      queueService as never,
      {} as never,
      {} as never,
      {} as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      {} as never,
      { fromRows: jest.fn().mockReturnValue([]), findDefault: jest.fn().mockReturnValue(undefined) } as never,
      {} as never,
    );

    await expect(svc.requeueExportJob("job-1")).rejects.toThrow(/tenant context/i);
    expect(queueService.enqueue).not.toHaveBeenCalled();
  });

  it("still works correctly when a real, explicit tenant context happens to be named 'default'", async () => {
    // The distinction that matters: "no context" (must fail) vs. "a context
    // that happens to hold the literal string default" (must succeed exactly
    // like any other tenant name) — these are not the same thing.
    const { svc, queueService } = makeDeltaSyncServiceWithRealTenantAccessor([
      { product_id: "p1", version: 2, category_id: "cat1" },
    ]);

    const result = await runWithTenantContext("default", () => svc.queueDeltaSync("inst_1"));

    expect(result).toEqual({ queued: 1, skipped: 0 });
    expect(queueService.enqueue).toHaveBeenCalledWith(
      "connector-submission",
      { jobId: "job-p1", connectorSlug: "shopify", tenantKey: "default" },
      { jobId: "job-p1_0" },
    );
  });
});
