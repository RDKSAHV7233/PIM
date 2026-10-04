import type { ConnectorContext, ProductPayload } from "../../connector-framework/connector.interface";
import { resolve4, resolve6 } from "node:dns/promises";
import { ShopwareConnector, ShopwarePublishError } from "./shopware.connector";

// Only DNS is mocked — the real url-safety guard runs in every test, so the
// SSRF tests below prove the connector is actually wired to it (mocking the
// guard itself, as some other connector specs do, would prove nothing).
jest.mock("node:dns/promises", () => ({
  resolve4: jest.fn(),
  resolve6: jest.fn(),
}));

const TEST_KEY = "d".repeat(64);

beforeEach(() => {
  (resolve4 as jest.Mock).mockReset().mockResolvedValue(["93.184.216.34"]);
  (resolve6 as jest.Mock).mockReset().mockRejectedValue(new Error("ENODATA"));
});

function makeConnectorWithDb(mockDbClient: any) {
  process.env.CREDENTIAL_ENCRYPTION_KEY_V1 = TEST_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION = "1";
  return new ShopwareConnector(
    { getClient: () => mockDbClient } as never,
    { info: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() } as never,
  );
}

function makeConnector() {
  return makeConnectorWithDb({
    connectorCredential: { findFirst: jest.fn().mockResolvedValue(null) },
  });
}

const credRow = (type: string, value: string) => ({
  credentialType: type,
  encryptedValue: `enc::v1:${Buffer.from(value).toString("base64")}`,
  keyVersion: "v1",
});

function findFirstByType(rows: Record<string, ReturnType<typeof credRow> | null>) {
  return jest.fn().mockImplementation(({ where }: { where: { credentialType: string } }) =>
    Promise.resolve(rows[where.credentialType] ?? null),
  );
}

function mockDecrypt() {
  jest
    .spyOn(require("../../connector-installer/credential-encryption.util"), "decryptCredentialValue")
    .mockImplementation((enc: unknown) => Buffer.from(String(enc).replace("enc::v1:", ""), "base64").toString("utf8"));
}

const baseProduct: ProductPayload = {
  sku: "SW-001",
  title: "Shopware mapped product",
  description: "A widget",
  brand: "Vexa",
  hsnCode: "",
  gstRate: 0,
  mrp: 0,
  sellingPrice: 119,
  mainImageUrl: "https://cdn.example.com/sw.jpg",
  attributes: { shopware_tax_id: "tax-1", shopware_sales_channel_id: "chan-1" },
  productType: "generic",
};

function fakeCtx(overrides: Partial<ConnectorContext> = {}): ConnectorContext {
  return {
    tenantId: "t1",
    installationId: "i1",
    connectorId: "shopware",
    getAccessToken: jest.fn().mockResolvedValue("unused"),
    ...overrides,
  } as ConnectorContext;
}

function dbWithCreds() {
  return {
    connectorCredential: {
      findFirst: findFirstByType({
        store_url: credRow("store_url", "https://shop.example.com"),
        client_id: credRow("client_id", "candidate-access-id"),
        client_secret: credRow("client_secret", "candidate-secret-key"),
      }),
    },
  };
}

describe("ShopwareConnector.validateProduct", () => {
  it("requires title, productNumber, non-negative price, and shopware_tax_id", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct(fakeCtx(), {
      ...baseProduct,
      title: "",
      sku: "",
      sellingPrice: -1,
      attributes: {},
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.map((e) => e.code)).toEqual(
      expect.arrayContaining(["MISSING_NAME", "MISSING_PRODUCT_NUMBER", "MISSING_PRICE", "MISSING_TAX"]),
    );
  });

  it("warns (does not error) when shopware_sales_channel_id is missing", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct(fakeCtx(), {
      ...baseProduct,
      attributes: { shopware_tax_id: "tax-1" },
    });
    expect(result.isValid).toBe(true);
    expect(result.warnings.some((w) => w.code === "MISSING_CHANNEL")).toBe(true);
  });

  it("accepts a fully valid product with no warnings", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct(fakeCtx(), baseProduct);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});

