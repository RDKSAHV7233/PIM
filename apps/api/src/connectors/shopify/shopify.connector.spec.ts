// apps/api/src/connectors/shopify/shopify.connector.spec.ts
// Coverage: webhook signature verification, parseWebhookEvent, normaliseError,
//           validateProduct (local rules), refreshAccessToken flow.

import { createHmac } from "node:crypto";
import { ShopifyConnector } from "./shopify.connector";
import { ShopifyApiClient, ShopifyApiHttpError } from "./shopify-api-client.service";
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
  const mockDbClient: any = {
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
    // persistTokenSet (issue #744) wraps credential writes in a real
    // transaction — the default mock just invokes the callback with itself,
    // so existing tests that indirectly call persistTokenSet keep working.
    $transaction: jest.fn((cb: any) => cb(mockDbClient)),
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

describe("ShopifyConnector.storeCredential tenant ownership (issue #738)", () => {
  it("includes the WHERE ownership guard on the ON CONFLICT upsert, scoped by tenant", async () => {
    const connector = makeConnector();
    const db = (connector as any).prismaDirect.getClient();
    const ctx = makeCtx({ tenantId: "tenant-a", installationId: "install-a" });

    // storeCredential now takes an explicit client (issue #744) so callers
    // can run it inside a shared transaction — pass db directly here since
    // this test targets storeCredential in isolation, not persistTokenSet.
    await (connector as any).storeCredential(db, ctx, "access_token", "shpat_live_token");

    expect(db.$executeRawUnsafe).toHaveBeenCalledTimes(1); // RLS-BYPASS: manual tenant filter — test mock
    const [sql, id, tenantKey, installationId] = db.$executeRawUnsafe.mock.calls[0]; // RLS-BYPASS: manual tenant filter — test mock
    expect(String(sql)).toContain("WHERE connector_credentials.tenant_key = EXCLUDED.tenant_key");
    expect(id).toBe("install-a:access_token");
    expect(tenantKey).toBe("tenant-a");
    expect(installationId).toBe("install-a");
  });

  it("rejects the write instead of silently overwriting a credential id already owned by a different tenant", async () => {
    // ON CONFLICT ... WHERE tenant_key = EXCLUDED.tenant_key returns 0 affected
    // rows when `id` collides with a row owned by a different tenant — this
    // must surface as a thrown error, not a silent successful resolve.
    const connector = makeConnector();
    const db = (connector as any).prismaDirect.getClient();
    db.$executeRawUnsafe.mockResolvedValue(0); // RLS-BYPASS: manual tenant filter — test mock
    const ctx = makeCtx({ tenantId: "tenant-a", installationId: "install-a" });

    await expect(
      (connector as any).storeCredential(db, ctx, "access_token", "shpat_live_token"),
    ).rejects.toThrow("already owned by a different tenant");
  });
});

describe("ShopifyConnector.persistTokenSet transaction wrapping (issue #744)", () => {
  it("runs all credential writes inside one transaction, sequentially, not via Promise.all", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("network unavailable")); // fetchShopMarket is best-effort/non-fatal
    const connector = makeConnector();
    const db = (connector as any).prismaDirect.getClient();
    db.$transaction = jest.fn((cb: any) => cb(db)); // RLS-BYPASS: manual tenant filter — test mock
    const ctx = makeCtx({ tenantId: "tenant-a", installationId: "install-a" });

    await (connector as any).persistTokenSet(ctx, {
      access_token: "shpat_live",
      refresh_token: "shprt_live",
      scope: "read_products",
      expires_in: 3600,
      refresh_token_expires_in: 7200,
    }, { shopDomain: "test-store.myshopify.com", authMode: "custom_app" });

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    // shop_domain, access_token, refresh_token — no shopIdentity, so no shop_id/shop_name.
    // (persistInstallationMetadata also issues its own UPDATE afterward, outside
    // this transaction, so scope the count to the credential-store INSERTs only.)
    const credentialWrites = db.$executeRawUnsafe.mock.calls // RLS-BYPASS: manual tenant filter — test mock
      .filter((call: unknown[]) => String(call[0]).includes("INSERT INTO connector_credentials"));
    expect(credentialWrites).toHaveLength(3);
  });

  it("stops after the first blocked write instead of leaving a partial credential set uncommitted", async () => {
    // If any one write is rejected (foreign-tenant id collision), the whole
    // $transaction callback rejects — no later writes in the sequence run,
    // and the real Postgres transaction rolls back whichever had already
    // landed (not exercisable by this mock, but the sequencing is).
    //
    // Deliberately includes refresh_token (positioned AFTER access_token in
    // the descriptor sequence) and blocks access_token specifically: this is
    // what distinguishes true sequential execution from a Promise.all placed
    // inside the same transaction. Under Promise.all, every write's raw exec
    // call fires synchronously (up to its own first await) regardless of
    // another write's eventual rejection — refresh_token's write would still
    // have been issued (3 calls total) even though the overall promise still
    // rejects. Under real sequential execution (this fix), refresh_token's
    // write is never even attempted (2 calls).
    global.fetch = jest.fn().mockRejectedValue(new Error("network unavailable")); // fetchShopMarket is best-effort/non-fatal
    const connector = makeConnector();
    const db = (connector as any).prismaDirect.getClient();
    db.$transaction = jest.fn((cb: any) => cb(db)); // RLS-BYPASS: manual tenant filter — test mock
    db.$executeRawUnsafe = jest.fn() // RLS-BYPASS: manual tenant filter — test mock
      .mockResolvedValueOnce(1) // shop_domain succeeds
      .mockResolvedValueOnce(0); // access_token blocked
    const ctx = makeCtx({ tenantId: "tenant-a", installationId: "install-a" });

    await expect((connector as any).persistTokenSet(ctx, {
      access_token: "shpat_live",
      refresh_token: "shprt_live",
      scope: "read_products",
      expires_in: 3600,
      refresh_token_expires_in: 7200,
    }, { shopDomain: "test-store.myshopify.com", authMode: "custom_app" }))
      .rejects.toThrow("access_token credential id already owned by a different tenant");

    // shop_domain, then access_token (blocked) — refresh_token's write must
    // never fire. A Promise.all-based implementation would have issued all 3
    // (this exact scenario is why test 1 alone couldn't prove sequential
    // execution — see PR #747 review).
    expect(db.$executeRawUnsafe).toHaveBeenCalledTimes(2); // RLS-BYPASS: manual tenant filter — test mock
    // credentialType is a bound parameter ($4 → call[4]), not inlined into
    // the SQL text (identical across all 5 credential types) — check the
    // actual composite id (call[1]) rather than the SQL string.
    const writtenIds = db.$executeRawUnsafe.mock.calls.map((call: unknown[]) => call[1]); // RLS-BYPASS: manual tenant filter — test mock
    expect(writtenIds).not.toContain("install-a:refresh_token");
  });
});

