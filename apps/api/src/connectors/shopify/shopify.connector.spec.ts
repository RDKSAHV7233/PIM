// apps/api/src/connectors/shopify/shopify.connector.spec.ts
// Coverage: webhook signature verification, parseWebhookEvent, normaliseError,
//           validateProduct (local rules), refreshAccessToken flow.

import { createHmac } from "node:crypto";
import { ShopifyConnector } from "./shopify.connector";
import { ShopifyApiClient } from "./shopify-api-client.service";
import { ConnectorContext, ProductPayload } from "../../connector-framework/connector.interface";

// ─── helpers ──────────────────────────────────────────────────────────────────

const TEST_CLIENT_SECRET = "test-shopify-client-secret-32bytes!!";
const TEST_CLIENT_ID = "test-shopify-client-id";
const TEST_KEY = "a".repeat(64); // 64 hex chars = 32 bytes

function makeConnector(): ShopifyConnector {
  process.env.CREDENTIAL_ENCRYPTION_KEY_V1 = TEST_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION = "1";
  process.env.PIM_SHOPIFY_CLIENT_SECRET = TEST_CLIENT_SECRET;
  process.env.PIM_SHOPIFY_CLIENT_ID = TEST_CLIENT_ID;

  // getClient must return the same object on every call — otherwise
  // tests that do db = getClient() then mock db.fn won't affect the connector
  const mockDbClient = {
    connectorCredential: {
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({}),
    },
    connectorInstallation: {
      findFirst: jest.fn().mockResolvedValue({ metadata: {} }),
    },
    $queryRawUnsafe: jest.fn().mockResolvedValue([]), // RLS-BYPASS: manual tenant filter — test mock
    $executeRawUnsafe: jest.fn().mockResolvedValue(1), // RLS-BYPASS: manual tenant filter — test mock
  };
  const prismaDirect = {
    getClient: () => mockDbClient,
  } as any;

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as any;

  // ShopifyApiClient handles graphqlRequest, exchangeToken, URL helpers.
  // Most tests exercise credential/webhook/validation paths that don't call apiClient,
  // so a minimal mock is sufficient. Tests that exercise graphqlRequest paths
  // will need to configure apiClient.graphqlRequest or apiClient.exchangeToken.
  const apiClient = new ShopifyApiClient(logger);

  return new ShopifyConnector(prismaDirect, logger, apiClient);
}

function makeCtx(overrides: Partial<ConnectorContext> = {}): ConnectorContext {
  return {
    tenantId: "tenant-1",
    installationId: "install-1",
    connectorId: "conn-1",
    getAccessToken: jest.fn().mockResolvedValue("mock-access-token"),
    fetch: jest.fn(),
    ...overrides,
  };
}

function signWebhookBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(Buffer.from(body, "utf8")).digest("base64");
}

// ─── parseWebhookEvent ─────────────────────────────────────────────────────────

