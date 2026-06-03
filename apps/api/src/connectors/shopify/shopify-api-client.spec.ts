// apps/api/src/connectors/shopify/shopify-api-client.spec.ts
// Unit tests for ShopifyApiClient transport layer:
//   - graphqlRequest: success, 401-retry, GraphQL THROTTLED, network error
//   - exchangeToken: success, failure

import { ShopifyApiClient, ShopifyGraphQlEnvelope } from "./shopify-api-client.service";
import { ConnectorContext } from "../../connector-framework/connector.interface";

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeLogger() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;
}

function makeApiClient(): ShopifyApiClient {
  return new ShopifyApiClient(makeLogger());
}

function makeCtx(fetchImpl?: jest.Mock): ConnectorContext {
  return {
    tenantId: "t1",
    installationId: "i1",
    connectorId: "c1",
    getAccessToken: jest.fn().mockResolvedValue("fresh-token"),
    fetch: fetchImpl ?? jest.fn(),
  };
}

function gqlResponse<T>(data: T, extensions?: ShopifyGraphQlEnvelope<T>["extensions"]): Response {
  const body: ShopifyGraphQlEnvelope<T> = { data, ...(extensions ? { extensions } : {}) };
  return {
    ok: true,
    status: 200,
    headers: { get: () => null } as any,
    text: async () => JSON.stringify(body),
  } as any;
}

function gqlErrorResponse(errors: Array<{ message: string; extensions?: { code?: string } }>): Response {
  const body: ShopifyGraphQlEnvelope<unknown> = { errors };
  return {
    ok: true,
    status: 200,
    headers: { get: () => null } as any,
    text: async () => JSON.stringify(body),
  } as any;
}

function httpResponse(status: number, body = ""): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => h === "Retry-After" ? null : null } as any,
    text: async () => body,
  } as any;
}

// ─── graphqlRequest — success path ───────────────────────────────────────────

describe("ShopifyApiClient.graphqlRequest — success", () => {
  it("returns data on a 200 response with a data field", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      gqlResponse({ shop: { id: "gid://shopify/Shop/1", name: "Test Shop" } }),
    );
    const ctx = makeCtx(mockFetch);
    const client = makeApiClient();

    const result = await client.graphqlRequest<{ shop: { id: string; name: string } }>(ctx, {
      shopDomain: "test.myshopify.com",
      accessToken: "tok",
      query: "{ shop { id name } }",
    });

    expect(result).toEqual({ shop: { id: "gid://shopify/Shop/1", name: "Test Shop" } });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][1].headers["X-Shopify-Access-Token"]).toBe("tok");
  });

  it("includes variables in the request body", async () => {
    const mockFetch = jest.fn().mockResolvedValue(gqlResponse({ node: null }));
    const ctx = makeCtx(mockFetch);
    const client = makeApiClient();

    await client.graphqlRequest(ctx, {
      shopDomain: "test.myshopify.com",
      accessToken: "tok",
      query: "query Q($id: ID!) { node(id: $id) { id } }",
      variables: { id: "gid://shopify/Product/123" },
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.variables).toEqual({ id: "gid://shopify/Product/123" });
  });

  it("throws on non-OK HTTP status (not 401, not 429)", async () => {
    const mockFetch = jest.fn().mockResolvedValue(httpResponse(500, "server error"));
    const ctx = makeCtx(mockFetch);
    const client = makeApiClient();

    await expect(
      client.graphqlRequest(ctx, {
        shopDomain: "test.myshopify.com",
        accessToken: "tok",
        query: "{ shop { id } }",
      }),
    ).rejects.toThrow(/status 500/);
  });

  it("throws when data field is absent from a 200 response", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: { get: () => null } as any,
      text: async () => JSON.stringify({ extensions: {} }),
    } as any);
    const ctx = makeCtx(mockFetch);
    const client = makeApiClient();

    await expect(
      client.graphqlRequest(ctx, {
        shopDomain: "test.myshopify.com",
        accessToken: "tok",
        query: "{ shop { id } }",
      }),
    ).rejects.toThrow(/did not include data/);
  });

  it("throws joining all error messages when GraphQL errors are present", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      gqlErrorResponse([
        { message: "Field 'foo' doesn't exist on type 'Shop'" },
        { message: "Argument 'bar' is required" },
      ]),
    );
    const ctx = makeCtx(mockFetch);
    const client = makeApiClient();

    await expect(
      client.graphqlRequest(ctx, {
        shopDomain: "test.myshopify.com",
        accessToken: "tok",
        query: "{ shop { foo } }",
      }),
    ).rejects.toThrow(/Field 'foo'.*Argument 'bar'/);
  });
});

