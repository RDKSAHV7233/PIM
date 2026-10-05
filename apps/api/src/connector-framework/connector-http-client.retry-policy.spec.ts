// connector-http-client.retry-policy.spec.ts
// Per-call retry policy on ConnectorHttpClient.fetch: the default keeps today's behavior,
// NO_AUTOMATIC_RETRY makes exactly one attempt, SAFE_TO_RETRY still retries, and
// RETRY_WITH_IDEMPOTENCY must carry a real key or the call fails before any attempt.

import { ConnectorHttpClient } from "./connector-http-client.service";
import { ConnectorRetryPolicyError } from "./connector-retry-policy";

function makeClient(): ConnectorHttpClient {
  return new ConnectorHttpClient({ info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any);
}

function mockResponse(status: number, headers: Record<string, string> = {}): Response {
  const headerMap = new Map(Object.entries(headers));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headerMap.get(name.toLowerCase()) ?? headerMap.get(name) ?? null } as any,
    text: async () => "",
  } as any;
}

async function drain(promise: Promise<unknown>): Promise<void> {
  for (let i = 0; i < 100; i++) {
    jest.runAllTimers();
    await Promise.resolve();
  }
  await promise.catch(() => undefined);
}

const warnCalls = (client: ConnectorHttpClient, message: string) =>
  (client as any).logger.warn.mock.calls.filter((c: any[]) => c[0] === message);

