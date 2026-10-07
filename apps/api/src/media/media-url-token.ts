import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * SEC-DB-RLS-001 D1: signed, tenant-bound, expiring tokens for the PUBLIC media file route.
 *
 * `GET /media/assets/:id/file` is deliberately unauthenticated so external systems (a marketplace pulling a product image) can fetch
 * an asset. It used to look the asset up by id with the context-free database client. No tenant is known there, so under row level
 * security the lookup sees only the default tenant and every other tenant's images would 404. The token carries the tenant, so the
 * route can look the asset up as that tenant, and it is verified BEFORE any database access.
 *
 * Token = `v1.<payload>.<signature>`, both base64url. The payload binds {tenantKey, assetId, purpose = "media-read", expiry}; the
 * signature is HMAC-SHA256 over `v1.<payload>` with MEDIA_URL_SIGNING_KEY (at least 32 characters). During a key rotation
 * MEDIA_URL_SIGNING_KEY_PREVIOUS is accepted for verification only. There is no unsigned tenant parameter and no fallback that
 * trusts a tenant supplied by the caller.
 */

export const MEDIA_READ_PURPOSE = "media-read";
export const MEDIA_TOKEN_VERSION = "v1";
export const MEDIA_TOKEN_MIN_KEY_LENGTH = 32;
export const MEDIA_TOKEN_DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
export const MEDIA_TOKEN_MAX_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_TENANT_KEY_LENGTH = 200;

export type MediaTokenFailure = "MISSING" | "MALFORMED" | "BAD_SIGNATURE" | "WRONG_PURPOSE" | "WRONG_ASSET" | "EXPIRED" | "NOT_CONFIGURED";

export class MediaTokenError extends Error {
  constructor(public readonly reason: MediaTokenFailure) {
    super(`media token rejected: ${reason}`);
    this.name = "MediaTokenError";
  }
}

export interface MediaTokenClaims {
  tenantKey: string;
  assetId: string;
  /** Expiry as epoch seconds. */
  expiresAt: number;
}

interface SigningKeys {
  current: Buffer | null;
  previous: Buffer | null;
}

function keyFrom(value: string | undefined): Buffer | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length >= MEDIA_TOKEN_MIN_KEY_LENGTH ? Buffer.from(trimmed, "utf8") : null;
}

export function resolveMediaSigningKeys(env: NodeJS.ProcessEnv = process.env): SigningKeys {
  return { current: keyFrom(env.MEDIA_URL_SIGNING_KEY), previous: keyFrom(env.MEDIA_URL_SIGNING_KEY_PREVIOUS) };
}

/** True when a current signing key is configured. Until then the route keeps its previous, unsigned behaviour (rollout compatibility). */
export function isMediaSigningConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveMediaSigningKeys(env).current !== null;
}

export function resolveMediaTokenTtlSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(String(env.MEDIA_URL_TTL_SECONDS ?? "").trim());
  if (!Number.isFinite(raw) || raw < 60) {
    return MEDIA_TOKEN_DEFAULT_TTL_SECONDS;
  }
  return Math.min(Math.floor(raw), MEDIA_TOKEN_MAX_TTL_SECONDS);
}

const b64 = (value: Buffer | string) => Buffer.from(value).toString("base64url");
const sign = (key: Buffer, data: string) => createHmac("sha256", key).update(data, "utf8").digest();

