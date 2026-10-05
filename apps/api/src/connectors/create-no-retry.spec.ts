// create-no-retry.spec.ts
//
// Sprint 3, PR 3b-A. The four provider creates that go through the shared HTTP client and have
// no idempotency mechanism (Odoo product.template create, Etsy createDraftListing, Dynamics 365
// POST /items, WooCommerce POST /products) must make exactly ONE attempt. The fake provider
// EXECUTES the create and then loses the response (reset, timeout, or a 5xx after execution);
// the invariant is that Vexa never issues a second create, so a lost response cannot become a
// duplicate. A control run with the default policy proves the harness would catch a second one.

import { ConnectorHttpClient } from "../connector-framework/connector-http-client.service";
import type { ConnectorContext, ProductPayload } from "../connector-framework/connector.interface";
import { Dynamics365Connector } from "./dynamics365/dynamics365.connector";
import { EtsyConnector } from "./etsy/etsy.connector";
import { OdooConnector } from "./odoo/odoo.connector";
import { WooCommerceConnector } from "./woocommerce/woocommerce.connector";

const TEST_KEY = "e".repeat(64);

const product: ProductPayload = {
  sku: "SKU-001",
  title: "Fault injected product",
  description: "A product",
  brand: "Vexa",
  hsnCode: "",
  gstRate: 0,
  mrp: 100,
  sellingPrice: 90,
  mainImageUrl: "https://cdn.example.com/p.jpg",
  attributes: {},
  productType: "",
};

type Failure = "reset" | "timeout" | "http_503" | "http_429";

// What the provider does after it has executed a create.
function lostResponse(failure: Failure): Promise<Response> {
  if (failure === "reset") return Promise.reject(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }));
  if (failure === "timeout") return Promise.reject(Object.assign(new Error("The operation timed out"), { name: "TimeoutError" }));
  return Promise.resolve(new Response("{}", { status: failure === "http_503" ? 503 : 429, headers: { "Retry-After": "1" } }));
}

interface Provider {
  creates: number;
  /** Every request seen, "METHOD url" (Odoo: "RPC service.method/model.method"). */
  seen: string[];
}

function logger() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() };
}

function ctxWith(client: ConnectorHttpClient, slug: string): ConnectorContext {
  return {
    tenantId: "tenant1",
    installationId: "inst-1",
    connectorId: "conn-1",
    getAccessToken: async () => "tok",
    fetch: (url: string, init?: Parameters<NonNullable<ConnectorContext["fetch"]>>[1]) => client.fetch(slug, "inst-1", url, init),
  } as ConnectorContext;
}

const dbStub = { getClient: () => ({}) } as never;

beforeEach(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY_V1 = TEST_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION = "1";
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function settle<T>(promise: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  const outcome = promise.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
  for (let i = 0; i < 200; i++) {
    jest.runAllTimers();
    await Promise.resolve();
  }
  return outcome;
}

const warnLines = (log: ReturnType<typeof logger>, message: string) => log.warn.mock.calls.filter((c: unknown[]) => c[0] === message);

// ─── harness control ─────────────────────────────────────────────────────────

describe("harness control: the default policy WOULD duplicate the create", () => {
  it.each<Failure>(["reset", "timeout", "http_503", "http_429"])("a plain POST through the shared client reaches the provider twice after a lost response (%s)", async (failure) => {
    const provider: Provider = { creates: 0, seen: [] };
    global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        provider.creates += 1;
        return provider.creates === 1 ? lostResponse(failure) : new Response("{}", { status: 201 });
      }
      return new Response("{}", { status: 200 });
    }) as never;
    const client = new ConnectorHttpClient(logger() as never);

    const result = await settle(client.fetch("etsy", "inst-1", "https://example.com/create", { method: "POST", body: "{}" }));

    expect(result.ok).toBe(true);
    expect(provider.creates).toBe(2); // the duplicate the policy exists to prevent
  });
});

// ─── Odoo ────────────────────────────────────────────────────────────────────

