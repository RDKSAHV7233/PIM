import type { ConnectorContext, ProductPayload } from "../../connector-framework/connector.interface";
import { PrestaShopConnector, PrestaShopPublishError } from "./prestashop.connector";

const TEST_KEY = "f".repeat(64);

function makeConnectorWithDb(mockDbClient: any) {
  process.env.CREDENTIAL_ENCRYPTION_KEY_V1 = TEST_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION = "1";
  return new PrestaShopConnector(
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
  sku: "PS-001",
  title: "PrestaShop mapped product",
  description: "A local product",
  brand: "Vexa",
  hsnCode: "",
  gstRate: 0,
  mrp: 0,
  sellingPrice: 19.99,
  mainImageUrl: "https://cdn.example.com/ps.jpg",
  attributes: { prestashop_category_id: 3 },
  productType: "generic",
};

function fakeCtx(overrides: Partial<ConnectorContext> = {}): ConnectorContext {
  return {
    tenantId: "t1",
    installationId: "i1",
    connectorId: "prestashop",
    getAccessToken: jest.fn().mockResolvedValue("unused"),
    ...overrides,
  } as ConnectorContext;
}

function dbWithCreds(overrides: Record<string, ReturnType<typeof credRow> | null> = {}) {
  return {
    connectorCredential: {
      findFirst: findFirstByType({
        store_url: credRow("store_url", "https://shop.example.com"),
        api_key: credRow("api_key", "3APZBMY9TRBX48FGZIMV169DHJQJFWNM"),
        lang_id: null,
        ...overrides,
      }),
    },
  };
}

describe("PrestaShopConnector.buildProductXml", () => {
  it("maps title/description/sellingPrice/sku onto the PrestaShop XML fields", () => {
    const connector = makeConnector();
    const xml = (connector as any).buildProductXml(baseProduct, "1");
    expect(xml).toContain("<price>19.99</price>");
    expect(xml).toContain("<reference>PS-001</reference>");
    expect(xml).toContain('<name><language id="1">PrestaShop mapped product</language></name>');
    expect(xml).toContain("<id_category_default>3</id_category_default>");
  });

  it("escapes XML special characters in name/description", () => {
    const connector = makeConnector();
    const xml = (connector as any).buildProductXml({ ...baseProduct, title: 'A & B <Test> "Product"' }, "1");
    expect(xml).toContain("A &amp; B &lt;Test&gt; &quot;Product&quot;");
    expect(xml).not.toContain("<Test>");
  });

  it("falls back to the default category id when none is set", () => {
    const connector = makeConnector();
    const xml = (connector as any).buildProductXml({ ...baseProduct, attributes: {} }, "1");
    expect(xml).toContain("<id_category_default>2</id_category_default>");
  });
});

describe("PrestaShopConnector.normaliseError", () => {
  it("maps the real PrestaShop 9.1.5 codes (41/85/127/3) to seller-friendly messages", () => {
    // Regression test for the real bug found in the prototype: the original
    // table (47/84/83) does not reproduce on 9.1.5 at all.
    const connector = makeConnector();
    expect(connector.normaliseError("41", "raw").sellerMessage).toMatch(/required field is missing/);
    expect(connector.normaliseError("85", "raw").sellerMessage).toMatch(/rejected a field value/);
    expect(connector.normaliseError("127", "raw").sellerMessage).toMatch(/could not parse/);
    expect(connector.normaliseError("3", "raw").sellerMessage).toMatch(/internal error/);
  });

  it("falls back to the raw message for an unmapped code", () => {
    const connector = makeConnector();
    const issue = connector.normaliseError("999", "some raw detail");
    expect(issue.sellerMessage).toBe("some raw detail");
  });
});

describe("PrestaShopConnector.validateProduct", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  it("requires a title, non-negative price, and a category id", async () => {
    const connector = makeConnectorWithDb(dbWithCreds());
    mockDecrypt();
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const result = await connector.validateProduct(fakeCtx(), { ...baseProduct, title: "", sellingPrice: -1, attributes: {} });
    expect(result.isValid).toBe(false);
    expect(result.errors.map((e) => e.code)).toEqual(expect.arrayContaining(["MISSING_NAME", "MISSING_PRICE", "MISSING_CATEGORY"]));
  });

  it("rejects a title over 128 characters", async () => {
    const connector = makeConnectorWithDb(dbWithCreds());
    mockDecrypt();
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const result = await connector.validateProduct(fakeCtx(), { ...baseProduct, title: "x".repeat(129) });
    expect(result.errors.some((e) => e.code === "NAME_TOO_LONG")).toBe(true);
  });

  it("flags CATEGORY_NOT_FOUND when the live category lookup 404s — PrestaShop itself accepts a bad category id silently", async () => {
    // Regression test for a real platform gap found in the prototype:
    // PrestaShop's webservice does not enforce the id_category_default
    // foreign key (a nonexistent id is silently accepted with HTTP 201).
    const connector = makeConnectorWithDb(dbWithCreds());
    mockDecrypt();
    const fetchMock = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes("/categories/")) return { ok: false, status: 404 };
      return { ok: true, status: 200, text: async () => "[]" };
    });
    (global as any).fetch = fetchMock;
    const result = await connector.validateProduct(fakeCtx(), baseProduct);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.code === "CATEGORY_NOT_FOUND")).toBe(true);
  });

  it("warns (does not error) with DUPLICATE_REFERENCE_RISK when a matching reference already exists", async () => {
    // Regression test for the other platform gap: PrestaShop does not
    // enforce reference uniqueness either — duplicates are silently
    // accepted as separate products. A match returns {"products": [...]},
    // not a bare [] like the no-match case.
    const connector = makeConnectorWithDb(dbWithCreds());
    mockDecrypt();
    const fetchMock = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes("/categories/")) return { ok: true, status: 200 };
      if (url.includes("/products?")) return { ok: true, status: 200, text: async () => JSON.stringify({ products: [{ id: 42 }] }) };
      throw new Error(`unexpected fetch to ${url}`);
    });
    (global as any).fetch = fetchMock;
    const result = await connector.validateProduct(fakeCtx(), baseProduct);
    expect(result.isValid).toBe(true);
    expect(result.warnings.some((w) => w.code === "DUPLICATE_REFERENCE_RISK")).toBe(true);
  });

  it("does not warn when the reference lookup returns a bare empty array (no match)", async () => {
    const connector = makeConnectorWithDb(dbWithCreds());
    mockDecrypt();
    const fetchMock = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes("/categories/")) return { ok: true, status: 200 };
      if (url.includes("/products?")) return { ok: true, status: 200, text: async () => "[]" };
      throw new Error(`unexpected fetch to ${url}`);
    });
    (global as any).fetch = fetchMock;
    const result = await connector.validateProduct(fakeCtx(), baseProduct);
    expect(result.warnings).toHaveLength(0);
  });
});