export function signMediaToken(
  input: { tenantKey: string; assetId: string; ttlSeconds?: number; nowMs?: number },
  env: NodeJS.ProcessEnv = process.env,
): string {
  const { current } = resolveMediaSigningKeys(env);
  if (!current) {
    throw new MediaTokenError("NOT_CONFIGURED");
  }
  const tenantKey = String(input.tenantKey ?? "").trim();
  const assetId = String(input.assetId ?? "").trim();
  if (!tenantKey || !assetId) {
    throw new MediaTokenError("MALFORMED");
  }
  const ttl = Math.min(Math.max(Math.floor(input.ttlSeconds ?? resolveMediaTokenTtlSeconds(env)), 60), MEDIA_TOKEN_MAX_TTL_SECONDS);
  const expiresAt = Math.floor((input.nowMs ?? Date.now()) / 1000) + ttl;
  const payload = b64(JSON.stringify({ t: tenantKey, a: assetId, p: MEDIA_READ_PURPOSE, e: expiresAt }));
  const head = `${MEDIA_TOKEN_VERSION}.${payload}`;
  return `${head}.${b64(sign(current, head))}`;
}

/**
 * Verifies a token for a specific asset. Order matters and nothing here touches the database: shape, signature, purpose, asset, expiry.
 * Throws a MediaTokenError whose reason is for logs only; callers must answer every failure identically.
 */
export function verifyMediaToken(
  token: string | undefined | null,
  expected: { assetId: string; nowMs?: number },
  env: NodeJS.ProcessEnv = process.env,
): MediaTokenClaims {
  const keys = resolveMediaSigningKeys(env);
  if (!keys.current) {
    throw new MediaTokenError("NOT_CONFIGURED");
  }
  const text = String(token ?? "").trim();
  if (!text) {
    throw new MediaTokenError("MISSING");
  }
  const parts = text.split(".");
  if (parts.length !== 3 || parts[0] !== MEDIA_TOKEN_VERSION || !parts[1] || !parts[2]) {
    throw new MediaTokenError("MALFORMED");
  }
  const head = `${parts[0]}.${parts[1]}`;
  let given: Buffer;
  try {
    given = Buffer.from(parts[2], "base64url");
  } catch {
    throw new MediaTokenError("MALFORMED");
  }
  const matchesKey = (key: Buffer | null) => {
    if (!key) {
      return false;
    }
    const want = sign(key, head);
    return given.length === want.length && timingSafeEqual(given, want);
  };
  if (!matchesKey(keys.current) && !matchesKey(keys.previous)) {
    throw new MediaTokenError("BAD_SIGNATURE");
  }

  let payload: { t?: unknown; a?: unknown; p?: unknown; e?: unknown };
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new MediaTokenError("MALFORMED");
  }
  if (payload.p !== MEDIA_READ_PURPOSE) {
    throw new MediaTokenError("WRONG_PURPOSE");
  }
  const tenantKey = typeof payload.t === "string" ? payload.t.trim() : "";
  const assetId = typeof payload.a === "string" ? payload.a : "";
  const expiresAt = typeof payload.e === "number" ? payload.e : Number.NaN;
  if (!tenantKey || tenantKey.length > MAX_TENANT_KEY_LENGTH || !assetId || !Number.isFinite(expiresAt)) {
    throw new MediaTokenError("MALFORMED");
  }
  if (assetId !== expected.assetId) {
    throw new MediaTokenError("WRONG_ASSET");
  }
  if (expiresAt <= Math.floor((expected.nowMs ?? Date.now()) / 1000)) {
    throw new MediaTokenError("EXPIRED");
  }
  return { tenantKey, assetId, expiresAt };
}

/** The path-and-query to append to the public file route for an asset, or "" when signing is not configured. */
export function mediaTokenQuery(input: { tenantKey: string; assetId: string }, env: NodeJS.ProcessEnv = process.env): string {
  return isMediaSigningConfigured(env) ? `?t=${signMediaToken(input, env)}` : "";
}

/** The public URL an external system uses to fetch an asset: signed and tenant-bound once the key is configured, the plain path before. */
export function buildPublicMediaFileUrl(
  input: { apiBase: string; assetId: string; tenantKey: string },
  env: NodeJS.ProcessEnv = process.env,
): string {
  return `${input.apiBase.replace(/\/+$/, "")}/media/assets/${input.assetId}/file${mediaTokenQuery({ tenantKey: input.tenantKey, assetId: input.assetId }, env)}`;
}
