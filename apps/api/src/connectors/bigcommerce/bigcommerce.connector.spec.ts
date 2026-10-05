import type { ConnectorContext, ProductPayload } from "../../connector-framework/connector.interface";
import { BigCommerceConnector, BigCommercePublishError } from "./bigcommerce.connector";

const TEST_KEY = "d".repeat(64);

function makeConnectorWithDb(mockDbClient: any) {
  process.env.CREDENTIAL_ENCRYPTION_KEY_V1 = TEST_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION = "1";
  return new BigCommerceConnector(
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
  sku: "BC-001",
  title: "BigCommerce mapped product",
  description: "A widget",
  brand: "Vexa",
  hsnCode: "",
  gstRate: 0,
  mrp: 0,
  sellingPrice: 19.99,
  mainImageUrl: "https://cdn.example.com/bc.jpg",
  attributes: { weight_kg: 1.2 },
  productType: "generic",
};

function fakeCtx(overrides: Partial<ConnectorContext> = {}): ConnectorContext {
  return {
    tenantId: "t1",
    installationId: "i1",
    connectorId: "bigcommerce",
    getAccessToken: jest.fn().mockResolvedValue("unused"),
    ...overrides,
  } as ConnectorContext;
}

function dbWithCreds() {
  return {
    connectorCredential: {
      findFirst: findFirstByType({
        store_hash: credRow("store_hash", "abc123"),
        api_key: credRow("api_key", "real-store-api-token"),
      }),
    },
  };
}

describe("BigCommerceConnector.validateProduct", () => {
  it("requires a title, non-negative price, and a weight", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct(fakeCtx(), { ...baseProduct, title: "", sellingPrice: -1, attributes: {} });
    expect(result.isValid).toBe(false);
    expect(result.errors.map((e) => e.code)).toEqual(expect.arrayContaining(["MISSING_NAME", "MISSING_PRICE", "MISSING_WEIGHT"]));
  });

  it("rejects a title over 250 characters", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct(fakeCtx(), { ...baseProduct, title: "x".repeat(251) });
    expect(result.errors.some((e) => e.code === "NAME_TOO_LONG")).toBe(true);
  });

  it("accepts a fully valid product", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct(fakeCtx(), baseProduct);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts a product with no bigcommerce_category_id at all (category is optional)", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct(fakeCtx(), baseProduct);
    expect(result.errors.some((e) => e.code === "INVALID_CATEGORY_ID_FORMAT")).toBe(false);
  });

  it("rejects a non-numeric bigcommerce_category_id instead of letting it silently publish uncategorised", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct(fakeCtx(), {
      ...baseProduct,
      attributes: { weight_kg: 1.2, bigcommerce_category_id: "42abc" },
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_CATEGORY_ID_FORMAT" && e.fieldPath === "attributes.bigcommerce_category_id")).toBe(
      true,
    );
  });

  it("accepts a numeric (string or number) bigcommerce_category_id", async () => {
    const connector = makeConnector();
    const stringResult = await connector.validateProduct(fakeCtx(), {
      ...baseProduct,
      attributes: { weight_kg: 1.2, bigcommerce_category_id: "42" },
    });
    const numberResult = await connector.validateProduct(fakeCtx(), {
      ...baseProduct,
      attributes: { weight_kg: 1.2, bigcommerce_category_id: 42 },
    });
    expect(stringResult.errors.some((e) => e.code === "INVALID_CATEGORY_ID_FORMAT")).toBe(false);
    expect(numberResult.errors.some((e) => e.code === "INVALID_CATEGORY_ID_FORMAT")).toBe(false);
  });
});

describe("BigCommerceConnector.normaliseError", () => {
  it("maps known error codes to seller-friendly messages with the right fieldPath", () => {
    const connector = makeConnector();
    expect(connector.normaliseError("DuplicateSKUError", "raw").fieldPath).toBe("sku");
    expect(connector.normaliseError("DuplicateSKUError", "raw").sellerMessage).toMatch(/already exists/);
    expect(connector.normaliseError("InvalidCategoryIdError", "raw").fieldPath).toBe("attributes.bigcommerce_category_id");
  });

  it("falls back to the raw message for an unmapped code", () => {
    const connector = makeConnector();
    const issue = connector.normaliseError("SomeUnknownError", "some raw detail");
    expect(issue.sellerMessage).toBe("some raw detail");
  });
});

