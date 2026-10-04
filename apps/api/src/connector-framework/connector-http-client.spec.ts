// connector-http-client.spec.ts
// Tests for ConnectorHttpClient: token bucket rate limiting, retry-with-backoff,
// Retry-After header, network error retry, permanent-error pass-through.

import { ConnectorHttpClient } from "./connector-http-client.service";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeLogger() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;
}

function makeClient(): ConnectorHttpClient {
  return new ConnectorHttpClient(makeLogger());
}

function mockResponse(status: number, headers: Record<string, string> = {}): Response {
  const headerMap = new Map(Object.entries(headers));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => headerMap.get(name.toLowerCase()) ?? headerMap.get(name) ?? null,
    } as any,
    text: async () => "",
  } as any;
}

// ─── happy path ───────────────────────────────────────────────────────────────

describe("ConnectorHttpClient.fetch — success path", () => {
  it("returns the response immediately on 200", async () => {
    global.fetch = jest.fn().mockResolvedValue(mockResponse(200));
    const client = makeClient();

    const resp = await client.fetch("shopify", "inst-1", "https://example.com/api");

    expect(resp.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("passes method, headers, and body through to fetch", async () => {
    global.fetch = jest.fn().mockResolvedValue(mockResponse(200));
    const client = makeClient();

    await client.fetch("shopify", "inst-1", "https://example.com/api", {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({ key: "value" }),
    });

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("https://example.com/api");
    expect(init.method).toBe("POST");
    expect(init.headers["Authorization"]).toBe("Bearer tok");
    expect(init.body).toBe(JSON.stringify({ key: "value" }));
  });

  it("defaults method to GET when not specified", async () => {
    global.fetch = jest.fn().mockResolvedValue(mockResponse(200));
    const client = makeClient();

    await client.fetch("shopify", "inst-1", "https://example.com/api");

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.method).toBe("GET");
  });
});

// ─── permanent errors (no retry) ─────────────────────────────────────────────

describe("ConnectorHttpClient.fetch — permanent errors (no retry)", () => {
  it.each([400, 401, 403, 404])(
    "returns %s response immediately without retrying",
    async (status) => {
      global.fetch = jest.fn().mockResolvedValue(mockResponse(status));
      const client = makeClient();

      const resp = await client.fetch("shopify", "inst-1", "https://example.com/api");

      expect(resp.status).toBe(status);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    },
  );
});

// ─── retry on transient errors ────────────────────────────────────────────────

describe("ConnectorHttpClient.fetch — retry on transient errors", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("retries 500 and succeeds on second attempt", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(mockResponse(500))
      .mockResolvedValueOnce(mockResponse(200));
    const client = makeClient();

    const resultPromise = client.fetch("shopify", "inst-1", "https://example.com/api");

    // Flush the backoff timer
    for (let i = 0; i < 100; i++) {
      jest.runAllTimers();
      await Promise.resolve();
    }
    const resp = await resultPromise;

    expect(resp.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("retries 503 and returns the last 503 after exhausting MAX_RETRIES", async () => {
    global.fetch = jest.fn().mockResolvedValue(mockResponse(503));
    const client = makeClient();

    const resultPromise = client.fetch("shopify", "inst-1", "https://example.com/api");

    for (let i = 0; i < 100; i++) {
      jest.runAllTimers();
      await Promise.resolve();
    }
    const resp = await resultPromise;

    expect(resp.status).toBe(503);
    // MAX_RETRIES = 3, so 4 total attempts (attempt 0..3)
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it.each([429, 500, 502, 503, 504])("retries on status %s", async (status) => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(mockResponse(status))
      .mockResolvedValueOnce(mockResponse(200));
    const client = makeClient();

    const resultPromise = client.fetch("amazon-in", "inst-1", "https://example.com/api");

    for (let i = 0; i < 10; i++) {
      jest.runAllTimers();
      await Promise.resolve();
    }
    const resp = await resultPromise;

    expect(resp.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

// ─── Retry-After header ───────────────────────────────────────────────────────

describe("ConnectorHttpClient.fetch — Retry-After header on 429", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("uses Retry-After value (case-insensitive) instead of exponential backoff", async () => {
    const retryAfterSec = 2;
    global.fetch = jest.fn()
      .mockResolvedValueOnce(mockResponse(429, { "Retry-After": String(retryAfterSec) }))
      .mockResolvedValueOnce(mockResponse(200));
    const client = makeClient();
    const logger = (client as any).logger;

    const resultPromise = client.fetch("shopify", "inst-1", "https://example.com/api");

    for (let i = 0; i < 10; i++) {
      jest.runAllTimers();
      await Promise.resolve();
    }
    const resp = await resultPromise;

    expect(resp.status).toBe(200);
    // The warn log should record a backoffMs derived from Retry-After (2000ms)
    const warnCall = logger.warn.mock.calls.find(
      (c: any[]) => c[0] === "connector.http.retrying",
    );
    expect(warnCall).toBeDefined();
    expect(warnCall[1].backoffMs).toBe(retryAfterSec * 1000);
  });

  it("caps Retry-After at MAX_BACKOFF_MS (30s)", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(mockResponse(429, { "Retry-After": "999" })) // 999 seconds
      .mockResolvedValueOnce(mockResponse(200));
    const client = makeClient();
    const logger = (client as any).logger;

    const resultPromise = client.fetch("shopify", "inst-1", "https://example.com/api");

    for (let i = 0; i < 10; i++) {
      jest.runAllTimers();
      await Promise.resolve();
    }
    await resultPromise;

    const warnCall = logger.warn.mock.calls.find(
      (c: any[]) => c[0] === "connector.http.retrying",
    );
    expect(warnCall[1].backoffMs).toBeLessThanOrEqual(30_000);
  });

  it("falls back to exponential backoff when Retry-After is absent", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(mockResponse(429))  // no Retry-After header
      .mockResolvedValueOnce(mockResponse(200));
    const client = makeClient();
    const logger = (client as any).logger;

    const resultPromise = client.fetch("shopify", "inst-1", "https://example.com/api");

    for (let i = 0; i < 10; i++) {
      jest.runAllTimers();
      await Promise.resolve();
    }
    await resultPromise;

    const warnCall = logger.warn.mock.calls.find(
      (c: any[]) => c[0] === "connector.http.retrying",
    );
    // Backoff should be between 800ms (BASE_BACKOFF * 0.8 jitter) and 1200ms (BASE_BACKOFF * 1.2 jitter)
    expect(warnCall[1].backoffMs).toBeGreaterThanOrEqual(800);
    expect(warnCall[1].backoffMs).toBeLessThanOrEqual(1_200);
  });
});

// ─── network error retry ──────────────────────────────────────────────────────

describe("ConnectorHttpClient.fetch — network error retry", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("retries on network error and succeeds on second attempt", async () => {
    const networkError = new Error("ECONNREFUSED");
    global.fetch = jest.fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(mockResponse(200));
    const client = makeClient();

    const resultPromise = client.fetch("flipkart", "inst-1", "https://example.com/api");

    for (let i = 0; i < 10; i++) {
      jest.runAllTimers();
      await Promise.resolve();
    }
    const resp = await resultPromise;

    expect(resp.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("throws the last network error after exhausting MAX_RETRIES", async () => {
    const networkError = new Error("ETIMEDOUT");
    global.fetch = jest.fn().mockRejectedValue(networkError);
    const client = makeClient();

    const resultPromise = client.fetch("flipkart", "inst-1", "https://example.com/api");

    for (let i = 0; i < 100; i++) {
      jest.runAllTimers();
      await Promise.resolve();
    }

    await expect(resultPromise).rejects.toThrow("ETIMEDOUT");
    expect(global.fetch).toHaveBeenCalledTimes(4); // 1 attempt + 3 retries
  });

  it("logs each network error with slug, url, attempt, backoffMs", async () => {
    global.fetch = jest.fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(mockResponse(200));
    const client = makeClient();
    const logger = (client as any).logger;

    const resultPromise = client.fetch("amazon-in", "inst-2", "https://sp-api.amazon.com/test");

    for (let i = 0; i < 10; i++) {
      jest.runAllTimers();
      await Promise.resolve();
    }
    await resultPromise;

    const warnCall = logger.warn.mock.calls.find(
      (c: any[]) => c[0] === "connector.http.network_error",
    );
    expect(warnCall).toBeDefined();
    expect(warnCall[1]).toMatchObject({
      slug: "amazon-in",
      url: "https://sp-api.amazon.com/test",
      attempt: 0,
      error: "ECONNRESET",
    });
  });
});

// ─── per-connector rate limiting ──────────────────────────────────────────────

describe("ConnectorHttpClient — rate limit isolation", () => {
  it("creates separate buckets per slug+installationId key", () => {
    const client = makeClient();
    const getOrCreate = (s: string, i: string) =>
      (client as any).getOrCreateBucket(s, `${s}:${i}`);

    const b1 = getOrCreate("shopify", "inst-1");
    const b2 = getOrCreate("shopify", "inst-2");
    const b3 = getOrCreate("amazon-in", "inst-1");

    expect(b1).not.toBe(b2);   // same slug, different installation
    expect(b1).not.toBe(b3);   // different slug
    expect(b2).not.toBe(b3);
  });

  it("returns the same bucket instance for the same slug+installationId", () => {
    const client = makeClient();
    const getOrCreate = (s: string, i: string) =>
      (client as any).getOrCreateBucket(s, `${s}:${i}`);

    const b1 = getOrCreate("shopify", "inst-1");
    const b2 = getOrCreate("shopify", "inst-1");

    expect(b1).toBe(b2);
  });

  it("uses known RATE_LIMIT_DEFAULTS capacity for recognised slugs", () => {
    const client = makeClient();
    const getBucket = (slug: string) => {
      const key = `${slug}:inst`;
      return (client as any).getOrCreateBucket(slug, key);
    };

    const amazonBucket = getBucket("amazon-in");
    const shopifyBucket = getBucket("shopify");
    const unknownBucket = getBucket("unknown-slug");

    // Amazon: capacity=5, Shopify: capacity=10, unknown: DEFAULT capacity=5
    expect((amazonBucket as any).capacity).toBe(5);
    expect((shopifyBucket as any).capacity).toBe(10);
    expect((unknownBucket as any).capacity).toBe(5); // DEFAULT_RATE_LIMIT
  });
});

// ─── redirect pass-through ────────────────────────────────────────────────────

describe("ConnectorHttpClient.fetch — redirect mode", () => {
  it("forwards redirect: 'manual' so callers can validate redirect targets themselves", async () => {
    global.fetch = jest.fn().mockResolvedValue(mockResponse(200));
    await makeClient().fetch("odoo", "inst-1", "https://example.com/jsonrpc", { method: "POST", redirect: "manual" });
    expect((global.fetch as jest.Mock).mock.calls[0][1].redirect).toBe("manual");
  });

  it("leaves redirect unset (fetch default) when the caller does not ask for one", async () => {
    global.fetch = jest.fn().mockResolvedValue(mockResponse(200));
    await makeClient().fetch("shopify", "inst-1", "https://example.com/api");
    expect((global.fetch as jest.Mock).mock.calls[0][1].redirect).toBeUndefined();
  });

  it("returns a 3xx response to the caller without retrying it", async () => {
    global.fetch = jest.fn().mockResolvedValue(mockResponse(307, { location: "/elsewhere" }));
    const resp = await makeClient().fetch("odoo", "inst-1", "https://example.com/jsonrpc", { redirect: "manual" });
    expect(resp.status).toBe(307);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