describe("ConnectorHttpClient.fetch — retry policy", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  describe("default (CURRENT_BEHAVIOR): existing retry behavior is unchanged", () => {
    it("retries a POST after a network error exactly as before", async () => {
      global.fetch = jest.fn().mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce(mockResponse(200));
      const client = makeClient();

      const promise = client.fetch("odoo", "inst-1", "https://example.com/api", { method: "POST", body: "{}" });
      await drain(promise);

      expect((await promise).status).toBe(200);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("retries a POST on 503 and exhausts MAX_RETRIES as before", async () => {
      global.fetch = jest.fn().mockResolvedValue(mockResponse(503));
      const client = makeClient();

      const promise = client.fetch("odoo", "inst-1", "https://example.com/api", { method: "POST", body: "{}" });
      await drain(promise);

      expect((await promise).status).toBe(503);
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });

    it("an explicit CURRENT_BEHAVIOR behaves the same as no policy", async () => {
      global.fetch = jest.fn().mockResolvedValueOnce(mockResponse(500)).mockResolvedValueOnce(mockResponse(200));
      const client = makeClient();

      const promise = client.fetch("odoo", "inst-1", "https://example.com/api", { method: "POST", retryPolicy: "CURRENT_BEHAVIOR" });
      await drain(promise);

      expect((await promise).status).toBe(200);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("sends the request headers untouched when no idempotency key is involved", async () => {
      global.fetch = jest.fn().mockResolvedValue(mockResponse(200));
      const headers = { Authorization: "Bearer tok" };

      await makeClient().fetch("odoo", "inst-1", "https://example.com/api", { method: "POST", headers });

      expect((global.fetch as jest.Mock).mock.calls[0][1].headers).toBe(headers);
    });
  });

  describe("NO_AUTOMATIC_RETRY: one attempt, the caller decides", () => {
    it("does not retry a network error (the request may already have executed)", async () => {
      const reset = new Error("ECONNRESET");
      global.fetch = jest.fn().mockRejectedValue(reset);
      const client = makeClient();

      const promise = client.fetch("odoo", "inst-1", "https://example.com/api", { method: "POST", retryPolicy: "NO_AUTOMATIC_RETRY" });
      const assertion = expect(promise).rejects.toBe(reset);
      await drain(promise);
      await assertion;

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(warnCalls(client, "connector.http.network_error")).toHaveLength(0);
    });

    it("does not retry a timeout and labels the suppression 'timeout'", async () => {
      const timeout = Object.assign(new Error("The operation timed out"), { name: "TimeoutError" });
      global.fetch = jest.fn().mockRejectedValue(timeout);
      const client = makeClient();

      const promise = client.fetch("etsy", "inst-9", "https://example.com/api", {
        method: "POST",
        retryPolicy: "NO_AUTOMATIC_RETRY",
        operation: "create_draft_listing",
      });
      const assertion = expect(promise).rejects.toBe(timeout);
      await drain(promise);
      await assertion;

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(warnCalls(client, "connector.http.retry_suppressed")[0][1]).toMatchObject({
        connector: "etsy",
        installation: "inst-9",
        operation: "create_draft_listing",
        method: "POST",
        attempt: 0,
        reason: "timeout",
        policy: "NO_AUTOMATIC_RETRY",
      });
    });

    it.each([429, 500, 502, 503, 504])("returns a %i response to the caller without retrying", async (status) => {
      global.fetch = jest.fn().mockResolvedValue(mockResponse(status, { "Retry-After": "1" }));
      const client = makeClient();

      const promise = client.fetch("odoo", "inst-1", "https://example.com/api", { method: "POST", retryPolicy: "NO_AUTOMATIC_RETRY" });
      await drain(promise);

      expect((await promise).status).toBe(status);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(warnCalls(client, "connector.http.retrying")).toHaveLength(0);
      expect(warnCalls(client, "connector.http.retry_suppressed")[0][1]).toMatchObject({
        reason: `http_${status}`,
        status,
        policy: "NO_AUTOMATIC_RETRY",
      });
    });

    it("returns a success on the single attempt, with nothing suppressed", async () => {
      global.fetch = jest.fn().mockResolvedValue(mockResponse(201));
      const client = makeClient();

      const resp = await client.fetch("odoo", "inst-1", "https://example.com/api", { method: "POST", retryPolicy: "NO_AUTOMATIC_RETRY" });

      expect(resp.status).toBe(201);
      expect(warnCalls(client, "connector.http.retry_suppressed")).toHaveLength(0);
    });

    it("applies to a pinned-transport call as well", async () => {
      const failure = new Error("socket hang up");
      const transport = { fetch: jest.fn().mockRejectedValue(failure) };
      global.fetch = jest.fn();
      const client = makeClient();

      const promise = client.fetch("odoo", "inst-1", "https://example.com/jsonrpc", {
        method: "POST",
        body: "{}",
        transport,
        retryPolicy: "NO_AUTOMATIC_RETRY",
      });
      const assertion = expect(promise).rejects.toBe(failure);
      await drain(promise);
      await assertion;

      expect(transport.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe("SAFE_TO_RETRY: retry still works", () => {
    it("retries a network error and a 503, and records the policy in the log", async () => {
      global.fetch = jest.fn()
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockResolvedValueOnce(mockResponse(503))
        .mockResolvedValueOnce(mockResponse(200));
      const client = makeClient();

      const promise = client.fetch("shopify", "inst-2", "https://example.com/api", {
        method: "PUT",
        retryPolicy: "SAFE_TO_RETRY",
        operation: "update_product",
      });
      await drain(promise);

      expect((await promise).status).toBe(200);
      expect(global.fetch).toHaveBeenCalledTimes(3);
      expect(warnCalls(client, "connector.http.network_error")[0][1]).toMatchObject({
        connector: "shopify",
        installation: "inst-2",
        operation: "update_product",
        method: "PUT",
        attempt: 0,
        reason: "network_error",
        policy: "SAFE_TO_RETRY",
      });
      expect(warnCalls(client, "connector.http.retrying")[0][1]).toMatchObject({
        reason: "http_503",
        attempt: 1,
        policy: "SAFE_TO_RETRY",
      });
    });
  });

  describe("RETRY_WITH_IDEMPOTENCY: not a label, the call must carry the mechanism", () => {
    const KEY = "op-2026-10-05-0001";

    it("fails closed before any attempt when no idempotency key is supplied", async () => {
      global.fetch = jest.fn();

      const promise = makeClient().fetch("odoo", "inst-1", "https://example.com/api", {
        method: "POST",
        retryPolicy: "RETRY_WITH_IDEMPOTENCY",
      });

      await expect(promise).rejects.toBeInstanceOf(ConnectorRetryPolicyError);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it.each([
      ["an empty key", { header: "Idempotency-Key", key: "" }],
      ["a short key", { header: "Idempotency-Key", key: "abc" }],
      ["a key with whitespace", { header: "Idempotency-Key", key: "has space in it" }],
      ["a key with a newline", { header: "Idempotency-Key", key: "abcdefgh\nX-Evil: 1" }],
      ["an invalid header name", { header: "Idempotency Key", key: KEY }],
      ["an empty header name", { header: "", key: KEY }],
    ])("fails closed on %s", async (_label, idempotency) => {
      global.fetch = jest.fn();

      await expect(
        makeClient().fetch("odoo", "inst-1", "https://example.com/api", {
          method: "POST",
          retryPolicy: "RETRY_WITH_IDEMPOTENCY",
          idempotency,
        }),
      ).rejects.toBeInstanceOf(ConnectorRetryPolicyError);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("fails closed when the request already carries that header with a different value", async () => {
      global.fetch = jest.fn();

      await expect(
        makeClient().fetch("odoo", "inst-1", "https://example.com/api", {
          method: "POST",
          headers: { "idempotency-key": "something-else-entirely" },
          retryPolicy: "RETRY_WITH_IDEMPOTENCY",
          idempotency: { header: "Idempotency-Key", key: KEY },
        }),
      ).rejects.toBeInstanceOf(ConnectorRetryPolicyError);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("rejects an idempotency key under any other policy, and an unknown policy", async () => {
      global.fetch = jest.fn();
      const client = makeClient();

      for (const retryPolicy of ["CURRENT_BEHAVIOR", "SAFE_TO_RETRY", "NO_AUTOMATIC_RETRY", undefined] as const) {
        await expect(
          client.fetch("odoo", "inst-1", "https://example.com/api", {
            method: "POST",
            retryPolicy,
            idempotency: { header: "Idempotency-Key", key: KEY },
          }),
        ).rejects.toBeInstanceOf(ConnectorRetryPolicyError);
      }
      await expect(
        client.fetch("odoo", "inst-1", "https://example.com/api", { retryPolicy: "RETRY_EVERYTHING" as never }),
      ).rejects.toBeInstanceOf(ConnectorRetryPolicyError);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("sends the same key on every attempt and still retries", async () => {
      global.fetch = jest.fn()
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockResolvedValueOnce(mockResponse(503))
        .mockResolvedValueOnce(mockResponse(200));
      const client = makeClient();

      const promise = client.fetch("etsy", "inst-1", "https://example.com/api", {
        method: "POST",
        headers: { Authorization: "Bearer tok" },
        retryPolicy: "RETRY_WITH_IDEMPOTENCY",
        idempotency: { header: "Idempotency-Key", key: KEY },
        operation: "create_draft_listing",
      });
      await drain(promise);

      expect((await promise).status).toBe(200);
      const calls = (global.fetch as jest.Mock).mock.calls;
      expect(calls).toHaveLength(3);
      for (const [, init] of calls) {
        expect(init.headers).toEqual({ Authorization: "Bearer tok", "Idempotency-Key": KEY });
      }
      expect(warnCalls(client, "connector.http.network_error")[0][1].policy).toBe("RETRY_WITH_IDEMPOTENCY");
    });

    it("accepts the same value already present on the request, and sends the key through a pinned transport", async () => {
      const transport = { fetch: jest.fn().mockResolvedValue(mockResponse(200)) };

      await makeClient().fetch("odoo", "inst-1", "https://example.com/jsonrpc", {
        method: "POST",
        body: "{}",
        headers: { "Idempotency-Key": KEY },
        transport,
        retryPolicy: "RETRY_WITH_IDEMPOTENCY",
        idempotency: { header: "Idempotency-Key", key: KEY },
      });

      expect(transport.fetch.mock.calls[0][1].headers).toEqual({ "Idempotency-Key": KEY });
    });
  });

  describe("logging", () => {
    it("every retry log carries connector, installation, operation, method, attempt, reason and policy", async () => {
      global.fetch = jest.fn().mockResolvedValueOnce(mockResponse(429)).mockResolvedValueOnce(mockResponse(200));
      const client = makeClient();

      const promise = client.fetch("woocommerce", "inst-7", "https://example.com/api");
      await drain(promise);

      expect(warnCalls(client, "connector.http.retrying")[0][1]).toMatchObject({
        connector: "woocommerce",
        installation: "inst-7",
        operation: null,
        method: "GET",
        attempt: 0,
        reason: "http_429",
        policy: "CURRENT_BEHAVIOR",
      });
    });

    it("never logs the idempotency key or request headers", async () => {
      global.fetch = jest.fn().mockResolvedValueOnce(mockResponse(503)).mockResolvedValueOnce(mockResponse(200));
      const client = makeClient();

      const promise = client.fetch("odoo", "inst-1", "https://example.com/api", {
        method: "POST",
        headers: { Authorization: "Bearer SECRET-TOKEN" },
        retryPolicy: "RETRY_WITH_IDEMPOTENCY",
        idempotency: { header: "Idempotency-Key", key: "op-key-0123456789" },
      });
      await drain(promise);

      const logged = JSON.stringify((client as any).logger.warn.mock.calls);
      expect(logged).not.toContain("op-key-0123456789");
      expect(logged).not.toContain("SECRET-TOKEN");
    });

    it("an operation label that is not a short code is replaced, not echoed", async () => {
      global.fetch = jest.fn().mockResolvedValueOnce(mockResponse(503)).mockResolvedValueOnce(mockResponse(200));
      const client = makeClient();

      const promise = client.fetch("odoo", "inst-1", "https://example.com/api", { operation: "https://x.example/?token=SECRET" });
      await drain(promise);

      expect(warnCalls(client, "connector.http.retrying")[0][1].operation).toBe("invalid_label");
    });
  });
});
