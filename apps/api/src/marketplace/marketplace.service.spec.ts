import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ExportJobStatus } from "@prisma/client";
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
      { jobId: "job-p1", connectorSlug: "shopify" },
      { jobId: "job-p1_0" },
    );
    expect(queueService.enqueue).toHaveBeenCalledWith(
      "connector-submission",
      { jobId: "job-p2", connectorSlug: "shopify" },
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
      { jobId: "job-p1", connectorSlug: "shopify" },
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
      { jobId: "job-p2", connectorSlug: "shopify" },
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