// ─── graphqlRequest — 401 retry ───────────────────────────────────────────────

describe("ShopifyApiClient.graphqlRequest — 401 token refresh", () => {
  it("calls onTokenExpired then retries with refreshed token on 401", async () => {
    const mockFetch = jest.fn()
      .mockResolvedValueOnce(httpResponse(401, ""))
      .mockResolvedValueOnce(gqlResponse({ shop: { id: "gid://shopify/Shop/1" } }));
    const ctx = makeCtx(mockFetch);
    const onTokenExpired = jest.fn().mockResolvedValue(undefined);
    const client = makeApiClient();

    const result = await client.graphqlRequest<{ shop: { id: string } }>(ctx, {
      shopDomain: "test.myshopify.com",
      accessToken: "stale-token",
      query: "{ shop { id } }",
    }, { onTokenExpired });

    expect(onTokenExpired).toHaveBeenCalledTimes(1);
    expect(ctx.getAccessToken).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // Second call must use the fresh token returned by ctx.getAccessToken
    expect(mockFetch.mock.calls[1][1].headers["X-Shopify-Access-Token"]).toBe("fresh-token");
    expect(result).toEqual({ shop: { id: "gid://shopify/Shop/1" } });
  });

  it("throws on 401 when onTokenExpired is not provided", async () => {
    const mockFetch = jest.fn().mockResolvedValue(httpResponse(401, ""));
    const ctx = makeCtx(mockFetch);
    const client = makeApiClient();

    await expect(
      client.graphqlRequest(ctx, {
        shopDomain: "test.myshopify.com",
        accessToken: "stale-token",
        query: "{ shop { id } }",
      }),
      // Without onTokenExpired, 401 is not retried — falls through to non-OK throw
    ).rejects.toThrow(/status 401/);
  });

  it("does not retry 401 on the second attempt (avoids infinite loop)", async () => {
    const mockFetch = jest.fn().mockResolvedValue(httpResponse(401, ""));
    const ctx = makeCtx(mockFetch);
    const onTokenExpired = jest.fn().mockResolvedValue(undefined);
    const client = makeApiClient();

    await expect(
      client.graphqlRequest(ctx, {
        shopDomain: "test.myshopify.com",
        accessToken: "stale-token",
        query: "{ shop { id } }",
      }, { onTokenExpired }),
    ).rejects.toThrow();

    // onTokenExpired called once (attempt 0 only), fetch called multiple times
    // but only one token-expiry callback
    expect(onTokenExpired).toHaveBeenCalledTimes(1);
  });
});

// ─── graphqlRequest — GraphQL THROTTLED ─────────────────────────────────────

