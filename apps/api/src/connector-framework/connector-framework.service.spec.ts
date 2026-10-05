// apps/api/src/connector-framework/connector-framework.service.spec.ts
//
// Unit tests for ConnectorFrameworkService.exportProducts()
//
// The method has three distinct paths:
//   (a) Installation lacks EXCEL_EXPORT capability → CapabilityNotSupportedError
//   (b) Connector registered but generateExportFile not implemented → CapabilityNotSupportedError
//   (c) Happy path → delegates to connector.generateExportFile, returns ExportFile

import { ConnectorFrameworkService } from "./connector-framework.service";
import { CapabilityNotSupportedError } from "./connector.errors";
import type { ConnectorInstallationRecord } from "./connector.types";
import type { ExportFile, ProductPayload, SubmissionRef } from "./connector.interface";

// ─── minimal stub factories ────────────────────────────────────────────────────

function makeInstallation(overrides: Partial<ConnectorInstallationRecord> = {}): ConnectorInstallationRecord {
  return {
    id: "inst_1",
    slug: "meesho",
    connectorId: "conn_1",
    tenantKey: "tenant1",
    externalAccountRef: null,
    accountAlias: "default",
    status: "ACTIVE",
    capabilities: ["VALIDATE", "EXCEL_EXPORT"],
    metadata: {},
    installedAt: new Date("2026-01-01"),
    launchStage: "manual",
    launchNote: null,
    implementationStatus: "partial",
    ...overrides,
  } as ConnectorInstallationRecord;
}

const FAKE_EXPORT: ExportFile = {
  buffer: Buffer.from("xlsx_content"),
  filename: "meesho_kurtis_20260528.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const FAKE_PRODUCTS: ProductPayload[] = [
  { sku: "SKU-001", title: "Test Kurti", mrp: 999, sellingPrice: 799, productType: "kurtis" } as ProductPayload,
];

// ─── service factory ──────────────────────────────────────────────────────────

