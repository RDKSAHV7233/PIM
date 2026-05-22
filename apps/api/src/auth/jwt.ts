import { createHmac, timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";
import { FOUNDATION_ROLES, type FoundationRole, APP_ROLES, AppRole } from "../common/rbac/roles";

const DEFAULT_EXPIRY_SECONDS = 4 * 60 * 60;
export const STEP_UP_SCOPE_MAPPING_HIGH_RISK = "mapping_high_risk";
// Auth-config step-up scope guards tenant authentication-policy mutations: OIDC IdP
// configuration upsert/delete and any future change that affects how users sign in.
// Mutating these without a fresh password proof would let a hijacked admin session
// silently rewire sign-in. Added 2026-05-17 with the OIDC admin UI.
export const STEP_UP_SCOPE_AUTH_CONFIG_HIGH_RISK = "auth_config_high_risk";
export type StepUpScope =
  | typeof STEP_UP_SCOPE_MAPPING_HIGH_RISK
  | typeof STEP_UP_SCOPE_AUTH_CONFIG_HIGH_RISK;
export type PimJwtTokenType = "access" | "step_up" | "mfa_pending" | "mfa_enrollment" | "refresh";

interface JwtHeader {
  alg: "HS256";
  typ: "JWT";
}

export interface PimJwtClaims {
  sub: string;
  tenantId: string;
  jti: string;
  role?: AppRole;
  assignedRoles?: FoundationRole[];
  tokenType?: PimJwtTokenType;
  stepUpScope?: StepUpScope;
  parentJti?: string;
  mfaVerified?: boolean;
  iat: number;
  exp: number;
}

interface SignJwtInput {
  sub: string;
  tenantId: string;
  role?: AppRole;
  assignedRoles?: FoundationRole[];
  jti?: string;
  expiresInSeconds?: number;
  tokenType?: PimJwtTokenType;
  stepUpScope?: StepUpScope;
  parentJti?: string;
  minimumExpiresInSeconds?: number;
  mfaVerified?: boolean;
}

function getJwtSecret(): string {
  const value = String(process.env.JWT_SECRET ?? process.env.PIM_JWT_SECRET ?? "").trim();
  if (value.length > 0) {
    return value;
  }
  throw new Error("JWT secret is not configured.");
}

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

function isAppRole(value: unknown): value is AppRole {
  return APP_ROLES.includes(value as AppRole);
}

function isFoundationRole(value: unknown): value is FoundationRole {
  return FOUNDATION_ROLES.includes(value as FoundationRole);
}

function isTokenType(value: unknown): value is PimJwtTokenType {
  return value === "access" || value === "step_up" || value === "mfa_pending" || value === "mfa_enrollment" || value === "refresh";
}

function isStepUpScope(value: unknown): value is StepUpScope {
  return (
    value === STEP_UP_SCOPE_MAPPING_HIGH_RISK ||
    value === STEP_UP_SCOPE_AUTH_CONFIG_HIGH_RISK
  );
}

export function signPimJwt(input: SignJwtInput): string {
  const now = Math.floor(Date.now() / 1000);
  const minimumExpiresInSeconds = Number.isFinite(input.minimumExpiresInSeconds)
    ? Math.max(1, Math.floor(input.minimumExpiresInSeconds ?? 60))
    : 60;
  const expiresInSeconds = Number.isFinite(input.expiresInSeconds)
    ? Math.max(minimumExpiresInSeconds, Math.floor(input.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS))
    : DEFAULT_EXPIRY_SECONDS;
  const tokenType = input.tokenType ?? "access";
  const header: JwtHeader = { alg: "HS256", typ: "JWT" };
  const claims: PimJwtClaims = {
    sub: input.sub,
    tenantId: input.tenantId,
    jti: input.jti?.trim() || randomUUID(),
    role: input.role,
    assignedRoles: Array.isArray(input.assignedRoles)
      ? Array.from(new Set(input.assignedRoles.filter((role) => isFoundationRole(role))))
      : undefined,
    tokenType,
    stepUpScope: tokenType === "step_up" ? input.stepUpScope : undefined,
    parentJti: tokenType === "step_up" ? input.parentJti?.trim() : undefined,
    mfaVerified: input.mfaVerified === true ? true : undefined,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const headerSegment = toBase64Url(JSON.stringify(header));
  const payloadSegment = toBase64Url(JSON.stringify(claims));
  const unsigned = `${headerSegment}.${payloadSegment}`;
  const signature = signSegment(unsigned, getJwtSecret());
  return `${unsigned}.${signature}`;
}

function parseClaims(payloadSegment: string): PimJwtClaims | null {
  try {
    const payload = JSON.parse(fromBase64Url(payloadSegment).toString("utf8")) as Record<string, unknown>;
    const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
    const tenantId = typeof payload.tenantId === "string" ? payload.tenantId.trim() : "";
    const jti = typeof payload.jti === "string" ? payload.jti.trim() : "";
    const iat = typeof payload.iat === "number" ? payload.iat : Number.NaN;
    const exp = typeof payload.exp === "number" ? payload.exp : Number.NaN;
    const role = isAppRole(payload.role) ? payload.role : undefined;
    const assignedRoles = Array.isArray(payload.assignedRoles)
      ? payload.assignedRoles.filter((value) => isFoundationRole(value))
      : undefined;
    const tokenType = isTokenType(payload.tokenType) ? payload.tokenType : "access";
    const stepUpScope = isStepUpScope(payload.stepUpScope) ? payload.stepUpScope : undefined;
    const parentJti = typeof payload.parentJti === "string" ? payload.parentJti.trim() : undefined;
    const mfaVerified = payload.mfaVerified === true ? true : undefined;

    if (!sub || !tenantId || !jti || !Number.isFinite(iat) || !Number.isFinite(exp)) {
      return null;
    }
    if (tokenType === "step_up" && (!stepUpScope || !parentJti)) {
      return null;
    }
    return { sub, tenantId, jti, role, assignedRoles, tokenType, stepUpScope, parentJti, mfaVerified, iat, exp };
  } catch {
    return null;
  }
}

export function verifyPimJwt(token: string): PimJwtClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [headerSegment, payloadSegment, signatureSegment] = parts;
  const unsigned = `${headerSegment}.${payloadSegment}`;
  const expected = signSegment(unsigned, getJwtSecret());

  const expectedBuffer = Buffer.from(expected);
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

  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= now) {
    return null;
  }

  return claims;
}

export function extractBearerToken(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : null;
}

export function decodePimJwtFromAuthHeader(value: unknown): PimJwtClaims | null {
  const token = extractBearerToken(value);
  if (!token) {
    return null;
  }
  return verifyPimJwt(token);
}
