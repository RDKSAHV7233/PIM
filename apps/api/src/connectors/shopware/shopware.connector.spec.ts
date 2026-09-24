import type { ConnectorContext, ProductPayload } from "../../connector-framework/connector.interface";
import { ShopwareConnector, ShopwarePublishError } from "./shopware.connector";

const TEST_KEY = "d".repeat(64);

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