function makeService(connectorOverrides: Record<string, unknown> = {}) {
  const defaultConnector = {
    slug: "meesho",
    generateExportFile: jest.fn().mockResolvedValue(FAKE_EXPORT),
    ...connectorOverrides,
  };

  const registry = {
    getConnector: jest.fn().mockReturnValue(defaultConnector),
  };

  // ConnectorFrameworkService has many constructor dependencies; cast to never
  // and override only the registry (the only dep used by exportProducts).
  const svc = new ConnectorFrameworkService(
    {} as never, // prisma
    registry as never,
    {} as never, // logger
    {} as never, // credentialService
    {} as never, // httpClient
    {} as never, // snapshotStorage
  );

  return { svc, registry, connector: defaultConnector };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe("ConnectorFrameworkService.exportProducts", () => {
  it("throws CapabilityNotSupportedError when installation lacks EXCEL_EXPORT", async () => {
    const { svc } = makeService();
    const installation = makeInstallation({ capabilities: ["VALIDATE"] }); // no EXCEL_EXPORT

    await expect(svc.exportProducts(installation, FAKE_PRODUCTS))
      .rejects
      .toThrow(CapabilityNotSupportedError);
  });

  it("error message identifies the connector slug when capability missing", async () => {
    const { svc } = makeService();
    const installation = makeInstallation({ capabilities: [] });

    await expect(svc.exportProducts(installation, FAKE_PRODUCTS))
      .rejects
      .toThrow(/meesho/i);
  });

  it("throws CapabilityNotSupportedError when connector has no generateExportFile method", async () => {
    // Connector is registered but does not implement generateExportFile
    const { svc } = makeService({ generateExportFile: undefined });
    const installation = makeInstallation(); // has EXCEL_EXPORT

    await expect(svc.exportProducts(installation, FAKE_PRODUCTS))
      .rejects
      .toThrow(CapabilityNotSupportedError);
  });

  it("delegates to connector.generateExportFile on the happy path", async () => {
    const { svc, connector } = makeService();
    const installation = makeInstallation();

    const result = await svc.exportProducts(installation, FAKE_PRODUCTS);

    expect(connector.generateExportFile).toHaveBeenCalledTimes(1);
    expect(result).toEqual(FAKE_EXPORT);
  });

  it("passes a context object and the products array to generateExportFile", async () => {
    const { svc, connector } = makeService();
    const installation = makeInstallation();

    await svc.exportProducts(installation, FAKE_PRODUCTS);

    const [ctx, products] = connector.generateExportFile.mock.calls[0] as [unknown, unknown];
    expect(products).toEqual(FAKE_PRODUCTS);
    expect(ctx).toMatchObject({ tenantId: installation.tenantKey, installationId: installation.id });
  });

  it("returns the ExportFile returned by the connector verbatim", async () => {
    const customExport: ExportFile = {
      buffer: Buffer.from("custom"),
      filename: "custom_export.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
    const { svc } = makeService({ generateExportFile: jest.fn().mockResolvedValue(customExport) });
    const installation = makeInstallation();

    const result = await svc.exportProducts(installation, FAKE_PRODUCTS);
    expect(result).toBe(customExport); // reference equality — no copy
  });
});

// ConnectorInstallation.lastSyncAt is read on every connector card in apps/web
// (/channels/connectors: "Last synced" / "No sync recorded yet"), but nothing
// anywhere in the codebase ever wrote it before touchLastSyncAt() — confirmed
// live (Shopify/WooCommerce cards read "No sync recorded yet" despite real
// publish traffic) and by grepping the whole apps/api/src tree for other writers.
describe("ConnectorFrameworkService.publish/update — touches ConnectorInstallation.lastSyncAt", () => {
  const FAKE_SUBMISSION: SubmissionRef = { externalRef: "ext-1", status: "SUCCESS", isAsync: false };

  function makeServiceWithPrisma(connectorOverrides: Record<string, unknown> = {}) {
    const updateSpy = jest.fn().mockResolvedValue({});
    const connectorInstallation = { update: updateSpy };
    const tenantClient = { connectorInstallation };
    const prisma = { tenant: jest.fn().mockReturnValue(tenantClient) };
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() };

    const defaultConnector = {
      slug: "shopify",
      publishProduct: jest.fn().mockResolvedValue(FAKE_SUBMISSION),
      updateProduct: jest.fn().mockResolvedValue(FAKE_SUBMISSION),
      ...connectorOverrides,
    };
    const registry = { getConnector: jest.fn().mockReturnValue(defaultConnector) };

    const svc = new ConnectorFrameworkService(
      prisma as never,
      registry as never,
      logger as never,
      {} as never, // credentialService
      {} as never, // httpClient
      {} as never, // snapshotStorage
    );

    return { svc, connector: defaultConnector, prisma, updateSpy, logger };
  }

  it("publish() success updates lastSyncAt on the tenant-scoped installation row", async () => {
    const { svc, updateSpy, prisma } = makeServiceWithPrisma();
    const installation = makeInstallation({ capabilities: ["PUBLISH"], slug: "shopify" });

    const result = await svc.publish(installation, FAKE_PRODUCTS[0]);

    expect(result).toEqual(FAKE_SUBMISSION);
    // Wait a tick — touchLastSyncAt is deliberately fire-and-forget.
    await new Promise((resolve) => setImmediate(resolve));
    expect(prisma.tenant).toHaveBeenCalledWith(installation.tenantKey);
    expect(updateSpy).toHaveBeenCalledWith({
      where: { id: installation.id },
      data: { lastSyncAt: expect.any(Date) },
    });
  });

  it("update() success updates lastSyncAt the same way", async () => {
    const { svc, updateSpy } = makeServiceWithPrisma();
    const installation = makeInstallation({ capabilities: ["PUBLISH"], slug: "shopify" });

    await svc.update(installation, FAKE_PRODUCTS[0], "ext-1");
    await new Promise((resolve) => setImmediate(resolve));

    expect(updateSpy).toHaveBeenCalledWith({
      where: { id: installation.id },
      data: { lastSyncAt: expect.any(Date) },
    });
  });

  it("a failed lastSyncAt update does not affect publish()'s return value or throw", async () => {
    const { svc, updateSpy, logger } = makeServiceWithPrisma();
    updateSpy.mockRejectedValue(new Error("db unavailable"));
    const installation = makeInstallation({ capabilities: ["PUBLISH"], slug: "shopify" });

    const result = await svc.publish(installation, FAKE_PRODUCTS[0]);
    await new Promise((resolve) => setImmediate(resolve));

    expect(result).toEqual(FAKE_SUBMISSION);
    expect(logger.warn).toHaveBeenCalledWith(
      "connector.last_sync_at.update_failed",
      expect.objectContaining({ slug: "shopify" }),
    );
  });

  it("does not touch lastSyncAt when publishProduct itself throws", async () => {
    const { svc, updateSpy } = makeServiceWithPrisma({
      publishProduct: jest.fn().mockRejectedValue(new Error("marketplace rejected it")),
    });
    const installation = makeInstallation({ capabilities: ["PUBLISH"], slug: "shopify" });

    await expect(svc.publish(installation, FAKE_PRODUCTS[0])).rejects.toThrow("marketplace rejected it");
    await new Promise((resolve) => setImmediate(resolve));

    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe("ConnectorFrameworkService.getInstallation — exposes the heartbeat's validation facts", () => {
  function makeFindService(row: Record<string, unknown>) {
    const findFirst = jest.fn().mockResolvedValue(row);
    const tenant = {
      connectorDefinition: {
        findFirst: jest.fn().mockResolvedValue({ id: "def_1", slug: "woocommerce", displayName: "WooCommerce", capabilities: ["PUBLISH"] }),
      },
      connectorInstallation: { count: jest.fn().mockResolvedValue(1), findFirst },
      connectorCredential: { count: jest.fn().mockResolvedValue(0) },
    };
    const svc = new ConnectorFrameworkService(
      { tenant: () => tenant } as never,
      {} as never,
      { warn: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { svc, findFirst };
  }

  const baseRow = {
    id: "inst_1",
    tenantKey: "tenant1",
    connectorId: "def_1",
    accountAlias: "default",
    externalAccountRef: null,
    status: "ACTIVE",
    metadata: {},
    installedAt: new Date("2026-01-01"),
    installedBy: "user_1",
    lastSyncAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };

  it("selects the four validation columns and maps them to ISO strings", async () => {
    const { svc, findFirst } = makeFindService({
      ...baseRow,
      lastValidatedAt: new Date("2026-10-04T10:00:00Z"),
      lastValidationAttemptAt: new Date("2026-10-05T00:00:00Z"),
      lastValidationOutcome: "INDETERMINATE",
      lastValidationReason: "HTTP_503",
    });

    const record = await svc.getInstallation("tenant1", "woocommerce");

    expect(findFirst.mock.calls[0][0].select).toEqual(
      expect.objectContaining({
        lastValidatedAt: true,
        lastValidationAttemptAt: true,
        lastValidationOutcome: true,
        lastValidationReason: true,
      }),
    );
    expect(record?.validation).toEqual({
      lastValidatedAt: "2026-10-04T10:00:00.000Z",
      lastAttemptAt: "2026-10-05T00:00:00.000Z",
      outcome: "INDETERMINATE",
      reason: "HTTP_503",
    });
    expect(record?.status).toBe("ACTIVE");
  });

  it("reports all-null facts for an installation that has never been checked", async () => {
    const { svc } = makeFindService({
      ...baseRow,
      lastValidatedAt: null,
      lastValidationAttemptAt: null,
      lastValidationOutcome: null,
      lastValidationReason: null,
    });

    const record = await svc.getInstallation("tenant1", "woocommerce");

    expect(record?.validation).toEqual({ lastValidatedAt: null, lastAttemptAt: null, outcome: null, reason: null });
  });
});