// ─── previewChanges ─────────────────────────────────────────────────────────

describe("ShopifyConnector.previewChanges", () => {
  async function buildEncryptedRow(value: string) {
    const { encryptCredentialValue, loadCredentialEncryptionKeys, resolveCurrentCredentialKeyVersion } =
      await import("../../connector-installer/credential-encryption.util");
    const keys = loadCredentialEncryptionKeys(process.env);
    const ver = resolveCurrentCredentialKeyVersion(process.env);
    const cipher = encryptCredentialValue(value, keys.get(ver)!, ver);
    return { encryptedValue: cipher, keyVersion: "v1", status: "ACTIVE", expiresAt: null, failureReason: null };
  }

  const BASE_PAYLOAD: ProductPayload = {
    sku: "X",
    title: "T",
    description: "Original description",
    brand: "B",
    hsnCode: "",
    attributes: {},
    productType: "SHIRT",
    mainImageUrl: "https://img.example.com/x.jpg",
    mrp: 100,
    sellingPrice: 80,
    gstRate: 0,
  };

  function setUpConnectorWithCredential() {
    const connector = makeConnector();
    const db = (connector as any).prismaDirect.getClient();
    // RLS-BYPASS: manual tenant filter — test mock, no real DB access
    db.$queryRawUnsafe.mockImplementation(async (sql: string) => {
      if (sql.includes("connector_credentials")) {
        return [await buildEncryptedRow("test-store.myshopify.com")];
      }
      return [];
    });
    const apiClient = (connector as any).apiClient as ShopifyApiClient;
    return { connector, apiClient };
  }

  function mockGraphqlNode(node: Record<string, unknown>) {
    return jest.fn().mockResolvedValue({ node });
  }

  it("surfaces a description change when Shopify's descriptionHtml differs from Vexa's", async () => {
    const { connector, apiClient } = setUpConnectorWithCredential();
    (apiClient as any).graphqlRequest = mockGraphqlNode({
      title: "T",
      handle: "t",
      descriptionHtml: "<p>Old description on Shopify</p>",
      status: "ACTIVE",
      variants: { nodes: [{ price: "80.00" }] },
      images: { nodes: [] },
    });

    const ctx = makeCtx();
    const result = await connector.previewChanges(ctx, BASE_PAYLOAD, "gid://shopify/Product/1");

    const descriptionChange = result.changes.find((c) => c.field === "description");
    expect(descriptionChange).toBeDefined();
    expect(descriptionChange?.currentValue).toBe("<p>Old description on Shopify</p>");
    expect(descriptionChange?.newValue).toBe("Original description");
    expect(descriptionChange?.changeType).toBe("update");
    expect(descriptionChange?.riskLevel).toBe("low");
  });

  it("does not surface a description entry when descriptions match", async () => {
    const { connector, apiClient } = setUpConnectorWithCredential();
    (apiClient as any).graphqlRequest = mockGraphqlNode({
      title: "T",
      handle: "t",
      descriptionHtml: "Original description",
      status: "ACTIVE",
      variants: { nodes: [{ price: "80.00" }] },
      images: { nodes: [] },
    });

    const ctx = makeCtx();
    const result = await connector.previewChanges(ctx, BASE_PAYLOAD, "gid://shopify/Product/1");

    expect(result.changes.find((c) => c.field === "description")).toBeUndefined();
  });

  it("treats a missing Shopify descriptionHtml as an add when Vexa has a description", async () => {
    const { connector, apiClient } = setUpConnectorWithCredential();
    (apiClient as any).graphqlRequest = mockGraphqlNode({
      title: "T",
      handle: "t",
      // descriptionHtml intentionally omitted, as Shopify's GraphQL field is nullable/omittable.
      status: "ACTIVE",
      variants: { nodes: [{ price: "80.00" }] },
      images: { nodes: [] },
    });

    const ctx = makeCtx();
    const result = await connector.previewChanges(ctx, BASE_PAYLOAD, "gid://shopify/Product/1");

    const descriptionChange = result.changes.find((c) => c.field === "description");
    expect(descriptionChange).toBeDefined();
    expect(descriptionChange?.changeType).toBe("add");
    expect(descriptionChange?.newValue).toBe("Original description");
  });
});

