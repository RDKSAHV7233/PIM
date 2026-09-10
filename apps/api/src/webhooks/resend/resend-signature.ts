import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Resend signs webhooks with the Svix scheme.
 * Reference: https://docs.svix.com/receiving/verifying-payloads/how-manual
 *
 * - The signing secret is `whsec_<base64>`; the raw key bytes are
 *   `base64decode(secret without the "whsec_" prefix)`.
 * - Three headers travel with every delivery: `svix-id`, `svix-timestamp`,
 *   `svix-signature`. The signature header is a space-separated list of
 *   `<version>,<base64sig>` tokens; only the `v1,` tokens are HMAC-SHA256.
 * - Signed content is `${svixId}.${svixTimestamp}.${rawBody}` — the raw request
 *   bytes, not a re-serialised object.
 * - A delivery whose timestamp is more than MAX_TIMESTAMP_SKEW_SECONDS away from
 *   now is rejected (replay-window guard).
 *
 * Implemented with node `crypto` only — no `svix` dependency.
 */

const WHSEC_PREFIX = "whsec_";
export const MAX_TIMESTAMP_SKEW_SECONDS = 5 * 60;

export interface ResendSignatureHeaders {
  svixId: string;
  svixTimestamp: string;
  svixSignature: string;
}

export type ResendSignatureFailureReason =
  | "missing_headers"
  | "bad_secret"
  | "timestamp_skew"
  | "signature_mismatch";

export type ResendSignatureResult =
  | { valid: true }
  | { valid: false; reason: ResendSignatureFailureReason };

function decodeSecretKey(secret: string): Buffer | null {
  const trimmed = String(secret ?? "").trim();
  const base64 = trimmed.startsWith(WHSEC_PREFIX) ? trimmed.slice(WHSEC_PREFIX.length) : trimmed;
  if (!base64) {
    return null;
  }
  try {
    const key = Buffer.from(base64, "base64");
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function isTimestampWithinSkew(svixTimestamp: string, nowSeconds: number): boolean {
  const timestamp = Number(String(svixTimestamp ?? "").trim());
  if (!Number.isFinite(timestamp)) {
    return false;
  }
  return Math.abs(nowSeconds - timestamp) <= MAX_TIMESTAMP_SKEW_SECONDS;
}

/**
 * Compute the base64 HMAC-SHA256 signature Svix expects for a given body.
 * Exposed so tests can build a real, correct signature.
 */
export function computeResendSignature(
  rawBody: Buffer | string,
  headers: Pick<ResendSignatureHeaders, "svixId" | "svixTimestamp">,
  secret: string,
): string | null {
  const key = decodeSecretKey(secret);
  if (!key) {
    return null;
  }
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody ?? "");
  const signedContent = `${String(headers.svixId ?? "")}.${String(headers.svixTimestamp ?? "")}.${body}`;
  return createHmac("sha256", key).update(signedContent, "utf8").digest("base64");
}

/**
 * Verify a Resend/Svix webhook signature against the raw request body.
 *
 * @param rawBody    the exact bytes Express received (Buffer or string)
 * @param headers    the three `svix-*` headers
 * @param secret     `RESEND_WEBHOOK_SECRET` (`whsec_<base64>`)
 * @param nowSeconds unix seconds; injectable for tests, defaults to wall clock
 */
export function verifyResendSignature(
  rawBody: Buffer | string,
  headers: ResendSignatureHeaders,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): ResendSignatureResult {
  const svixId = String(headers?.svixId ?? "").trim();
  const svixTimestamp = String(headers?.svixTimestamp ?? "").trim();
  const svixSignature = String(headers?.svixSignature ?? "").trim();
  if (!svixId || !svixTimestamp || !svixSignature) {
    return { valid: false, reason: "missing_headers" };
  }

  const expected = computeResendSignature(rawBody, { svixId, svixTimestamp }, secret);
  if (!expected) {
    return { valid: false, reason: "bad_secret" };
  }

  if (!isTimestampWithinSkew(svixTimestamp, nowSeconds)) {
    return { valid: false, reason: "timestamp_skew" };
  }

  const presented = svixSignature
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.startsWith("v1,"))
    .map((token) => token.slice("v1,".length));

  for (const candidate of presented) {
    if (constantTimeEquals(candidate, expected)) {
      return { valid: true };
    }
  }
  return { valid: false, reason: "signature_mismatch" };
}