describe("ShopifyConnector.parseWebhookEvent", () => {
  let connector: ShopifyConnector;

  beforeEach(() => {
    connector = makeConnector();
  });

  it("returns null when HMAC header is missing", async () => {
    const body = Buffer.from(JSON.stringify({ id: "gid://shopify/Product/123" }));
    const result = await connector.parseWebhookEvent(body, {
      "x-shopify-topic": "products/update",
      "x-shopify-webhook-id": "evt-001",
    });
    expect(result).toBeNull();
  });

  it("returns null when HMAC signature is tampered", async () => {
    const bodyStr = JSON.stringify({ id: "gid://shopify/Product/123" });
    const body = Buffer.from(bodyStr);
    const result = await connector.parseWebhookEvent(body, {
      "x-shopify-hmac-sha256": "dGFtcGVyZWQ=", // base64 of "tampered"
      "x-shopify-topic": "products/update",
      "x-shopify-webhook-id": "evt-001",
    });
    expect(result).toBeNull();
  });

  it("returns null when topic header is missing", async () => {
    const bodyStr = JSON.stringify({ id: "gid://shopify/Product/123" });
    const body = Buffer.from(bodyStr);
    const sig = signWebhookBody(bodyStr, TEST_CLIENT_SECRET);
    const result = await connector.parseWebhookEvent(body, {
      "x-shopify-hmac-sha256": sig,
      "x-shopify-webhook-id": "evt-001",
      // topic intentionally omitted
    });
    expect(result).toBeNull();
  });

  it("returns null when webhook ID header is missing", async () => {
    const bodyStr = JSON.stringify({ id: "gid://shopify/Product/123" });
    const body = Buffer.from(bodyStr);
    const sig = signWebhookBody(bodyStr, TEST_CLIENT_SECRET);
    const result = await connector.parseWebhookEvent(body, {
      "x-shopify-hmac-sha256": sig,
      "x-shopify-topic": "products/update",
      // webhook ID intentionally omitted
    });
    expect(result).toBeNull();
  });

  it("accepts a valid products/update webhook and returns parsed event", async () => {
    const bodyStr = JSON.stringify({
      id: "gid://shopify/Product/456",
      variants: [{ sku: "TEST-SKU-01" }],
    });
    const body = Buffer.from(bodyStr);
    const sig = signWebhookBody(bodyStr, TEST_CLIENT_SECRET);

    const result = await connector.parseWebhookEvent(body, {
      "x-shopify-hmac-sha256": sig,
      "x-shopify-topic": "products/update",
      "x-shopify-webhook-id": "evt-abc-123",
    });

    expect(result).not.toBeNull();
    expect(result!.eventType).toBe("products/update");
    expect(result!.rawEventId).toBe("evt-abc-123");
    expect(Array.isArray(result!.channelErrors)).toBe(true);
  });

  it("accepts a products/delete webhook", async () => {
    const bodyStr = JSON.stringify({ id: "gid://shopify/Product/789" });
    const body = Buffer.from(bodyStr);
    const sig = signWebhookBody(bodyStr, TEST_CLIENT_SECRET);

    const result = await connector.parseWebhookEvent(body, {
      "x-shopify-hmac-sha256": sig,
      "x-shopify-topic": "products/delete",
      "x-shopify-webhook-id": "evt-del-001",
    });

    expect(result).not.toBeNull();
    expect(result!.eventType).toBe("products/delete");
  });

  it("falls back to x-shopify-event-id when x-shopify-webhook-id is absent", async () => {
    const bodyStr = JSON.stringify({ id: "gid://shopify/Product/999" });
    const body = Buffer.from(bodyStr);
    const sig = signWebhookBody(bodyStr, TEST_CLIENT_SECRET);

    const result = await connector.parseWebhookEvent(body, {
      "x-shopify-hmac-sha256": sig,
      "x-shopify-topic": "products/update",
      "x-shopify-event-id": "fallback-event-id",
    });

    expect(result).not.toBeNull();
    expect(result!.rawEventId).toBe("fallback-event-id");
  });
});

// ─── normaliseError ────────────────────────────────────────────────────────────

describe("ShopifyConnector.normaliseError", () => {
  let connector: ShopifyConnector;

  beforeEach(() => {
    connector = makeConnector();
  });

  it("returns a ConnectorIssue with code, fieldPath, severity, sellerMessage", () => {
    const issue = connector.normaliseError("SOME_CODE", "Raw channel message");
    expect(issue).toMatchObject({
      code: expect.any(String),
      fieldPath: expect.any(String),
      severity: expect.stringMatching(/^error|warning$/),
      sellerMessage: expect.any(String),
    });
  });

  it("never returns an empty sellerMessage", () => {
    const issue = connector.normaliseError("UNKNOWN_CODE", "");
    expect(issue.sellerMessage.length).toBeGreaterThan(0);
  });

  it("handles empty code without throwing", () => {
    expect(() => connector.normaliseError("", "some message")).not.toThrow();
  });
});

// ─── validateProduct (local rules) ────────────────────────────────────────────

