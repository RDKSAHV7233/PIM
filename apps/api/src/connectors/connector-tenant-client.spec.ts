// SEC-DB-RLS-001 M1b: every migrated connector must reach the database for ITS tenant through prisma.tenant(<tenant>) and never
// through the context-free direct client once the tenant client is injected.
//
// Existing connector specs build the connectors without the tenant client, so they run the old fallback path and cannot see this.
// Each case below injects a tenant client, calls the connector's own credential/metadata helpers with a non-default tenant, and
// asserts (1) the direct client was never touched, (2) every tenant client requested was the one for that tenant, and (3) at least
// one helper really ran (a case that exercises nothing must fail, not pass).

import { AmazonConnector } from "./amazon/amazon.connector";
import { BigCommerceConnector } from "./bigcommerce/bigcommerce.connector";
import { Dynamics365Connector } from "./dynamics365/dynamics365.connector";
import { EbayConnector } from "./ebay/ebay.connector";
import { EtsyConnector } from "./etsy/etsy.connector";
import { FlipkartConnector } from "./flipkart/flipkart.connector";
import { MyntraConnector } from "./myntra/myntra.connector";
import { OdooConnector } from "./odoo/odoo.connector";
import { PrestaShopConnector } from "./prestashop/prestashop.connector";
import { ShopifyConnector } from "./shopify/shopify.connector";
import { ShopwareConnector } from "./shopware/shopware.connector";
import { WooCommerceConnector } from "./woocommerce/woocommerce.connector";
import { ZohoInventoryConnector } from "./zoho-inventory/zoho-inventory.connector";

const ENV = {
  CREDENTIAL_ENCRYPTION_KEY_V1: "pim1-test-encryption-key-v1-minimum-32",
  CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION: "1",
};

const TENANT = "tenant-rls-m1b";
const ctx = { tenantId: TENANT, installationId: "inst-1", slug: "x" } as never;

/** A client whose every model method resolves to nothing, and whose raw and transaction calls work. */
function makeClient(): any {
  const client: any = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === "$transaction") {
          return (fn: (tx: unknown) => unknown) => fn(client);
        }
        if (prop.startsWith("$")) {
          return jest.fn().mockResolvedValue([]);
        }
        return new Proxy({}, { get: () => jest.fn().mockResolvedValue(null) });
      },
    },
  );
  return client;
}

type Case = { name: string; build: (direct: unknown, logger: unknown, prisma: unknown) => unknown; calls: Array<[string, unknown[]]> };

const credentialCalls: Array<[string, unknown[]]> = [
  ["getPlainCredential", [ctx, "access_token"]],
  ["getCredentialRow", [ctx, "access_token"]],
  ["noteCredentialHealth", [ctx, null]],
  ["noteCredentialWarning", [ctx, "warning"]],
  ["storeCredential", [ctx, "access_token", "plain-value", null]],
  ["invalidateAccessToken", [ctx]],
  ["fetchCredentialPlaintext", [TENANT, "inst-1", "access_token"]],
];

const CASES: Case[] = [
  { name: "Amazon", build: (d, l, p) => new (AmazonConnector as any)(d, l, p), calls: credentialCalls },
  { name: "BigCommerce", build: (d, l, p) => new (BigCommerceConnector as any)(d, l, p), calls: credentialCalls },
  { name: "Dynamics365", build: (d, l, p) => new (Dynamics365Connector as any)(d, l, p), calls: credentialCalls },
  { name: "eBay", build: (d, l, p) => new (EbayConnector as any)(d, l, p), calls: credentialCalls },
  { name: "Etsy", build: (d, l, p) => new (EtsyConnector as any)(d, l, p), calls: credentialCalls },
  { name: "Flipkart", build: (d, l, p) => new (FlipkartConnector as any)(d, l, p), calls: credentialCalls },
  { name: "Myntra", build: (d, l, p) => new (MyntraConnector as any)(d, l, p), calls: credentialCalls },
  { name: "Odoo", build: (d, l, p) => new (OdooConnector as any)(d, l, undefined, p), calls: credentialCalls },
  { name: "PrestaShop", build: (d, l, p) => new (PrestaShopConnector as any)(d, l, p), calls: credentialCalls },
  {
    name: "Shopify",
    build: (d, l, p) => new (ShopifyConnector as any)(d, l, { resolveAdminApiVersion: () => "2026-01" }, p),
    calls: [
      ["getCredentialRow", [ctx, "access_token"]],
      ["noteCredentialHealth", [ctx, null]],
      ["expireAccessToken", [ctx]],
      ["getInstallationMetadata", [ctx]],
    ],
  },
  { name: "Shopware", build: (d, l, p) => new (ShopwareConnector as any)(d, l, p), calls: credentialCalls },
  {
    name: "WooCommerce",
    build: (d, l, p) => new (WooCommerceConnector as any)(d, l, undefined, p),
    calls: [
      ...credentialCalls,
      ["checkWebhookHealth", [TENANT, "inst-1"]],
      ["loadRecentSubmissionSummary", [TENANT, "inst-1"]],
    ],
  },
  { name: "ZohoInventory", build: (d, l, p) => new (ZohoInventoryConnector as any)(d, l, p), calls: credentialCalls },
];

describe("connectors reach the database through the tenant client (SEC-DB-RLS-001 M1b)", () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv, ...ENV };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it.each(CASES.map((c) => [c.name, c] as const))("%s: only prisma.tenant(<its tenant>), never the direct client", async (_name, c) => {
    const directGetClient = jest.fn().mockImplementation(() => {
      throw new Error("the direct client must not be used once the tenant client is injected");
    });
    const prisma = { tenant: jest.fn().mockImplementation(() => makeClient()) };
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const connector: any = c.build({ getClient: directGetClient }, logger, prisma);

    let exercised = 0;
    for (const [method, args] of c.calls) {
      if (typeof connector[method] !== "function") {
        continue;
      }
      exercised += 1;
      await Promise.resolve()
        .then(() => connector[method](...args))
        .catch((error: unknown) => {
          // A helper may legitimately fail on the empty stub (nothing stored, nothing to decrypt); the direct client may not be why.
          expect(String((error as Error)?.message ?? error)).not.toMatch(/direct client must not be used/);
        });
    }

    expect(exercised).toBeGreaterThan(0);
    expect(directGetClient).not.toHaveBeenCalled();
    expect(prisma.tenant).toHaveBeenCalled();
    for (const [tenant] of prisma.tenant.mock.calls) {
      expect(tenant).toBe(TENANT);
    }
  });

  it("refuses to run a database call for a blank tenant instead of using the default tenant", async () => {
    const prisma = { tenant: jest.fn().mockImplementation(() => makeClient()) };
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const connector: any = new (FlipkartConnector as any)({ getClient: jest.fn() }, logger, prisma);
    await expect(connector.getCredentialRow({ tenantId: "", installationId: "inst-1" }, "access_token")).rejects.toThrow(/requires a tenant/);
    expect(prisma.tenant).not.toHaveBeenCalled();
  });
});
