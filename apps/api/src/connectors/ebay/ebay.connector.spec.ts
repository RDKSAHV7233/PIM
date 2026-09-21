import type { ConnectorContext, ProductPayload } from "../../connector-framework/connector.interface";
import { EbayConnector, EbayPublishError } from "./ebay.connector";

const TEST_KEY = "c".repeat(64);

function makeConnectorWithDb(mockDbClient: any) {
  process.env.CREDENTIAL_ENCRYPTION_KEY_V1 = TEST_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION = "1";
  return new EbayConnector(
    { getClient: () => mockDbClient } as never,
    { info: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() } as never,
  );
}

function makeConnector() {
  return makeConnectorWithDb({
    connectorCredential: { findFirst: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
  });
}

const credRow = (type: string, value: string) => ({
  credentialType: type,
  encryptedValue: `enc::v1:${Buffer.from(value).toString("base64")}`,
  keyVersion: "v1",
  status: "ACTIVE",
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
  sku: "EBAY-001",
  title: "eBay mapped product",
  description: "A dropship item",
  brand: "Vexa",
  hsnCode: "",
  gstRate: 0,
  mrp: 0,
  sellingPrice: 29.99,
  mainImageUrl: "https://cdn.example.com/ebay.jpg",
  attributes: { condition: "NEW" },
  productType: "generic",
};

function fakeCtx(overrides: Partial<ConnectorContext> = {}): ConnectorContext {
  return {
    tenantId: "t1",
    installationId: "i1",
    connectorId: "ebay",
    marketplaceId: "EBAY_US",
    getAccessToken: jest.fn().mockResolvedValue("a-real-access-token"),
    ...overrides,
  } as ConnectorContext;
}

function dbWithPolicies(overrides: Record<string, ReturnType<typeof credRow> | null> = {}) {
  return {
    connectorCredential: {
      findFirst: findFirstByType({
        fulfillment_policy_id: credRow("fulfillment_policy_id", "FUL-1"),
        payment_policy_id: credRow("payment_policy_id", "PAY-1"),
        return_policy_id: credRow("return_policy_id", "RET-1"),
        ...overrides,
      }),
      upsert: jest.fn().mockResolvedValue({}),
    },
  };
}

describe("EbayConnector.validateProduct", () => {
  it("requires a title", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct(fakeCtx(), { ...baseProduct, title: "" });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.code === "MISSING_TITLE")).toBe(true);
  });

  it("rejects a title over 80 characters", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct(fakeCtx(), { ...baseProduct, title: "x".repeat(81) });
    expect(result.errors.some((e) => e.code === "TITLE_TOO_LONG")).toBe(true);
  });

  it("requires a positive price", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct(fakeCtx(), { ...baseProduct, sellingPrice: 0 });
    expect(result.errors.some((e) => e.code === "MISSING_PRICE")).toBe(true);
  });

  it("requires attributes.condition", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct(fakeCtx(), { ...baseProduct, attributes: {} });
    expect(result.errors.some((e) => e.code === "MISSING_CONDITION")).toBe(true);
  });

  it("warns (not errors) when there is no main image", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct(fakeCtx(), { ...baseProduct, mainImageUrl: "" });
    expect(result.isValid).toBe(true);
    expect(result.warnings.some((w) => w.code === "NO_IMAGE")).toBe(true);
  });

  it("accepts a fully valid product", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct(fakeCtx(), baseProduct);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe("EbayConnector.normaliseError", () => {
  it("maps known eBay error codes to seller-friendly messages with the right fieldPath", () => {
    const connector = makeConnector();
    expect(connector.normaliseError("25003", "raw").fieldPath).toBe("attributes.ebay_category_id");
    expect(connector.normaliseError("25701", "raw").fieldPath).toBe("attributes.condition");
    expect(connector.normaliseError("25715", "raw").fieldPath).toBe("mainImageUrl");
    expect(connector.normaliseError("25007", "raw").fieldPath).toBe("sellingPrice");
    expect(connector.normaliseError("25002", "raw").sellerMessage).toMatch(/listing policies/);
  });

  it("falls back to a generic message for an unmapped error code", () => {
    const connector = makeConnector();
    const issue = connector.normaliseError("99999", "some raw detail");
    expect(issue.sellerMessage).toBe("some raw detail");
  });
});

describe("EbayConnector.buildInventoryItemPayload / buildOfferPayload", () => {
  it("maps stock/condition/images and title-cases attribute keys into aspects", () => {
    const connector = makeConnector();
    const payload = (connector as any).buildInventoryItemPayload({
      ...baseProduct,
      attributes: { condition: "NEW", material_type: "Cotton" },
      additionalImageUrls: ["https://cdn.example.com/2.jpg"],
    }) as any;
    expect(payload.condition).toBe("NEW");
    expect(payload.product.imageUrls).toEqual(["https://cdn.example.com/ebay.jpg", "https://cdn.example.com/2.jpg"]);
    expect(payload.product.aspects["Material Type"]).toEqual(["Cotton"]);
    expect(payload.product.aspects["Brand"]).toEqual(["Vexa"]);
    expect(payload.availability.shipToLocationAvailability.quantity).toBe(10);
  });

  it("builds the offer payload with the supplied marketplace and policy ids", () => {
    const connector = makeConnector();
    const payload = (connector as any).buildOfferPayload(baseProduct, "EBAY_US", { fulfillment: "F", payment: "P", return: "R" }) as any;
    expect(payload.marketplaceId).toBe("EBAY_US");
    expect(payload.listingPolicies).toEqual({ fulfillmentPolicyId: "F", paymentPolicyId: "P", returnPolicyId: "R" });
    expect(payload.pricingSummary.price.value).toBe(29.99);
    expect(payload.format).toBe("FIXED_PRICE");
  });
});

describe("EbayConnector auth transport", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  it("validateStoredCredentialsDetailed reports valid on a 200 from the sandbox API", async () => {
    const connector = makeConnector();
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const result = await connector.validateStoredCredentialsDetailed(fakeCtx());
    expect(result.outcome).toBe("valid");
    const calledUrl = (global as any).fetch.mock.calls[0][0];
    expect(calledUrl).toContain("api.sandbox.ebay.com");
  });

  it("reports invalid on a 401", async () => {
    const connector = makeConnector();
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });
    const result = await connector.validateStoredCredentialsDetailed(fakeCtx());
    expect(result.outcome).toBe("invalid");
    expect((result as { reasonCode?: string }).reasonCode).toBe("HTTP_401");
  });

  it("verifyCandidateCredentials exchanges the candidate refresh_token via Basic auth against the sandbox token endpoint", async () => {
    const connector = makeConnector();
    const fetchMock = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes("/oauth2/token")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: "new-token", expires_in: 7200 }) };
      }
      return { ok: true, status: 200 };
    });
    (global as any).fetch = fetchMock;

    const result = await connector.verifyCandidateCredentials!({
      client_id: "cid",
      client_secret: "csecret",
      refresh_token: "rtoken",
    });

    expect(result.outcome).toBe("valid");
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe("https://api.sandbox.ebay.com/identity/v1/oauth2/token");
    const expectedAuth = `Basic ${Buffer.from("cid:csecret").toString("base64")}`;
    expect(tokenInit.headers.Authorization).toBe(expectedAuth);
    const body = new URLSearchParams(tokenInit.body);
    expect(body.get("grant_type")).toBe("refresh_token");
  });
});

