import type { ConnectorContext, ProductPayload } from "../../connector-framework/connector.interface";
import { EtsyConnector } from "./etsy.connector";

const TEST_KEY = "d".repeat(64);

function makeConnectorWithDb(mockDbClient: any) {
  process.env.CREDENTIAL_ENCRYPTION_KEY_V1 = TEST_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION = "1";
  return new EtsyConnector(
    { getClient: () => mockDbClient } as never,
    { info: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() } as never,
  );
}

function makeConnector() {
  return makeConnectorWithDb({
    connectorCredential: { findFirst: jest.fn().mockResolvedValue(null), updateMany: jest.fn().mockResolvedValue({}) },
  });
}

const credRow = (type: string, value: string) => ({
  credentialType: type,
  encryptedValue: `enc::v1:${Buffer.from(value).toString("base64")}`,
  keyVersion: "v1",
  status: "ACTIVE",
  expiresAt: null,
});

function mockDecrypt() {
  jest
    .spyOn(require("../../connector-installer/credential-encryption.util"), "decryptCredentialValue")
    .mockImplementation((enc: unknown) => Buffer.from(String(enc).replace("enc::v1:", ""), "base64").toString("utf8"));
}

// Keyed by credentialType rather than call order — validateStoredCredentialsDetailed
// looks up refresh_token (health check) before client_id/shared_secret (headers),
// and that order is an implementation detail, not something these tests should pin.
function findFirstByType(rows: Record<string, ReturnType<typeof credRow> | null>) {
  return jest.fn().mockImplementation(({ where }: { where: { credentialType: string } }) =>
    Promise.resolve(rows[where.credentialType] ?? null),
  );
}

const baseProduct: ProductPayload = {
  sku: "ETSY-001",
  title: "Etsy mapped product",
  description: "A handcrafted item",
  brand: "Vexa",
  hsnCode: "",
  gstRate: 0,
  mrp: 0,
  sellingPrice: 24.99,
  mainImageUrl: "https://cdn.example.com/etsy.jpg",
  attributes: { who_made: "i_did", when_made: "made_to_order", taxonomy_id: 1234 },
  productType: "handmade",
};

function fakeCtx(overrides: Partial<ConnectorContext> = {}): ConnectorContext {
  return {
    tenantId: "t1",
    installationId: "i1",
    connectorId: "etsy",
    getAccessToken: jest.fn().mockResolvedValue("a-real-access-token"),
    ...overrides,
  } as ConnectorContext;
}

describe("EtsyConnector.buildListingPayload", () => {
  it("maps title/description/sellingPrice onto title/description/price", () => {
    const connector = makeConnector();
    const payload = (connector as any).buildListingPayload(baseProduct);
    expect(payload.title).toBe("Etsy mapped product");
    expect(payload.description).toBe("A handcrafted item");
    expect(payload.price).toBe(24.99);
    expect(payload.sku).toEqual(["ETSY-001"]);
  });

  it("defaults who_made/when_made/type sensibly and reads taxonomy_id as a number", () => {
    const connector = makeConnector();
    const payload = (connector as any).buildListingPayload(baseProduct);
    expect(payload.who_made).toBe("i_did");
    expect(payload.when_made).toBe("made_to_order");
    expect(payload.type).toBe("physical");
    expect(payload.taxonomy_id).toBe(1234);
  });

  it("collects mainImageUrl + additionalImageUrls into image_ids", () => {
    const connector = makeConnector();
    const payload = (connector as any).buildListingPayload({
      ...baseProduct,
      additionalImageUrls: ["https://cdn.example.com/2.jpg", "https://cdn.example.com/3.jpg"],
    });
    expect(payload.image_ids).toEqual([
      "https://cdn.example.com/etsy.jpg",
      "https://cdn.example.com/2.jpg",
      "https://cdn.example.com/3.jpg",
    ]);
  });

  it("reads a single material from attributes.material", () => {
    const connector = makeConnector();
    const payload = (connector as any).buildListingPayload({ ...baseProduct, attributes: { ...baseProduct.attributes, material: "clay" } });
    expect(payload.materials).toEqual(["clay"]);
  });
});