describe("PrestaShopConnector credential validation transport", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  it("sends HTTP Basic auth with the api_key as username and an empty password", async () => {
    const connector = makeConnectorWithDb(dbWithCreds());
    mockDecrypt();
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    (global as any).fetch = fetchMock;

    const result = await connector.validateStoredCredentialsDetailed(fakeCtx());

    expect(result.outcome).toBe("valid");
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("https://shop.example.com/api/");
    const expectedAuth = `Basic ${Buffer.from("3APZBMY9TRBX48FGZIMV169DHJQJFWNM:").toString("base64")}`;
    expect(calledInit.headers.Authorization).toBe(expectedAuth);
  });

  it("rejects a non-HTTPS store URL before making any network call", async () => {
    const connector = makeConnectorWithDb(dbWithCreds({ store_url: credRow("store_url", "http://shop.example.com") }));
    mockDecrypt();
    const fetchMock = jest.fn();
    (global as any).fetch = fetchMock;

    const result = await connector.validateStoredCredentialsDetailed(fakeCtx());
    expect(result.outcome).toBe("invalid");
    expect((result as { reasonCode?: string }).reasonCode).toBe("PRESTASHOP_URL_NOT_HTTPS");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports invalid on a 401 from the API", async () => {
    const connector = makeConnectorWithDb(dbWithCreds());
    mockDecrypt();
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });
    const result = await connector.validateStoredCredentialsDetailed(fakeCtx());
    expect(result.outcome).toBe("invalid");
    expect((result as { reasonCode?: string }).reasonCode).toBe("HTTP_401");
  });

  it("reports unavailable on a network failure, not invalid", async () => {
    const connector = makeConnectorWithDb(dbWithCreds());
    mockDecrypt();
    (global as any).fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await connector.validateStoredCredentialsDetailed(fakeCtx());
    expect(result.outcome).toBe("unavailable");
  });

  it("verifyCandidateCredentials checks a candidate without touching stored credentials", async () => {
    const connector = makeConnector();
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    (global as any).fetch = fetchMock;

    const result = await connector.verifyCandidateCredentials!({
      store_url: "https://shop.example.com",
      api_key: "candidate-key",
    });

    expect(result.outcome).toBe("valid");
    const expectedAuth = `Basic ${Buffer.from("candidate-key:").toString("base64")}`;
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(expectedAuth);
  });
});