describe("BigCommerceConnector.buildProductPayload", () => {
  it("maps images, custom fields (excluding _id keys), and category id", () => {
    const connector = makeConnector();
    const payload = (connector as any).buildProductPayload({
      ...baseProduct,
      additionalImageUrls: ["https://cdn.example.com/2.jpg"],
      attributes: { weight_kg: 1.2, bigcommerce_category_id: "42", material: "Steel" },
    }) as any;
    expect(payload.images).toEqual([
      { image_url: "https://cdn.example.com/bc.jpg", is_thumbnail: true },
      { image_url: "https://cdn.example.com/2.jpg", is_thumbnail: false },
    ]);
    expect(payload.categories).toEqual([42]);
    expect(payload.custom_fields).toEqual(
      expect.arrayContaining([{ name: "Material", value: "Steel" }]),
    );
    expect(payload.custom_fields).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: expect.stringMatching(/category/i) })]),
    );
  });

  it("excludes weight_kg from custom_fields since it is already sent as the structured weight field", () => {
    const connector = makeConnector();
    const payload = (connector as any).buildProductPayload({
      ...baseProduct,
      attributes: { weight_kg: 1.2, material: "Steel" },
    }) as any;
    expect(payload.weight).toBe(1.2);
    expect(payload.custom_fields).toEqual([{ name: "Material", value: "Steel" }]);
    expect(payload.custom_fields).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: expect.stringMatching(/weight/i) })]),
    );
  });

  it("defaults weight to 0.5 when not a valid number", () => {
    const connector = makeConnector();
    const payload = (connector as any).buildProductPayload({ ...baseProduct, attributes: {} }) as any;
    expect(payload.weight).toBe(0.5);
  });
});

describe("BigCommerceConnector auth transport", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  it("sends the api_key as X-Auth-Token against /catalog/summary", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    (global as any).fetch = fetchMock;

    const result = await connector.validateStoredCredentialsDetailed(fakeCtx());

    expect(result.outcome).toBe("valid");
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("https://api.bigcommerce.com/stores/abc123/v3/catalog/summary");
    expect(calledInit.headers["X-Auth-Token"]).toBe("real-store-api-token");
  });

  it("reports invalid on a 401", async () => {
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

  it("classifies an abort/timeout failure as reasonCode TIMEOUT, not a generic error", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    (global as any).fetch = jest.fn().mockRejectedValue(abortError);
    const result = await connector.validateStoredCredentialsDetailed(fakeCtx());
    expect(result.outcome).toBe("unavailable");
    expect((result as { reasonCode?: string }).reasonCode).toBe("TIMEOUT");
  });

  it("classifies a DNS failure (ENOTFOUND cause) as reasonCode DNS", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    const dnsError = new Error("getaddrinfo ENOTFOUND api.bigcommerce.com");
    (dnsError as any).cause = { code: "ENOTFOUND" };
    (global as any).fetch = jest.fn().mockRejectedValue(dnsError);
    const result = await connector.validateStoredCredentialsDetailed(fakeCtx());
    expect(result.outcome).toBe("unavailable");
    expect((result as { reasonCode?: string }).reasonCode).toBe("DNS");
  });

  it("classifies a TLS/certificate failure as reasonCode TLS", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    const tlsError = new Error("self-signed certificate");
    (tlsError as any).cause = { code: "CERT_HAS_EXPIRED" };
    (global as any).fetch = jest.fn().mockRejectedValue(tlsError);
    const result = await connector.validateStoredCredentialsDetailed(fakeCtx());
    expect(result.outcome).toBe("unavailable");
    expect((result as { reasonCode?: string }).reasonCode).toBe("TLS");
  });

  it("verifyCandidateCredentials also classifies network failures by category", async () => {
    const connector = makeConnector();
    const dnsError = new Error("getaddrinfo ENOTFOUND api.bigcommerce.com");
    (dnsError as any).cause = { code: "ENOTFOUND" };
    (global as any).fetch = jest.fn().mockRejectedValue(dnsError);
    const result = await connector.verifyCandidateCredentials!({ store_hash: "candidate-hash", api_key: "candidate-key" });
    expect(result.outcome).toBe("unavailable");
    expect((result as { reasonCode?: string }).reasonCode).toBe("DNS");
  });

  it("verifyCandidateCredentials checks a candidate without touching stored credentials", async () => {
    const connector = makeConnector();
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    (global as any).fetch = fetchMock;

    const result = await connector.verifyCandidateCredentials!({ store_hash: "candidate-hash", api_key: "candidate-key" });

    expect(result.outcome).toBe("valid");
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("https://api.bigcommerce.com/stores/candidate-hash/v3/catalog/summary");
    expect(calledInit.headers["X-Auth-Token"]).toBe("candidate-key");
  });
});

