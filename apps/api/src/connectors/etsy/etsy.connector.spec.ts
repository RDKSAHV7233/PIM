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

  it("never includes image_ids — Etsy's create/update endpoints require already-uploaded numeric image IDs, not URLs", () => {
    // Regression test for the real bug found in review: the original payload
    // sent raw image URLs as image_ids, but Etsy's v3 API expects numeric IDs
    // of images already uploaded via a separate per-image call. Images are
    // attached afterwards by uploadListingImages(), not in this payload.
    const connector = makeConnector();
    const payload = (connector as any).buildListingPayload({
      ...baseProduct,
      additionalImageUrls: ["https://cdn.example.com/2.jpg", "https://cdn.example.com/3.jpg"],
    });
    expect(payload).not.toHaveProperty("image_ids");
  });

  it("reads a single material from attributes.material", () => {
    const connector = makeConnector();
    const payload = (connector as any).buildListingPayload({ ...baseProduct, attributes: { ...baseProduct.attributes, material: "clay" } });
    expect(payload.materials).toEqual(["clay"]);
  });

  it("passes shipping_profile_id/return_policy_id through when set — needed to activate a physical listing", () => {
    const connector = makeConnector();
    const payload = (connector as any).buildListingPayload({
      ...baseProduct,
      attributes: { ...baseProduct.attributes, shipping_profile_id: 42, return_policy_id: 7 },
    });
    expect(payload.shipping_profile_id).toBe(42);
    expect(payload.return_policy_id).toBe(7);
  });

  it("omits shipping_profile_id/return_policy_id entirely when not set, rather than sending 0/null", () => {
    const connector = makeConnector();
    const payload = (connector as any).buildListingPayload(baseProduct);
    expect(payload).not.toHaveProperty("shipping_profile_id");
    expect(payload).not.toHaveProperty("return_policy_id");
  });
});

