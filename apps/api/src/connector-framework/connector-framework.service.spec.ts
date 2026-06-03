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
import type { ExportFile, ProductPayload } from "./connector.interface";

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