describe("ShopifyConnector.validateProduct — local rules", () => {
  let connector: ShopifyConnector;
  const ctx = makeCtx();

  const BASE: ProductPayload = {
    sku: "SHOPIFY-TEST-001",
    title: "Organic Cotton T-Shirt",
    description: "100% organic cotton, breathable and comfortable.",
    brand: "TestBrand",
    hsnCode: "61091000",
    gstRate: 5,
    mrp: 1299,
    sellingPrice: 999,
    mainImageUrl: "https://cdn.example.com/tshirt.jpg",
    attributes: { color: "White", size: "M" },
    productType: "SHIRT",
  };

  beforeEach(() => {
    connector = makeConnector();
  });

  it("returns isValid:true and source:LOCAL_RULES for a well-formed product", async () => {
    const result = await connector.validateProduct(ctx, BASE);
    expect(result.source).toBe("LOCAL_RULES");
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns an error when title is missing", async () => {
    const result = await connector.validateProduct(ctx, { ...BASE, title: "" });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.fieldPath.includes("title"))).toBe(true);
  });

  it("returns an error when mainImageUrl is missing", async () => {
    const result = await connector.validateProduct(ctx, { ...BASE, mainImageUrl: "" });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.fieldPath.includes("image") || e.fieldPath.includes("mainImage"))).toBe(true);
  });

  it("returns an error when description is empty", async () => {
    const result = await connector.validateProduct(ctx, { ...BASE, description: "" });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) =>
      e.fieldPath.includes("description")
    )).toBe(true);
  });

  it("returns errors array as empty array (not undefined) on a valid product", async () => {
    const result = await connector.validateProduct(ctx, BASE);
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("emits HS_CODE_MISSING warning when taxCodes has no HS/commodity code", async () => {
    const result = await connector.validateProduct(ctx, BASE); // BASE has no taxCodes
    const hsWarning = result.warnings.find((w) => w.code === "HS_CODE_MISSING");
    expect(hsWarning).toBeDefined();
    expect(hsWarning!.severity).toBe("warning");
    expect(hsWarning!.fieldPath).toBe("taxCodes");
  });

  it("does NOT emit HS_CODE_MISSING when AE HS_CODE is set", async () => {
    const result = await connector.validateProduct(ctx, {
      ...BASE,
      taxCodes: [{ regimeKey: "AE", key: "HS_CODE", value: "620442" }],
    });
    expect(result.warnings.find((w) => w.code === "HS_CODE_MISSING")).toBeUndefined();
  });

  it("does NOT emit HS_CODE_MISSING when GB COMMODITY_CODE is set", async () => {
    const result = await connector.validateProduct(ctx, {
      ...BASE,
      taxCodes: [{ regimeKey: "GB", key: "COMMODITY_CODE", value: "6204420000" }],
    });
    expect(result.warnings.find((w) => w.code === "HS_CODE_MISSING")).toBeUndefined();
  });

  it("does NOT emit HS_CODE_MISSING when AU COMMODITY_CODE is set", async () => {
    const result = await connector.validateProduct(ctx, {
      ...BASE,
      taxCodes: [{ regimeKey: "AU", key: "COMMODITY_CODE", value: "62044200" }],
    });
    expect(result.warnings.find((w) => w.code === "HS_CODE_MISSING")).toBeUndefined();
  });
});

// ─── harmonizedSystemCode resolution ─────────────────────────────────────────

