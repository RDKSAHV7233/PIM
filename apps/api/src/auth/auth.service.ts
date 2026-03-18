import { Injectable, Logger, OnModuleDestroy, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { AuditService } from "../audit/audit.service";
import { AppRole } from "../common/rbac/roles";
import { normalizeAppRole, resolveDefaultRole } from "../common/rbac/role-utils";
import { TenantDirectoryService } from "../common/tenant/tenant-directory.service";
import { normalizeTenantKey, normalizeWorkspaceSlug } from "../common/tenant/tenant.constants";
import { PrismaService } from "../prisma/prisma.service";
import { LoginDto } from "./dto/login.dto";
import { JwtBlocklistService } from "./jwt-blocklist.service";
import { PimJwtClaims, StepUpScope, signPimJwt } from "./jwt";

const DEFAULT_LOGIN_EXPIRY_MINUTES = 4 * 60;
const MAX_LOGIN_EXPIRY_MINUTES = 4 * 60;
const DEFAULT_IP_ATTEMPT_LIMIT = 10;
const DEFAULT_IP_WINDOW_MS = 15 * 60 * 1000;
const USER_ATTEMPT_LIMIT = 5;
const ACCOUNT_LOCK_MS = 15 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const DEFAULT_REDIS_URL = "redis://localhost:6379";
const REDIS_RETRY_BACKOFF_MS = 30_000;
const REDIS_WARN_THROTTLE_MS = 10_000;
const REDIS_CONNECT_TIMEOUT_MS = 1_000;
const DEFAULT_STEP_UP_EXPIRY_SECONDS = 5 * 60;
const MAX_STEP_UP_EXPIRY_SECONDS = 15 * 60;

function resolvePositiveIntegerEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: "Bearer";
  expiresInSeconds: number;
  userId: string;
  tenantId: string;
  role: AppRole;
}

export interface StepUpResponse {
  stepUpToken: string;
  tokenType: "StepUp";
  expiresInSeconds: number;
  scope: StepUpScope;
}

interface IpAttemptState {
  windowStartMs: number;
  attempts: number;
}

interface UserLockState {
  failedAttempts: number;
  lockedUntilMs: number | null;
  lastResendAtMs: number | null;
  maskedIdentity: string;
}

interface ResolvedLoginIdentity {
  userId: string;
  tenantId: string;
  role: AppRole;
  lockedUntil: Date | null;
}

interface AuthIdentityRow {
  userId: string;
  tenantKey: string;
  role: string;
  isActive: boolean;
  lockedUntil: Date | null;
}

export type LoginResult =
  | {
      type: "success";
      payload: LoginResponse;
    }
  | {
      type: "invalid_credentials";
      attemptsRemaining: number;
    }
  | {
      type: "account_locked";
      unlockAt: string;
      maskedEmail: string;
    }
  | {
      type: "rate_limited";
      retryAfterSeconds: number;
    }
  | {
      type: "workspace_not_found";
    };

export interface ResendUnlockResult {
  ok: true;
  resent: boolean;
  retryAfterSeconds: number;
}

export interface RequestPasswordResetResult {
  ok: true;
  requested: boolean;
  retryAfterSeconds: number;
}

export interface RecordConsentInput {
  userId: string;
  tenantId: string;
  role: AppRole;
  accepted: boolean;
  policyVersion?: string;
  purpose?: string;
}

export interface RecordConsentResult {
  ok: true;
  userId: string;
  tenantId: string;
  accepted: boolean;
  consentRecordedAt: string;
  policyVersion: string;
  purpose: string;
}

export interface RequestAccountExportInput {
  userId: string;
  tenantId: string;
  role: AppRole;
  format?: "json" | "csv";
}

export interface RequestAccountExportResult {
  ok: true;
  jobId: string;
  status: "queued";
  format: "json" | "csv";
  requestedAt: string;
  estimatedReadyInSeconds: number;
}

export interface DeleteAccountInput {
  userId: string;
  tenantId: string;
  role: AppRole;
  reason?: string;
}

export interface DeleteAccountResult {
  ok: true;
  ticketId: string;
  status: "scheduled";
  scheduledFor: string;
}

