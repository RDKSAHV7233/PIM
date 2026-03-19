import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createClient } from "redis";
import { AuditService } from "../audit/audit.service";
import { AppRole } from "../common/rbac/roles";
import { normalizeAppRole, resolveDefaultRole } from "../common/rbac/role-utils";
import { TenantDirectoryService } from "../common/tenant/tenant-directory.service";
import {
  DEFAULT_TENANT_KEY,
  normalizeTenantKey,
  normalizeWorkspaceSlug,
} from "../common/tenant/tenant.constants";
import { PrismaService } from "../prisma/prisma.service";
import { QUEUE_NAMES } from "../queue/queue.constants";
import { QueueService } from "../queue/queue.service";
import { AuthEmailService } from "./auth-email.service";
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
const PASSWORD_RESET_EXPIRY_MS = 30 * 60 * 1000;
const PASSWORD_RESET_TOKEN_BYTES = 24;
const DEFAULT_EXPORT_READY_SECONDS = 120;
const EXPORT_STATUS_QUEUED = "queued";
const EXPORT_STATUS_PROCESSING = "processing";
const EXPORT_STATUS_COMPLETED = "completed";
const EXPORT_STATUS_FAILED = "failed";

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
  passwordHash: string | null;
}

interface AuthIdentityRow {
  userId: string;
  tenantKey: string;
  role: string;
  isActive: boolean;
  lockedUntil: Date | null;
  passwordHash: string | null;
}

interface AccountExportJobPayload {
  jobId: string;
  tenantId: string;
  userId: string;
  format: "json" | "csv";
}

interface AuthEmailJobPayload {
  tenantId: string;
  userId: string;
  kind: "password_reset" | "account_unlock" | "account_export_ready";
  workspaceSlug?: string | null;
  resetToken?: string;
  jobId?: string;
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
  note?: string;
}