// PIM#653 — the OLD validateCredentials() never made a live API call for a direct
// admin-API-token install (this pilot's actual deployment mode): resolveAccessToken()
// -> ctx.getAccessToken() returns a cached token from the DB whenever its stored
// expiresAt is null, without ever touching Shopify's API. validateStoredCredentialsDetailed()
// fixes this with an actual live { shop { id } } query — these tests exercise that
// real live-check path, not just the pass-through wiring.
describe("ShopifyConnector.validateCredentials / validateStoredCredentialsDetailed (PIM#653)", () => {
  async function buildEncryptedRow(value: string) {
    const { encryptCredentialValue, loadCredentialEncryptionKeys, resolveCurrentCredentialKeyVersion } =
      await import("../../connector-installer/credential-encryption.util");
    const keys = loadCredentialEncryptionKeys(process.env);
    const ver = resolveCurrentCredentialKeyVersion(process.env);
    const cipher = encryptCredentialValue(value, keys.get(ver)!, ver);
    return { encryptedValue: cipher, keyVersion: "v1", status: "ACTIVE", expiresAt: null, failureReason: null };
  }

  function setUpConnectorWithShopDomain() {
    const connector = makeConnector();
    const db = (connector as any).prismaDirect.getClient();
    // RLS-BYPASS: manual tenant filter — test mock, no real DB access
    db.$queryRawUnsafe.mockImplementation(async (sql: string, ...params: string[]) => {
      if (sql.includes("connector_credentials")) {
        const credentialType = params[2];
        if (credentialType === "shop_domain") return [await buildEncryptedRow("test-store.myshopify.com")];
        return [];
      }
      return [];
    });
    const apiClient = (connector as any).apiClient as ShopifyApiClient;
    return { connector, apiClient };
  }

  it("makes a real live GraphQL call and resolves valid/true on a healthy shop response — proves this is no longer a DB-only check", async () => {
    const { connector, apiClient } = setUpConnectorWithShopDomain();
    const graphqlRequest = jest.fn().mockResolvedValue({ shop: { id: "gid://shopify/Shop/1" } });
    (apiClient as any).graphqlRequest = graphqlRequest;

    const ctx = makeCtx();
    await expect(connector.validateStoredCredentialsDetailed(ctx)).resolves.toEqual({ outcome: "valid" });
    expect(graphqlRequest).toHaveBeenCalledTimes(1);
    await expect(connector.validateCredentials(ctx)).resolves.toBe(true);
  });

  it("resolves invalid/false on a 401 (revoked/uninstalled app) — the exact case the old check could never detect", async () => {
    const { connector, apiClient } = setUpConnectorWithShopDomain();
    (apiClient as any).graphqlRequest = jest.fn().mockRejectedValue(
      new ShopifyApiHttpError(401, "test-store.myshopify.com", "Shopify GraphQL request failed with status 401."),
    );

    const ctx = makeCtx();
    await expect(connector.validateStoredCredentialsDetailed(ctx)).resolves.toEqual({
      outcome: "invalid",
      reasonCode: "HTTP_401",
    });
    await expect(connector.validateCredentials(ctx)).resolves.toBe(false);
  });

  it("resolves unavailable/false (not invalid) on a network/timeout failure", async () => {
    const { connector, apiClient } = setUpConnectorWithShopDomain();
    (apiClient as any).graphqlRequest = jest.fn().mockRejectedValue(new Error("fetch failed"));

    const ctx = makeCtx();
    const result = await connector.validateStoredCredentialsDetailed(ctx);
    expect(result.outcome).toBe("unavailable");
    await expect(connector.validateCredentials(ctx)).resolves.toBe(false);
  });

  it("resolves unavailable on a 5xx Shopify-side outage, distinct from 401/403 invalid", async () => {
    const { connector, apiClient } = setUpConnectorWithShopDomain();
    (apiClient as any).graphqlRequest = jest.fn().mockRejectedValue(
      new ShopifyApiHttpError(503, "test-store.myshopify.com", "Shopify GraphQL request failed with status 503."),
    );

    const ctx = makeCtx();
    await expect(connector.validateStoredCredentialsDetailed(ctx)).resolves.toEqual({
      outcome: "unavailable",
      reasonCode: "HTTP_503",
    });
  });
});