describe("Odoo product.template create", () => {
  function setup(failure: Failure | null, authFailsOnce: boolean | "always" = false) {
    const provider: Provider = { creates: 0, seen: [] };
    let authCalls = 0;
    global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
      const rpc = JSON.parse(String(init?.body ?? "{}")).params as { service: string; method: string; args: unknown[] };
      const label = rpc.service === "common" ? `common.${rpc.method}` : `object.${rpc.method}/${String(rpc.args[3])}.${String(rpc.args[4])}`;
      provider.seen.push(label);
      if (rpc.service === "common" && rpc.method === "authenticate") {
        authCalls += 1;
        if (authFailsOnce === "always" || (authFailsOnce && authCalls === 1)) return lostResponse("reset");
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: 7 }), { status: 200 });
      }
      if (rpc.args[4] === "create") {
        provider.creates += 1;
        if (failure && provider.creates === 1) return lostResponse(failure);
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: 4242 }), { status: 200 });
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: [] }), { status: 200 });
    }) as never;
    const log = logger();
    const connector = new OdooConnector(dbStub, log as never, new ConnectorHttpClient(log as never));
    jest.spyOn(connector as any, "resolveCredentials").mockResolvedValue({
      odooUrl: "https://odoo.example.com", database: "db", username: "u", password: "p",
    });
    return { connector, provider, log, ctx: ctxWith(new ConnectorHttpClient(log as never), "odoo"), authCalls: () => authCalls };
  }

  it.each<Failure>(["reset", "timeout", "http_503", "http_429"])("makes exactly one create when the provider executes it and the response is lost (%s)", async (failure) => {
    const { connector, provider, log, ctx } = setup(failure);

    const result = await settle(connector.publishProduct(ctx, product));

    expect(result.ok).toBe(false); // the failure surfaces; it is not silently repeated
    // The create may have executed, so the error says the outcome is unknown (the publish flow keys on this).
    expect((result as { error: { outcomeUnknown?: boolean } }).error.outcomeUnknown).toBe(true);
    expect(provider.creates).toBe(1);
    expect(provider.seen.filter((s) => s.endsWith("product.template.create"))).toHaveLength(1);
    expect(warnLines(log, "connector.http.retrying")).toHaveLength(0);
    expect(warnLines(log, "connector.http.network_error")).toHaveLength(0);
    if (failure === "reset" || failure === "timeout") {
      expect(warnLines(log, "connector.http.retry_suppressed")[0]?.[1]).toMatchObject({
        connector: "odoo", operation: "odoo_create_product", method: "POST", attempt: 0, policy: "NO_AUTOMATIC_RETRY",
      });
    }
  });

  it.each<Failure>(["http_503", "http_429"])("a create answered by a %s without a record id is AMBIGUOUS_CREATE_OUTCOME, never SUCCESS", async (failure) => {
    const { connector, provider, ctx } = setup(failure);

    const result = await settle(connector.publishProduct(ctx, product));

    expect(result.ok).toBe(false);
    expect(JSON.stringify((result as { error: { issues?: unknown } }).error.issues)).toContain("AMBIGUOUS_CREATE_OUTCOME");
    expect(provider.creates).toBe(1);
  });

  it("still creates once on the happy path and returns the record id", async () => {
    const { connector, provider, ctx } = setup(null);

    const result = await settle(connector.publishProduct(ctx, product));

    expect(result).toMatchObject({ ok: true, value: { externalRef: "4242", status: "SUCCESS" } });
    expect(provider.creates).toBe(1);
  });

  it("a transport failure BEFORE the create (authentication) is not flagged as an unknown outcome: nothing was written", async () => {
    const { connector, provider, ctx } = setup(null, "always");

    const result = await settle(connector.publishProduct(ctx, product));

    expect(result.ok).toBe(false);
    expect((result as { error: { outcomeUnknown?: boolean } }).error.outcomeUnknown).toBeFalsy();
    expect(provider.creates).toBe(0);
  });

  it("leaves the authentication call on the default policy (it still retries; it creates nothing)", async () => {
    const { connector, provider, ctx, authCalls } = setup(null, true);

    const result = await settle(connector.publishProduct(ctx, product));

    expect(result.ok).toBe(true);
    expect(authCalls()).toBe(2);
    expect(provider.creates).toBe(1);
  });
});

// ─── Etsy ────────────────────────────────────────────────────────────────────

