import { BadRequestException, NotFoundException } from "@nestjs/common";
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
        $queryRawUnsafe: jest.fn().mockResolvedValue(rows),
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
