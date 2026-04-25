import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { AppRole } from "@/lib/api";

interface PimJwtClaims {
  sub: string;
  tenantId: string;
  jti: string;
  role?: AppRole;
  iat: number;
  exp: number;
}

const APP_ROLES: readonly AppRole[] = ["admin", "editor", "reviewer", "viewer"];

function toBase64Url(value: Buffer | string): string {
  const source = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return source
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  const padded = padding === 0 ? normalized : normalized + "=".repeat(4 - padding);
  return Buffer.from(padded, "base64");
}

function signSegment(input: string, secret: string): string {
  return toBase64Url(createHmac("sha256", secret).update(input).digest());
}

function getJwtSecret(): string | null {
  const value = String(process.env.JWT_SECRET ?? process.env.PIM_JWT_SECRET ?? "").trim();
  return value.length > 0 ? value : null;
}

function parseClaims(payloadSegment: string): PimJwtClaims | null {
  try {
    const payload = JSON.parse(fromBase64Url(payloadSegment).toString("utf8")) as Record<string, unknown>;
    const roleValue = String(payload.role ?? "").trim().toLowerCase();
    const role = APP_ROLES.includes(roleValue as AppRole) ? (roleValue as AppRole) : undefined;
    const sub = String(payload.sub ?? "").trim();
    const tenantId = String(payload.tenantId ?? "").trim();
    const jti = String(payload.jti ?? "").trim();
    const iat = Number(payload.iat);
    const exp = Number(payload.exp);
    if (!sub || !tenantId || !jti || !Number.isFinite(iat) || !Number.isFinite(exp)) {
      return null;
    }
    return { sub, tenantId, jti, role, iat, exp };
  } catch {
    return null;
  }
}

function verifyToken(token: string): PimJwtClaims | null {
  const secret = getJwtSecret();
  if (!secret) {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [headerSegment, payloadSegment, signatureSegment] = parts;
  const unsigned = `${headerSegment}.${payloadSegment}`;
  const expectedSignature = signSegment(unsigned, secret);
  const expectedBuffer = Buffer.from(expectedSignature);
  const actualBuffer = Buffer.from(signatureSegment);
  if (expectedBuffer.length !== actualBuffer.length) {
    return null;
  }
  if (!timingSafeEqual(expectedBuffer, actualBuffer)) {
    return null;
  }
  const claims = parseClaims(payloadSegment);
  if (!claims) {
    return null;
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (claims.exp <= nowSeconds) {
    return null;
  }
  return claims;
}

function parseUnverifiedToken(token: string): PimJwtClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  return parseClaims(parts[1]);
}

export async function getServerSessionClaims(): Promise<PimJwtClaims | null> {
  const cookieStore = await cookies();
  const token = String(cookieStore.get("pim_access_token")?.value ?? "").trim();
  if (!token) {
    return null;
  }
  const verified = verifyToken(token);
  if (verified) {
    return verified;
  }
  if (!getJwtSecret()) {
    return parseUnverifiedToken(token);
  }
  return null;
}

export async function getServerActorRole(): Promise<AppRole> {
  const claims = await getServerSessionClaims();
  if (claims?.role && APP_ROLES.includes(claims.role)) {
    return claims.role;
  }
  return "viewer";
}
