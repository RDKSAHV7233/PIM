import { ConnectorRegistry } from "./connector.registry";

// CTO review remediation (CODE-003): verifies the connector registry refuses to
// boot in staging/production when it would otherwise fall back to the safe
// connector set (empty/unmapped definitions, or DB discovery failure) — instead
// of silently degrading the connector catalogue like it used to everywhere.

describe("ConnectorRegistry — safe-fallback boot gating", () => {
  const ORIGINAL_ENV = { ...process.env };

  function fakeConnector(slug: string) {
    return { slug } as never;
  }

  function createRegistry(findManyImpl: () => Promise<Array<{ slug: string }>>) {
    const findMany = jest.fn(findManyImpl);
    const prisma = {
      tenant: jest.fn().mockReturnValue({ connectorDefinition: { findMany } }),
    };
    const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
    const registry = new ConnectorRegistry(
      prisma as never,
      logger as never,
      fakeConnector("amazon"),
      fakeConnector("dynamics-365"),
      fakeConnector("ebay"),
      fakeConnector("etsy"),
      fakeConnector("flipkart"),
      fakeConnector("meesho"),
      fakeConnector("myntra"),
      fakeConnector("nykaa"),
      fakeConnector("odoo"),
      fakeConnector("prestashop"),
      fakeConnector("shopify"),
      fakeConnector("woocommerce"),
    );
    return { registry, findMany, logger };
  }

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.CONNECTOR_SAFE_FALLBACK_SLUGS;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("throws in production when connector definitions are empty (would fall back)", async () => {
    process.env.APP_ENV = "production";
    const { registry } = createRegistry(async () => []);
    await expect(registry.onModuleInit()).rejects.toThrow(/fell back to the safe set/);
  });

  it("throws in staging when connector-definition discovery fails", async () => {
    process.env.APP_ENV = "staging";
    const { registry } = createRegistry(async () => {
      throw new Error("connection refused");
    });
    await expect(registry.onModuleInit()).rejects.toThrow(/fell back to the safe set/);
  });

  it("falls back silently in development when definitions are empty", async () => {
    process.env.APP_ENV = "development";
    const { registry } = createRegistry(async () => []);
    await expect(registry.onModuleInit()).resolves.toBeUndefined();
    expect(registry.listConnectors().map((c) => c.slug)).toEqual(["flipkart"]);
  });

  it("does not fall back or throw in production when definitions resolve normally", async () => {
    process.env.APP_ENV = "production";
    const { registry } = createRegistry(async () => [{ slug: "amazon" }, { slug: "flipkart" }]);
    await expect(registry.onModuleInit()).resolves.toBeUndefined();
    expect(registry.listConnectors().map((c) => c.slug).sort()).toEqual(["amazon", "flipkart"]);
  });
});