describe("ShopifyConnector — harmonizedSystemCode resolution", () => {
  let connector: ShopifyConnector;

  beforeEach(() => {
    connector = makeConnector();
  });

  const BASE_PAYLOAD: ProductPayload = {
    sku: "X", title: "T", description: "D",
    brand: "B", hsnCode: "", attributes: {}, productType: "SHIRT",
    mainImageUrl: "https://img.example.com/x.jpg",
    mrp: 100, sellingPrice: 80, gstRate: 0,
  };

  it("resolves AE HS_CODE with highest priority", () => {
    const product: ProductPayload = {
      ...BASE_PAYLOAD,
      taxCodes: [
        { regimeKey: "AE", key: "HS_CODE", value: "620442" },
        { regimeKey: "GB", key: "COMMODITY_CODE", value: "6204420000" },
        { regimeKey: "AU", key: "COMMODITY_CODE", value: "62044200" },
      ],
    };
    const code = (connector as any).resolveHarmonizedSystemCode(product);
    expect(code).toBe("620442"); // AE wins
  });

  it("falls back to GB COMMODITY_CODE when AE is absent", () => {
    const product: ProductPayload = {
      ...BASE_PAYLOAD,
      taxCodes: [
        { regimeKey: "GB", key: "COMMODITY_CODE", value: "6204420000" },
        { regimeKey: "AU", key: "COMMODITY_CODE", value: "62044200" },
      ],
    };
    const code = (connector as any).resolveHarmonizedSystemCode(product);
    expect(code).toBe("6204420000"); // GB fallback
  });

  it("falls back to AU COMMODITY_CODE as last resort", () => {
    const product: ProductPayload = {
      ...BASE_PAYLOAD,
      taxCodes: [{ regimeKey: "AU", key: "COMMODITY_CODE", value: "62044200" }],
    };
    const code = (connector as any).resolveHarmonizedSystemCode(product);
    expect(code).toBe("62044200");
  });

  it("returns undefined when no HS/commodity code is present", () => {
    const product: ProductPayload = {
      ...BASE_PAYLOAD,
      gstRate: 5,
      taxCodes: [{ regimeKey: "IN", key: "HSN_CODE", value: "61091000", rate: 5 }],
    };
    const code = (connector as any).resolveHarmonizedSystemCode(product);
    expect(code).toBeUndefined();
  });

  it("returns undefined when taxCodes is absent", () => {
    const product: ProductPayload = { ...BASE_PAYLOAD, gstRate: 5 };
    const code = (connector as any).resolveHarmonizedSystemCode(product);
    expect(code).toBeUndefined();
  });
});

// ─── refreshAccessToken ────────────────────────────────────────────────────────

describe("ShopifyConnector.refreshAccessToken", () => {
  async function buildEncryptedRow(value: string) {
    const { encryptCredentialValue, loadCredentialEncryptionKeys, resolveCurrentCredentialKeyVersion } =
      await import("../../connector-installer/credential-encryption.util");
    const keys = loadCredentialEncryptionKeys(process.env);
    const ver = resolveCurrentCredentialKeyVersion(process.env);
    const cipher = encryptCredentialValue(value, keys.get(ver)!, ver);
    return { encryptedValue: cipher, keyVersion: "v1", status: "ACTIVE", expiresAt: null, failureReason: null };
  }

  it("calls exchangeToken and returns access_token on success", async () => {
    const connector = makeConnector();
    const db = (connector as any).prismaDirect.getClient();

    // RLS-BYPASS: manual tenant filter — test mock, no real DB access
    db.$queryRawUnsafe.mockImplementation(async (sql: string, ...params: string[]) => {
      // connector_credentials query: params = [tenantKey, installationId, credentialType]
      if (sql.includes("connector_credentials")) {
        const credentialType = params[2];
        if (credentialType === "refresh_token") return [await buildEncryptedRow("old-refresh-token")];
        if (credentialType === "shop_domain") return [await buildEncryptedRow("test-store.myshopify.com")];
        return [];
      }
      // connector_installations query: return metadata with shopId so fetchShopIdentity is skipped
      if (sql.includes("connector_installations")) {
        return [{ metadata: { shopId: "gid://shopify/Shop/1", shopName: "Test Store" } }];
      }
      return [];
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: "new-access-token-xyz", expires_in: 3600 }),
    } as any);

    const ctx = makeCtx();
    const token = await connector.refreshAccessToken(ctx);

    expect(token).toBe("new-access-token-xyz");
    // RLS-BYPASS: manual tenant filter — test mock assertion
    expect(db.$executeRawUnsafe).toHaveBeenCalled();
  });

  it("throws when token exchange response has no access_token", async () => {
    const connector = makeConnector();
    const db = (connector as any).prismaDirect.getClient();

    // RLS-BYPASS: manual tenant filter — test mock, no real DB access
    db.$queryRawUnsafe.mockImplementation(async (sql: string, ...params: string[]) => {
      if (sql.includes("connector_credentials")) {
        const credentialType = params[2];
        const value = credentialType === "shop_domain" ? "test-store.myshopify.com" : "refresh-token-value";
        return [await buildEncryptedRow(value)];
      }
      if (sql.includes("connector_installations")) {
        return [{ metadata: { shopId: "gid://shopify/Shop/1" } }];
      }
      return [];
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({}), // no access_token
    } as any);

    const ctx = makeCtx();
    await expect(connector.refreshAccessToken(ctx)).rejects.toThrow(/access_token/i);
  });
});