describe("Etsy createDraftListing", () => {
  function setup(failure: Failure | null) {
    const provider: Provider = { creates: 0, seen: [] };
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      provider.seen.push(`${init?.method} ${url}`);
      if (init?.method === "POST" && /\/shops\/123\/listings$/.test(url)) {
        provider.creates += 1;
        if (failure && provider.creates === 1) return lostResponse(failure);
        return new Response(JSON.stringify({ listing_id: 555 }), { status: 201 });
      }
      return new Response("{}", { status: 200 });
    }) as never;
    const log = logger();
    const client = new ConnectorHttpClient(log as never);
    const connector = new EtsyConnector(dbStub, log as never);
    jest.spyOn(connector, "validateProduct").mockResolvedValue({ isValid: true, errors: [], warnings: [] } as never);
    jest.spyOn(connector as any, "requireCredential").mockResolvedValue("123");
    jest.spyOn(connector as any, "buildApiHeaders").mockResolvedValue({ Authorization: "Bearer tok", "x-api-key": "k:s" });
    jest.spyOn(connector as any, "uploadListingImages").mockResolvedValue(undefined);
    return { connector, provider, log, ctx: ctxWith(client, "etsy") };
  }

  it.each<Failure>(["reset", "timeout", "http_503", "http_429"])("makes exactly one create when the provider executes it and the response is lost (%s)", async (failure) => {
    const { connector, provider, log, ctx } = setup(failure);

    const result = await settle(connector.publishProduct(ctx, product));

    expect(result.ok).toBe(false);
    expect(provider.creates).toBe(1);
    expect(warnLines(log, "connector.http.retrying")).toHaveLength(0);
    expect(warnLines(log, "connector.http.network_error")).toHaveLength(0);
    if (failure === "reset" || failure === "timeout") {
      expect(warnLines(log, "connector.http.retry_suppressed")[0]?.[1]).toMatchObject({
        connector: "etsy", operation: "etsy_create_draft_listing", method: "POST", attempt: 0, policy: "NO_AUTOMATIC_RETRY",
      });
    }
  });

  it("still creates once on the happy path", async () => {
    const { connector, provider, ctx } = setup(null);

    const result = await settle(connector.publishProduct(ctx, product));

    expect(result.ok).toBe(true);
    expect(provider.creates).toBe(1);
  });
});

// ─── Dynamics 365 ────────────────────────────────────────────────────────────

describe("Dynamics 365 POST /items", () => {
  function setup(failure: Failure | null) {
    const provider: Provider = { creates: 0, seen: [] };
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      provider.seen.push(`${init?.method} ${url}`);
      if (init?.method === "POST" && /\/items$/.test(url)) {
        provider.creates += 1;
        if (failure && provider.creates === 1) return lostResponse(failure);
        return new Response(JSON.stringify({ id: "guid-1", number: "SKU-001" }), { status: 201 });
      }
      return new Response("{}", { status: 200 });
    }) as never;
    const log = logger();
    const client = new ConnectorHttpClient(log as never);
    const connector = new Dynamics365Connector(dbStub, log as never);
    jest.spyOn(connector, "validateProduct").mockResolvedValue({ isValid: true, errors: [], warnings: [] } as never);
    jest.spyOn(connector as any, "resolveApiBase").mockResolvedValue("https://bc.example.com/api/v2.0/companies(c1)");
    return { connector, provider, log, ctx: ctxWith(client, "dynamics-365") };
  }

  it.each<Failure>(["reset", "timeout", "http_503", "http_429"])("makes exactly one create when the provider executes it and the response is lost (%s)", async (failure) => {
    const { connector, provider, log, ctx } = setup(failure);

    const result = await settle(connector.publishProduct(ctx, product));

    expect(result.ok).toBe(false);
    expect(provider.creates).toBe(1);
    expect(warnLines(log, "connector.http.retrying")).toHaveLength(0);
    expect(warnLines(log, "connector.http.network_error")).toHaveLength(0);
    if (failure === "reset" || failure === "timeout") {
      expect(warnLines(log, "connector.http.retry_suppressed")[0]?.[1]).toMatchObject({
        connector: "dynamics-365", operation: "dynamics365_create_item", method: "POST", attempt: 0, policy: "NO_AUTOMATIC_RETRY",
      });
    }
  });

  it("still creates once on the happy path", async () => {
    const { connector, provider, ctx } = setup(null);

    const result = await settle(connector.publishProduct(ctx, product));

    expect(result).toMatchObject({ ok: true, value: { externalRef: "guid-1", status: "SUCCESS" } });
    expect(provider.creates).toBe(1);
  });
});

// ─── WooCommerce ─────────────────────────────────────────────────────────────