export interface AccountPrivacyStatusResult {
  ok: true;
  userId: string;
  tenantId: string;
  latestConsent: {
    accepted: boolean;
    policyVersion: string;
    purpose: string;
    consentRecordedAt: string;
  } | null;
  latestExport: {
    jobId: string;
    status: string;
    format: string;
    requestedAt: string;
    estimatedReadyInSeconds: number;
  } | null;
  latestDeletion: {
    ticketId: string;
    status: string;
    requestedAt: string;
    scheduledFor: string;
  } | null;
}

@Injectable()
export class AuthService implements OnModuleDestroy {
  private readonly logger = new Logger(AuthService.name);
  private readonly ipAttempts = new Map<string, IpAttemptState>();
  private readonly userLocks = new Map<string, UserLockState>();
  private readonly identityDirectory = this.loadIdentityDirectory();
  private redisClient: ReturnType<typeof createClient> | null = null;
  private redisConnecting: Promise<void> | null = null;
  private redisAvailable = false;
  private redisRetryAfterMs = 0;
  private lastRedisWarnAtMs = 0;
  private readonly ipAttemptLimit = resolvePositiveIntegerEnv(
    process.env.PIM_AUTH_IP_ATTEMPT_LIMIT,
    DEFAULT_IP_ATTEMPT_LIMIT,
  );
  private readonly ipWindowMs = resolvePositiveIntegerEnv(process.env.PIM_AUTH_IP_WINDOW_MS, DEFAULT_IP_WINDOW_MS);

  constructor(
    private readonly jwtBlocklistService: JwtBlocklistService,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly tenantDirectoryService: TenantDirectoryService,
  ) {}

  async login(dto: LoginDto, ipAddress: string): Promise<LoginResult> {
    const now = Date.now();
    const retryAfterSeconds = await this.incrementAndCheckIpRateLimit(ipAddress, now);
    if (retryAfterSeconds > 0) {
      return {
        type: "rate_limited",
        retryAfterSeconds,
      };
    }

    const submittedWorkspaceSlug = normalizeWorkspaceSlug(dto.workspaceSlug ?? process.env.PIM_DEFAULT_WORKSPACE_SLUG ?? "");
    const workspace =
      (submittedWorkspaceSlug
        ? await this.tenantDirectoryService.resolveWorkspaceSlug(submittedWorkspaceSlug)
        : null) ??
      (dto.tenantId ? await this.tenantDirectoryService.resolveTenantAlias(dto.tenantId) : null);
    if (!workspace) {
      return { type: "workspace_not_found" };
    }

    const normalizedWorkspaceSlug = workspace.workspaceSlug || submittedWorkspaceSlug;
    const normalizedUserId = this.normalizeUserKey(dto.userId);
    const userKey = this.composeLoginLockKey(normalizedWorkspaceSlug, normalizedUserId);
    const existingLock = await this.getActiveLock(userKey, dto.userId, now);
    if (existingLock?.lockedUntilMs && existingLock.lockedUntilMs > now) {
      return {
        type: "account_locked",
        unlockAt: new Date(existingLock.lockedUntilMs).toISOString(),
        maskedEmail: existingLock.maskedIdentity,
      };
    }

    const credentialOk = this.verifyCredential(dto);
    if (!credentialOk) {
      const lockState = await this.recordFailedCredential(userKey, dto.userId, now);
      if (lockState.lockedUntilMs && lockState.lockedUntilMs > now) {
        return {
          type: "account_locked",
          unlockAt: new Date(lockState.lockedUntilMs).toISOString(),
          maskedEmail: lockState.maskedIdentity,
        };
      }
      const attemptsRemaining = Math.max(0, USER_ATTEMPT_LIMIT - lockState.failedAttempts);
      return { type: "invalid_credentials", attemptsRemaining };
    }

    const identity = await this.resolveLoginIdentity(dto.userId, workspace.tenantId);
    if (!identity) {
      const lockState = await this.recordFailedCredential(userKey, dto.userId, now);
      if (lockState.lockedUntilMs && lockState.lockedUntilMs > now) {
        return {
          type: "account_locked",
          unlockAt: new Date(lockState.lockedUntilMs).toISOString(),
          maskedEmail: lockState.maskedIdentity,
        };
      }
      const attemptsRemaining = Math.max(0, USER_ATTEMPT_LIMIT - lockState.failedAttempts);
      return { type: "invalid_credentials", attemptsRemaining };
    }
    if (identity.lockedUntil && identity.lockedUntil.getTime() > now) {
      return {
        type: "account_locked",
        unlockAt: identity.lockedUntil.toISOString(),
        maskedEmail: this.maskIdentity(identity.userId),
      };
    }
    const expiryMinutes = Number.isFinite(dto.expiresInMinutes)
      ? Math.min(MAX_LOGIN_EXPIRY_MINUTES, Math.max(1, Math.floor(dto.expiresInMinutes ?? DEFAULT_LOGIN_EXPIRY_MINUTES)))
      : DEFAULT_LOGIN_EXPIRY_MINUTES;
    const expiresInSeconds = expiryMinutes * 60;

    const accessToken = signPimJwt({
      sub: identity.userId,
      tenantId: identity.tenantId,
      role: identity.role,
      expiresInSeconds,
    });

    await this.clearUserFailures(userKey);

    return {
      type: "success",
      payload: {
        accessToken,
        tokenType: "Bearer",
        expiresInSeconds,
        userId: identity.userId,
        tenantId: identity.tenantId,
        role: identity.role,
      },
    };
  }