describe("ShopwareConnector.normaliseError", () => {
  it("maps known error codes to seller-friendly messages with the right fieldPath", () => {
    const connector = makeConnector();
    expect(connector.normaliseError("FRAMEWORK__DUPLICATE_KEY", "raw").fieldPath).toBe("sku");
    expect(connector.normaliseError("FRAMEWORK__DUPLICATE_KEY", "raw").sellerMessage).toMatch(/already exists/);
    expect(connector.normaliseError("TAX_NOT_FOUND", "raw").fieldPath).toBe("attributes.shopware_tax_id");
    expect(connector.normaliseError("SALES_CHANNEL_NOT_FOUND", "raw").fieldPath).toBe("attributes.shopware_sales_channel_id");
  });

  it("falls back to the raw message for an unmapped code", () => {
    const connector = makeConnector();
    const issue = connector.normaliseError("SomeUnknownError", "some raw detail");
    expect(issue.sellerMessage).toBe("some raw detail");
  });
});

describe("ShopwareConnector.buildProductPayload — VAT/net-price bug fix", () => {
  it("computes net price from the product's own tax_rate_percent, not a hardcoded 19%", () => {
    const connector = makeConnector();
    // 20% Austrian VAT: net = 120 / 1.20 = 100
    const payload = (connector as any).buildProductPayload({
      ...baseProduct,
      sellingPrice: 120,
      attributes: { shopware_tax_id: "tax-1", tax_rate_percent: 20 },
    }) as any;
    expect(payload.price[0].gross).toBe(120);
    expect(payload.price[0].net).toBe(100);
  });

  it("falls back to 19% only when tax_rate_percent is absent", () => {
    const connector = makeConnector();
    const payload = (connector as any).buildProductPayload({
      ...baseProduct,
      sellingPrice: 119,
      attributes: { shopware_tax_id: "tax-1" },
    }) as any;
    expect(payload.price[0].net).toBeCloseTo(100, 5);
  });

  it("maps productNumber, manufacturer, category, visibility, and non-shopware_ custom fields", () => {
    const connector = makeConnector();
    const payload = (connector as any).buildProductPayload({
      ...baseProduct,
      attributes: {
        shopware_tax_id: "tax-1",
        shopware_sales_channel_id: "chan-1",
        shopware_category_id: "cat-1",
        shopware_currency_id: "cur-1",
        material: "Steel",
        stock: 42,
      },
    }) as any;
    expect(payload.productNumber).toBe("SW-001");
    expect(payload.manufacturer).toEqual({ name: "Vexa" });
    expect(payload.categories).toEqual([{ id: "cat-1" }]);
    expect(payload.visibilities).toEqual([{ salesChannelId: "chan-1", visibility: 30 }]);
    expect(payload.price[0].currencyId).toBe("cur-1");
    expect(payload.stock).toBe(42);
    expect(payload.customFields).toEqual({ material: "Steel" });
    expect(payload.customFields).not.toHaveProperty("shopware_tax_id");
  });

  it("defaults stock to 100 and currency to the well-known EUR id when unset", () => {
    const connector = makeConnector();
    const payload = (connector as any).buildProductPayload({
      ...baseProduct,
      attributes: { shopware_tax_id: "tax-1" },
    }) as any;
    expect(payload.stock).toBe(100);
    expect(payload.price[0].currencyId).toBe("b7d2554b0ce847cd82f3ac9bd1c0dfca");
  });
});