// ─── buildVariantInput / buildProductSetInput ──────────────────────────────────
// Coverage for the variant/media write-path request construction flagged as
// "not verified" in the 2026-07-23 connector release verdict. These are pure
// functions that build the GraphQL mutation input Shopify receives — they can't
// substitute for a live-store round-trip, but they lock down the actual request
// shape (price/compareAt/barcode/weight/HS-code logic, multi-variant option
// derivation, and image filename handling) so regressions here are caught
// without needing live Shopify credentials.

describe("ShopifyConnector.buildVariantInput", () => {
  let connector: ShopifyConnector;

  beforeEach(() => {
    connector = makeConnector();
  });

  function build(sku: string, sellingPrice: number, mrp: number, opts?: Record<string, unknown>) {
    return (connector as any).buildVariantInput(sku, sellingPrice, mrp, opts) as Record<string, unknown>;
  }

  it("formats price to 2 decimals and derives compareAtPrice from mrp when higher", () => {
    const result = build("SKU-1", 999, 1299);
    expect(result.price).toBe("999.00");
    expect(result.compareAtPrice).toBe("1299.00");
  });

  it("omits compareAtPrice when mrp is 0 and no explicit compareAtPrice is given", () => {
    const result = build("SKU-1", 999, 0);
    expect(result.compareAtPrice).toBeUndefined();
  });

  it("prefers an explicit compareAtPrice override over mrp", () => {
    const result = build("SKU-1", 999, 1299, { compareAtPrice: 1499 });
    expect(result.compareAtPrice).toBe("1499.00");
  });

  it("omits compareAtPrice when the resolved value is not a positive finite number", () => {
    const result = build("SKU-1", 999, 1299, { compareAtPrice: -50 });
    expect(result.compareAtPrice).toBeUndefined();
  });

  it("includes barcode only when provided", () => {
    expect(build("SKU-1", 999, 1299, { barcode: "1234567890123" }).barcode).toBe("1234567890123");
    expect(build("SKU-1", 999, 1299).barcode).toBeUndefined();
  });

  it("trims the SKU and sets inventoryItem.tracked to false (PIM tracks inventory, not Shopify)", () => {
    const result = build("  SKU-1  ", 999, 1299) as any;
    expect(result.inventoryItem.sku).toBe("SKU-1");
    expect(result.inventoryItem.tracked).toBe(false);
  });

  it("includes weight/weightUnit only when weight is a positive number", () => {
    const withWeight = build("SKU-1", 999, 1299, { weight: 0.5, weightUnit: "GRAMS" }) as any;
    expect(withWeight.inventoryItem.measurement).toEqual({ weight: { value: 0.5, unit: "GRAMS" } });

    const noWeight = build("SKU-1", 999, 1299, { weight: 0 }) as any;
    expect(noWeight.inventoryItem.measurement).toBeUndefined();
  });

  it("defaults weightUnit to KILOGRAMS when weight is set without a unit", () => {
    const result = build("SKU-1", 999, 1299, { weight: 2 }) as any;
    expect(result.inventoryItem.measurement).toEqual({ weight: { value: 2, unit: "KILOGRAMS" } });
  });

  it("writes harmonizedSystemCode onto inventoryItem, not the top-level variant, when provided", () => {
    const result = build("SKU-1", 999, 1299, { harmonizedSystemCode: "610910" }) as any;
    expect(result.inventoryItem.harmonizedSystemCode).toBe("610910");
    expect(result.harmonizedSystemCode).toBeUndefined();
  });

  it("defaults optionValues to a single Default Title option, and passes custom optionValues through unchanged", () => {
    expect(build("SKU-1", 999, 1299).optionValues).toEqual([{ optionName: "Title", name: "Default Title" }]);
    const custom = [{ optionName: "Color", name: "Red" }];
    expect(build("SKU-1", 999, 1299, { optionValues: custom }).optionValues).toBe(custom);
  });

  it("defaults inventoryPolicy to CONTINUE and taxable to true, honoring overrides", () => {
    const defaults = build("SKU-1", 999, 1299) as any;
    expect(defaults.inventoryPolicy).toBe("CONTINUE");
    expect(defaults.taxable).toBe(true);

    const overridden = build("SKU-1", 999, 1299, { inventoryPolicy: "DENY", taxable: false }) as any;
    expect(overridden.inventoryPolicy).toBe("DENY");
    expect(overridden.taxable).toBe(false);
  });
});

