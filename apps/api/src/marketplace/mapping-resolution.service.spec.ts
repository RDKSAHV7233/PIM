// apps/api/src/marketplace/mapping-resolution.service.spec.ts
//
// Parity tests for Story 2 of the Shopify shadow-sprint restart:
// MappingResolutionService.resolveForConnector("shopify", ...) must always
// return exactly what MarketplaceService.getEffectiveMapping("shopify", ...)
// already returns today, across every tier of that method's precedence
// (system pack fallback, saved legacy template, ConnectorMappingVersion
// bridge). Same tenant, same category, same mapping data -> legacy
// resolution and the Story 2 abstraction must agree.

import { MappingResolutionService } from "./mapping-resolution.service";
import { MarketplaceService } from "./marketplace.service";

function makeMarketplaceService(options: {
  channelMappingTemplate?: { findFirst?: unknown; findUnique?: unknown };
  connectorMappingResolved?: unknown;
} = {}) {
  const prisma = {
    tenant: jest.fn().mockReturnValue({
      channelMappingTemplate: {
        findUnique: jest.fn().mockResolvedValue(options.channelMappingTemplate?.findUnique ?? null),
        findFirst: jest.fn().mockResolvedValue(options.channelMappingTemplate?.findFirst ?? null),
      },
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

  const connectorMappingService = {
    resolveEffectiveMapping: jest.fn().mockResolvedValue(
      options.connectorMappingResolved ?? { resolvedMapping: { field_mappings: {} }, matchedVersions: [] },
    ),
  };

  const notificationsService = {};
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const accessPolicy = {};
  const priceResolution = {};
  const mediaStorage = {};

  const marketplaceService = new MarketplaceService(
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
    priceResolution as never,
    mediaStorage as never,
  );

  return { marketplaceService, mocks: { connectorMappingService } };
}

describe("MappingResolutionService.resolveForConnector — parity with MarketplaceService.getEffectiveMapping", () => {
  it("matches the legacy path exactly for the system_pack fallback tier (no template, no ConnectorMappingVersion)", async () => {
    const { marketplaceService } = makeMarketplaceService();
    const resolver = new MappingResolutionService(marketplaceService);

    const legacy = await marketplaceService.getEffectiveMapping("shopify", "cat1", undefined, null);
    const viaAbstraction = await resolver.resolveForConnector("shopify", "cat1", null);

    expect(viaAbstraction.requiredFields).toEqual(legacy.requiredFields);
    expect(viaAbstraction.fieldMap).toEqual(legacy.fieldMap);
    expect(viaAbstraction.source).toEqual(legacy.source);
    expect(legacy.source).toBe("system_pack");
  });

  it("matches the legacy path exactly for the connector_mapping_version bridge tier", async () => {
    const { marketplaceService } = makeMarketplaceService({
      connectorMappingResolved: {
        resolvedMapping: { field_mappings: { "attributes.mainImageUrl": "images.0.src" } },
        matchedVersions: [{ id: "v1" }],
      },
    });
    const resolver = new MappingResolutionService(marketplaceService);

    const legacy = await marketplaceService.getEffectiveMapping("shopify", "cat1", undefined, null);
    const viaAbstraction = await resolver.resolveForConnector("shopify", "cat1", null);

    expect(legacy.source).toBe("connector_mapping_version");
    expect(viaAbstraction.source).toBe("connector_mapping_version");
    expect(viaAbstraction.fieldMap).toEqual(legacy.fieldMap);
    expect(viaAbstraction.rawFieldMap).toEqual(legacy.rawFieldMap);
  });

  it("matches the legacy path exactly for the saved_template tier (legacy default channelMappingTemplate)", async () => {
    const { marketplaceService } = makeMarketplaceService({
      channelMappingTemplate: {
        findFirst: {
          id: "tmpl-1",
          name: "Default Shopify Template",
          requiredFields: ["title", "sku"],
          fieldMap: { title: "title" },
        },
      },
    });
    const resolver = new MappingResolutionService(marketplaceService);

    const legacy = await marketplaceService.getEffectiveMapping("shopify", "cat1", undefined, null);
    const viaAbstraction = await resolver.resolveForConnector("shopify", "cat1", null);

    expect(legacy.source).toBe("saved_template");
    expect(viaAbstraction.source).toBe("saved_template");
    expect(viaAbstraction.requiredFields).toEqual(legacy.requiredFields);
    expect(viaAbstraction.fieldMap).toEqual(legacy.fieldMap);
  });

  it("passes installationId through to the same ConnectorMappingVersion bridge call the legacy path makes", async () => {
    const { marketplaceService, mocks } = makeMarketplaceService();
    const resolver = new MappingResolutionService(marketplaceService);

    await resolver.resolveForConnector("shopify", "cat1", "inst-123");

    expect(mocks.connectorMappingService.resolveEffectiveMapping).toHaveBeenCalledWith(
      expect.objectContaining({ connectorSlug: "shopify", categoryScope: "cat1", installationId: "inst-123" }),
    );
  });

  it("throws for a connector slug with no marketplace channel mapping, instead of silently resolving nothing", async () => {
    const { marketplaceService } = makeMarketplaceService();
    const resolver = new MappingResolutionService(marketplaceService);

    await expect(resolver.resolveForConnector("not-a-real-connector", "cat1", null)).rejects.toThrow(
      /No marketplace channel mapping/,
    );
  });
});