export interface RequestPasswordResetResult {
  ok: true;
  requested: boolean;
  retryAfterSeconds: number;
  adminResetAvailable?: boolean;
  note?: string;
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
  note: string;
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
    completedAt: string | null;
    failedAt: string | null;
    errorMessage: string | null;
    downloadAvailable: boolean;
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
    private readonly queueService: QueueService,
    private readonly authEmailService: AuthEmailService,
  ) {
    this.queueService.process<AuthEmailJobPayload>(QUEUE_NAMES.AUTH_EMAIL, async (payload) => {
      await this.processAuthEmailJob(payload);
    });
    this.queueService.process<AccountExportJobPayload>(QUEUE_NAMES.ACCOUNT_EXPORT, async (payload) => {
      await this.processAccountExportJob(payload);
    });
  }

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

    const credentialOk = await this.verifyPasswordForIdentity(dto.password, identity);
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
    if (identity.lockedUntil && identity.lockedUntil.getTime() > now) {
      return {
        type: "account_locked",
        unlockAt: identity.lockedUntil.toISOString(),
        maskedEmail: this.maskIdentity(identity.userId),
      };
    }
    await this.backfillLegacyPasswordHash(identity, dto.password);
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
    const identity = await this.resolveLoginIdentity(input.claims.sub, input.claims.tenantId);
    const credentialOk = identity
      ? await this.verifyPasswordForIdentity(input.password, identity)
      : false;
    if (!credentialOk) {
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
    const normalizedEmail = this.normalizeUserKey(email);
    const workspaceSlug =
      normalizeWorkspaceSlug(
        workspaceSlugInput || process.env.PIM_DEFAULT_WORKSPACE_SLUG || process.env.PIM_DEFAULT_TENANT_KEY || "",
      );
    const userKey = this.composeLoginLockKey(workspaceSlug, normalizedEmail);
    const now = Date.now();

    const redisResult = await this.applyResendCooldownRedis(userKey, now);
    if (redisResult) {
      return redisResult;
    }

    const state = await this.getActiveLock(userKey, email, now);
    const lastResendAtMs = state?.lastResendAtMs ?? 0;
    const cooldownRemainingMs = Math.max(0, RESEND_COOLDOWN_MS - (now - lastResendAtMs));
    if (cooldownRemainingMs > 0) {
      return {
        ok: true,
        resent: false,
        retryAfterSeconds: Math.ceil(cooldownRemainingMs / 1000),
        note: "Please wait before requesting another recovery email.",
      };
    }

    const workspace = workspaceSlug
      ? await this.tenantDirectoryService.resolveWorkspaceSlug(workspaceSlug)
      : null;
    const identity = workspace ? await this.resolveLoginIdentity(normalizedEmail, workspace.tenantId) : null;

    if (state) {
      state.lastResendAtMs = now;
      this.userLocks.set(userKey, state);
    }

    if (identity) {
      const resetToken = await this.createRecoveryToken(identity, "password_reset");
      await this.queueService.enqueue(QUEUE_NAMES.AUTH_EMAIL, {
        tenantId: identity.tenantId,
        userId: identity.userId,
        kind: "account_unlock",
        workspaceSlug: workspace?.workspaceSlug ?? workspaceSlug,
        resetToken,
      } satisfies AuthEmailJobPayload);
    }

    await this.auditService.record({
      actorId: normalizedEmail || "unknown",
      actorRole: "public",
      action: "auth.unlock_email_requested",
      resource: "auth.recovery",
      metadata: {
        emailMasked: this.maskIdentity(normalizedEmail),
        workspaceSlug,
      },
    });

    return {
      ok: true,
      resent: true,
      retryAfterSeconds: 0,
      note: "If the account exists, we have emailed a recovery link that will let you unlock access by setting a new password.",
    };
  }

  async requestPasswordReset(email: string): Promise<RequestPasswordResetResult> {
    const normalizedEmail = this.normalizeUserKey(email);
    let queued = false;

    if (this.isDbAuthMode()) {
      const identity = await this.prisma.tenant(DEFAULT_TENANT_KEY).authIdentity.findUnique({
        where: {
          userId: normalizedEmail,
        },
        select: {
          userId: true,
          tenantKey: true,
          role: true,
          isActive: true,
          lockedUntil: true,
          passwordHash: true,
        },
      });
      if (identity?.isActive) {
        const resolvedIdentity: ResolvedLoginIdentity = {
          userId: this.normalizeUserKey(identity.userId),
          tenantId: normalizeTenantKey(identity.tenantKey),
          role: normalizeAppRole(identity.role) ?? "viewer",
          lockedUntil: identity.lockedUntil ?? null,
          passwordHash: identity.passwordHash ?? null,
        };
        const resetToken = await this.createRecoveryToken(resolvedIdentity, "password_reset");
        const workspace = await this.tenantDirectoryService.resolveTenantAlias(resolvedIdentity.tenantId);
        await this.queueService.enqueue(QUEUE_NAMES.AUTH_EMAIL, {
          tenantId: resolvedIdentity.tenantId,
          userId: resolvedIdentity.userId,
          kind: "password_reset",
          workspaceSlug: workspace?.workspaceSlug ?? null,
          resetToken,
        } satisfies AuthEmailJobPayload);
        queued = true;
      }
    }

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
      requested: queued,
      retryAfterSeconds: 0,
      adminResetAvailable: !queued,
      note: queued
        ? "If the account exists, a recovery email has been sent."
        : "Password reset email is only available for DB-backed accounts.",
    };
  }

  async confirmPasswordReset(token: string, password: string): Promise<{
    ok: true;
    reset: true;
    workspaceSlug: string | null;
  }> {
    const normalizedPassword = String(password ?? "");
    if (normalizedPassword.trim().length < 8) {
      throw new BadRequestException({ error: "PASSWORD_TOO_SHORT", minLength: 8 });
    }

    const recoveryToken = await this.prisma.tenant(DEFAULT_TENANT_KEY).authRecoveryToken.findUnique({
      where: {
        tokenHash: this.hashRecoveryToken(token),
      },
      select: {
        id: true,
        tenantKey: true,
        userId: true,
        purpose: true,
        expiresAt: true,
        usedAt: true,
      },
    });
    if (!recoveryToken || recoveryToken.usedAt || recoveryToken.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({ error: "PASSWORD_RESET_TOKEN_INVALID" });
    }

    const tenantId = normalizeTenantKey(recoveryToken.tenantKey);
    const userId = this.normalizeUserKey(recoveryToken.userId);
    const passwordHash = await bcrypt.hash(normalizedPassword, 12);

    const identity = await this.prisma.tenant(DEFAULT_TENANT_KEY).authIdentity.findFirst({
      where: {
        tenantKey: tenantId,
        userId,
      },
      select: {
        id: true,
      },
    });
    if (!identity) {
      throw new UnauthorizedException({ error: "PASSWORD_RESET_TOKEN_INVALID" });
    }

    await this.prisma.tenant(DEFAULT_TENANT_KEY).$transaction([
      this.prisma.tenant(DEFAULT_TENANT_KEY).authIdentity.update({
        where: {
          id: identity.id,
        },
        data: {
          passwordHash,
          lockedUntil: null,
        },
      }),
      this.prisma.tenant(DEFAULT_TENANT_KEY).authRecoveryToken.update({
        where: {
          id: recoveryToken.id,
        },
        data: {
          usedAt: new Date(),
        },
      }),
    ]);

    const workspace = await this.tenantDirectoryService.resolveTenantAlias(tenantId);
    if (workspace?.workspaceSlug) {
      await this.clearUserFailures(this.composeLoginLockKey(workspace.workspaceSlug, userId));
    }

    await this.auditService.record({
      actorId: userId,
      actorRole: "public",
      action: "auth.password_reset_completed",
      resource: "AuthRecoveryToken",
      resourceId: recoveryToken.id,
      metadata: {
        tenantId,
        purpose: recoveryToken.purpose,
      },
    });

    return {
      ok: true,
      reset: true,
      workspaceSlug: workspace?.workspaceSlug ?? null,
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
      estimatedReadyInSeconds: DEFAULT_EXPORT_READY_SECONDS,
      note: "Your export has been queued. We will email you when it is ready to download.",
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
        EXPORT_STATUS_QUEUED,
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

    await this.queueService.enqueue(QUEUE_NAMES.ACCOUNT_EXPORT, {
      jobId,
      tenantId,
      userId,
      format: result.format,
    } satisfies AccountExportJobPayload);

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
                estimated_ready_in_seconds AS "estimatedReadyInSeconds",
                completed_at AS "completedAt",
                failed_at AS "failedAt",
                error_message AS "errorMessage",
                (artifact_path IS NOT NULL AND completed_at IS NOT NULL) AS "downloadAvailable"
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

  async downloadAccountExport(jobIdInput: string, userIdInput: string, tenantIdInput: string): Promise<{
    fileName: string;
    contentType: string;
    content: Buffer;
  }> {
    const jobId = String(jobIdInput ?? "").trim();
    const userId = this.normalizeUserKey(userIdInput);
    const tenantId = normalizeTenantKey(tenantIdInput);
    const exportRequest = await this.prisma.tenant(tenantId).accountExportRequest.findFirst({
      where: {
        id: jobId,
        tenantKey: tenantId,
        userId,
      },
      select: {
        status: true,
        format: true,
        artifactPath: true,
        artifactFileName: true,
      },
    });
    if (!exportRequest || exportRequest.status !== EXPORT_STATUS_COMPLETED || !exportRequest.artifactPath) {
      throw new NotFoundException({ error: "ACCOUNT_EXPORT_NOT_READY" });
    }

    const filePath = exportRequest.artifactPath;
    const content = await fs.readFile(filePath);
    return {
      fileName: exportRequest.artifactFileName || path.basename(filePath),
      contentType: exportRequest.format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      content,
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
        passwordHash: null,
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
        passwordHash: true,
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
      passwordHash: row.passwordHash ?? null,
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
          passwordHash: typeof candidate.passwordHash === "string" ? candidate.passwordHash : null,
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error ?? "unknown error");
      this.logger.warn(`PIM_AUTH_IDENTITIES_JSON parse failed. Falling back to default identity resolution: ${message}`);
    }

    return directory;
  }

  private async backfillLegacyPasswordHash(identity: ResolvedLoginIdentity, submittedPassword: string): Promise<void> {
    if (!this.isDbAuthMode() || identity.passwordHash) {
      return;
    }
    try {
      const passwordHash = await bcrypt.hash(submittedPassword, 12);
      await this.prisma.tenant(DEFAULT_TENANT_KEY).authIdentity.updateMany({
        where: {
          tenantKey: identity.tenantId,
          userId: identity.userId,
          passwordHash: null,
        },
        data: {
          passwordHash,
        },
      });
    } catch (error: unknown) {
      this.logger.warn(`Failed to backfill legacy password hash for ${identity.userId}: ${this.toErrorMessage(error)}`);
    }
  }

  private async createRecoveryToken(identity: ResolvedLoginIdentity, purpose: "password_reset"): Promise<string> {
    const rawToken = randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString("hex");
    const tokenHash = this.hashRecoveryToken(rawToken);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRY_MS);
    const prisma = this.prisma.tenant(DEFAULT_TENANT_KEY);

    await prisma.authRecoveryToken.updateMany({
      where: {
        tenantKey: identity.tenantId,
        userId: identity.userId,
        purpose,
        usedAt: null,
      },
      data: {
        usedAt: new Date(),
      },
    });

    await prisma.authRecoveryToken.create({
      data: {
        id: `recovery_${randomUUID()}`,
        tenantKey: identity.tenantId,
        userId: identity.userId,
        purpose,
        tokenHash,
        expiresAt,
      },
    });

    return rawToken;
  }

  private hashRecoveryToken(token: string): string {
    return createHash("sha256").update(String(token ?? "").trim(), "utf8").digest("hex");
  }

  private async processAuthEmailJob(payload: AuthEmailJobPayload): Promise<void> {
    const tenantId = normalizeTenantKey(payload.tenantId);
    const userId = this.normalizeUserKey(payload.userId);
    const workspace =
      (payload.workspaceSlug
        ? await this.tenantDirectoryService.resolveWorkspaceSlug(payload.workspaceSlug)
        : null) ?? (await this.tenantDirectoryService.resolveTenantAlias(tenantId));
    const workspaceSlug = workspace?.workspaceSlug ?? normalizeWorkspaceSlug(payload.workspaceSlug ?? tenantId);
    const webBaseUrl = this.resolveWebBaseUrl();

    if (payload.kind === "account_export_ready" && payload.jobId) {
      const privacyUrl = `${webBaseUrl}/settings/privacy`;
      await this.authEmailService.send({
        to: userId,
        subject: "Your PIM1 account export is ready",
        text: `Your account export is ready. Sign in to PIM1 and open ${privacyUrl} to download it securely.`,
        html: `<p>Your account export is ready.</p><p><a href=\"${privacyUrl}\">Sign in to PIM1</a> and open Privacy settings to download it securely.</p>`,
        category: "account_export_ready",
        metadata: {
          tenantId,
          jobId: payload.jobId,
        },
      });
      return;
    }

    if (!payload.resetToken) {
      throw new Error(`Missing reset token for auth email kind=${payload.kind}`);
    }

    const resetUrl = `${webBaseUrl}/login/reset?token=${encodeURIComponent(payload.resetToken)}&email=${encodeURIComponent(userId)}&workspace=${encodeURIComponent(workspaceSlug)}`;
    const isUnlock = payload.kind === "account_unlock";
    const subject = isUnlock ? "Unlock your PIM1 account" : "Reset your PIM1 password";
    const intro = isUnlock
      ? "Your account was locked after repeated sign-in attempts. Use the link below to set a new password and regain access."
      : "Use the link below to set a new password for your PIM1 account.";

    await this.authEmailService.send({
      to: userId,
      subject,
      text: `${intro}\n\nWorkspace: ${workspaceSlug}\nReset link: ${resetUrl}\n\nThis link expires in 30 minutes.`,
      html: `<p>${intro}</p><p><strong>Workspace:</strong> ${this.escapeHtml(workspaceSlug)}</p><p><a href=\"${resetUrl}\">Set a new password</a></p><p>This link expires in 30 minutes.</p>`,
      category: isUnlock ? "account_unlock" : "password_reset",
      metadata: {
        tenantId,
        workspaceSlug,
      },
    });
  }

  private async processAccountExportJob(payload: AccountExportJobPayload): Promise<void> {
    const tenantId = normalizeTenantKey(payload.tenantId);
    const tenantPrisma = this.prisma.tenant(tenantId);

    await tenantPrisma.accountExportRequest.updateMany({
      where: {
        id: payload.jobId,
        tenantKey: tenantId,
        userId: payload.userId,
      },
      data: {
        status: EXPORT_STATUS_PROCESSING,
        failedAt: null,
        errorMessage: null,
      },
    });

    try {
      const exportDocument = await this.buildAccountExportDocument(payload.tenantId, payload.userId, payload.jobId);
      const artifact = await this.writeAccountExportArtifact(payload.tenantId, payload.userId, payload.jobId, payload.format, exportDocument);

      await tenantPrisma.accountExportRequest.updateMany({
        where: {
          id: payload.jobId,
          tenantKey: tenantId,
          userId: payload.userId,
        },
        data: {
          status: EXPORT_STATUS_COMPLETED,
          artifactPath: artifact.storagePath,
          artifactFileName: artifact.fileName,
          completedAt: new Date(),
          failedAt: null,
          errorMessage: null,
          estimatedReadyInSeconds: 0,
        },
      });

      await this.auditService.record({
        actorId: payload.userId,
        actorRole: "public",
        action: "account.export_completed",
        resource: "account_export_requests",
        resourceId: payload.jobId,
        metadata: {
          tenantId,
          format: payload.format,
          fileName: artifact.fileName,
        },
      });

      await this.queueService.enqueue(QUEUE_NAMES.AUTH_EMAIL, {
        tenantId,
        userId: payload.userId,
        kind: "account_export_ready",
        jobId: payload.jobId,
      } satisfies AuthEmailJobPayload);
    } catch (error: unknown) {
      const errorMessage = this.toErrorMessage(error);
      await tenantPrisma.accountExportRequest.updateMany({
        where: {
          id: payload.jobId,
          tenantKey: tenantId,
          userId: payload.userId,
        },
        data: {
          status: EXPORT_STATUS_FAILED,
          failedAt: new Date(),
          errorMessage,
        },
      });

      await this.auditService.record({
        actorId: payload.userId,
        actorRole: "public",
        action: "account.export_failed",
        resource: "account_export_requests",
        resourceId: payload.jobId,
        metadata: {
          tenantId,
          format: payload.format,
          errorMessage,
        },
      });

      throw error;
    }
  }

  private async buildAccountExportDocument(tenantIdInput: string, userIdInput: string, jobId: string): Promise<Record<string, unknown>> {
    const tenantId = normalizeTenantKey(tenantIdInput);
    const userId = this.normalizeUserKey(userIdInput);
    const authIdentity = await this.prisma.tenant(DEFAULT_TENANT_KEY).authIdentity.findFirst({
      where: {
        tenantKey: tenantId,
        userId,
      },
      select: {
        id: true,
        tenantKey: true,
        userId: true,
        role: true,
        isActive: true,
        lockedUntil: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const workspace = await this.tenantDirectoryService.resolveTenantAlias(tenantId);
    const tenantPrisma = this.prisma.tenant(tenantId);
    const consents = await tenantPrisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      SELECT
        id,
        accepted,
        policy_version AS "policyVersion",
        purpose,
        consent_recorded_at AS "consentRecordedAt",
        created_at AS "createdAt"
      FROM account_consent_events
      WHERE tenant_key = $1 AND user_id = $2
      ORDER BY consent_recorded_at DESC
      `,
      tenantId,
      userId,
    );
    const exportRequests = await tenantPrisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      SELECT
        id,
        actor_role AS "actorRole",
        format,
        status,
        requested_at AS "requestedAt",
        estimated_ready_in_seconds AS "estimatedReadyInSeconds",
        artifact_file_name AS "artifactFileName",
        completed_at AS "completedAt",
        failed_at AS "failedAt",
        error_message AS "errorMessage"
      FROM account_export_requests
      WHERE tenant_key = $1 AND user_id = $2
      ORDER BY requested_at DESC
      `,
      tenantId,
      userId,
    );
    const deletionRequests = await tenantPrisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      SELECT
        id,
        actor_role AS "actorRole",
        reason,
        status,
        requested_at AS "requestedAt",
        scheduled_for AS "scheduledFor"
      FROM account_deletion_requests
      WHERE tenant_key = $1 AND user_id = $2
      ORDER BY requested_at DESC
      `,
      tenantId,
      userId,
    );
    const notifications = await tenantPrisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      SELECT
        id,
        event_type AS "eventType",
        title,
        message,
        action_url AS "actionUrl",
        action_label AS "actionLabel",
        read_at AS "readAt",
        created_at AS "createdAt"
      FROM user_notifications
      WHERE tenant_key = $1 AND user_id = $2
      ORDER BY created_at DESC
      `,
      tenantId,
      userId,
    );
    const auditRows = await tenantPrisma.auditLog.findMany({
      where: {
        actorId: userId,
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        action: true,
        resource: true,
        resourceId: true,
        metadata: true,
        createdAt: true,
      },
      take: 500,
    });

    return {
      generatedAt: new Date().toISOString(),
      jobId,
      tenantId,
      userId,
      workspace: workspace
        ? {
            workspaceSlug: workspace.workspaceSlug,
            displayName: workspace.displayName,
          }
        : null,
      account: authIdentity
        ? {
            id: authIdentity.id,
            userId: authIdentity.userId,
            role: authIdentity.role,
            isActive: authIdentity.isActive,
            lockedUntil: authIdentity.lockedUntil?.toISOString() ?? null,
            createdBy: authIdentity.createdBy,
            createdAt: authIdentity.createdAt.toISOString(),
            updatedAt: authIdentity.updatedAt.toISOString(),
          }
        : null,
      consentEvents: consents,
      exportRequests,
      deletionRequests,
      notifications,
      auditLog: auditRows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  private async writeAccountExportArtifact(
    tenantIdInput: string,
    userIdInput: string,
    jobId: string,
    format: "json" | "csv",
    exportDocument: Record<string, unknown>,
  ): Promise<{ storagePath: string; fileName: string }> {
    const tenantId = normalizeTenantKey(tenantIdInput).replace(/[^a-zA-Z0-9._-]+/g, "_");
    const userId = this.normalizeUserKey(userIdInput).replace(/[^a-zA-Z0-9._-]+/g, "_");
    const safeJobId = String(jobId ?? "").replace(/[^a-zA-Z0-9._-]+/g, "_");
    const extension = format === "csv" ? ".csv" : ".json";
    const fileName = `${userId}-${safeJobId}${extension}`;
    const storageDir = path.join(process.cwd(), "storage", "account-exports", tenantId);
    await fs.mkdir(storageDir, { recursive: true });
    const storagePath = path.join(storageDir, fileName);
    const fileContents =
      format === "csv"
        ? this.renderAccountExportCsv(exportDocument)
        : JSON.stringify(exportDocument, null, 2);
    await fs.writeFile(storagePath, fileContents, "utf8");
    return {
      storagePath,
      fileName,
    };
  }

  private renderAccountExportCsv(exportDocument: Record<string, unknown>): string {
    const rows = [
      ["section", "recordId", "payloadJson"],
    ];
    const account = exportDocument["account"];
    if (account && typeof account === "object") {
      rows.push(["account", String((account as Record<string, unknown>).id ?? ""), JSON.stringify(account)]);
    }
    const workspace = exportDocument["workspace"];
    if (workspace && typeof workspace === "object") {
      rows.push(["workspace", "", JSON.stringify(workspace)]);
    }
    const appendRows = (section: string, items: unknown) => {
      if (!Array.isArray(items)) {
        return;
      }
      for (const item of items) {
        const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        rows.push([
          section,
          String(record.id ?? record.jobId ?? record.ticketId ?? ""),
          JSON.stringify(record),
        ]);
      }
    };

    appendRows("consentEvents", exportDocument["consentEvents"]);
    appendRows("exportRequests", exportDocument["exportRequests"]);
    appendRows("deletionRequests", exportDocument["deletionRequests"]);
    appendRows("notifications", exportDocument["notifications"]);
    appendRows("auditLog", exportDocument["auditLog"]);

    return rows
      .map((row) => row.map((value) => this.csvCell(value)).join(","))
      .join("\n");
  }

  private csvCell(value: string): string {
    const normalized = String(value ?? "");
    return `"${normalized.replace(/"/g, "\"\"")}"`;
  }

  private resolveWebBaseUrl(): string {
    const explicit = String(process.env.PIM_WEB_BASE_URL ?? "").trim().replace(/\/+$/, "");
    if (explicit) {
      return explicit;
    }
    const corsOrigins = String(process.env.CORS_ORIGIN ?? process.env.CORS_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (corsOrigins[0]) {
      return corsOrigins[0].replace(/\/+$/, "");
    }
    return "http://localhost:3000";
  }

  private escapeHtml(value: string): string {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  private async verifyPasswordForIdentity(
    password: string,
    identity: ResolvedLoginIdentity,
  ): Promise<boolean> {
    if (identity.passwordHash) {
      return bcrypt.compare(password, identity.passwordHash);
    }
    return this.verifySharedPassword(password);
  }

  private verifySharedPassword(password: string): boolean {
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
    const submittedBuffer = Buffer.from(password, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");
    if (submittedBuffer.length !== expectedBuffer.length) {
      return false;
    }
    return timingSafeEqual(submittedBuffer, expectedBuffer);
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
        return null;
      }
      const ttlMs = Number(await this.redisClient.pTTL(resendKey));
      const effectiveTtlMs = ttlMs > 0 ? ttlMs : RESEND_COOLDOWN_MS;
      return {
        ok: true,
        resent: false,
        retryAfterSeconds: Math.max(1, Math.ceil(effectiveTtlMs / 1000)),
        note: "Please wait before requesting another recovery email.",
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

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message.trim();
    }
    return String(error ?? "unknown_error");
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