describe("ShopifyConnector.buildProductSetInput", () => {
  let connector: ShopifyConnector;

  const BASE: ProductPayload = {
    sku: "SHOPIFY-TEST-001",
    title: "Organic Cotton T-Shirt",
    description: "100% organic cotton, breathable and comfortable.",
    brand: "TestBrand",
    hsnCode: "61091000",
    gstRate: 5,
    mrp: 1299,
    sellingPrice: 999,
    mainImageUrl: "https://cdn.example.com/media/tshirt.jpg",
    attributes: { color: "White", size: "M" },
    productType: "SHIRT",
  };

  beforeEach(() => {
    connector = makeConnector();
  });

  function build(product: ProductPayload) {
    return (connector as any).buildProductSetInput(product) as Record<string, unknown>;
  }

  it("builds a single-variant product with one Default Title variant and no productOptions override", () => {
    const result = build(BASE) as any;
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0].price).toBe("999.00");
    expect(result.productOptions).toEqual([{ name: "Title", position: 1, values: [{ name: "Default Title" }] }]);
  });

  it("builds one Shopify variant per PIM variant when product.variants is present, deriving productOptions from the first variant's option names", () => {
    const withVariants: ProductPayload = {
      ...BASE,
      variants: [
        { sku: "SKU-RED-S", sellingPrice: 999, mrp: 1299, options: [{ optionName: "Color", name: "Red" }, { optionName: "Size", name: "S" }] },
        { sku: "SKU-BLUE-M", sellingPrice: 1099, mrp: 1399, options: [{ optionName: "Color", name: "Blue" }, { optionName: "Size", name: "M" }] },
      ],
    };
    const result = build(withVariants) as any;
    expect(result.variants).toHaveLength(2);
    expect(result.variants[0].inventoryItem.sku).toBe("SKU-RED-S");
    expect(result.variants[1].inventoryItem.sku).toBe("SKU-BLUE-M");
    expect(result.productOptions).toEqual([
      { name: "Color", position: 1, values: [{ name: "Red" }, { name: "Blue" }] },
      { name: "Size", position: 2, values: [{ name: "S" }, { name: "M" }] },
    ]);
  });

  it("applies the product-level harmonizedSystemCode uniformly to every variant", () => {
    const withVariants: ProductPayload = {
      ...BASE,
      hsnCode: "",
      taxCodes: [{ regimeKey: "AE", key: "HS_CODE", value: "610910" }],
      variants: [
        { sku: "SKU-A", sellingPrice: 999, mrp: 1299 },
        { sku: "SKU-B", sellingPrice: 1099, mrp: 1399 },
      ],
    } as ProductPayload;
    const result = build(withVariants) as any;
    expect(result.variants[0].inventoryItem.harmonizedSystemCode).toBe("610910");
    expect(result.variants[1].inventoryItem.harmonizedSystemCode).toBe("610910");
  });

  it("derives an image filename with extension when the image URL path has a recognizable extension", () => {
    const result = build(BASE) as any;
    expect(result.files).toEqual([
      { originalSource: BASE.mainImageUrl, alt: BASE.title, contentType: "IMAGE", filename: "product-image.jpg" },
    ]);
  });

  it("omits the image filename when the URL has no recognizable extension, without dropping the image itself", () => {
    const result = build({ ...BASE, mainImageUrl: "https://cdn.example.com/media/asset-id-abc123" }) as any;
    expect(result.files).toEqual([
      { originalSource: "https://cdn.example.com/media/asset-id-abc123", alt: BASE.title, contentType: "IMAGE" },
    ]);
  });

  it("falls back to treating a malformed image URL as a raw path for extension derivation, rather than throwing", () => {
    expect(() => build({ ...BASE, mainImageUrl: "not-a-valid-url.png" })).not.toThrow();
    const result = build({ ...BASE, mainImageUrl: "not-a-valid-url.png" }) as any;
    expect(result.files[0].filename).toBe("product-image.png");
  });

  it("marks DRAFT status through and defaults everything else to ACTIVE", () => {
    expect((build({ ...BASE, status: "DRAFT" } as ProductPayload) as any).status).toBe("DRAFT");
    expect((build(BASE) as any).status).toBe("ACTIVE");
  });
});
