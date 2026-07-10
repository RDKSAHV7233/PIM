import { createHmac } from "node:crypto";
import { verifyShopifyOAuthHmac } from "./shopify-oauth-hmac";

const TEST_CLIENT_SECRET = "test-shopify-client-secret";

function buildQueryWithHmac(
  params: Record<string, string>,
  secret: string,
): Record<string, string> {
  const entries = Object.entries(params)
    .filter(([key]) => key !== "hmac")
    .sort(([a], [b]) => a.localeCompare(b));
  const message = entries.map(([key, value]) => `${key}=${value}`).join("&");
  const hmac = createHmac("sha256", secret).update(message).digest("hex");
  return { ...params, hmac };
}

// ---------------------------------------------------------------------------
// verifyShopifyOAuthHmac
// ---------------------------------------------------------------------------

describe("verifyShopifyOAuthHmac", () => {
  it("verifies a valid Shopify OAuth HMAC", () => {
    const query = buildQueryWithHmac(
      {
        code: "abc123",
        shop: "mystore.myshopify.com",
        state: "some-state-token",
        timestamp: "1234567890",
      },
      TEST_CLIENT_SECRET,
    );
    expect(verifyShopifyOAuthHmac(query, TEST_CLIENT_SECRET)).toBe(true);
  });

  it("rejects when HMAC is missing", () => {
    const query = {
      code: "abc123",
      shop: "mystore.myshopify.com",
      state: "some-state",
    };
    expect(verifyShopifyOAuthHmac(query, TEST_CLIENT_SECRET)).toBe(false);
  });

  it("rejects when HMAC is empty string", () => {
    const query = {
      code: "abc123",
      shop: "mystore.myshopify.com",
      hmac: "",
    };
    expect(verifyShopifyOAuthHmac(query, TEST_CLIENT_SECRET)).toBe(false);
  });

  it("rejects a tampered code parameter", () => {
    const query = buildQueryWithHmac(
      {
        code: "abc123",
        shop: "mystore.myshopify.com",
        state: "some-state",
        timestamp: "1234567890",
      },
      TEST_CLIENT_SECRET,
    );
    query.code = "tampered";
    expect(verifyShopifyOAuthHmac(query, TEST_CLIENT_SECRET)).toBe(false);
  });

  it("rejects a tampered shop parameter", () => {
    const query = buildQueryWithHmac(
      {
        code: "abc123",
        shop: "mystore.myshopify.com",
        state: "some-state",
      },
      TEST_CLIENT_SECRET,
    );
    query.shop = "evil.myshopify.com";
    expect(verifyShopifyOAuthHmac(query, TEST_CLIENT_SECRET)).toBe(false);
  });

  it("rejects when signed with a different secret", () => {
    const query = buildQueryWithHmac(
      {
        code: "abc123",
        shop: "mystore.myshopify.com",
        state: "some-state",
      },
      "wrong-secret",
    );
    expect(verifyShopifyOAuthHmac(query, TEST_CLIENT_SECRET)).toBe(false);
  });

  it("rejects a forged HMAC value", () => {
    const query = {
      code: "abc123",
      shop: "mystore.myshopify.com",
      state: "some-state",
      hmac: "0000000000000000000000000000000000000000000000000000000000000000",
    };
    expect(verifyShopifyOAuthHmac(query, TEST_CLIENT_SECRET)).toBe(false);
  });

  it("handles extra query parameters correctly", () => {
    const query = buildQueryWithHmac(
      {
        code: "abc123",
        shop: "mystore.myshopify.com",
        state: "some-state",
        timestamp: "1234567890",
        extra_param: "extra_value",
      },
      TEST_CLIENT_SECRET,
    );
    expect(verifyShopifyOAuthHmac(query, TEST_CLIENT_SECRET)).toBe(true);
  });

  it("sorts parameters alphabetically for HMAC computation", () => {
    const params = {
      zebra: "z",
      alpha: "a",
      code: "abc",
      shop: "test.myshopify.com",
    };
    const query = buildQueryWithHmac(params, TEST_CLIENT_SECRET);
    expect(verifyShopifyOAuthHmac(query, TEST_CLIENT_SECRET)).toBe(true);
  });
});