describe("EbayConnector.publishProduct", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  it("throws EbayPublishError with a clear message when Business Policies are not configured", async () => {
    const connector = makeConnectorWithDb({
      connectorCredential: { findFirst: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
    });
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "{}" });
    await expect(connector.publishProduct(fakeCtx(), baseProduct)).rejects.toThrow(/Business Policy/);
  });

  it("upserts the inventory item, creates the offer, then publishes it, in that order", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithPolicies());
    const calls: string[] = [];
    const fetchMock = jest.fn().mockImplementation(async (url: string, init: any) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/inventory_item/")) return { ok: true, status: 200 };
      if (url.endsWith("/offer")) return { ok: true, status: 201, text: async () => JSON.stringify({ offerId: "OFFER-1" }) };
      if (url.includes("/offer/OFFER-1/publish")) return { ok: true, status: 200, text: async () => JSON.stringify({ listingId: "LISTING-1" }) };
      throw new Error(`unexpected fetch to ${url}`);
    });
    (global as any).fetch = fetchMock;

    const ref = await connector.publishProduct(fakeCtx(), baseProduct);

    expect(ref.externalRef).toBe("LISTING-1");
    expect(calls[0]).toMatch(/^PUT .*\/inventory_item\/EBAY-001$/);
    expect(calls[1]).toMatch(/^POST .*\/offer$/);
    expect(calls[2]).toMatch(/^POST .*\/offer\/OFFER-1\/publish$/);
  });

  it("throws a parsed EbayPublishError when the offer creation step fails", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithPolicies());
    const fetchMock = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes("/inventory_item/")) return { ok: true, status: 200 };
      if (url.endsWith("/offer")) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ errors: [{ errorId: 25003, message: "Invalid category" }] }),
        };
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    (global as any).fetch = fetchMock;

    let caught: unknown;
    try {
      await connector.publishProduct(fakeCtx(), baseProduct);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EbayPublishError);
    expect((caught as EbayPublishError).issues[0].code).toBe("25003");
  });
});