describe("ShopwareConnector auth transport", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  it("validateStoredCredentialsDetailed calls GET /api/_info/config with the ctx access token", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    (global as any).fetch = fetchMock;

    const result = await connector.validateStoredCredentialsDetailed(fakeCtx());

    expect(result.outcome).toBe("valid");
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("https://shop.example.com/api/_info/config");
    expect(calledInit.headers.Authorization).toBe("Bearer unused");
  });

  it("rejects a non-HTTPS store_url without making a network call", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb({
      connectorCredential: {
        findFirst: findFirstByType({
          store_url: credRow("store_url", "http://shop.example.com"),
          client_id: credRow("client_id", "id"),
          client_secret: credRow("client_secret", "secret"),
        }),
      },
    });
    const fetchMock = jest.fn();
    (global as any).fetch = fetchMock;

    const result = await connector.validateStoredCredentialsDetailed(fakeCtx());

    expect(result.outcome).toBe("invalid");
    expect((result as { reasonCode?: string }).reasonCode).toBe("SHOPWARE_URL_NOT_HTTPS");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports invalid on a 401 from /api/_info/config", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });
    const result = await connector.validateStoredCredentialsDetailed(fakeCtx());
    expect(result.outcome).toBe("invalid");
    expect((result as { reasonCode?: string }).reasonCode).toBe("HTTP_401");
  });

  it("reports unavailable on a network failure, not invalid", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    (global as any).fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await connector.validateStoredCredentialsDetailed(fakeCtx());
    expect(result.outcome).toBe("unavailable");
  });

  it("verifyCandidateCredentials performs a real client_credentials exchange before checking /api/_info/config", async () => {
    const connector = makeConnector();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: "tok-123", expires_in: 600 }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    (global as any).fetch = fetchMock;

    const result = await connector.verifyCandidateCredentials!({
      store_url: "https://candidate.example.com/",
      client_id: "candidate-id",
      client_secret: "candidate-secret",
    });

    expect(result.outcome).toBe("valid");
    expect((result as any).commitExtra.accessToken.value).toBe("tok-123");

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe("https://candidate.example.com/api/oauth/token");
    expect(JSON.parse(tokenInit.body)).toEqual({
      grant_type: "client_credentials",
      client_id: "candidate-id",
      client_secret: "candidate-secret",
    });

    const [configUrl, configInit] = fetchMock.mock.calls[1];
    expect(configUrl).toBe("https://candidate.example.com/api/_info/config");
    expect(configInit.headers.Authorization).toBe("Bearer tok-123");
  });

  it("verifyCandidateCredentials rejects a non-HTTPS candidate store_url without exchanging a token", async () => {
    const connector = makeConnector();
    const fetchMock = jest.fn();
    (global as any).fetch = fetchMock;

    const result = await connector.verifyCandidateCredentials!({
      store_url: "http://candidate.example.com",
      client_id: "id",
      client_secret: "secret",
    });

    expect(result.outcome).toBe("invalid");
    expect((result as { reasonCode?: string }).reasonCode).toBe("SHOPWARE_URL_NOT_HTTPS");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("verifyCandidateCredentials reports invalid on a 401 token exchange", async () => {
    const connector = makeConnector();
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ errors: [{ detail: "invalid client" }] }),
    });

    const result = await connector.verifyCandidateCredentials!({
      store_url: "https://candidate.example.com",
      client_id: "bad-id",
      client_secret: "bad-secret",
    });

    expect(result.outcome).toBe("invalid");
    expect((result as { reasonCode?: string }).reasonCode).toBe("HTTP_401");
  });
});

describe("ShopwareConnector.publishProduct / updateProduct", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  it("POSTs the built payload to /api/product and returns the sku as externalRef", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 204, text: async () => "" });
    (global as any).fetch = fetchMock;

    const ref = await connector.publishProduct(fakeCtx(), baseProduct);

    expect(ref.externalRef).toBe("SW-001");
    expect(ref.status).toBe("SUCCESS");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://shop.example.com/api/product");
    expect(init.method).toBe("POST");
  });

  it("throws a parsed ShopwarePublishError on a validation failure", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ errors: [{ code: "FRAMEWORK__DUPLICATE_KEY", detail: "" }] }),
    });

    let caught: unknown;
    try {
      await connector.publishProduct(fakeCtx(), baseProduct);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ShopwarePublishError);
    expect((caught as ShopwarePublishError).issues[0].code).toBe("FRAMEWORK__DUPLICATE_KEY");
  });

  it("updateProduct looks up the Shopware id by productNumber, then PATCHes it", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: "sw-uuid-1" }] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => "" });
    (global as any).fetch = fetchMock;

    const ref = await connector.updateProduct(fakeCtx(), baseProduct, "SW-001");

    expect(ref.externalRef).toBe("SW-001");
    expect(ref.status).toBe("SUCCESS");
    const [lookupUrl] = fetchMock.mock.calls[0];
    expect(lookupUrl).toBe("https://shop.example.com/api/search/product");
    const [patchUrl, patchInit] = fetchMock.mock.calls[1];
    expect(patchUrl).toBe("https://shop.example.com/api/product/sw-uuid-1");
    expect(patchInit.method).toBe("PATCH");
  });

  it("updateProduct throws when the lookup finds no matching product", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ data: [] }) });

    let caught: unknown;
    try {
      await connector.updateProduct(fakeCtx(), baseProduct, "SW-MISSING");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ShopwarePublishError);
    expect((caught as ShopwarePublishError).issues[0].code).toBe("PRODUCT_NOT_FOUND");
  });
});

