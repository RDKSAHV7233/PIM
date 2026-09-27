import { sentryBeforeSend } from "./sentry-before-send";

describe("sentryBeforeSend", () => {
  describe("null/non-object inputs", () => {
    it("passes through null", () => {
      expect(sentryBeforeSend(null)).toBeNull();
    });

    it("passes through undefined", () => {
      expect(sentryBeforeSend(undefined)).toBeUndefined();
    });

    it("passes through a string", () => {
      expect(sentryBeforeSend("error")).toBe("error");
    });

    it("passes through an event with no request field", () => {
      const event = { exception: { values: [{ type: "Error", value: "boom" }] } };
      expect(sentryBeforeSend(event)).toEqual(event);
    });
  });

  describe("request body (tenant product data)", () => {
    it("removes request.data so product titles/prices/SKUs are not sent", () => {
      const event = {
        request: {
          method: "POST",
          url: "/api/v1/products",
          data: JSON.stringify({ title: "My Product", price: 9.99, sku: "SKU-001" }),
        },
      };
      const result = sentryBeforeSend(event) as Record<string, unknown>;
      const req = result.request as Record<string, unknown>;
      expect(req.data).toBeUndefined();
      expect(req.method).toBe("POST");
      expect(req.url).toBe("/api/v1/products");
    });

    it("removes request.cookies", () => {
      const event = {
        request: {
          url: "/api/v1/products",
          cookies: { session: "abc123", "_ga": "UA-xxx" },
        },
      };
      const result = sentryBeforeSend(event) as Record<string, unknown>;
      const req = result.request as Record<string, unknown>;
      expect(req.cookies).toBeUndefined();
    });
  });

  describe("auth headers (session credentials)", () => {
    it("removes authorization header", () => {
      const event = {
        request: {
          url: "/api/v1/products",
          headers: { authorization: "Bearer tok_secret", "content-type": "application/json" },
        },
      };
      const result = sentryBeforeSend(event) as Record<string, unknown>;
      const headers = (result.request as Record<string, unknown>).headers as Record<string, unknown>;
      expect(headers["authorization"]).toBeUndefined();
      expect(headers["content-type"]).toBe("application/json");
    });

    it("removes cookie header", () => {
      const event = {
        request: {
          url: "/api/v1/products",
          headers: { cookie: "session=abc; _ga=UA-xxx", host: "api.vexapim.com" },
        },
      };
      const result = sentryBeforeSend(event) as Record<string, unknown>;
      const headers = (result.request as Record<string, unknown>).headers as Record<string, unknown>;
      expect(headers["cookie"]).toBeUndefined();
      expect(headers["host"]).toBe("api.vexapim.com");
    });

    it("removes x-api-key header", () => {
      const event = {
        request: {
          url: "/api/v1/products",
          headers: { "x-api-key": "secret_key_123", "content-type": "application/json" },
        },
      };
      const result = sentryBeforeSend(event) as Record<string, unknown>;
      const headers = (result.request as Record<string, unknown>).headers as Record<string, unknown>;
      expect(headers["x-api-key"]).toBeUndefined();
      expect(headers["content-type"]).toBe("application/json");
    });

    it("strips all three auth headers together", () => {
      const event = {
        request: {
          url: "/api/v1/products",
          data: '{"title":"My Product"}',
          cookies: { session: "abc" },
          headers: {
            authorization: "Bearer tok",
            cookie: "session=abc",
            "x-api-key": "key_secret",
            "accept-language": "en-US",
          },
        },
      };
      const result = sentryBeforeSend(event) as Record<string, unknown>;
      const req = result.request as Record<string, unknown>;
      const headers = req.headers as Record<string, unknown>;
      expect(req.data).toBeUndefined();
      expect(req.cookies).toBeUndefined();
      expect(headers["authorization"]).toBeUndefined();
      expect(headers["cookie"]).toBeUndefined();
      expect(headers["x-api-key"]).toBeUndefined();
      expect(headers["accept-language"]).toBe("en-US");
    });
  });

  describe("non-sensitive fields are preserved", () => {
    it("keeps exception, level, and tags", () => {
      const event = {
        exception: { values: [{ type: "TypeError", value: "Cannot read property" }] },
        level: "error",
        tags: { env: "production", component: "connector" },
        request: {
          method: "GET",
          url: "/api/v1/health",
          headers: { host: "api.vexapim.com" },
        },
      };
      const result = sentryBeforeSend(event) as Record<string, unknown>;
      expect(result.exception).toEqual(event.exception);
      expect(result.level).toBe("error");
      expect(result.tags).toEqual(event.tags);
      const req = result.request as Record<string, unknown>;
      const headers = req.headers as Record<string, unknown>;
      expect(headers["host"]).toBe("api.vexapim.com");
    });
  });

  describe("edge: request with no headers field", () => {
    it("does not throw if headers is missing", () => {
      const event = { request: { method: "GET", url: "/api/v1/health" } };
      expect(() => sentryBeforeSend(event)).not.toThrow();
    });
  });

  describe("edge: request is not an object", () => {
    it("does not mutate when request is a string", () => {
      const event = { request: "not-an-object" };
      const result = sentryBeforeSend(event) as Record<string, unknown>;
      expect(result.request).toBe("not-an-object");
    });
  });
});
