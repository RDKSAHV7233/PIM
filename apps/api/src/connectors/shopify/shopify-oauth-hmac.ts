import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify Shopify's OAuth redirect query HMAC.
 *
 * This is DISTINCT from webhook HMAC verification:
 * - Webhook: HMAC-SHA256 of raw body, base64-encoded, in X-Shopify-Hmac-Sha256 header
 * - OAuth redirect: HMAC-SHA256 of sorted query string (excluding `hmac` param), hex-encoded, in `hmac` query param
 *
 * See: https://shopify.dev/docs/apps/auth/get-access-tokens/authorization-code-grant/getting-started#verify-a-request
 */
export function verifyShopifyOAuthHmac(
  query: Record<string, string>,
  clientSecret: string,
): boolean {
  const providedHmac = String(query.hmac ?? "").trim();
  if (!providedHmac) {
    return false;
  }

  const entries = Object.entries(query)
    .filter(([key]) => key !== "hmac")
    .sort(([a], [b]) => a.localeCompare(b));

  const message = entries
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  const computed = createHmac("sha256", clientSecret)
    .update(message)
    .digest("hex");

  const providedBuf = Buffer.from(providedHmac, "utf8");
  const computedBuf = Buffer.from(computed, "utf8");

  if (providedBuf.length !== computedBuf.length) {
    return false;
  }

  return timingSafeEqual(providedBuf, computedBuf);
}