describe("EbayConnector.updateProduct", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  it("only upserts the inventory item — never re-runs create-offer or publish-offer", async () => {
    // Regression test for the real bug found during the port: the prototype's
    // update_product() just called publish_product() again, which would
    // re-create-and-republish an offer that already exists. eBay's inventory
    // PUT is itself an idempotent upsert; update must not touch offer/publish.
    const connector = makeConnectorWithDb(dbWithPolicies());
    const calls: string[] = [];
    const fetchMock = jest.fn().mockImplementation(async (url: string, init: any) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/inventory_item/")) return { ok: true, status: 200 };
      throw new Error(`unexpected fetch to ${url} — updateProduct must not call the offer/publish endpoints`);
    });
    (global as any).fetch = fetchMock;

    const ref = await connector.updateProduct(fakeCtx(), baseProduct, "LISTING-1");

    expect(ref.externalRef).toBe("LISTING-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^PUT .*\/inventory_item\/EBAY-001$/);
  });
});

describe("EbayConnector.syncSubmissionStatus", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  it("returns ERROR when the offer is not found (404)", async () => {
    const connector = makeConnector();
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
    const result = await connector.syncSubmissionStatus!(fakeCtx(), "OFFER-1");
    expect(result.status).toBe("ERROR");
    expect(result.channelErrors[0].code).toBe("OFFER_NOT_FOUND");
  });

  it("maps PUBLISHED to SUCCESS and ENDED to SUPPRESSED", async () => {
    const connector = makeConnector();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ status: "PUBLISHED" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ status: "ENDED" }) });
    (global as any).fetch = fetchMock;

    const published = await connector.syncSubmissionStatus!(fakeCtx(), "OFFER-1");
    const ended = await connector.syncSubmissionStatus!(fakeCtx(), "OFFER-1");
    expect(published.status).toBe("SUCCESS");
    expect(ended.status).toBe("SUPPRESSED");
  });
});

describe("EbayConnector OAuth", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  it("handleOAuthCallback requires both code and redirectUri", async () => {
    const connector = makeConnectorWithDb(dbWithPolicies({ client_id: credRow("client_id", "cid") }));
    mockDecrypt();
    await expect(connector.handleOAuthCallback!(fakeCtx(), {})).rejects.toThrow(/authorization code/);
  });

  it("handleOAuthCallback exchanges the code via authorization_code grant and persists tokens", async () => {
    const db = {
      connectorCredential: {
        findFirst: findFirstByType({
          client_id: credRow("client_id", "cid"),
          client_secret: credRow("client_secret", "csecret"),
        }),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    mockDecrypt();
    const connector = makeConnectorWithDb(db);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 7200 }),
    });
    (global as any).fetch = fetchMock;

    await connector.handleOAuthCallback!(fakeCtx(), { code: "auth-code", redirectUri: "ru-name" });

    const [, init] = fetchMock.mock.calls[0];
    const body = new URLSearchParams(init.body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(db.connectorCredential.upsert).toHaveBeenCalled();
  });

  it("refreshAccessToken uses the refresh_token grant and returns the new access_token", async () => {
    const db = {
      connectorCredential: {
        findFirst: findFirstByType({
          client_id: credRow("client_id", "cid"),
          client_secret: credRow("client_secret", "csecret"),
          refresh_token: credRow("refresh_token", "rtoken"),
        }),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    mockDecrypt();
    const connector = makeConnectorWithDb(db);
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: "rotated-access", expires_in: 7200 }),
    });

    const token = await connector.refreshAccessToken!(fakeCtx());
    expect(token).toBe("rotated-access");
  });
});