  async logout(claims: PimJwtClaims): Promise<void> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const ttlSeconds = Math.max(1, claims.exp - nowSeconds);
    await this.jwtBlocklistService.revoke(claims.jti, ttlSeconds);
  }

  async issueStepUp(input: {
    claims: PimJwtClaims;
    password: string;
    scope: StepUpScope;
    ipAddress: string;
  }): Promise<StepUpResponse> {
    if (!this.verifyPassword(input.password)) {
      await this.auditService.record({
        actorId: input.claims.sub,
        actorRole: input.claims.role ?? "viewer",
        action: "auth.step_up_denied",
        resource: "auth.step_up",
        metadata: {
          scope: input.scope,
          reason: "invalid_credentials",
          parentJti: input.claims.jti,
          ipAddress: input.ipAddress,
        },
      });
      throw new UnauthorizedException({ error: "STEP_UP_INVALID_CREDENTIALS" });
    }

    const expiresInSeconds = this.resolveStepUpExpirySeconds();
    const stepUpToken = signPimJwt({
      sub: input.claims.sub,
      tenantId: input.claims.tenantId,
      role: input.claims.role,
      tokenType: "step_up",
      stepUpScope: input.scope,
      parentJti: input.claims.jti,
      expiresInSeconds,
      minimumExpiresInSeconds: 1,
    });

    await this.auditService.record({
      actorId: input.claims.sub,
      actorRole: input.claims.role ?? "viewer",
      action: "auth.step_up_issued",
      resource: "auth.step_up",
      metadata: {
        scope: input.scope,
        parentJti: input.claims.jti,
        expiresInSeconds,
        ipAddress: input.ipAddress,
      },
    });

    return {
      stepUpToken,
      tokenType: "StepUp",
      expiresInSeconds,
      scope: input.scope,
    };
  }

  async resendUnlock(email: string, workspaceSlugInput: string): Promise<ResendUnlockResult> {
    const userKey = this.composeLoginLockKey(
      workspaceSlugInput || process.env.PIM_DEFAULT_WORKSPACE_SLUG || process.env.PIM_DEFAULT_TENANT_KEY || "",
      this.normalizeUserKey(email),
    );
    const now = Date.now();
    const state = await this.getActiveLock(userKey, email, now);

    if (!state || !state.lockedUntilMs || state.lockedUntilMs <= now) {
      return {
        ok: true,
        resent: false,
        retryAfterSeconds: 0,
      };
    }

    const redisResult = await this.applyResendCooldownRedis(userKey, now);
    if (redisResult) {
      return redisResult;
    }

    const lastResendAtMs = state.lastResendAtMs ?? 0;
    const cooldownRemainingMs = Math.max(0, RESEND_COOLDOWN_MS - (now - lastResendAtMs));
    if (cooldownRemainingMs > 0) {
      return {
        ok: true,
        resent: false,
        retryAfterSeconds: Math.ceil(cooldownRemainingMs / 1000),
      };
    }
    state.lastResendAtMs = now;
    this.userLocks.set(userKey, state);
    return {
      ok: true,
      resent: true,
      retryAfterSeconds: 0,
    };
  }

  async requestPasswordReset(email: string): Promise<RequestPasswordResetResult> {
    const normalizedEmail = this.normalizeUserKey(email);

    await this.auditService.record({
      actorId: normalizedEmail || "unknown",
      actorRole: "public",
      action: "auth.password_reset_requested",
      resource: "auth.password_reset",
      metadata: {
        emailMasked: this.maskIdentity(normalizedEmail),
      },
    });

    return {
      ok: true,
      requested: true,
      retryAfterSeconds: 0,
    };
  }

  async recordConsent(input: RecordConsentInput): Promise<RecordConsentResult> {
    const tenantId = normalizeTenantKey(input.tenantId);
    const userId = input.userId.trim();
    const policyVersion = String(input.policyVersion ?? "").trim() || "dpdp-v1";
    const purpose = String(input.purpose ?? "").trim() || "account_access";
    const consentRecordedAt = new Date().toISOString();
    const record: RecordConsentResult = {
      ok: true,
      userId,
      tenantId,
      accepted: input.accepted,
      consentRecordedAt,
      policyVersion,
      purpose,
    };
    await this.prisma
      .tenant(tenantId)
      // RLS-BYPASS: manual tenant filter
      .$executeRawUnsafe(
        `
        INSERT INTO account_consent_events (
          id,
          tenant_key,
          user_id,
          accepted,
          policy_version,
          purpose,
          consent_recorded_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
        `,
        randomUUID(),
        tenantId,
        userId,
        input.accepted,
        policyVersion,
        purpose,
        consentRecordedAt,
      );

    await this.auditService.record({
      actorId: userId,
      actorRole: input.role,
      action: "consent.recorded",
      resource: "account_consent_events",
      metadata: {
        tenantId,
        policyVersion,
        purpose,
        accepted: input.accepted,
      },
    });

    return record;
  }

  async requestAccountExport(input: RequestAccountExportInput): Promise<RequestAccountExportResult> {
    const tenantId = normalizeTenantKey(input.tenantId);
    const userId = input.userId.trim();
    const requestedAt = new Date().toISOString();
    const jobId = `exp_${randomUUID()}`;
    const result: RequestAccountExportResult = {
      ok: true,
      jobId,
      status: "queued",
      format: input.format ?? "json",
      requestedAt,
      estimatedReadyInSeconds: 120,
    };

    await this.prisma
      .tenant(tenantId)
      // RLS-BYPASS: manual tenant filter
      .$executeRawUnsafe(
        `
        INSERT INTO account_export_requests (
          id,
          tenant_key,
          user_id,
          actor_role,
          format,
          status,
          requested_at,
          estimated_ready_in_seconds
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8)
        `,
        jobId,
        tenantId,
        userId,
        input.role,
        result.format,
        result.status,
        requestedAt,
        result.estimatedReadyInSeconds,
      );

    await this.auditService.record({
      actorId: userId,
      actorRole: input.role,
      action: "account.export_requested",
      resource: "account_export_requests",
      resourceId: jobId,
      metadata: {
        tenantId,
        format: result.format,
      },
    });

    return result;
  }

  async getAccountPrivacyStatus(userIdInput: string, tenantIdInput: string): Promise<AccountPrivacyStatusResult> {
    const tenantId = normalizeTenantKey(tenantIdInput);
    const userId = userIdInput.trim();
    const rows = (await this.prisma
      .tenant(tenantId)
      // RLS-BYPASS: manual tenant filter
      .$queryRawUnsafe(
        `
        SELECT
          (
            SELECT row_to_json(c)
            FROM (
              SELECT
                accepted,
                policy_version AS "policyVersion",
                purpose,
                consent_recorded_at AS "consentRecordedAt"
              FROM account_consent_events
              WHERE tenant_key = $1 AND user_id = $2
              ORDER BY consent_recorded_at DESC
              LIMIT 1
            ) c
          ) AS "latestConsent",
          (
            SELECT row_to_json(e)
            FROM (
              SELECT
                id AS "jobId",
                status,
                format,
                requested_at AS "requestedAt",
                estimated_ready_in_seconds AS "estimatedReadyInSeconds"
              FROM account_export_requests
              WHERE tenant_key = $1 AND user_id = $2
              ORDER BY requested_at DESC
              LIMIT 1
            ) e
          ) AS "latestExport",
          (
            SELECT row_to_json(d)
            FROM (
              SELECT
                id AS "ticketId",
                status,
                requested_at AS "requestedAt",
                scheduled_for AS "scheduledFor"
              FROM account_deletion_requests
              WHERE tenant_key = $1 AND user_id = $2
              ORDER BY requested_at DESC
              LIMIT 1
            ) d
          ) AS "latestDeletion"
        `,
        tenantId,
        userId,
      )) as Array<{
      latestConsent: AccountPrivacyStatusResult["latestConsent"];
      latestExport: AccountPrivacyStatusResult["latestExport"];
      latestDeletion: AccountPrivacyStatusResult["latestDeletion"];
    }>;

    const first = rows[0] ?? {
      latestConsent: null,
      latestExport: null,
      latestDeletion: null,
    };

    return {
      ok: true,
      userId,
      tenantId,
      latestConsent: first.latestConsent ?? null,
      latestExport: first.latestExport ?? null,
      latestDeletion: first.latestDeletion ?? null,
    };
  }

  async deleteAccount(input: DeleteAccountInput): Promise<DeleteAccountResult> {
    const tenantId = normalizeTenantKey(input.tenantId);
    const userId = input.userId.trim();
    const ticketId = `del_${randomUUID()}`;
    const scheduledFor = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const result: DeleteAccountResult = {
      ok: true,
      ticketId,
      status: "scheduled",
      scheduledFor,
    };

    await this.prisma
      .tenant(tenantId)
      // RLS-BYPASS: manual tenant filter
      .$executeRawUnsafe(
        `
        INSERT INTO account_deletion_requests (
          id,
          tenant_key,
          user_id,
          actor_role,
          reason,
          status,
          requested_at,
          scheduled_for
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7::timestamptz)
        `,
        ticketId,
        tenantId,
        userId,
        input.role,
        input.reason ?? null,
        result.status,
        scheduledFor,
      );

    await this.auditService.record({
      actorId: userId,
      actorRole: input.role,
      action: "account.deletion_scheduled",
      resource: "account_deletion_requests",
      resourceId: ticketId,
      metadata: {
        tenantId,
        scheduledFor,
        reason: input.reason ?? null,
      },
    });

    return result;
  }

  private async incrementAndCheckIpRateLimit(ipAddress: string, now: number): Promise<number> {
    await this.ensureRedisConnection();
    if (this.redisAvailable && this.redisClient) {
      try {
        return await this.incrementAndCheckIpRateLimitRedis(ipAddress);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error ?? "unknown error");
        this.markRedisUnavailable(`Failed to evaluate IP login rate limit in Redis: ${message}`);
      }
    }
    return this.incrementAndCheckIpRateLimitInMemory(ipAddress, now);
  }

  private incrementAndCheckIpRateLimitInMemory(ipAddress: string, now: number): number {
    const ipKey = String(ipAddress || "unknown").trim() || "unknown";
    const existing = this.ipAttempts.get(ipKey);
    if (!existing || now - existing.windowStartMs >= this.ipWindowMs) {
      this.ipAttempts.set(ipKey, {
        windowStartMs: now,
        attempts: 1,
      });
      return 0;
    }

    if (existing.attempts >= this.ipAttemptLimit) {
      const remainingMs = Math.max(0, this.ipWindowMs - (now - existing.windowStartMs));
      return Math.max(1, Math.ceil(remainingMs / 1000));
    }

    existing.attempts += 1;
    this.ipAttempts.set(ipKey, existing);
    return 0;
  }

  private async incrementAndCheckIpRateLimitRedis(ipAddress: string): Promise<number> {
    const client = this.redisClient;
    if (!client) {
      return 0;
    }
    const ipKey = String(ipAddress || "unknown").trim() || "unknown";
    const key = this.ipRateKey(ipKey);
    const attempts = Number(await client.incr(key));
    if (attempts === 1) {
      await client.pExpire(key, this.ipWindowMs);
      return 0;
    }
    if (attempts <= this.ipAttemptLimit) {
      return 0;
    }
    const ttlMs = Number(await client.pTTL(key));
    const effectiveTtlMs = ttlMs > 0 ? ttlMs : this.ipWindowMs;
    return Math.max(1, Math.ceil(effectiveTtlMs / 1000));
  }

  private async getActiveLock(userKey: string, rawIdentity: string, now: number): Promise<UserLockState | null> {
    await this.ensureRedisConnection();
    if (this.redisAvailable && this.redisClient) {
      try {
        const lockRaw = await this.redisClient.get(this.userLockKey(userKey));
        if (lockRaw) {
          const lockText = String(lockRaw);
          const lockedUntilMs = Number.parseInt(lockText, 10);
          if (Number.isFinite(lockedUntilMs) && lockedUntilMs > now) {
            return {
              failedAttempts: USER_ATTEMPT_LIMIT,
              lockedUntilMs,
              lastResendAtMs: null,
              maskedIdentity: this.maskIdentity(rawIdentity),
            };
          }
          await this.redisClient.del(this.userLockKey(userKey));
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error ?? "unknown error");
        this.markRedisUnavailable(`Failed to read account lock from Redis: ${message}`);
      }
    }

    const current = this.userLocks.get(userKey);
    if (!current) {
      return null;
    }
    if (current.lockedUntilMs && current.lockedUntilMs <= now) {
      current.lockedUntilMs = null;
      current.failedAttempts = 0;
      this.userLocks.set(userKey, current);
      return null;
    }
    return current;
  }

  private normalizeUserKey(value: string): string {
    return String(value ?? "").trim().toLowerCase();
  }

  private composeLoginLockKey(workspaceSlugInput: string, userIdInput: string): string {
    const workspaceSlug = normalizeWorkspaceSlug(workspaceSlugInput);
    const normalizedUserId = this.normalizeUserKey(userIdInput);
    return `${workspaceSlug}:${normalizedUserId}`;
  }

  private async resolveLoginIdentity(userIdInput: string, tenantIdInput: string): Promise<ResolvedLoginIdentity | null> {
    const normalizedUserId = this.normalizeUserKey(userIdInput);
    const tenantId = normalizeTenantKey(tenantIdInput);
    if (!normalizedUserId) {
      return null;
    }

    if (this.isDbAuthMode()) {
      const fromDb = await this.resolveIdentityFromDatabase(normalizedUserId, tenantId);
      return fromDb;
    }

    const defaultTenantId = normalizeTenantKey(process.env.PIM_DEFAULT_TENANT_KEY);
    const defaultRole = resolveDefaultRole();
    const fromDirectory = this.identityDirectory.get(normalizedUserId);
    if (fromDirectory) {
      return fromDirectory.tenantId === tenantId ? fromDirectory : null;
    }
    if (this.isLocalAuthMode()) {
      if (defaultTenantId !== tenantId) {
        return null;
      }
      return {
        userId: normalizedUserId,
        tenantId,
        role: defaultRole,
        lockedUntil: null,
      };
    }

    return null;
  }

  private async resolveIdentityFromDatabase(normalizedUserId: string, tenantId: string): Promise<ResolvedLoginIdentity | null> {
    const row = await this.prisma.tenant().authIdentity.findFirst({
      where: {
        tenantKey: tenantId,
        userId: normalizedUserId,
      },
      select: {
        userId: true,
        tenantKey: true,
        role: true,
        isActive: true,
        lockedUntil: true,
      },
    });
    if (!row || !row.isActive) {
      return null;
    }

    return {
      userId: this.normalizeUserKey(row.userId),
      tenantId: normalizeTenantKey(row.tenantKey),
      role: normalizeAppRole(row.role) ?? "viewer",
      lockedUntil: row.lockedUntil,
    };
  }

  private loadIdentityDirectory(): Map<string, ResolvedLoginIdentity> {
    const directory = new Map<string, ResolvedLoginIdentity>();
    if (!this.isLocalAuthMode()) {
      return directory;
    }
    const raw = String(process.env.PIM_AUTH_IDENTITIES_JSON ?? "").trim();
    if (!raw) {
      return directory;
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [userIdRaw, value] of Object.entries(parsed)) {
        const normalizedUserId = this.normalizeUserKey(userIdRaw);
        if (!normalizedUserId || !value || typeof value !== "object" || Array.isArray(value)) {
          continue;
        }
        const candidate = value as Record<string, unknown>;
        const tenantId = normalizeTenantKey(candidate.tenantId ?? process.env.PIM_DEFAULT_TENANT_KEY);
        const role = normalizeAppRole(candidate.role) ?? resolveDefaultRole();
        directory.set(normalizedUserId, {
          userId: normalizedUserId,
          tenantId,
          role,
          lockedUntil: null,
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error ?? "unknown error");
      this.logger.warn(`PIM_AUTH_IDENTITIES_JSON parse failed. Falling back to default identity resolution: ${message}`);
    }

    return directory;
  }

  private verifyCredential(dto: LoginDto): boolean {
    return this.verifyPassword(dto.password);
  }

  private verifyPassword(password: string): boolean {
    if (typeof password !== "string" || password.trim().length === 0) {
      return false;
    }
    const configuredPassword = String(process.env.PIM_AUTH_PASSWORD ?? "").trim();
    const allowLocalDefault = this.isLocalAuthMode();
    if (!configuredPassword && !allowLocalDefault) {
      this.logger.error("PIM_AUTH_PASSWORD must be configured outside local development.");
      return false;
    }
    const expected = configuredPassword || "pim1-demo-password";
    return password === expected;
  }

  private resolveStepUpExpirySeconds(): number {
    const configured = Number.parseInt(String(process.env.PIM_STEP_UP_EXPIRY_SECONDS ?? ""), 10);
    if (!Number.isFinite(configured)) {
      return DEFAULT_STEP_UP_EXPIRY_SECONDS;
    }
    return Math.min(MAX_STEP_UP_EXPIRY_SECONDS, Math.max(1, configured));
  }

  private isLocalAuthMode(): boolean {
    const authMode = String(process.env.AUTH_MODE ?? "").trim().toLowerCase();
    if (authMode === "db") {
      return false;
    }
    if (authMode === "local") {
      return true;
    }
    const appEnv = String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "development")
      .trim()
      .toLowerCase();
    return appEnv === "development" || appEnv === "local" || appEnv === "test";
  }

  private isDbAuthMode(): boolean {
    return String(process.env.AUTH_MODE ?? "").trim().toLowerCase() === "db";
  }

  private async recordFailedCredential(userKey: string, rawIdentity: string, now: number): Promise<UserLockState> {
    await this.ensureRedisConnection();
    if (this.redisAvailable && this.redisClient) {
      try {
        const failedKey = this.userFailedKey(userKey);
        const attempts = Number(await this.redisClient.incr(failedKey));
        if (attempts === 1) {
          await this.redisClient.pExpire(failedKey, ACCOUNT_LOCK_MS);
        }

        let lockedUntilMs: number | null = null;
        if (attempts >= USER_ATTEMPT_LIMIT) {
          lockedUntilMs = now + ACCOUNT_LOCK_MS;
          await Promise.all([
            this.redisClient.set(this.userLockKey(userKey), String(lockedUntilMs), { PX: ACCOUNT_LOCK_MS }),
            this.redisClient.del(failedKey),
          ]);
        }

        return {
          failedAttempts: Math.max(1, attempts),
          lockedUntilMs,
          lastResendAtMs: null,
          maskedIdentity: this.maskIdentity(rawIdentity),
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error ?? "unknown error");
        this.markRedisUnavailable(`Failed to write failed-login state in Redis: ${message}`);
      }
    }

    const current = this.userLocks.get(userKey) ?? {
      failedAttempts: 0,
      lockedUntilMs: null,
      lastResendAtMs: null,
      maskedIdentity: this.maskIdentity(rawIdentity),
    };

    current.failedAttempts += 1;
    if (current.failedAttempts >= USER_ATTEMPT_LIMIT) {
      current.lockedUntilMs = now + ACCOUNT_LOCK_MS;
    }
    this.userLocks.set(userKey, current);
    return current;
  }

  private async clearUserFailures(userKey: string): Promise<void> {
    await this.ensureRedisConnection();
    if (this.redisAvailable && this.redisClient) {
      try {
        await this.redisClient.del([
          this.userFailedKey(userKey),
          this.userLockKey(userKey),
          this.userResendKey(userKey),
        ]);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error ?? "unknown error");
        this.markRedisUnavailable(`Failed clearing user failure state in Redis: ${message}`);
      }
    }

    const current = this.userLocks.get(userKey);
    if (!current) {
      return;
    }
    current.failedAttempts = 0;
    current.lockedUntilMs = null;
    this.userLocks.set(userKey, current);
  }

  private async applyResendCooldownRedis(userKey: string, now: number): Promise<ResendUnlockResult | null> {
    await this.ensureRedisConnection();
    if (!this.redisAvailable || !this.redisClient) {
      return null;
    }

    try {
      const resendKey = this.userResendKey(userKey);
      const outcome = await this.redisClient.set(resendKey, String(now), { NX: true, PX: RESEND_COOLDOWN_MS });
      if (outcome === "OK") {
        return {
          ok: true,
          resent: true,
          retryAfterSeconds: 0,
        };
      }
      const ttlMs = Number(await this.redisClient.pTTL(resendKey));
      const effectiveTtlMs = ttlMs > 0 ? ttlMs : RESEND_COOLDOWN_MS;
      return {
        ok: true,
        resent: false,
        retryAfterSeconds: Math.max(1, Math.ceil(effectiveTtlMs / 1000)),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error ?? "unknown error");
      this.markRedisUnavailable(`Failed to apply resend unlock cooldown in Redis: ${message}`);
      return null;
    }
  }

  private ipRateKey(ipKey: string): string {
    return `${this.redisKeyPrefix()}login:ip:${ipKey}`;
  }

  private userFailedKey(userKey: string): string {
    return `${this.redisKeyPrefix()}login:user:${userKey}:failed`;
  }

  private userLockKey(userKey: string): string {
    return `${this.redisKeyPrefix()}login:user:${userKey}:lock`;
  }

  private userResendKey(userKey: string): string {
    return `${this.redisKeyPrefix()}login:user:${userKey}:resend`;
  }

  private redisKeyPrefix(): string {
    const configured = String(process.env.PIM_AUTH_REDIS_KEY_PREFIX ?? "pim1:auth:").trim();
    return configured.length > 0 ? configured : "pim1:auth:";
  }

  private isRedisDisabled(): boolean {
    return String(process.env.PIM_AUTH_REDIS_DISABLED ?? "false")
      .trim()
      .toLowerCase() === "true";
  }

  private async ensureRedisConnection(): Promise<void> {
    if (this.isRedisDisabled()) {
      this.redisAvailable = false;
      return;
    }
    if (this.redisAvailable) {
      return;
    }
    const nowMs = Date.now();
    if (nowMs < this.redisRetryAfterMs) {
      return;
    }
    if (this.redisConnecting) {
      await this.redisConnecting;
      return;
    }

    this.redisConnecting = (async () => {
      let pendingClient: ReturnType<typeof createClient> | null = null;
      try {
        const url = String(process.env.REDIS_URL ?? "").trim() || DEFAULT_REDIS_URL;
        const client = createClient({
          url,
          socket: {
            connectTimeout: 750,
          },
        });
        pendingClient = client;
        client.on("error", (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error ?? "unknown error");
          this.markRedisUnavailable(`Redis error for auth login protections: ${message}`);
        });
        await Promise.race([
          client.connect(),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("Redis connect timeout")), REDIS_CONNECT_TIMEOUT_MS);
          }),
        ]);
        this.redisClient = client;
        pendingClient = null;
        this.redisAvailable = true;
        this.redisRetryAfterMs = 0;
      } catch (error: unknown) {
        if (pendingClient) {
          try {
            pendingClient.disconnect();
          } catch {
            // Ignore disconnect cleanup errors during failed bootstrap.
          }
        }
        const message = error instanceof Error ? error.message : String(error ?? "unknown error");
        this.markRedisUnavailable(`Redis unavailable for auth login protections; falling back to in-memory controls: ${message}`);
      } finally {
        this.redisConnecting = null;
      }
    })();

    await this.redisConnecting;
  }

  private markRedisUnavailable(message: string) {
    this.redisAvailable = false;
    this.redisRetryAfterMs = Date.now() + REDIS_RETRY_BACKOFF_MS;
    const nowMs = Date.now();
    if (nowMs - this.lastRedisWarnAtMs >= REDIS_WARN_THROTTLE_MS) {
      this.lastRedisWarnAtMs = nowMs;
      this.logger.warn(message);
    }
  }

  private maskIdentity(identity: string): string {
    const trimmed = String(identity ?? "").trim();
    if (!trimmed) {
      return "***";
    }
    if (trimmed.includes("@")) {
      const [local, domain] = trimmed.split("@");
      const first = local.slice(0, 2);
      return `${first}***@${domain}`;
    }
    const first = trimmed.slice(0, 2);
    return `${first}***`;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redisClient) {
      await Promise.race([
        this.redisClient.quit().catch(() => undefined),
        new Promise<void>((resolve) => {
          setTimeout(resolve, 300);
        }),
      ]);
      this.redisClient = null;
    }
    this.redisAvailable = false;
  }

}