describe("EtsyConnector.encodeFormBody", () => {
  it("joins array fields with commas rather than repeating the key", () => {
    // Etsy's spec documents `tags` as "a comma-separated list of tag strings"
    // for the form-urlencoded body — not repeated `tags=a&tags=b` pairs.
    const connector = makeConnector();
    const encoded = (connector as any).encodeFormBody({ tags: ["a", "b", "c"], title: "hello world" });
    const params = new URLSearchParams(encoded);
    expect(params.get("tags")).toBe("a,b,c");
    expect(params.get("title")).toBe("hello world");
  });

  it("omits null/undefined fields and empty arrays", () => {
    const connector = makeConnector();
    const encoded = (connector as any).encodeFormBody({ materials: [], missing: undefined, price: 12.5 });
    const params = new URLSearchParams(encoded);
    expect(params.has("materials")).toBe(false);
    expect(params.has("missing")).toBe(false);
    expect(params.get("price")).toBe("12.5");
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

  it("warns (does not block) when a physical listing has no shipping_profile_id — Etsy will accept the draft but refuse to activate it", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct({} as any, baseProduct);
    expect(result.isValid).toBe(true);
    expect(result.warnings.some((w) => w.code === "MISSING_SHIPPING_PROFILE")).toBe(true);
  });

  it("does not warn once shipping_profile_id is set", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct(
      {} as any,
      { ...baseProduct, attributes: { ...baseProduct.attributes, shipping_profile_id: 42 } },
    );
    expect(result.warnings.some((w) => w.code === "MISSING_SHIPPING_PROFILE")).toBe(false);
  });

  it("does not warn for a digital (download) listing — no shipping profile applies", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct(
      {} as any,
      { ...baseProduct, attributes: { ...baseProduct.attributes, listing_type: "download" } },
    );
    expect(result.warnings.some((w) => w.code === "MISSING_SHIPPING_PROFILE")).toBe(false);
  });

  it("warns (does not block) when when_made is missing — buildListingPayload silently defaults it to made_to_order", async () => {
    const connector = makeConnector();
    const { when_made, ...rest } = baseProduct.attributes as Record<string, unknown>;
    const result = await connector.validateProduct({} as any, { ...baseProduct, attributes: rest });
    expect(result.isValid).toBe(true);
    expect(result.warnings.some((w) => w.code === "MISSING_WHEN_MADE")).toBe(true);
  });

  it("does not warn about when_made once it is set", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct({} as any, baseProduct);
    expect(result.warnings.some((w) => w.code === "MISSING_WHEN_MADE")).toBe(false);
  });

  it("warns (does not block) when is_supply is missing — buildListingPayload silently defaults it to false", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct({} as any, baseProduct);
    expect(result.isValid).toBe(true);
    expect(result.warnings.some((w) => w.code === "MISSING_IS_SUPPLY")).toBe(true);
  });

  it("does not warn about is_supply once it is explicitly set (including false)", async () => {
    const connector = makeConnector();
    const result = await connector.validateProduct(
      {} as any,
      { ...baseProduct, attributes: { ...baseProduct.attributes, is_supply: false } },
    );
    expect(result.warnings.some((w) => w.code === "MISSING_IS_SUPPLY")).toBe(false);
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

describe("EtsyConnector.describeFailure", () => {
  // Regression tests for a real bug found in review: Etsy's REST resource
  // endpoints (listings, images, ...) don't use the OAuth error/error_description
  // shape — a failure body is just {"error": "<full human-readable message>"},
  // e.g. {"error":"Missing input parameter: [products]"} (confirmed against
  // Etsy's published OpenAPI spec 2026-09-22). describeFailure used to treat
  // that whole sentence as a short machine code, so instead of surfacing it,
  // sellers saw it re-derived as "Etsy returned an error: MISSING INPUT
  // PARAMETER: [PRODUCTS]. Contact support." — shouted, mangled, and strictly
  // worse than Etsy's own message.
  it("surfaces Etsy's real single-field error message verbatim instead of re-deriving a shouted fallback", () => {
    const connector = makeConnector();
    const described = (connector as any).describeFailure({ error: "Missing input parameter: [products]" }, 400);
    expect(described).toBe("Missing input parameter: [products]");
  });

  it("still prefers a curated ERROR_MESSAGES entry when the error code actually matches one", () => {
    const connector = makeConnector();
    const described = (connector as any).describeFailure({ error: "title_too_long" }, 400);
    expect(described).toMatch(/140 characters/);
  });

  it("falls back to the status code when the body has no usable text at all", () => {
    const connector = makeConnector();
    const described = (connector as any).describeFailure({}, 500);
    expect(described).toBe("Etsy request failed with status 500.");
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

describe("EtsyConnector.publishProduct / updateProduct — form encoding + image upload", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = undefined;
  });

  function dbWithCreds() {
    return {
      connectorCredential: {
        findFirst: findFirstByType({
          shop_id: credRow("shop_id", "98765"),
          client_id: credRow("client_id", "qckxiqackm1rdz09u3kzu1po"),
          shared_secret: credRow("shared_secret", "1ba80bcg6f"),
        }),
        updateMany: jest.fn().mockResolvedValue({}),
      },
    };
  }

  it("sends the listing body as form-urlencoded (not JSON) and uploads images per-file afterwards", async () => {
    // Regression test for the second real bug found alongside image_ids:
    // Etsy's create/update listing endpoints only accept
    // application/x-www-form-urlencoded per its Open API v3 spec — a JSON
    // body with a JSON content-type is silently unparseable there.
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    const calls: Array<{ url: string; init: any }> = [];
    const fetchMock = jest.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      if (url.endsWith("/listings") && init?.method === "POST") {
        return { ok: true, status: 201, text: async () => JSON.stringify({ listing_id: 555 }) };
      }
      if (url === "https://cdn.example.com/etsy.jpg") {
        return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) };
      }
      if (url.includes("/images")) {
        return { ok: true, status: 201, text: async () => JSON.stringify({ listing_image_id: 1 }) };
      }
      if (url.endsWith("/listings/555") && init?.method === "PATCH") {
        return { ok: true, status: 200, text: async () => JSON.stringify({ listing_id: 555, state: "active" }) };
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    (global as any).fetch = fetchMock;

    const ref = await connector.publishProduct(fakeCtx(), baseProduct);

    expect(ref.externalRef).toBe("555");
    const listingCall = calls.find((c) => c.url.endsWith("/listings") && c.init.method === "POST");
    expect(listingCall!.init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(typeof listingCall!.init.body).toBe("string");
    expect(listingCall!.init.body.trim().startsWith("{")).toBe(false);
    const bodyParams = new URLSearchParams(listingCall!.init.body);
    expect(bodyParams.get("title")).toBe(baseProduct.title);
    expect(bodyParams.has("image_ids")).toBe(false);

    const imageCall = calls.find((c) => c.url.includes("/images"));
    expect(imageCall).toBeDefined();
    expect(imageCall!.url).toBe("https://openapi.etsy.com/v3/application/shops/98765/listings/555/images");
    expect(imageCall!.init.body).toBeInstanceOf(FormData);
  });

  it("does not fail the publish when a single image fails to upload — the listing already exists and is editable", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    const fetchMock = jest.fn().mockImplementation(async (url: string, init: any) => {
      if (url.endsWith("/listings") && init?.method === "POST") {
        return { ok: true, status: 201, text: async () => JSON.stringify({ listing_id: 555 }) };
      }
      if (url === "https://cdn.example.com/etsy.jpg") {
        return { ok: false, status: 404 };
      }
      if (url.endsWith("/listings/555") && init?.method === "PATCH") {
        return { ok: true, status: 200, text: async () => JSON.stringify({ listing_id: 555, state: "active" }) };
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    (global as any).fetch = fetchMock;

    const ref = await connector.publishProduct(fakeCtx(), baseProduct);
    expect(ref.externalRef).toBe("555");
  });

  describe("activateListing — the real fix: createDraftListing never goes live on its own", () => {
    // Regression tests for the core bug found in review: POST .../listings is
    // Etsy's createDraftListing — its request schema has no `state` field, so
    // it can only ever create a draft. Nothing on etsy.com becomes visible
    // until a separate PATCH sets state=active. The ported prototype never
    // made that second call, so every "published" product would have sat in
    // the shop as an invisible draft forever — never caught because publish
    // has never been exercised against a real shop.
    function imageCapableFetch(handlePatch: (init: any) => { ok: boolean; status: number; text: () => Promise<string> }) {
      const calls: Array<{ url: string; init: any }> = [];
      const fetchMock = jest.fn().mockImplementation(async (url: string, init: any) => {
        calls.push({ url, init });
        if (url.endsWith("/listings") && init?.method === "POST") {
          return { ok: true, status: 201, text: async () => JSON.stringify({ listing_id: 555 }) };
        }
        if (url === "https://cdn.example.com/etsy.jpg") {
          return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) };
        }
        if (url.includes("/images")) {
          return { ok: true, status: 201, text: async () => JSON.stringify({ listing_image_id: 1 }) };
        }
        if (url.endsWith("/listings/555") && init?.method === "PATCH") {
          return handlePatch(init);
        }
        throw new Error(`unexpected fetch to ${url}`);
      });
      return { fetchMock, calls };
    }

    it("PATCHes state=active after a successful create + image upload", async () => {
      mockDecrypt();
      const connector = makeConnectorWithDb(dbWithCreds());
      const { fetchMock, calls } = imageCapableFetch(() => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ listing_id: 555, state: "active" }),
      }));
      (global as any).fetch = fetchMock;

      await connector.publishProduct(
        fakeCtx(),
        { ...baseProduct, attributes: { ...baseProduct.attributes, shipping_profile_id: 42, return_policy_id: 7 } },
      );

      const activationCall = calls.find((c) => c.url.endsWith("/listings/555") && c.init.method === "PATCH");
      expect(activationCall).toBeDefined();
      const params = new URLSearchParams(activationCall!.init.body);
      expect(params.get("state")).toBe("active");
      expect(params.get("shipping_profile_id")).toBe("42");
      expect(params.get("return_policy_id")).toBe("7");
    });

    it("does not fail the publish when activation is rejected — the draft still exists and is editable", async () => {
      // e.g. a physical listing with no valid shipping profile: Etsy accepts
      // the draft but rejects activation. Same fail-open handling as a single
      // image failing to upload.
      mockDecrypt();
      const connector = makeConnectorWithDb(dbWithCreds());
      const { fetchMock } = imageCapableFetch(() => ({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: "Shipping profile is required for a physical listing." }),
      }));
      (global as any).fetch = fetchMock;

      const ref = await connector.publishProduct(fakeCtx(), baseProduct);
      expect(ref.externalRef).toBe("555");
    });

    it("updateProduct never sends state=active — forcing it on every edit would undo a seller's own deactivation or renew a sold_out listing", async () => {
      mockDecrypt();
      const connector = makeConnectorWithDb(dbWithCreds());
      const calls: Array<{ url: string; init: any }> = [];
      const fetchMock = jest.fn().mockImplementation(async (url: string, init: any) => {
        calls.push({ url, init });
        if (url.endsWith("/listings/555") && init?.method === "PATCH") {
          return { ok: true, status: 200, text: async () => JSON.stringify({ listing_id: 555 }) };
        }
        if (url === "https://cdn.example.com/etsy.jpg") {
          return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) };
        }
        if (url.includes("/images")) {
          return { ok: true, status: 201, text: async () => JSON.stringify({ listing_image_id: 1 }) };
        }
        throw new Error(`unexpected fetch to ${url}`);
      });
      (global as any).fetch = fetchMock;

      await connector.updateProduct(fakeCtx(), baseProduct, "555");

      const patchCalls = calls.filter((c) => c.url.endsWith("/listings/555") && c.init.method === "PATCH");
      expect(patchCalls).toHaveLength(1);
      const params = new URLSearchParams(patchCalls[0].init.body);
      expect(params.has("state")).toBe(false);
    });
  });

  it("updateProduct also form-encodes the body and re-uploads images against the existing externalRef", async () => {
    mockDecrypt();
    const connector = makeConnectorWithDb(dbWithCreds());
    const calls: Array<{ url: string; init: any }> = [];
    const fetchMock = jest.fn().mockImplementation(async (url: string, init: any) => {
      calls.push({ url, init });
      if (url.endsWith("/listings/555") && init?.method === "PATCH") {
        return { ok: true, status: 200, text: async () => JSON.stringify({ listing_id: 555 }) };
      }
      if (url === "https://cdn.example.com/etsy.jpg") {
        return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) };
      }
      if (url.includes("/images")) {
        return { ok: true, status: 201, text: async () => JSON.stringify({ listing_image_id: 1 }) };
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    (global as any).fetch = fetchMock;

    const ref = await connector.updateProduct(fakeCtx(), baseProduct, "555");

    expect(ref.externalRef).toBe("555");
    const listingCall = calls.find((c) => c.url.endsWith("/listings/555") && c.init.method === "PATCH");
    expect(listingCall!.init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const imageCall = calls.find((c) => c.url.includes("/images"));
    expect(imageCall).toBeDefined();
  });
});
