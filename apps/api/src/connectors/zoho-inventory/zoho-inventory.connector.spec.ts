import type { ConnectorContext, ProductPayload } from "../../connector-framework/connector.interface";
import { ZohoInventoryConnector, ZohoInventoryPublishError } from "./zoho-inventory.connector";

const TEST_KEY = "d".repeat(64);

function makeConnectorWithDb(mockDbClient: any) {
  process.env.CREDENTIAL_ENCRYPTION_KEY_V1 = TEST_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION = "1";
  return new ZohoInventoryConnector(
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
  sku: "ZOHO-001",
  title: "Zoho mapped product",
  description: "A widget",
  brand: "Vexa",
  hsnCode: "",
  gstRate: 0,
  mrp: 0,
  sellingPrice: 199,
  mainImageUrl: "https://cdn.example.com/zoho.jpg",
  attributes: { hsn: "8471" },
  productType: "generic",
};

function fakeCtx(overrides: Partial<ConnectorContext> = {}): ConnectorContext {
  return {
    tenantId: "t1",
    installationId: "i1",
    connectorId: "zoho-inventory",
    getAccessToken: jest.fn().mockResolvedValue("unused"),
    ...overrides,
  } as ConnectorContext;
}

function dbWithCreds() {
  return {
    connectorCredential: {
      findFirst: findFirstByType({
        client_id: credRow("client_id", "candidate-client-id"),
        client_secret: credRow("client_secret", "candidate-client-secret"),
        refresh_token: credRow("refresh_token", "candidate-refresh-token"),
        organization_id: credRow("organization_id", "60012345678"),
      }),
    },
  };
}

describe("ZohoInventoryConnector.validateProduct", () => {
  it("requires a title, non-negative price, and warns (not errors) on missing HSN", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct(fakeCtx(), { ...baseProduct, title: "", sellingPrice: -1, attributes: {} });
    expect(result.isValid).toBe(false);
    expect(result.errors.map((e) => e.code)).toEqual(expect.arrayContaining(["MISSING_NAME", "MISSING_RATE"]));
    expect(result.warnings.some((w) => w.code === "MISSING_HSN")).toBe(true);
  });

  it("rejects a title over 100 characters and a SKU over 100 characters", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct(fakeCtx(), { ...baseProduct, title: "x".repeat(101), sku: "y".repeat(101) });
    expect(result.errors.some((e) => e.code === "NAME_TOO_LONG")).toBe(true);
    expect(result.errors.some((e) => e.code === "SKU_TOO_LONG")).toBe(true);
  });

  it("accepts a fully valid product with an HSN code and no warnings", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct(fakeCtx(), baseProduct);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});

describe("ZohoInventoryConnector.normaliseError", () => {
  it("maps known Zoho error codes to seller-friendly messages with the right fieldPath", () => {
    const connector = makeConnector();
    expect(connector.normaliseError("1001", "raw").fieldPath).toBe("sku");
    expect(connector.normaliseError("1001", "raw").sellerMessage).toMatch(/already exists/);
    expect(connector.normaliseError("2046", "raw").fieldPath).toBe("attributes.hsn");
    expect(connector.normaliseError("57", "raw").sellerMessage).toMatch(/write scope/);
  });

  it("falls back to the raw message for an unmapped code", () => {
    const connector = makeConnector();
    const issue = connector.normaliseError("99999", "some raw detail");
    expect(issue.sellerMessage).toBe("some raw detail");
  });
});

describe("ZohoInventoryConnector — data-center bug fix", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  it("resolves the India host pair when marketplaceId is 'in', not the hardcoded US host", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    (global as any).fetch = fetchMock;

    await connector.validateStoredCredentialsDetailed(fakeCtx({ marketplaceId: "in" }));

    const [calledUrl] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toContain("https://www.zohoapis.in/inventory/v1/items");
  });

  it("defaults to the global 'com' host when marketplaceId is unset", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    (global as any).fetch = fetchMock;

    await connector.validateStoredCredentialsDetailed(fakeCtx());

    const [calledUrl] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toContain("https://www.zohoapis.com/inventory/v1/items");
  });

  it("falls back to 'com' for an unrecognized region code instead of throwing", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    (global as any).fetch = fetchMock;

    await connector.validateStoredCredentialsDetailed(fakeCtx({ marketplaceId: "not-a-real-region" }));

    const [calledUrl] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toContain("https://www.zohoapis.com/inventory/v1/items");
  });
});

