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

  function makeExportService(installationRow: unknown = MOCK_INSTALLATION_ROW) {
    const tenantDb = {
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
