import type { ProductPayload } from "../../connector-framework/connector.interface";
import { ConnectorNetworkError } from "../../connector-framework/connector.errors";
import { WooCommerceConnector } from "./woocommerce.connector";

const TEST_KEY = "c".repeat(64);

function makeConnectorWithDb(mockDbClient: any) {
  process.env.CREDENTIAL_ENCRYPTION_KEY_V1 = TEST_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION = "1";

  return new WooCommerceConnector(
    { getClient: () => mockDbClient } as never,
    { info: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() } as never,
  );
}

function makeConnector() {
  return makeConnectorWithDb({
    connectorCredential: {
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({}),
    },
    $queryRawUnsafe: jest.fn().mockResolvedValue([]), // RLS-BYPASS: manual tenant filter — test mock
    $executeRawUnsafe: jest.fn().mockResolvedValue(1), // RLS-BYPASS: manual tenant filter — test mock
  });
}

describe("WooCommerceConnector product payload", () => {
  const baseProduct: ProductPayload = {
    sku: "WC-001",
    title: "Woo mapped product",
    description: "Woo product description",
    brand: "Vexa",
    hsnCode: "6204",
    gstRate: 12,
    mrp: 1299,
    sellingPrice: 999,
    mainImageUrl: "https://cdn.example.com/wc.jpg",
    attributes: {},
    productType: "Kurtas",
  };

  it("includes mapped customMeta entries in WooCommerce meta_data without overwriting reserved Vexa keys", () => {
    const connector = makeConnector();
    const payload = (connector as any).buildWcProductPayload(
      {
        ...baseProduct,
        customMeta: [
          { key: "material", value: "Cotton" },
          { key: "fabric_care", value: "Machine wash" },
          { key: "_vexa_pim_product_id", value: "forged" },
        ],
      },
      [],
      [],
    );

    expect(payload.meta_data).toEqual(expect.arrayContaining([
      { key: "_vexa_pim_product_id", value: "WC-001" },
      { key: "_vexa_hsn_code", value: "6204" },
      { key: "material", value: "Cotton" },
      { key: "fabric_care", value: "Machine wash" },
    ]));
    expect(payload.meta_data.filter((entry: { key: string }) => entry.key === "_vexa_pim_product_id")).toHaveLength(1);
  });
});

describe("WooCommerceConnector.handleOAuthCallback app-auth credential persistence", () => {
  it("stores consumer credentials with explicit tenant ownership", async () => {
    const db = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(1), // RLS-BYPASS: manual tenant filter — test mock
    };
    const connector = makeConnectorWithDb(db);
    const ctx = {
      tenantId: "tenant-a",
      installationId: "woo-install-a",
      connectorId: "woocommerce",
    };

    await expect(connector.handleOAuthCallback(ctx as any, {
      consumer_key: "ck_live",
      consumer_secret: "cs_live",
      key_permissions: "read_write",
    })).resolves.toBeUndefined();

    expect(db.$executeRawUnsafe).toHaveBeenCalledTimes(2); // RLS-BYPASS: manual tenant filter — test mock
    for (const call of db.$executeRawUnsafe.mock.calls) { // RLS-BYPASS: manual tenant filter — test mock
      expect(String(call[0]).toLowerCase()).toContain("tenant_key");
      expect(call[2]).toBe(ctx.tenantId);
      expect(call[3]).toBe(ctx.installationId);
    }
    expect(db.$executeRawUnsafe.mock.calls[0][1]).toBe("woo-install-a:consumer_key"); // RLS-BYPASS: manual tenant filter — test mock
    expect(db.$executeRawUnsafe.mock.calls[1][1]).toBe("woo-install-a:consumer_secret"); // RLS-BYPASS: manual tenant filter — test mock
  });

  it("denies app-auth persistence without a tenant context", async () => {
    const db = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(1), // RLS-BYPASS: manual tenant filter — test mock
    };
    const connector = makeConnectorWithDb(db);

    await expect(connector.handleOAuthCallback({
      tenantId: "",
      installationId: "woo-install-a",
      connectorId: "woocommerce",
    } as any, {
      consumer_key: "ck_live",
      consumer_secret: "cs_live",
    })).rejects.toThrow("tenant");

    expect(db.$executeRawUnsafe).not.toHaveBeenCalled(); // RLS-BYPASS: manual tenant filter — test mock
  });
});

