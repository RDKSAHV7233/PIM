import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const HKDF_CONTEXT = "connector-oauth-state-v1";
const HKDF_KEY_LENGTH = 32;

export type ConnectorOAuthStatePayload = {
  /** Tenant key owning the installation */
  tenantKey: string;
  /** Installation ID being authorized */
  installationId: string;
  /** Connector slug (e.g. "shopify") — prevents cross-connector replay */
  connectorKey: string;
  /** Nonce for replay protection — hex-encoded random bytes */
  nonce: string;
  /** Expiry timestamp (ms since epoch) */
  exp: number;
};

export type ConnectorOAuthStateVerifyResult =
  | { valid: true; payload: ConnectorOAuthStatePayload }
  | { valid: false; error: string };

function deriveSigningKey(jwtSecret: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", jwtSecret, "", HKDF_CONTEXT, HKDF_KEY_LENGTH),
  );
}

function encodeBase64Url(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return buf.toString("base64url");
}

function decodeBase64Url(encoded: string): Buffer {
  return Buffer.from(encoded, "base64url");
}

export function generateOAuthNonce(): string {
  return randomBytes(16).toString("hex");
}

export function signConnectorOAuthState(
  payload: Omit<ConnectorOAuthStatePayload, "exp" | "nonce">,
  jwtSecret: string,
): { stateToken: string; nonce: string; expiresAt: number } {
  const nonce = generateOAuthNonce();
  const expiresAt = Date.now() + STATE_TTL_MS;
  const fullPayload: ConnectorOAuthStatePayload = {
    ...payload,
    nonce,
    exp: expiresAt,
  };

  const key = deriveSigningKey(jwtSecret);
  const payloadEncoded = encodeBase64Url(JSON.stringify(fullPayload));
  const hmac = createHmac("sha256", key).update(payloadEncoded).digest();
  const hmacEncoded = encodeBase64Url(hmac);

  return {
    stateToken: `${payloadEncoded}.${hmacEncoded}`,
    nonce,
    expiresAt,
  };
}

export function verifyConnectorOAuthState(
  stateToken: string,
  jwtSecret: string,
): ConnectorOAuthStateVerifyResult {
  const dotIndex = stateToken.indexOf(".");
  if (dotIndex < 0) {
    return { valid: false, error: "MALFORMED_STATE" };
  }

  const payloadEncoded = stateToken.slice(0, dotIndex);
  const hmacEncoded = stateToken.slice(dotIndex + 1);

  const key = deriveSigningKey(jwtSecret);
  const expectedHmac = createHmac("sha256", key).update(payloadEncoded).digest();
  const providedHmac = decodeBase64Url(hmacEncoded);

  if (expectedHmac.length !== providedHmac.length) {
    return { valid: false, error: "INVALID_SIGNATURE" };
  }
  if (!timingSafeEqual(expectedHmac, providedHmac)) {
    return { valid: false, error: "INVALID_SIGNATURE" };
  }

  let payload: ConnectorOAuthStatePayload;
  try {
    const decoded = JSON.parse(decodeBase64Url(payloadEncoded).toString("utf8"));
    if (
      typeof decoded.tenantKey !== "string" ||
      typeof decoded.installationId !== "string" ||
      typeof decoded.connectorKey !== "string" ||
      typeof decoded.nonce !== "string" ||
      typeof decoded.exp !== "number"
    ) {
      return { valid: false, error: "MALFORMED_STATE_PAYLOAD" };
    }
    payload = decoded as ConnectorOAuthStatePayload;
  } catch {
    return { valid: false, error: "MALFORMED_STATE_PAYLOAD" };
  }

  if (Date.now() > payload.exp) {
    return { valid: false, error: "STATE_EXPIRED" };
  }

  return { valid: true, payload };
}
