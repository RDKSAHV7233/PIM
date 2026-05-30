import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { AppRole } from "@/lib/api";

type AdminBoundaryRole = "product_admin" | "system_admin" | "super_admin";

interface PimJwtClaims {
  sub: string;
  tenantId: string;
  jti: string;
  role?: AppRole;
  assignedRoles?: string[];
  adminBoundaryRoles?: AdminBoundaryRole[];
  iat: number;
  exp: number;
}

const APP_ROLES: readonly AppRole[] = ["admin", "editor", "publisher", "approver", "channel_manager", "connector_admin", "reviewer", "viewer"];
const ADMIN_BOUNDARY_ROLES: readonly AdminBoundaryRole[] = ["product_admin", "system_admin", "super_admin"];

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

function requiresVerifiedSessions(): boolean {
  const appEnv = String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "").trim().toLowerCase();
  return appEnv === "staging" || appEnv === "production";
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
    const rawAssignedRoles = Array.isArray(payload.assignedRoles) ? payload.assignedRoles : [];
    const adminBoundaryRoles = rawAssignedRoles
      .map((r) => String(r).trim().toLowerCase())
      .filter((r): r is AdminBoundaryRole => ADMIN_BOUNDARY_ROLES.includes(r as AdminBoundaryRole));
    return { sub, tenantId, jti, role, assignedRoles: rawAssignedRoles.map(String), adminBoundaryRoles, iat, exp };
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

export async function getServerSessionClaims(): Promise<PimJwtClaims | null> {
  const cookieStore = await cookies();
  const token = String(cookieStore.get("pim_access_token")?.value ?? "").trim();
  if (!token) {
    return null;
  }
  const secret = getJwtSecret();
  if (!secret) {
    if (requiresVerifiedSessions()) {
      throw new Error("JWT_SECRET or PIM_JWT_SECRET is required for verified web sessions.");
    }
    return null;
  }
  const verified = verifyToken(token);
  if (verified) {
    return verified;
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

export async function getServerActorAdminBoundaryRoles(): Promise<AdminBoundaryRole[]> {
  const claims = await getServerSessionClaims();
  return claims?.adminBoundaryRoles ?? [];
}

/**
 * Combined helper — reads cookies ONCE, verifies the JWT ONCE, and returns
 * both values that almost every page needs.  Calling getServerAuthHeader()
 * and getServerActorRole() separately incurs two `await cookies()` calls and
 * two JWT decode paths; this helper halves that cost.
 *
 * Usage (destructure with rename if needed):
 *   const { authHeader, actorRole } = await getServerSession();
 *   const { authHeader, actorRole: role } = await getServerSession();
 */
export async function getServerSession(): Promise<{
  authHeader: string | undefined;
  actorRole: AppRole;
  adminBoundaryRoles: AdminBoundaryRole[];
}> {
  const cookieStore = await cookies();
  const token = String(cookieStore.get("pim_access_token")?.value ?? "").trim();
  const authHeader = token ? `Bearer ${token}` : undefined;

  if (!token) {
    return { authHeader: undefined, actorRole: "viewer", adminBoundaryRoles: [] };
  }

  const secret = getJwtSecret();
  if (!secret) {
    if (requiresVerifiedSessions()) {
      throw new Error("JWT_SECRET or PIM_JWT_SECRET is required for verified web sessions.");
    }
    return { authHeader, actorRole: "viewer", adminBoundaryRoles: [] };
  }

  const claims = verifyToken(token);
  const actorRole: AppRole =
    claims?.role && APP_ROLES.includes(claims.role) ? claims.role : "viewer";
  const adminBoundaryRoles: AdminBoundaryRole[] = claims?.adminBoundaryRoles ?? [];
  return { authHeader, actorRole, adminBoundaryRoles };
}