describe("WooCommerceConnector stored credential tenant isolation", () => {
  it("scopes every stored credential read by tenant, installation, and type", async () => {
    const db = {
      connectorCredential: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const connector = makeConnectorWithDb(db);

    await expect((connector as any).resolveCredentials({
      tenantId: "tenant-a",
      installationId: "woo-install-a",
      connectorId: "woocommerce",
    })).rejects.toThrow("incomplete");

    expect(db.connectorCredential.findFirst).toHaveBeenCalledTimes(3);
    expect(db.connectorCredential.findFirst).toHaveBeenNthCalledWith(1, {
      where: { tenantKey: "tenant-a", installationId: "woo-install-a", credentialType: "site_url" },
      select: { encryptedValue: true, keyVersion: true },
    });
    expect(db.connectorCredential.findFirst).toHaveBeenNthCalledWith(2, {
      where: { tenantKey: "tenant-a", installationId: "woo-install-a", credentialType: "consumer_key" },
      select: { encryptedValue: true, keyVersion: true },
    });
    expect(db.connectorCredential.findFirst).toHaveBeenNthCalledWith(3, {
      where: { tenantKey: "tenant-a", installationId: "woo-install-a", credentialType: "consumer_secret" },
      select: { encryptedValue: true, keyVersion: true },
    });
  });

  it("denies stored credential reads before DB access when tenant context is missing", async () => {
    const db = {
      connectorCredential: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const connector = makeConnectorWithDb(db);

    await expect((connector as any).resolveCredentials({
      tenantId: "",
      installationId: "woo-install-a",
      connectorId: "woocommerce",
    })).rejects.toThrow("tenant context");

    expect(db.connectorCredential.findFirst).not.toHaveBeenCalled();
  });

  it("scopes per-installation webhook secret reads by tenant when webhook context includes tenant", async () => {
    const db = {
      connectorCredential: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const connector = makeConnectorWithDb(db);

    await expect(connector.parseWebhookEvent(
      Buffer.from("{}"),
      {},
      { tenantId: "tenant-a", installationId: "woo-install-a" },
    )).resolves.toBeNull();

    expect(db.connectorCredential.findFirst).toHaveBeenCalledWith({
      where: { tenantKey: "tenant-a", installationId: "woo-install-a", credentialType: "webhook_secret" },
      select: { encryptedValue: true, keyVersion: true },
    });
  });

  it("does not read a per-installation webhook secret without tenant context", async () => {
    const db = {
      connectorCredential: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const connector = makeConnectorWithDb(db);

    await expect(connector.parseWebhookEvent(
      Buffer.from("{}"),
      {},
      { installationId: "woo-install-a" },
    )).resolves.toBeNull();

    expect(db.connectorCredential.findFirst).not.toHaveBeenCalled();
  });
});

describe("ConnectorNetworkError", () => {
  it("produces an actionable retry message for retryable errors", () => {
    const err = new ConnectorNetworkError("woocommerce", "TIMEOUT", true, "request exceeded 30000ms timeout");
    expect(err.message).toContain("retry automatically");
    expect(err.retryable).toBe(true);
    expect(err.category).toBe("TIMEOUT");
    expect(err.name).toBe("ConnectorNetworkError");
  });

  it("produces a credential-check message for non-retryable errors", () => {
    const err = new ConnectorNetworkError("woocommerce", "DNS", false, "DNS resolution failed (ENOTFOUND)");
    expect(err.message).toContain("Check your woocommerce store URL");
    expect(err.message).toContain("DNS resolution failed");
    expect(err.retryable).toBe(false);
    expect(err.category).toBe("DNS");
  });

  it("produces a credential-check message for TLS errors", () => {
    const err = new ConnectorNetworkError("woocommerce", "TLS", false, "TLS/certificate error (ERR_TLS_CERT_ALTNAME_INVALID)");
    expect(err.retryable).toBe(false);
    expect(err.category).toBe("TLS");
    expect(err.message).toContain("Check your woocommerce store URL");
  });

  it("produces an actionable retry message for NETWORK category", () => {
    const err = new ConnectorNetworkError("woocommerce", "NETWORK", true, "connection failed (ECONNRESET)");
    expect(err.retryable).toBe(true);
    expect(err.category).toBe("NETWORK");
    expect(err.message).toContain("retry automatically");
  });

  it("is an instance of Error", () => {
    const err = new ConnectorNetworkError("woocommerce", "TIMEOUT", true, "timeout");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ConnectorNetworkError);
  });
});

describe("WooCommerceConnector.validateCredentials (BUG-WOO-HEALTH-001 / #472)", () => {
  const ctx = { tenantId: "t1", installationId: "inst-1", connectorId: "conn-1" };

  function mockResolvedCredentials(connector: WooCommerceConnector) {
    jest.spyOn(connector as any, "resolveCredentials").mockResolvedValue({
      siteUrl: "https://example.com",
      consumerKey: "ck_test",
      consumerSecret: "cs_test",
    });
  }

  it("returns true and does not treat a retryable network failure as invalid credentials", async () => {
    const connector = makeConnector();
    mockResolvedCredentials(connector);
    jest.spyOn(connector as any, "callApi").mockRejectedValue(
      new ConnectorNetworkError("woocommerce", "NETWORK", true, "connection failed (ECONNRESET)"),
    );

    await expect(connector.validateCredentials(ctx as any)).resolves.toBe(true);
  });

  it("still returns false for a non-retryable network failure (DNS/TLS)", async () => {
    const connector = makeConnector();
    mockResolvedCredentials(connector);
    jest.spyOn(connector as any, "callApi").mockRejectedValue(
      new ConnectorNetworkError("woocommerce", "DNS", false, "DNS resolution failed (ENOTFOUND)"),
    );

    await expect(connector.validateCredentials(ctx as any)).resolves.toBe(false);
  });

  it("still returns false on a 401/403 auth rejection", async () => {
    const connector = makeConnector();
    mockResolvedCredentials(connector);
    jest.spyOn(connector as any, "callApi").mockResolvedValue({ status: 401, ok: false } as Response);

    await expect(connector.validateCredentials(ctx as any)).resolves.toBe(false);
  });

  it("still returns true on a healthy response", async () => {
    const connector = makeConnector();
    mockResolvedCredentials(connector);
    jest.spyOn(connector as any, "callApi").mockResolvedValue({ status: 200, ok: true } as Response);

    await expect(connector.validateCredentials(ctx as any)).resolves.toBe(true);
  });

  it("hits a real, auth-required resource — not the unauthenticated bare API root (PIM#582)", async () => {
    // The bare /wp-json/wc/v3 root is WordPress's public route-discovery endpoint: it
    // returns 200 with no Authorization header at all (live-verified against a real
    // store), so calling it can never distinguish valid credentials from garbage ones.
    // /products is a real protected resource that correctly 401s on wrong credentials.
    const connector = makeConnector();
    mockResolvedCredentials(connector);
    const callApi = jest.spyOn(connector as any, "callApi").mockResolvedValue({ status: 200, ok: true } as Response);

    await connector.validateCredentials(ctx as any);

    expect(callApi).toHaveBeenCalledWith("GET", "/products?per_page=1", "https://example.com", "ck_test", "cs_test");
  });
});

// PIM#653 — validateStoredCredentialsDetailed() is a SEPARATE method from
// validateCredentials() above, used only by reconnect (not the heartbeat, and not
// install — WooCommerce's install path defers all live checking to the heartbeat).
// It must be honest about a network failure ("unavailable", not "assume valid") —
// the opposite of validateCredentials()'s own #472 behavior for the SAME input,
// because a one-shot user-initiated reconnect claiming success without having
// actually checked is misleading in a way a background heartbeat's one-cycle delay
// is not. Both tests below reuse the exact same mocked failures the #472 tests
// above use, to prove validateCredentials() itself is completely unaffected.
describe("WooCommerceConnector.validateStoredCredentialsDetailed (PIM#653 — reconnect only, not heartbeat)", () => {
  const ctx = { tenantId: "t1", installationId: "inst-1", connectorId: "conn-1" };

  function mockResolvedCredentials(connector: WooCommerceConnector) {
    jest.spyOn(connector as any, "resolveCredentials").mockResolvedValue({
      siteUrl: "https://example.com",
      consumerKey: "ck_test",
      consumerSecret: "cs_test",
    });
  }

  it("returns unavailable (NOT valid/true) on the exact same retryable network failure validateCredentials() treats as true — the whole point of this method", async () => {
    const connector = makeConnector();
    mockResolvedCredentials(connector);
    jest.spyOn(connector as any, "callApi").mockRejectedValue(
      new ConnectorNetworkError("woocommerce", "NETWORK", true, "connection failed (ECONNRESET)"),
    );

    await expect(connector.validateStoredCredentialsDetailed(ctx as any)).resolves.toEqual({
      outcome: "unavailable",
      reasonCode: "NETWORK",
    });
    // validateCredentials() itself must be completely unaffected by this method existing.
    await expect(connector.validateCredentials(ctx as any)).resolves.toBe(true);
  });

  it("returns invalid on a 401/403 auth rejection", async () => {
    const connector = makeConnector();
    mockResolvedCredentials(connector);
    jest.spyOn(connector as any, "callApi").mockResolvedValue({ status: 401, ok: false } as Response);

    await expect(connector.validateStoredCredentialsDetailed(ctx as any)).resolves.toEqual({
      outcome: "invalid",
      reasonCode: "WOOCOMMERCE_CREDENTIALS_REJECTED",
    });
  });

  it("returns valid on a healthy response", async () => {
    const connector = makeConnector();
    mockResolvedCredentials(connector);
    jest.spyOn(connector as any, "callApi").mockResolvedValue({ status: 200, ok: true } as Response);

    await expect(connector.validateStoredCredentialsDetailed(ctx as any)).resolves.toEqual({ outcome: "valid" });
  });

  it("returns unavailable for a non-retryable network failure too (DNS/TLS) — unlike validateCredentials(), which returns false for this case, not true", async () => {
    const connector = makeConnector();
    mockResolvedCredentials(connector);
    jest.spyOn(connector as any, "callApi").mockRejectedValue(
      new ConnectorNetworkError("woocommerce", "DNS", false, "DNS resolution failed (ENOTFOUND)"),
    );

    const result = await connector.validateStoredCredentialsDetailed(ctx as any);
    expect(result.outcome).toBe("unavailable");
  });
});

describe("WooCommerceConnector.verifyCandidateCredentials", () => {
  const candidate = {
    site_url: "https://candidate-store.example.com",
    consumer_key: "ck_candidate",
    consumer_secret: "cs_candidate",
  };

  it("returns valid on a healthy response", async () => {
    const connector = makeConnector();
    const callApi = jest.spyOn(connector as any, "callApi").mockResolvedValue({ status: 200, ok: true } as Response);

    await expect(connector.verifyCandidateCredentials!(candidate)).resolves.toEqual({ outcome: "valid" });
    // Candidate-purity: the connector's HTTP call is made with the candidate's own
    // values, not any stored value — asserted by checking callApi's actual arguments.
    // The path must be a real, auth-required resource (PIM#582) — the bare root is
    // WordPress's public route-discovery endpoint and returns 200 with no auth at all,
    // so it can never actually verify credentials.
    expect(callApi).toHaveBeenCalledWith("GET", "/products?per_page=1", candidate.site_url, candidate.consumer_key, candidate.consumer_secret);
  });

  it("returns invalid on 401", async () => {
    const connector = makeConnector();
    jest.spyOn(connector as any, "callApi").mockResolvedValue({ status: 401, ok: false } as Response);

    await expect(connector.verifyCandidateCredentials!(candidate)).resolves.toEqual({
      outcome: "invalid",
      reasonCode: "WOOCOMMERCE_CREDENTIALS_REJECTED",
    });
  });

  it("returns invalid for a non-HTTPS site URL without making a network call", async () => {
    const connector = makeConnector();
    const callApi = jest.spyOn(connector as any, "callApi");

    const result = await connector.verifyCandidateCredentials!({ ...candidate, site_url: "http://insecure.example.com" });

    expect(result).toEqual({ outcome: "invalid", reasonCode: "WOOCOMMERCE_SITE_URL_NOT_HTTPS" });
    expect(callApi).not.toHaveBeenCalled();
  });

  it("returns unavailable, not invalid, on a retryable network failure", async () => {
    const connector = makeConnector();
    jest.spyOn(connector as any, "callApi").mockRejectedValue(
      new ConnectorNetworkError("woocommerce", "NETWORK", true, "connection failed (ECONNRESET)"),
    );

    await expect(connector.verifyCandidateCredentials!(candidate)).resolves.toEqual({
      outcome: "unavailable",
      reasonCode: "NETWORK",
    });
  });

  it("never touches stored credential state — no db calls made", async () => {
    const dbSpy = jest.fn();
    const connector = new WooCommerceConnector(
      { getClient: () => ({ connectorCredential: { findFirst: dbSpy, updateMany: dbSpy, upsert: dbSpy } }) } as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() } as never,
    );
    jest.spyOn(connector as any, "callApi").mockResolvedValue({ status: 200, ok: true } as Response);

    await connector.verifyCandidateCredentials!(candidate);

    expect(dbSpy).not.toHaveBeenCalled();
  });
});

describe("WooCommerceConnector.findExistingProductId", () => {
  // Regression coverage: WooCommerce's /products collection endpoint does not
  // implement the generic WordPress meta_key/meta_value filter — passing it is
  // silently ignored and the endpoint falls back to its default listing. This
  // was live-verified against a real store: the same product was returned for
  // every distinct SKU queried, causing publishProduct to PUT-overwrite one
  // existing product on every single publish instead of creating new ones.
  // `sku` is the correct, natively-supported filter parameter.

  it("queries the native sku parameter, not the unsupported meta_key/meta_value pair", async () => {
    const connector = makeConnector();
    const callApi = jest
      .spyOn(connector as any, "callApi")
      .mockResolvedValue({ ok: true, json: async () => [{ id: 42, sku: "WC-001" }] } as unknown as Response);

    const id = await (connector as any).findExistingProductId(
      "https://store.example.com",
      "ck_test",
      "cs_test",
      "WC-001",
    );

    expect(id).toBe(42);
    const [, path] = callApi.mock.calls[0];
    expect(path).toContain("sku=WC-001");
    expect(path).not.toContain("meta_key");
    expect(path).not.toContain("meta_value");
  });

  it("returns null when the response's sku doesn't exactly match the query (defense in depth)", async () => {
    // This is exactly the failure mode that was live-verified: an unfiltered
    // (or mis-filtered) response returning an unrelated product must never be
    // trusted as a match just because the request "succeeded".
    const connector = makeConnector();
    jest
      .spyOn(connector as any, "callApi")
      .mockResolvedValue({ ok: true, json: async () => [{ id: 138, sku: "some-other-product" }] } as unknown as Response);

    const id = await (connector as any).findExistingProductId(
      "https://store.example.com",
      "ck_test",
      "cs_test",
      "WC-001",
    );

    expect(id).toBeNull();
  });

  it("returns null when the store has no matching product", async () => {
    const connector = makeConnector();
    jest.spyOn(connector as any, "callApi").mockResolvedValue({ ok: true, json: async () => [] } as unknown as Response);

    const id = await (connector as any).findExistingProductId(
      "https://store.example.com",
      "ck_test",
      "cs_test",
      "WC-999-NEW",
    );

    expect(id).toBeNull();
  });
});

describe("WooCommerceConnector.publishProduct create-vs-update branching", () => {
  const product: ProductPayload = {
    sku: "WC-NEW-001",
    title: "Brand New Product",
    description: "A genuinely new product",
    brand: "Vexa",
    hsnCode: "6204",
    gstRate: 12,
    mrp: 999,
    sellingPrice: 799,
    mainImageUrl: "https://cdn.example.com/new.jpg",
    attributes: {},
    // Deliberately blank productType (no tags either) — keeps this test
    // isolated to the create-vs-update branch, without also exercising
    // resolveTermIds' separate category/tag POST calls.
    productType: "",
  };

  function mockResolvedCredentials(connector: WooCommerceConnector) {
    jest.spyOn(connector as any, "resolveCredentials").mockResolvedValue({
      siteUrl: "https://store.example.com",
      consumerKey: "ck_test",
      consumerSecret: "cs_test",
    });
  }

  it("POSTs to /products (creates) when no existing product matches the SKU", async () => {
    const connector = makeConnector();
    mockResolvedCredentials(connector);
    const callApi = jest.spyOn(connector as any, "callApi").mockImplementation(async (method: any, path: any) => {
      if (method === "GET" && path.startsWith("/products?")) {
        return { ok: true, json: async () => [] } as unknown as Response;
      }
      return { ok: true, json: async () => ({ id: 555 }) } as unknown as Response;
    });

    const result = await connector.publishProduct({ tenantId: "t1", installationId: "inst-1", connectorId: "conn-1" } as any, product);

    expect(result.externalRef).toBe("555");
    const publishCall = callApi.mock.calls.find(([method]) => method === "POST");
    expect(publishCall?.[0]).toBe("POST");
    expect(publishCall?.[1]).toBe("/products");
  });

  it("PUTs to /products/{id} (updates) only when a real matching-SKU product was found", async () => {
    const connector = makeConnector();
    mockResolvedCredentials(connector);
    const callApi = jest.spyOn(connector as any, "callApi").mockImplementation(async (method: any, path: any) => {
      if (method === "GET" && path.startsWith("/products?")) {
        return { ok: true, json: async () => [{ id: 777, sku: product.sku }] } as unknown as Response;
      }
      return { ok: true, json: async () => ({ id: 777 }) } as unknown as Response;
    });

    const result = await connector.publishProduct({ tenantId: "t1", installationId: "inst-1", connectorId: "conn-1" } as any, product);

    expect(result.externalRef).toBe("777");
    const publishCall = callApi.mock.calls.find(([method]) => method === "PUT");
    expect(publishCall?.[0]).toBe("PUT");
    expect(publishCall?.[1]).toBe("/products/777");
  });
});

// PIM#660 — publishProduct/updateProduct's REST call already confirms the real
// WooCommerce product status (data.status) before returning, but the old code
// discarded it and always hardcoded { status: 'PENDING', isAsync: false }. Since
// isAsync is false, the only mechanism that could ever resolve that PENDING
// (marketplace.service.ts's isAsync-gated status-sync poller) never runs, so
// every WooCommerce submission was stuck at PENDING forever — 0 of 83 real
// submissions ever reached a terminal status in production.
describe("WooCommerceConnector.publishProduct/updateProduct — terminal status from the real WC response (#660)", () => {
  const product: ProductPayload = {
    sku: "WC-STATUS-001",
    title: "Status Mapping Product",
    description: "",
    brand: "Vexa",
    hsnCode: "6204",
    gstRate: 12,
    mrp: 999,
    sellingPrice: 799,
    mainImageUrl: "https://cdn.example.com/status.jpg",
    attributes: {},
    productType: "",
  };

  function mockResolvedCredentials(connector: WooCommerceConnector) {
    jest.spyOn(connector as any, "resolveCredentials").mockResolvedValue({
      siteUrl: "https://store.example.com",
      consumerKey: "ck_test",
      consumerSecret: "cs_test",
    });
  }

  function mockCreateResponding(connector: WooCommerceConnector, wcStatus: string) {
    return jest.spyOn(connector as any, "callApi").mockImplementation(async (method: any, path: any) => {
      if (method === "GET" && path.startsWith("/products?")) {
        return { ok: true, json: async () => [] } as unknown as Response;
      }
      return { ok: true, json: async () => ({ id: 555, status: wcStatus }) } as unknown as Response;
    });
  }

  it("publishProduct resolves to SUCCESS (not PENDING) when WooCommerce's own response says status: 'publish'", async () => {
    const connector = makeConnector();
    mockResolvedCredentials(connector);
    mockCreateResponding(connector, "publish");

    const result = await connector.publishProduct({ tenantId: "t1", installationId: "inst-1", connectorId: "conn-1" } as any, product);

    expect(result.status).toBe("SUCCESS");
    expect(result.isAsync).toBe(false);
  });

  it("publishProduct resolves to PENDING when WooCommerce's own response says status: 'draft' (genuinely not live yet)", async () => {
    const connector = makeConnector();
    mockResolvedCredentials(connector);
    mockCreateResponding(connector, "draft");

    const result = await connector.publishProduct({ tenantId: "t1", installationId: "inst-1", connectorId: "conn-1" } as any, product);

    expect(result.status).toBe("PENDING");
  });

  it("updateProduct resolves to SUCCESS when WooCommerce's own response says status: 'publish'", async () => {
    const connector = makeConnector();
    mockResolvedCredentials(connector);
    jest.spyOn(connector as any, "callApi").mockResolvedValue({
      ok: true,
      json: async () => ({ id: 777, status: "publish" }),
    } as unknown as Response);

    const result = await connector.updateProduct(
      { tenantId: "t1", installationId: "inst-1", connectorId: "conn-1" } as any,
      product,
      "777",
    );

    expect(result.status).toBe("SUCCESS");
    expect(result.isAsync).toBe(false);
  });

  it("updateProduct resolves to SUPPRESSED when WooCommerce's own response says status: 'private'", async () => {
    const connector = makeConnector();
    mockResolvedCredentials(connector);
    jest.spyOn(connector as any, "callApi").mockResolvedValue({
      ok: true,
      json: async () => ({ id: 777, status: "private" }),
    } as unknown as Response);

    const result = await connector.updateProduct(
      { tenantId: "t1", installationId: "inst-1", connectorId: "conn-1" } as any,
      product,
      "777",
    );

    expect(result.status).toBe("SUPPRESSED");
  });

  it("publishProduct and syncSubmissionStatus agree on the terminal status for the same WC status string (no drift between the two mappings)", async () => {
    const connector = makeConnector();
    mockResolvedCredentials(connector);
    mockCreateResponding(connector, "publish");
    const publishResult = await connector.publishProduct({ tenantId: "t1", installationId: "inst-1", connectorId: "conn-1" } as any, product);

    jest.spyOn(connector as any, "callApi").mockResolvedValue({
      ok: true,
      json: async () => ({ id: 555, status: "publish" }),
    } as unknown as Response);
    const syncResult = await connector.syncSubmissionStatus({ tenantId: "t1", installationId: "inst-1", connectorId: "conn-1" } as any, "555");

    expect(publishResult.status).toBe(syncResult.status);
  });
});