describe("WooCommerce POST /products", () => {
  function setup(opts: { failure: Failure | null; existingId?: number; putFailsOnce?: boolean }) {
    const provider: Provider = { creates: 0, seen: [] };
    let puts = 0;
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      provider.seen.push(`${method} ${url}`);
      if (method === "GET" && /\/products\?sku=/.test(url)) {
        const body = opts.existingId ? [{ id: opts.existingId, sku: product.sku }] : [];
        return new Response(JSON.stringify(body), { status: 200 });
      }
      if (method === "POST" && /\/products$/.test(url)) {
        provider.creates += 1;
        if (opts.failure && provider.creates === 1) return lostResponse(opts.failure);
        return new Response(JSON.stringify({ id: 901, status: "publish" }), { status: 201 });
      }
      if (method === "PUT") {
        puts += 1;
        if (opts.putFailsOnce && puts === 1) return lostResponse("reset");
        return new Response(JSON.stringify({ id: opts.existingId, status: "publish" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as never;
    const log = logger();
    const client = new ConnectorHttpClient(log as never);
    const connector = new WooCommerceConnector(dbStub, log as never, client);
    jest.spyOn(connector as any, "resolveCredentials").mockResolvedValue({
      siteUrl: "https://shop.example.com", consumerKey: "ck", consumerSecret: "cs",
    });
    return { connector, provider, log, ctx: ctxWith(client, "woocommerce"), puts: () => puts };
  }

  it.each<Failure>(["reset", "timeout", "http_503", "http_429"])("makes exactly one create when the provider executes it and the response is lost (%s)", async (failure) => {
    const { connector, provider, log, ctx } = setup({ failure });

    const result = await settle(connector.publishProduct(ctx, product));

    expect(result.ok).toBe(false);
    expect(provider.creates).toBe(1);
    expect(warnLines(log, "connector.http.retrying")).toHaveLength(0);
    expect(warnLines(log, "connector.http.network_error")).toHaveLength(0);
    if (failure === "reset" || failure === "timeout") {
      expect(warnLines(log, "connector.http.retry_suppressed")[0]?.[1]).toMatchObject({
        connector: "woocommerce", operation: "woocommerce_create_product", method: "POST", attempt: 0, policy: "NO_AUTOMATIC_RETRY",
      });
    }
  });

  it("still creates once on the happy path", async () => {
    const { connector, provider, ctx } = setup({ failure: null });

    const result = await settle(connector.publishProduct(ctx, product));

    expect(result).toMatchObject({ ok: true, value: { externalRef: "901" } });
    expect(provider.creates).toBe(1);
  });

  it("does not reuse the SKU lookup to justify a blind retry: after a lost create the lookup is not consulted again", async () => {
    const { connector, provider, ctx } = setup({ failure: "reset" });

    await settle(connector.publishProduct(ctx, product));

    expect(provider.seen.filter((s) => s.startsWith("GET") && s.includes("/products?sku="))).toHaveLength(1);
    expect(provider.creates).toBe(1);
  });

  it("leaves the update branch (PUT of an existing product) on the default policy: it still retries", async () => {
    const { connector, provider, ctx, puts } = setup({ failure: null, existingId: 77, putFailsOnce: true });

    const result = await settle(connector.publishProduct(ctx, product));

    expect(result.ok).toBe(true);
    expect(puts()).toBe(2);
    expect(provider.creates).toBe(0);
  });
});

// ─── scope guard ─────────────────────────────────────────────────────────────

describe("scope: only the four identified creates opt out of automatic retry", () => {
  it("lists exactly the four call sites", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require("node:path") as typeof import("node:path");
    const dir = path.join(__dirname);
    const found: string[] = [];
    for (const sub of fs.readdirSync(dir)) {
      const subDir = path.join(dir, sub);
      if (!fs.statSync(subDir).isDirectory()) continue;
      for (const file of fs.readdirSync(subDir)) {
        if (!file.endsWith(".ts") || file.endsWith(".spec.ts")) continue;
        const text = fs.readFileSync(path.join(subDir, file), "utf8");
        for (const m of text.matchAll(/noAutomaticRetry\(\s*['"]([a-z0-9_]+)['"]\s*\)/g)) found.push(m[1]);
        if (/retryPolicy\s*:/.test(text)) found.push(`${file}:literal-retryPolicy`);
      }
    }
    expect(found.sort()).toEqual([
      "dynamics365_create_item",
      "etsy_create_draft_listing",
      "odoo_create_product",
      "woocommerce_create_product",
    ]);
  });
});