describe("EtsyConnector.validateProduct", () => {
  it("requires a title", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct({} as any, { ...baseProduct, title: "" });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.code === "MISSING_TITLE")).toBe(true);
  });

  it("rejects a title over 140 characters", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct({} as any, { ...baseProduct, title: "x".repeat(141) });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.code === "TITLE_TOO_LONG")).toBe(true);
  });

  it("rejects a selling price below Etsy's 0.20 minimum", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct({} as any, { ...baseProduct, sellingPrice: 0.1 });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.code === "PRICE_TOO_LOW")).toBe(true);
  });

  it("requires who_made and taxonomy_id", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct({} as any, { ...baseProduct, attributes: {} });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.code === "MISSING_WHO_MADE")).toBe(true);
    expect(result.errors.some((e) => e.code === "MISSING_TAXONOMY")).toBe(true);
  });

  it("requires at least one image", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct({} as any, { ...baseProduct, mainImageUrl: "" });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.code === "NO_IMAGE")).toBe(true);
  });

  it("accepts a fully valid product", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct({} as any, baseProduct);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe("EtsyConnector.normaliseError", () => {
  it("maps a known Etsy error code to a seller-friendly message", () => {
    const connector = makeConnector();
    const issue = connector.normaliseError("title_too_long", "raw");
    expect(issue.sellerMessage).toMatch(/140 characters/);
  });

  it("falls back to a generic message for an unmapped error code", () => {
    const connector = makeConnector();
    const issue = connector.normaliseError("some_unknown_code", "raw detail");
    expect(issue.sellerMessage).toMatch(/raw detail/);
  });
});

describe("EtsyConnector auth transport", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  it("sends x-api-key as 'client_id:shared_secret' — a bare client_id 403s (verified live 2026-09-20)", async () => {
    // Regression test for the real bug found porting this connector: the
    // prototype only sent the bare client_id, which Etsy rejects with
    // "Shared secret is required in x-api-key header."
    const db = {
      connectorCredential: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(credRow("client_id", "qckxiqackm1rdz09u3kzu1po"))
          .mockResolvedValueOnce(credRow("shared_secret", "1ba80bcg6f")),
      },
    };
    mockDecrypt();
    const connector = makeConnectorWithDb(db);
    const headers = await (connector as any).buildApiHeaders(fakeCtx());
    expect(headers["x-api-key"]).toBe("qckxiqackm1rdz09u3kzu1po:1ba80bcg6f");
    expect(headers["Authorization"]).toBe("Bearer a-real-access-token");
  });

  it("validateStoredCredentialsDetailed calls /seller-taxonomy/nodes — NOT the nonexistent /taxonomy/seller", async () => {
    // Regression test for the second real bug found: /taxonomy/seller doesn't
    // exist on Etsy's v3 API and 404s unconditionally, regardless of
    // credential validity. Verified live 2026-09-20.
    const db = {
      connectorCredential: {
        findFirst: findFirstByType({
          client_id: credRow("client_id", "qckxiqackm1rdz09u3kzu1po"),
          shared_secret: credRow("shared_secret", "1ba80bcg6f"),
          refresh_token: null,
        }),
        updateMany: jest.fn().mockResolvedValue({}),
      },
    };
    mockDecrypt();
    const connector = makeConnectorWithDb(db);
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    (global as any).fetch = fetchMock;

    const result = await connector.validateStoredCredentialsDetailed(fakeCtx());

    expect(result.outcome).toBe("valid");
    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toBe("https://openapi.etsy.com/v3/application/seller-taxonomy/nodes");
  });

  it("validateStoredCredentialsDetailed reports invalid on a 403 from the API", async () => {
    const db = {
      connectorCredential: {
        findFirst: findFirstByType({
          client_id: credRow("client_id", "qckxiqackm1rdz09u3kzu1po"),
          shared_secret: credRow("shared_secret", "wrong"),
          refresh_token: null,
        }),
        updateMany: jest.fn().mockResolvedValue({}),
      },
    };
    mockDecrypt();
    const connector = makeConnectorWithDb(db);
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 });

    const result = await connector.validateStoredCredentialsDetailed(fakeCtx());
    expect(result.outcome).toBe("invalid");
    expect((result as { outcome: "invalid"; reasonCode?: string }).reasonCode).toBe("HTTP_403");
  });

  it("refreshAccessToken persists the rotated refresh_token — Etsy invalidates the old one on every use", async () => {
    const storeCalls: Array<{ type: string; value: string }> = [];
    const db = {
      connectorCredential: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(credRow("client_id", "qckxiqackm1rdz09u3kzu1po"))
          .mockResolvedValueOnce(credRow("refresh_token", "old-refresh-token")),
        upsert: jest.fn().mockImplementation(({ create }: any) => {
          storeCalls.push({ type: create.credentialType, value: "stored" });
          return Promise.resolve({});
        }),
      },
    };
    mockDecrypt();
    const connector = makeConnectorWithDb(db);
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          access_token: "new-access-token",
          refresh_token: "rotated-refresh-token",
          expires_in: 3600,
        }),
    });

    const token = await connector.refreshAccessToken(fakeCtx());

    expect(token).toBe("new-access-token");
    expect(storeCalls.map((c) => c.type)).toEqual(expect.arrayContaining(["access_token", "refresh_token"]));
  });
});