describe("BigCommerceConnector.publishProduct / updateProduct", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  it("POSTs the product payload and extracts the numeric id from response.data.id", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    // The first call is the SKU lookup (nothing there yet); the second is the create.
    const fetchMock = jest.fn().mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? { ok: true, status: 201, text: async () => JSON.stringify({ data: { id: 77 } }) }
        : { ok: true, status: 200, text: async () => JSON.stringify({ data: [] }) },
    );
    (global as any).fetch = fetchMock;

    const ref = await connector.publishProduct(fakeCtx(), baseProduct);

    expect(ref.externalRef).toBe("77");
    expect(ref.status).toBe("SUCCESS");
    const [lookupUrl, lookupInit] = fetchMock.mock.calls[0];
    expect(lookupUrl).toContain("https://api.bigcommerce.com/stores/abc123/v3/catalog/products?sku=BC-001");
    expect(lookupInit.method).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://api.bigcommerce.com/stores/abc123/v3/catalog/products");
    expect(init.method).toBe("POST");
  });

  it("throws a parsed BigCommercePublishError on a validation failure", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    (global as any).fetch = jest.fn().mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? {
            ok: false,
            status: 422,
            text: async () => JSON.stringify({ title: "DuplicateSKUError", errors: { sku: "SKU already exists" } }),
          }
        : { ok: true, status: 200, text: async () => JSON.stringify({ data: [] }) },
    );

    let caught: unknown;
    try {
      await connector.publishProduct(fakeCtx(), baseProduct);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BigCommercePublishError);
    expect((caught as BigCommercePublishError).issues[0].code).toBe("DuplicateSKUError");
  });

  it("updateProduct PUTs to the product's id and returns the same externalRef", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ data: { id: 77 } }) });
    (global as any).fetch = fetchMock;

    const ref = await connector.updateProduct(fakeCtx(), baseProduct, "77");

    expect(ref.externalRef).toBe("77");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.bigcommerce.com/stores/abc123/v3/catalog/products/77");
    expect(init.method).toBe("PUT");
  });
});

describe("BigCommerceConnector.syncSubmissionStatus", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  it("returns ERROR when the product is not found (404)", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
    const result = await connector.syncSubmissionStatus!(fakeCtx(), "77");
    expect(result.status).toBe("ERROR");
    expect(result.channelErrors[0].code).toBe("PRODUCT_NOT_FOUND");
  });

  it("returns SUCCESS when is_visible is true, SUPPRESSED otherwise", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ data: { is_visible: true } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ data: { is_visible: false } }) });
    (global as any).fetch = fetchMock;

    const visible = await connector.syncSubmissionStatus!(fakeCtx(), "77");
    const hidden = await connector.syncSubmissionStatus!(fakeCtx(), "77");
    expect(visible.status).toBe("SUCCESS");
    expect(hidden.status).toBe("SUPPRESSED");
  });
});