describe("PrestaShopConnector.publishProduct / updateProduct", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  it("POSTs the product XML with Basic auth and extracts the numeric id from the response", async () => {
    const connector = makeConnectorWithDb(dbWithCreds());
    mockDecrypt();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => "<prestashop><product><id><![CDATA[77]]></id></product></prestashop>",
    });
    (global as any).fetch = fetchMock;

    const ref = await connector.publishProduct(fakeCtx(), baseProduct);

    expect(ref.externalRef).toBe("77");
    expect(ref.status).toBe("SUCCESS");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://shop.example.com/api/products");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/xml");
    expect(init.body).toContain("<prestashop>");
  });

  it("throws PrestaShopPublishError with the real code+message parsed from PrestaShop's XML error envelope", async () => {
    // Regression test for the real bug found: the prototype never parsed
    // this envelope at all, so every failure fell through to a hardcoded
    // placeholder regardless of what normaliseError()'s table said.
    const connector = makeConnectorWithDb(dbWithCreds());
    mockDecrypt();
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () =>
        '<prestashop><errors><error><code><![CDATA[41]]></code><message><![CDATA[parameter "price" required]]></message></error></errors></prestashop>',
    });

    await expect(connector.publishProduct(fakeCtx(), baseProduct)).rejects.toThrow(PrestaShopPublishError);
    try {
      await connector.publishProduct(fakeCtx(), baseProduct);
    } catch (err) {
      expect(err).toBeInstanceOf(PrestaShopPublishError);
      expect((err as PrestaShopPublishError).issues[0].code).toBe("41");
      expect((err as PrestaShopPublishError).message).toMatch(/required field is missing/);
    }
  });

  it("updateProduct PUTs to the product's id and returns the same externalRef", async () => {
    const connector = makeConnectorWithDb(dbWithCreds());
    mockDecrypt();
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "<prestashop></prestashop>" });
    (global as any).fetch = fetchMock;

    const ref = await connector.updateProduct(fakeCtx(), baseProduct, "77");

    expect(ref.externalRef).toBe("77");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://shop.example.com/api/products/77");
    expect(init.method).toBe("PUT");
  });
});

describe("PrestaShopConnector.syncSubmissionStatus", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  it("returns ERROR when the product is not found (404)", async () => {
    const connector = makeConnectorWithDb(dbWithCreds());
    mockDecrypt();
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
    const result = await connector.syncSubmissionStatus!(fakeCtx(), "77");
    expect(result.status).toBe("ERROR");
    expect(result.channelErrors[0].code).toBe("PRODUCT_NOT_FOUND");
  });

  it("returns SUCCESS when active=1, SUPPRESSED otherwise", async () => {
    const connector = makeConnectorWithDb(dbWithCreds());
    mockDecrypt();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => "<active><![CDATA[1]]></active>" })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => "<active><![CDATA[0]]></active>" });
    (global as any).fetch = fetchMock;

    const active = await connector.syncSubmissionStatus!(fakeCtx(), "77");
    const inactive = await connector.syncSubmissionStatus!(fakeCtx(), "77");
    expect(active.status).toBe("SUCCESS");
    expect(inactive.status).toBe("SUPPRESSED");
  });
});