describe("ShopwareConnector.syncSubmissionStatus", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  it("returns ERROR when the product is not found", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ data: [] }) });
    const result = await connector.syncSubmissionStatus!(fakeCtx(), "SW-001");
    expect(result.status).toBe("ERROR");
    expect(result.channelErrors[0].code).toBe("PRODUCT_NOT_FOUND");
  });

  it("returns SUCCESS when active is true, SUPPRESSED otherwise", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ data: [{ active: true }] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ data: [{ active: false }] }) });
    (global as any).fetch = fetchMock;

    const active = await connector.syncSubmissionStatus!(fakeCtx(), "SW-001");
    const suppressed = await connector.syncSubmissionStatus!(fakeCtx(), "SW-001");
    expect(active.status).toBe("SUCCESS");
    expect(suppressed.status).toBe("SUPPRESSED");
  });
});

// ─── SSRF boundary: tenant-controlled store_url ────────────────────────────
//
// store_url is tenant-supplied and the connector sends the Integration's
// client_secret (token exchange) and bearer token (every API call) to it. The
// shared validateConnectorTargetUrl guard — the one Odoo, PrestaShop and
// WooCommerce use — must run before ANY of those requests is built. The real
// guard is exercised here (only DNS is mocked), so these tests fail if the
// connector stops calling it.

const UNSAFE_STORE_URLS: Array<[string, string]> = [
  ["localhost", "https://localhost"],
  ["IPv4 loopback", "https://127.0.0.1"],
  ["IPv6 loopback", "https://[::1]"],
  ["RFC1918 10/8", "https://10.0.0.5"],
  ["RFC1918 172.16/12", "https://172.16.0.1"],
  ["RFC1918 192.168/16", "https://192.168.1.10"],
  ["link-local / cloud metadata IP", "https://169.254.169.254"],
  ["CGNAT 100.64/10", "https://100.64.0.1"],
  ["metadata hostname", "https://metadata.google.internal"],
  [".internal hostname", "https://store.internal"],
  [".local hostname", "https://shop.local"],
  ["malformed host", "https://exa mple.com"],
];

function dbWithStoreUrl(storeUrl: string) {
  return {
    connectorCredential: {
      findFirst: findFirstByType({
        store_url: credRow("store_url", storeUrl),
        client_id: credRow("client_id", "candidate-access-id"),
        client_secret: credRow("client_secret", "candidate-secret-key"),
      }),
    },
  };
}