describe("ShopifyApiClient.graphqlRequest — GraphQL THROTTLED", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("waits and retries on a THROTTLED error, returns data on next attempt", async () => {
    const throttledBody: ShopifyGraphQlEnvelope<unknown> = {
      errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
      extensions: {
        cost: {
          requestedQueryCost: 100,
          throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 0, restoreRate: 50 },
        },
      },
    };
    const mockFetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: () => null } as any,
        text: async () => JSON.stringify(throttledBody),
      } as any)
      .mockResolvedValueOnce(gqlResponse({ product: { id: "gid://shopify/Product/1" } }));

    const ctx = makeCtx(mockFetch);
    const client = makeApiClient();

    const resultPromise = client.graphqlRequest<{ product: { id: string } }>(ctx, {
      shopDomain: "test.myshopify.com",
      accessToken: "tok",
      query: "{ product(id: \"gid://shopify/Product/1\") { id } }",
    });

    // Advance timers past the throttle wait
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ product: { id: "gid://shopify/Product/1" } });
  });

  it("throws after exhausting GRAPHQL_MAX_RETRIES on persistent THROTTLED", async () => {
    const throttledBody: ShopifyGraphQlEnvelope<unknown> = {
      errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
      extensions: {
        cost: {
          requestedQueryCost: 500,
          throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 10, restoreRate: 50 },
        },
      },
    };
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: { get: () => null } as any,
      text: async () => JSON.stringify(throttledBody),
    } as any);

    const ctx = makeCtx(mockFetch);
    const client = makeApiClient();

    // Capture the rejection without awaiting so fake timers can be advanced.
    const resultPromise = client.graphqlRequest(ctx, {
      shopDomain: "test.myshopify.com",
      accessToken: "tok",
      query: "{ expensiveQuery }",
    });

    // Flush all pending timers (the throttle backoff waits between retries).
    // Run several rounds to handle nested/sequenced setTimeout calls.
    for (let i = 0; i < 10; i++) {
      jest.runAllTimers();
      await Promise.resolve(); // drain microtask queue between timer ticks
    }

    await expect(resultPromise).rejects.toThrow(/throttled after/i);
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── exchangeToken ────────────────────────────────────────────────────────────

describe("ShopifyApiClient.exchangeToken", () => {
  it("returns parsed token response on success", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: "shpat_abc", scope: "read_products", expires_in: 3600 }),
    } as any);

    const client = makeApiClient();
    const result = await client.exchangeToken("test.myshopify.com", {
      client_id: "client-id",
      client_secret: "client-secret",
      grant_type: "authorization_code",
      code: "auth-code",
    });

    expect(result.access_token).toBe("shpat_abc");
    expect(result.scope).toBe("read_products");
  });

  it("throws on non-OK HTTP response from token endpoint", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: "invalid_client" }),
    } as any);

    const client = makeApiClient();
    await expect(
      client.exchangeToken("test.myshopify.com", {
        client_id: "bad-id",
        client_secret: "bad-secret",
        grant_type: "authorization_code",
        code: "bad-code",
      }),
    ).rejects.toThrow(/status 401/);
  });
});

// ─── URL helpers ──────────────────────────────────────────────────────────────

describe("ShopifyApiClient URL helpers", () => {
  it("resolveAdminApiBaseUrl returns shop HTTPS URL by default", () => {
    delete process.env.PIM_SHOPIFY_ADMIN_API_BASE_URL;
    const client = makeApiClient();
    expect(client.resolveAdminApiBaseUrl("test.myshopify.com")).toBe("https://test.myshopify.com");
  });

  it("resolveAdminApiBaseUrl respects PIM_SHOPIFY_ADMIN_API_BASE_URL override", () => {
    process.env.PIM_SHOPIFY_ADMIN_API_BASE_URL = "http://localhost:3457";
    const client = makeApiClient();
    expect(client.resolveAdminApiBaseUrl("anything")).toBe("http://localhost:3457");
    delete process.env.PIM_SHOPIFY_ADMIN_API_BASE_URL;
  });

  it("resolveAdminApiVersion returns default when env var absent", () => {
    delete process.env.PIM_SHOPIFY_ADMIN_API_VERSION;
    const client = makeApiClient();
    expect(client.resolveAdminApiVersion()).toBe("2026-04");
  });

  it("resolveAdminApiVersion respects PIM_SHOPIFY_ADMIN_API_VERSION override", () => {
    process.env.PIM_SHOPIFY_ADMIN_API_VERSION = "2026-07";
    const client = makeApiClient();
    expect(client.resolveAdminApiVersion()).toBe("2026-07");
    delete process.env.PIM_SHOPIFY_ADMIN_API_VERSION;
  });
});
