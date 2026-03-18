import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

type HeaderValue = string | string[] | undefined;

function firstHeaderValue(value: HeaderValue): string {
  return Array.isArray(value) ? String(value[0] ?? "").trim() : String(value ?? "").trim();
}

function toBase64Url(value: Buffer): string {
  return value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function extractApiKeyFromHeaders(headers: Record<string, HeaderValue>): string | null {
  const directHeader = firstHeaderValue(headers["x-pim-api-key"]);
  if (directHeader) {
    return directHeader;
  }

  const authorization = firstHeaderValue(headers.authorization);
  if (!authorization) {
    return null;
  }
  const match = authorization.match(/^ApiKey\s+(.+)$/i);
  if (!match) {
    return null;
  }
  const token = String(match[1] ?? "").trim();
  return token.length > 0 ? token : null;
}

export function generateApiKeySecret(): string {
  return toBase64Url(randomBytes(32));
}

export function buildPlainTextApiKey(id: string, secret: string): string {
  return `pim1_${id}.${secret}`;
}

export function buildApiKeyPrefix(id: string): string {
  return `pim1_${id.slice(0, 8)}`;
}

export function parsePlainTextApiKey(rawKey: string): { id: string; secret: string } | null {
  const normalized = String(rawKey ?? "").trim();
  const match = normalized.match(/^pim1_([A-Za-z0-9-]+)\.([A-Za-z0-9_-]+)$/);
  if (!match) {
    return null;
  }
  const [, id, secret] = match;
  if (!id || !secret) {
    return null;
  }
  return { id, secret };
}

export function hashApiKeySecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function apiKeySecretMatches(expectedHash: string, secret: string): boolean {
  const expected = Buffer.from(String(expectedHash ?? ""), "utf8");
  const actual = Buffer.from(hashApiKeySecret(secret), "utf8");
  if (expected.length !== actual.length) {
    return false;
  }
  return timingSafeEqual(expected, actual);
}