describe("ZohoInventoryConnector.buildItemPayload", () => {
  it("maps rate, hsn_or_sac, brand, and non-hsn/unit custom fields", () => {
    const connector = makeConnector();
    const payload = (connector as any).buildItemPayload({
      ...baseProduct,
      attributes: { hsn: "8471", unit: "box", material: "Steel" },
    }) as any;
    expect(payload.name).toBe("Zoho mapped product");
    expect(payload.sku).toBe("ZOHO-001");
    expect(payload.rate).toBe(199);
    expect(payload.hsn_or_sac).toBe("8471");
    expect(payload.unit).toBe("box");
    expect(payload.brand).toBe("Vexa");
    expect(payload.custom_fields).toEqual([{ label: "Material", value: "Steel" }]);
  });

  it("does not send taxability_type or is_taxable — Zoho rejects both on a non-GST-registered org", () => {
    const connector = makeConnector();
    const payload = (connector as any).buildItemPayload(baseProduct) as any;
    expect(payload).not.toHaveProperty("taxability_type");
    expect(payload).not.toHaveProperty("is_taxable");
  });

  it("defaults unit to pcs and hsn_or_sac to empty string when unset", () => {
    const connector = makeConnector();
    const payload = (connector as any).buildItemPayload({ ...baseProduct, attributes: {} }) as any;
    expect(payload.unit).toBe("pcs");
    expect(payload.hsn_or_sac).toBe("");
  });
});

describe("ZohoInventoryConnector auth transport", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  it("validateStoredCredentialsDetailed sends the Zoho-oauthtoken header and organization_id query param", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    (global as any).fetch = fetchMock;

    const result = await connector.validateStoredCredentialsDetailed(fakeCtx());

    expect(result.outcome).toBe("valid");
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toContain("organization_id=60012345678");
    expect(calledInit.headers.Authorization).toBe("Zoho-oauthtoken unused");
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

  it("verifyCandidateCredentials performs a real refresh_token exchange before checking reachability", async () => {
    const connector = makeConnector();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: "tok-123", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    (global as any).fetch = fetchMock;

    const result = await connector.verifyCandidateCredentials!({
      client_id: "candidate-id",
      client_secret: "candidate-secret",
      refresh_token: "candidate-refresh",
      organization_id: "60099999999",
      data_center: "eu",
    });

    expect(result.outcome).toBe("valid");
    expect((result as any).commitExtra.accessToken.value).toBe("tok-123");

    const [tokenUrl] = fetchMock.mock.calls[0];
    expect(String(tokenUrl)).toContain("https://accounts.zoho.eu/oauth/v2/token");
    expect(String(tokenUrl)).toContain("grant_type=refresh_token");

    const [checkUrl, checkInit] = fetchMock.mock.calls[1];
    expect(String(checkUrl)).toContain("https://www.zohoapis.eu/inventory/v1/items");
    expect(checkInit.headers.Authorization).toBe("Zoho-oauthtoken tok-123");
  });

  it("verifyCandidateCredentials reports invalid when Zoho returns 200 with an error body (a real Zoho quirk)", async () => {
    const connector = makeConnector();
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ error: "invalid_code" }),
    });

    const result = await connector.verifyCandidateCredentials!({
      client_id: "bad-id",
      client_secret: "bad-secret",
      refresh_token: "bad-refresh",
      organization_id: "60099999999",
    });

    expect(result.outcome).toBe("invalid");
  });
});

describe("ZohoInventoryConnector.publishProduct / updateProduct", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  it("POSTs the built item payload and returns the Zoho item_id as externalRef", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ item: { item_id: "900000012345" } }),
    });
    (global as any).fetch = fetchMock;

    const ref = await connector.publishProduct(fakeCtx(), baseProduct);

    expect(ref.externalRef).toBe("900000012345");
    expect(ref.status).toBe("SUCCESS");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("https://www.zohoapis.com/inventory/v1/items");
    expect(init.method).toBe("POST");
  });

  it("throws a parsed ZohoInventoryPublishError on a validation failure", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ code: 1001, message: "duplicate sku" }),
    });

    let caught: unknown;
    try {
      await connector.publishProduct(fakeCtx(), baseProduct);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ZohoInventoryPublishError);
    expect((caught as ZohoInventoryPublishError).issues[0].code).toBe("1001");
  });

  it("updateProduct PUTs to the item's id and returns the same externalRef", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ item: { item_id: "900000012345" } }) });
    (global as any).fetch = fetchMock;

    const ref = await connector.updateProduct(fakeCtx(), baseProduct, "900000012345");

    expect(ref.externalRef).toBe("900000012345");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("https://www.zohoapis.com/inventory/v1/items/900000012345");
    expect(init.method).toBe("PUT");
  });
});

describe("ZohoInventoryConnector.syncSubmissionStatus", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  it("returns ERROR when the item is not found (404)", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
    const result = await connector.syncSubmissionStatus!(fakeCtx(), "900000012345");
    expect(result.status).toBe("ERROR");
    expect(result.channelErrors[0].code).toBe("ITEM_NOT_FOUND");
  });

  it("returns SUCCESS when status is active, SUPPRESSED otherwise", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ item: { status: "active" } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ item: { status: "inactive" } }) });
    (global as any).fetch = fetchMock;

    const active = await connector.syncSubmissionStatus!(fakeCtx(), "900000012345");
    const inactive = await connector.syncSubmissionStatus!(fakeCtx(), "900000012345");
    expect(active.status).toBe("SUCCESS");
    expect(inactive.status).toBe("SUPPRESSED");
  });
});