describe("ShopwareConnector — tenant-controlled store_url SSRF boundary", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  describe("verifyCandidateCredentials (install / replace-credentials)", () => {
    it.each(UNSAFE_STORE_URLS)("rejects %s without sending any request", async (_label, url) => {
      const connector = makeConnector();
      const fetchMock = jest.fn();
      (global as any).fetch = fetchMock;

      const result = await connector.verifyCandidateCredentials!({
        store_url: url,
        client_id: "candidate-id",
        client_secret: "candidate-secret",
      });

      expect(result.outcome).toBe("invalid");
      expect((result as { reasonCode?: string }).reasonCode).toBe("SHOPWARE_URL_UNSAFE");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects a non-HTTPS URL without sending any request", async () => {
      const connector = makeConnector();
      const fetchMock = jest.fn();
      (global as any).fetch = fetchMock;

      const result = await connector.verifyCandidateCredentials!({
        store_url: "http://shop.example.com",
        client_id: "candidate-id",
        client_secret: "candidate-secret",
      });

      expect((result as { reasonCode?: string }).reasonCode).toBe("SHOPWARE_URL_NOT_HTTPS");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects an empty-host URL without sending any request", async () => {
      const connector = makeConnector();
      const fetchMock = jest.fn();
      (global as any).fetch = fetchMock;

      const result = await connector.verifyCandidateCredentials!({
        store_url: "https://",
        client_id: "candidate-id",
        client_secret: "candidate-secret",
      });

      expect(result.outcome).toBe("invalid");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects a public-looking hostname that DNS resolves to a private address (DNS rebinding shape)", async () => {
      (resolve4 as jest.Mock).mockResolvedValue(["10.0.0.5"]);
      const connector = makeConnector();
      const fetchMock = jest.fn();
      (global as any).fetch = fetchMock;

      const result = await connector.verifyCandidateCredentials!({
        store_url: "https://totally-legit-shop.example.com",
        client_id: "candidate-id",
        client_secret: "candidate-secret",
      });

      expect((result as { reasonCode?: string }).reasonCode).toBe("SHOPWARE_URL_UNSAFE");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects a hostname that resolves to the cloud metadata address", async () => {
      (resolve4 as jest.Mock).mockResolvedValue(["169.254.169.254"]);
      const connector = makeConnector();
      const fetchMock = jest.fn();
      (global as any).fetch = fetchMock;

      const result = await connector.verifyCandidateCredentials!({
        store_url: "https://metadata-rebind.example.com",
        client_id: "candidate-id",
        client_secret: "candidate-secret",
      });

      expect((result as { reasonCode?: string }).reasonCode).toBe("SHOPWARE_URL_UNSAFE");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("still allows a valid public HTTPS URL and sends the secret only to that host", async () => {
      const connector = makeConnector();
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ access_token: "tok", expires_in: 600 }) })
        .mockResolvedValueOnce({ ok: true, status: 200 });
      (global as any).fetch = fetchMock;

      const result = await connector.verifyCandidateCredentials!({
        store_url: "https://shop.example.com",
        client_id: "candidate-id",
        client_secret: "candidate-secret",
      });

      expect(result.outcome).toBe("valid");
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.every((u) => u.startsWith("https://shop.example.com/"))).toBe(true);
    });
  });

  describe("stored store_url (heartbeat, token refresh, publish, update, status sync)", () => {
    it.each(UNSAFE_STORE_URLS)("heartbeat validation reports invalid for %s and sends no request", async (_label, url) => {
      mockDecrypt();
      const connector = makeConnectorWithDb(dbWithStoreUrl(url));
      const fetchMock = jest.fn();
      (global as any).fetch = fetchMock;

      const result = await connector.validateStoredCredentialsDetailed(fakeCtx());

      expect(result.outcome).toBe("invalid");
      expect((result as { reasonCode?: string }).reasonCode).toBe("SHOPWARE_URL_UNSAFE");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await connector.validateCredentials(fakeCtx())).toBe(false);
    });

    it("keeps classifying a stored non-HTTPS URL as invalid/NOT_HTTPS (behavior unchanged)", async () => {
      mockDecrypt();
      const connector = makeConnectorWithDb(dbWithStoreUrl("http://shop.example.com"));
      const fetchMock = jest.fn();
      (global as any).fetch = fetchMock;

      const result = await connector.validateStoredCredentialsDetailed(fakeCtx());

      expect(result.outcome).toBe("invalid");
      expect((result as { reasonCode?: string }).reasonCode).toBe("SHOPWARE_URL_NOT_HTTPS");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      ["refreshAccessToken", (c: ShopwareConnector) => c.refreshAccessToken(fakeCtx())],
      ["publishProduct", (c: ShopwareConnector) => c.publishProduct(fakeCtx(), baseProduct)],
      ["updateProduct", (c: ShopwareConnector) => c.updateProduct(fakeCtx(), baseProduct, "SW-001")],
      ["syncSubmissionStatus", (c: ShopwareConnector) => c.syncSubmissionStatus!(fakeCtx(), "SW-001")],
    ])("%s refuses a stored metadata-endpoint store_url before any request or token attach", async (_name, call) => {
      mockDecrypt();
      const connector = makeConnectorWithDb(dbWithStoreUrl("https://169.254.169.254"));
      const fetchMock = jest.fn();
      (global as any).fetch = fetchMock;

      await expect(call(connector)).rejects.toThrow(/private or reserved IP/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refreshAccessToken refuses a stored hostname that resolves to a private address", async () => {
      (resolve4 as jest.Mock).mockResolvedValue(["192.168.0.20"]);
      mockDecrypt();
      const connector = makeConnectorWithDb(dbWithStoreUrl("https://rebinds-later.example.com"));
      const fetchMock = jest.fn();
      (global as any).fetch = fetchMock;

      await expect(connector.refreshAccessToken(fakeCtx())).rejects.toThrow(/resolves to a private or reserved IP/);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});

// Redirect handling on the credential-bearing Admin API transport. The OAuth
// token exchange puts the Integration's client_secret in the request body and
// every later call carries the bearer token, so fetch must never follow a
// redirect to a destination that has not passed the canonical SSRF validation.
describe("ShopwareConnector — authenticated redirect handling", () => {
  const SHOP = "https://shop.example.com";
  const SECRET = "SHOPWARE-CLIENT-SECRET-DO-NOT-LEAK";
  const candidate = { store_url: SHOP, client_id: "SWIA-TEST", client_secret: SECRET };
  const redirect = (status: number, location: string) =>
    new Response(null, { status, headers: { location } });
  const tokenResponse = () =>
    new Response(JSON.stringify({ access_token: "tok", expires_in: 600 }), { status: 200 });
  const configResponse = () => new Response("{}", { status: 200 });

  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  it("sends the client_secret-bearing token exchange with redirect: 'manual'", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(configResponse());
    (global as any).fetch = fetchMock;
    const result = await makeConnector().verifyCandidateCredentials!(candidate);
    expect(result.outcome).toBe("valid");
    expect(fetchMock.mock.calls[0][0]).toBe(`${SHOP}/api/oauth/token`);
    expect(fetchMock.mock.calls[0][1].redirect).toBe("manual");
    expect(fetchMock.mock.calls[1][1].redirect).toBe("manual");
  });

  it.each([
    ["private IPv4", "https://10.0.0.5/api/oauth/token"],
    ["cloud metadata", "https://169.254.169.254/latest/meta-data/"],
    ["IPv4-mapped IPv6 loopback", "https://[::ffff:7f00:1]/api/oauth/token"],
    ["plain http downgrade", "http://shop.example.com/api/oauth/token"],
  ])("never sends the client_secret to a redirect to %s", async (_label, location) => {
    const fetchMock = jest.fn().mockResolvedValue(redirect(307, location));
    (global as any).fetch = fetchMock;
    const result = await makeConnector().verifyCandidateCredentials!(candidate);
    expect(result).toEqual({ outcome: "invalid", reasonCode: "SHOPWARE_REDIRECT_UNSAFE_TARGET", category: "configuration" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${SHOP}/api/oauth/token`);
  });

  it("fails closed on an apex->www cross-origin redirect of the token exchange", async () => {
    for (const status of [301, 302, 303, 307, 308]) {
      const fetchMock = jest.fn().mockResolvedValue(redirect(status, "https://www.shop.example.com/api/oauth/token"));
      (global as any).fetch = fetchMock;
      const result = await makeConnector().verifyCandidateCredentials!(candidate);
      expect(result).toEqual({ outcome: "invalid", reasonCode: "SHOPWARE_REDIRECT_CROSS_ORIGIN", category: "configuration" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("fails closed on a same-origin 302 for the POST rather than letting fetch drop the body", async () => {
    const fetchMock = jest.fn().mockResolvedValue(redirect(302, "/api/oauth/token/"));
    (global as any).fetch = fetchMock;
    const result = await makeConnector().verifyCandidateCredentials!(candidate);
    expect(result).toEqual({ outcome: "invalid", reasonCode: "SHOPWARE_REDIRECT_METHOD_UNSUPPORTED", category: "configuration" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows an explicit same-origin 308 and re-sends the body only to the same origin", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(redirect(308, "/api/oauth/token/"))
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(configResponse());
    (global as any).fetch = fetchMock;
    const result = await makeConnector().verifyCandidateCredentials!(candidate);
    expect(result.outcome).toBe("valid");
    expect(new URL(fetchMock.mock.calls[1][0]).origin).toBe(SHOP);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).client_secret).toBe(SECRET);
  });

  it("refuses a redirect of the bearer-token request (second call) as well", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(redirect(301, "https://www.shop.example.com/api/_info/config"));
    (global as any).fetch = fetchMock;
    const result = await makeConnector().verifyCandidateCredentials!(candidate);
    expect(result).toEqual({ outcome: "invalid", reasonCode: "SHOPWARE_REDIRECT_CROSS_ORIGIN", category: "configuration" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("validateStoredCredentialsDetailed reports a refused token-exchange redirect as invalid", async () => {
    const connector = makeConnector();
    jest.spyOn(connector as any, "resolveCredentials").mockResolvedValue({
      storeUrl: SHOP,
      clientId: "id",
      clientSecret: SECRET,
    });
    const fetchMock = jest.fn().mockResolvedValue(redirect(301, "https://www.shop.example.com/api/oauth/token"));
    (global as any).fetch = fetchMock;
    const ctx = {
      tenantId: "t1",
      installationId: "i1",
      connectorId: "shopware",
      getAccessToken: () => (connector as any).exchangeToken(SHOP, "id", SECRET).then((t: any) => t.access_token),
    };
    await expect(connector.validateStoredCredentialsDetailed!(ctx as any)).resolves.toEqual({
      outcome: "invalid",
      reasonCode: "SHOPWARE_REDIRECT_CROSS_ORIGIN",
      category: "configuration",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not report a redirect refusal as a transient (unavailable) failure", async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(redirect(307, "https://evil.example.net/api/oauth/token"));
    const result = await makeConnector().verifyCandidateCredentials!(candidate);
    expect(result.outcome).toBe("invalid");
  });
});
