import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createClient } from "redis";
import { AuditService } from "../audit/audit.service";
import { type FoundationRole, AppRole } from "../common/rbac/roles";
import { normalizeAppRole, normalizeFoundationRole, resolveDefaultRole } from "../common/rbac/role-utils";
import { TenantDirectoryService } from "../common/tenant/tenant-directory.service";
import { PlanUsageService } from "../billing/plan-usage.service";
import {
  DEFAULT_TENANT_KEY,
  normalizeTenantKey,
  normalizeWorkspaceSlug,
} from "../common/tenant/tenant.constants";
import { PrismaService } from "../prisma/prisma.service";
import { PrismaDirectService } from "../prisma/prisma-direct.service";
import { QUEUE_NAMES } from "../queue/queue.constants";
import { QueueService } from "../queue/queue.service";
import { AuthEmailService } from "./auth-email.service";
import { AccountExportStorageError, AuthExportStorageService } from "./auth-export-storage.service";
import { AuthPolicyService } from "./auth-policy.service";
import { LoginDto } from "./dto/login.dto";
import { JwtBlocklistService } from "./jwt-blocklist.service";
import { MfaService } from "./mfa.service";
import { PimJwtClaims, StepUpScope, signPimJwt, verifyPimJwt } from "./jwt";

const DEFAULT_LOGIN_EXPIRY_MINUTES = 4 * 60;
const MAX_LOGIN_EXPIRY_MINUTES = 4 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
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
const MIN_STEP_UP_EXPIRY_SECONDS = 2;
const MFA_PENDING_TOKEN_TTL_SECONDS = 5 * 60;
const MFA_ENROLLMENT_TOKEN_TTL_SECONDS = 15 * 60;
const MAX_STEP_UP_EXPIRY_SECONDS = 15 * 60;
const PASSWORD_RESET_EXPIRY_MS = 30 * 60 * 1000;
const PASSWORD_RESET_TOKEN_BYTES = 24;
const RESET_ATTEMPT_LIMIT = 3;
const RESET_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_EXPORT_READY_SECONDS = 120;
const EXPORT_STATUS_QUEUED = "queued";
const EXPORT_STATUS_PROCESSING = "processing";
const EXPORT_STATUS_COMPLETED = "completed";
const EXPORT_STATUS_FAILED = "failed";
const EXPORT_STATUS_SKIPPED = "skipped";

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
  assignedRoles: FoundationRole[];
  lockedUntil: Date | null;
  passwordHash: string | null;
}

interface AuthIdentityRow {
  userId: string;
  tenantKey: string;
  role: string;
  assignedRoles?: string[] | null;
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
      refreshToken: string;
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
    }
  | {
      type: "tenant_suspended";
      tenantId: string;
      billingStatus: string;
      accessStatus: string;
      suspensionReason: string | null;
    }
  | {
      type: "mfa_required";
      pendingToken: string;
      maskedEmail: string;
    }
  | {
      type: "mfa_enrollment_required";
      enrollmentToken: string;
      maskedEmail: string;
    }
  | {
      type: "auth_method_not_allowed";
      allowedMethods: string[];
    };

export type RefreshResult =
  | {
      type: "success";
      accessToken: string;
      refreshToken: string;
      expiresInSeconds: number;
    }
  | {
      type: "invalid_token";
    };

export interface ResendUnlockResult {
  ok: true;
  resent: boolean;
  retryAfterSeconds: number;
  note?: string;
}

export interface RequestPasswordResetResult {
  ok: true;
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
  commercialState: {
    billingStatus: string;
    accessStatus: string;
    suspensionReason: string | null;
    suspendedAt: string | null;
  };
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

type AccountPrivacyConsentSummary = NonNullable<AccountPrivacyStatusResult["latestConsent"]>;
type AccountPrivacyExportSummary = NonNullable<AccountPrivacyStatusResult["latestExport"]>;
type AccountPrivacyDeletionSummary = NonNullable<AccountPrivacyStatusResult["latestDeletion"]>;

function toIsoStringOrNull(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

function toPrivacyConsentSummary(input: {
  accepted: boolean;
  policyVersion: string;
  purpose: string;
  consentRecordedAt: Date;
}): AccountPrivacyConsentSummary {
  return {
    accepted: input.accepted,
    policyVersion: input.policyVersion,
    purpose: input.purpose,
    consentRecordedAt: input.consentRecordedAt.toISOString(),
  };
}

function toPrivacyExportSummary(input: {
  id: string;
  status: string;
  format: string;
  requestedAt: Date;
  estimatedReadyInSeconds: number;
  completedAt: Date | null;
  failedAt: Date | null;
  errorMessage: string | null;
  artifactPath?: string | null;
}): AccountPrivacyExportSummary {
  return {
    jobId: input.id,
    status: input.status,
    format: input.format,
    requestedAt: input.requestedAt.toISOString(),
    estimatedReadyInSeconds: input.estimatedReadyInSeconds,
    completedAt: toIsoStringOrNull(input.completedAt),
    failedAt: toIsoStringOrNull(input.failedAt),
    errorMessage: input.errorMessage ?? null,
    downloadAvailable: Boolean(input.artifactPath && input.completedAt),
  };
}

function toPrivacyDeletionSummary(input: {
  id: string;
  status: string;
  requestedAt: Date;
  scheduledFor: Date;
}): AccountPrivacyDeletionSummary {
  return {
    ticketId: input.id,
    status: input.status,
    requestedAt: input.requestedAt.toISOString(),
    scheduledFor: input.scheduledFor.toISOString(),
  };
}

export type AccountExportDownloadResult =
  | {
      kind: "ready";
      downloadUrl: string;
      expiresInSeconds: number;
    }
  | {
      kind: "binary";
      fileName: string;
      contentType: string;
      content: Buffer;
    }
  | {
      kind: "unavailable";
      status: "unavailable";
      reason: string;
    };

@Injectable()
export class AuthService implements OnModuleDestroy {
  private readonly logger = new Logger(AuthService.name);
  private readonly ipAttempts = new Map<string, IpAttemptState>();
  private readonly passwordResetAttempts = new Map<string, IpAttemptState>();
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
    private readonly prismaDirect: PrismaDirectService,
    private readonly auditService: AuditService,
    private readonly tenantDirectoryService: TenantDirectoryService,
    private readonly queueService: QueueService,
    private readonly authEmailService: AuthEmailService,
    private readonly authExportStorageService: AuthExportStorageService,
    private readonly planUsageService: PlanUsageService,
    private readonly authPolicyService: AuthPolicyService,
    private readonly mfaService: MfaService,
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
    const localIdentities = String(process.env.PIM_AUTH_IDENTITIES_JSON ?? "").trim();
    const localWorkspaceDirectory = String(process.env.PIM_AUTH_WORKSPACES_JSON ?? "").trim();
    const workspace =
      (submittedWorkspaceSlug
        ? await this.tenantDirectoryService.resolveWorkspaceSlug(submittedWorkspaceSlug)
        : null) ??
      (dto.tenantId ? await this.tenantDirectoryService.resolveTenantAlias(dto.tenantId) : null) ??
      // Local dev fallback: synthesize a tenant from the workspace slug only
      // when no explicit workspace directory is configured.
      (!localWorkspaceDirectory && localIdentities && submittedWorkspaceSlug
        ? { tenantId: submittedWorkspaceSlug, workspaceSlug: submittedWorkspaceSlug }
        : null);
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
      await this.auditService.record({
        actorId: dto.userId,
        actorRole: "viewer",
        action: "auth.login_failed",
        resource: "auth.login",
        tenantKey: workspace.tenantId,
        metadata: {
          reason: lockState.lockedUntilMs && lockState.lockedUntilMs > now ? "account_locked" : "invalid_credentials",
          ipAddress,
        },
      });
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
      await this.auditService.record({
        actorId: identity.userId,
        actorRole: identity.role,
        action: "auth.login_failed",
        resource: "auth.login",
        tenantKey: identity.tenantId,
        metadata: {
          reason: lockState.lockedUntilMs && lockState.lockedUntilMs > now ? "account_locked" : "invalid_credentials",
          ipAddress,
        },
      });
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
      await this.auditService.record({
        actorId: identity.userId,
        actorRole: identity.role,
        action: "auth.login_failed",
        resource: "auth.login",
        tenantKey: identity.tenantId,
        metadata: { reason: "account_locked", ipAddress },
      });
      return {
        type: "account_locked",
        unlockAt: identity.lockedUntil.toISOString(),
        maskedEmail: this.maskIdentity(identity.userId),
      };
    }

    const commercialProfile = await this.planUsageService.getTenantPlanProfile(identity.tenantId);
    if (commercialProfile.accessStatus === "suspended") {
      return {
        type: "tenant_suspended",
        tenantId: identity.tenantId,
        billingStatus: commercialProfile.billingStatus,
        accessStatus: commercialProfile.accessStatus,
        suspensionReason: commercialProfile.suspensionReason,
      };
    }

    const allowedAuthMethods = await this.authPolicyService.getEffectiveAllowedAuthMethods(identity.tenantId);
    if (!allowedAuthMethods.includes("password")) {
      return { type: "auth_method_not_allowed", allowedMethods: allowedAuthMethods };
    }

    const [mfaPolicy, hasActiveEnrollment] = await Promise.all([
      this.authPolicyService.getEffectiveMfaPolicy(identity.tenantId),
      this.mfaService.hasActiveEnrollment(identity.userId, identity.tenantId),
    ]);

    if (hasActiveEnrollment) {
      const pendingToken = signPimJwt({
        sub: identity.userId,
        tenantId: identity.tenantId,
        role: identity.role,
        assignedRoles: identity.assignedRoles,
        tokenType: "mfa_pending",
        expiresInSeconds: MFA_PENDING_TOKEN_TTL_SECONDS,
      });
      return { type: "mfa_required", pendingToken, maskedEmail: this.maskIdentity(identity.userId) };
    }

    if (mfaPolicy.mfaRequired) {
      const enrollmentToken = signPimJwt({
        sub: identity.userId,
        tenantId: identity.tenantId,
        role: identity.role,
        assignedRoles: identity.assignedRoles,
        tokenType: "mfa_enrollment",
        expiresInSeconds: MFA_ENROLLMENT_TOKEN_TTL_SECONDS,
      });
      return { type: "mfa_enrollment_required", enrollmentToken, maskedEmail: this.maskIdentity(identity.userId) };
    }

    const policySessionTimeoutMinutes = await this.authPolicyService.getEffectiveSessionTimeoutMinutes(identity.tenantId);
    const maxSessionTimeoutMinutes = Math.min(MAX_LOGIN_EXPIRY_MINUTES, policySessionTimeoutMinutes);
    const expiryMinutes = Number.isFinite(dto.expiresInMinutes)
      ? Math.min(maxSessionTimeoutMinutes, Math.max(1, Math.floor(dto.expiresInMinutes ?? maxSessionTimeoutMinutes)))
      : maxSessionTimeoutMinutes;
    const expiresInSeconds = expiryMinutes * 60;

    const accessToken = signPimJwt({
      sub: identity.userId,
      tenantId: identity.tenantId,
      role: identity.role,
      assignedRoles: identity.assignedRoles,
      expiresInSeconds,
    });

    await this.clearUserFailures(userKey);

    if (this.isDbAuthMode()) {
      void this.prisma.tenant(identity.tenantId).authIdentity.updateMany({
        where: { tenantKey: identity.tenantId, userId: identity.userId },
        data: { lastSignInAt: new Date() },
      });
    }

    await this.auditService.record({
      actorId: identity.userId,
      actorRole: identity.role,
      action: "auth.login_success",
      resource: "auth.login",
      tenantKey: identity.tenantId,
      metadata: { ipAddress, expiresInSeconds },
    });

    return {
      type: "success",
      refreshToken: this.issueRefreshToken(identity),
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

  issueRefreshToken(identity: { userId: string; tenantId: string; role?: AppRole; assignedRoles?: FoundationRole[] }): string {
    return signPimJwt({
      sub: identity.userId,
      tenantId: identity.tenantId,
      role: identity.role,
      assignedRoles: identity.assignedRoles,
      tokenType: "refresh",
      expiresInSeconds: REFRESH_TOKEN_TTL_SECONDS,
    });
  }

  async refresh(refreshToken: string): Promise<RefreshResult> {
    const claims = verifyPimJwt(refreshToken);
    if (!claims || claims.tokenType !== "refresh") {
      return { type: "invalid_token" };
    }
    // Fail-open when Redis is down: refresh tokens are short-lived and the
    // access token check in JwtAuthGuard applies the same policy.
    let revoked = false;
    try {
      revoked = await this.jwtBlocklistService.isRevoked(claims.jti);
    } catch {
      this.logger.warn("JWT blocklist unavailable during refresh — failing open");
    }
    if (revoked) {
      return { type: "invalid_token" };
    }
    let credRevoked = false;
    try {
      credRevoked = await this.jwtBlocklistService.isCredentialRevoked(
        normalizeTenantKey(claims.tenantId),
        claims.sub,
        claims.iat,
      );
    } catch {
      this.logger.warn("JWT blocklist unavailable during credential check on refresh — failing open");
    }
    if (credRevoked) {
      return { type: "invalid_token" };
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const revokeCurrentRefresh = async () => {
      await this.jwtBlocklistService.revoke(claims.jti, Math.max(1, claims.exp - nowSeconds));
    };

    const identity = await this.resolveLoginIdentity(claims.sub, claims.tenantId);
    if (!identity || (identity.lockedUntil && identity.lockedUntil.getTime() > Date.now())) {
      await revokeCurrentRefresh();
      return { type: "invalid_token" };
    }

    const commercialProfile = await this.planUsageService.getTenantPlanProfile(identity.tenantId);
    if (commercialProfile.accessStatus === "suspended") {
      await revokeCurrentRefresh();
      return { type: "invalid_token" };
    }

    await revokeCurrentRefresh();

    const sessionTimeoutMinutes = await this.authPolicyService.getEffectiveSessionTimeoutMinutes(identity.tenantId);
    const expiresInSeconds = Math.min(MAX_LOGIN_EXPIRY_MINUTES, sessionTimeoutMinutes) * 60;
    const accessToken = signPimJwt({
      sub: identity.userId,
      tenantId: identity.tenantId,
      role: identity.role,
      assignedRoles: identity.assignedRoles,
      tokenType: "access",
      mfaVerified: claims.mfaVerified,
      expiresInSeconds,
    });
    const nextRefreshToken = this.issueRefreshToken(identity);

    await this.auditService.record({
      actorId: identity.userId,
      actorRole: identity.role,
      action: "auth.token_refreshed",
      resource: "auth.session",
      tenantKey: identity.tenantId,
      metadata: { expiresInSeconds },
    });

    return { type: "success", accessToken, refreshToken: nextRefreshToken, expiresInSeconds };
  }

  async logout(claims: PimJwtClaims, refreshToken?: string): Promise<void> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const ttlSeconds = Math.max(1, claims.exp - nowSeconds);
    await this.jwtBlocklistService.revoke(claims.jti, ttlSeconds);
    if (refreshToken) {
      const refreshClaims = verifyPimJwt(refreshToken);
      if (refreshClaims?.tokenType === "refresh") {
        const refreshTtlSeconds = Math.max(1, refreshClaims.exp - nowSeconds);
        await this.jwtBlocklistService.revoke(refreshClaims.jti, refreshTtlSeconds);
      }
    }
    await this.auditService.record({
      actorId: claims.sub,
      actorRole: claims.role ?? "viewer",
      action: "auth.logout",
      resource: "auth.session",
      tenantKey: claims.tenantId,
      metadata: { jti: claims.jti },
    });
  }

  async verifyLoginMfa(
    pendingToken: string,
    code: string,
  ): Promise<
    | { type: "success"; payload: LoginResponse }
    | { type: "invalid_token" }
    | { type: "invalid_code" }
  > {
    const claims = verifyPimJwt(pendingToken);
    if (!claims || claims.tokenType !== "mfa_pending") {
      return { type: "invalid_token" };
    }
    const ok = await this.mfaService.verifyMfaForLogin(claims.sub, claims.tenantId, code);
    if (!ok) {
      return { type: "invalid_code" };
    }
    const sessionTimeoutMinutes = await this.authPolicyService.getEffectiveSessionTimeoutMinutes(claims.tenantId);
    const expiresInSeconds = Math.min(MAX_LOGIN_EXPIRY_MINUTES, sessionTimeoutMinutes) * 60;
    const accessToken = signPimJwt({
      sub: claims.sub,
      tenantId: claims.tenantId,
      role: claims.role,
      assignedRoles: claims.assignedRoles,
      tokenType: "access",
      mfaVerified: true,
      expiresInSeconds,
      minimumExpiresInSeconds: 60,
    });
    if (this.isDbAuthMode()) {
      void this.prisma.tenant(claims.tenantId).authIdentity.updateMany({
        where: { tenantKey: claims.tenantId, userId: claims.sub },
        data: { lastSignInAt: new Date() },
      });
    }

    await this.auditService.record({
      actorId: claims.sub,
      actorRole: claims.role ?? "viewer",
      action: "auth.login_success",
      resource: "auth.login",
      tenantKey: claims.tenantId,
      metadata: { mfa: true, expiresInSeconds },
    });
    return {
      type: "success",
      payload: {
        accessToken,
        tokenType: "Bearer",
        expiresInSeconds,
        userId: claims.sub,
        tenantId: claims.tenantId,
        role: claims.role ?? resolveDefaultRole(),
      },
    };
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
      assignedRoles: input.claims.assignedRoles,
      tokenType: "step_up",
      stepUpScope: input.scope,
      parentJti: input.claims.jti,
      expiresInSeconds,
      // JWT expiry is second-granular, so a 1-second token can expire
      // between issuance and the very next protected request.
      minimumExpiresInSeconds: MIN_STEP_UP_EXPIRY_SECONDS,
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

  issueEnrollmentToken(sub: string, tenantId: string, role: AppRole, assignedRoles: FoundationRole[]): { enrollmentToken: string; expiresInSeconds: number } {
    const enrollmentToken = signPimJwt({
      sub,
      tenantId,
      role,
      assignedRoles,
      tokenType: "mfa_enrollment",
      expiresInSeconds: MFA_ENROLLMENT_TOKEN_TTL_SECONDS,
    });
    return { enrollmentToken, expiresInSeconds: MFA_ENROLLMENT_TOKEN_TTL_SECONDS };
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
      await this.dispatchAuthEmail(
        {
          tenantId: identity.tenantId,
          userId: identity.userId,
          kind: "account_unlock",
          workspaceSlug: workspace?.workspaceSlug ?? workspaceSlug,
          resetToken,
        } satisfies AuthEmailJobPayload,
        "resend_unlock",
      );
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
    const now = Date.now();
    const rateLimit = await this.checkAndIncrementResetRateLimit(normalizedEmail, now);
    let identityFound = false;

    if (this.isDbAuthMode()) {
      const identity = await this.prismaDirect.getClient().authIdentity.findFirst({
        where: {
          userId: normalizedEmail,
        },
        select: {
          userId: true,
          tenantKey: true,
          role: true,
          assignedRoles: true,
          isActive: true,
          lockedUntil: true,
          passwordHash: true,
        },
      });
      identityFound = Boolean(identity);
      if (identity?.isActive && rateLimit.allowed) {
        const resolvedIdentity: ResolvedLoginIdentity = {
          userId: this.normalizeUserKey(identity.userId),
          tenantId: normalizeTenantKey(identity.tenantKey),
          role: normalizeAppRole(identity.role) ?? "viewer",
          assignedRoles: this.resolvePersistedAssignedRoles(identity),
          lockedUntil: identity.lockedUntil ?? null,
          passwordHash: identity.passwordHash ?? null,
        };
        const resetToken = await this.createRecoveryToken(resolvedIdentity, "password_reset");
        const workspace = await this.tenantDirectoryService.resolveTenantAlias(resolvedIdentity.tenantId);
        await this.dispatchAuthEmail(
          {
            tenantId: resolvedIdentity.tenantId,
            userId: resolvedIdentity.userId,
            kind: "password_reset",
            workspaceSlug: workspace?.workspaceSlug ?? null,
            resetToken,
          } satisfies AuthEmailJobPayload,
          "request_password_reset",
        );
      }
    }

    await this.auditService.record({
      actorId: normalizedEmail || "unknown",
      actorRole: "public",
      action: "auth.password_reset_requested",
      resource: "auth.password_reset",
      metadata: {
        emailMasked: this.maskIdentity(normalizedEmail),
        identityFound,
        rateLimited: !rateLimit.allowed,
      },
    });

    return {
      ok: true,
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    };
  }

  async changePassword(
    userId: string,
    tenantId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ ok: true }> {
    const identity = await this.resolveLoginIdentity(userId, tenantId);
    if (!identity) {
      throw new UnauthorizedException({ error: "INVALID_CREDENTIALS" });
    }
    const credentialOk = await this.verifyPasswordForIdentity(currentPassword, identity);
    if (!credentialOk) {
      throw new UnauthorizedException({ error: "INVALID_CREDENTIALS" });
    }
    const normalizedNew = newPassword.normalize("NFC");
    const passwordHash = await bcrypt.hash(normalizedNew, 12);
    await this.prisma.tenant(tenantId).authIdentity.updateMany({
      where: { userId: identity.userId, tenantKey: tenantId },
      data: { passwordHash },
    });
    await this.auditService.record({
      actorId: identity.userId,
      actorRole: identity.role,
      action: "auth.password_changed",
      resource: "auth.identity",
      tenantKey: tenantId,
      metadata: {},
    });
    return { ok: true };
  }

  async confirmPasswordReset(token: string, password: string): Promise<{
    ok: true;
    reset: true;
    workspaceSlug: string | null;
  }> {
    const normalizedPassword = String(password ?? "").trim();
    if (normalizedPassword.length < 8) {
      throw new BadRequestException({ error: "PASSWORD_TOO_SHORT", minLength: 8 });
    }
    if (normalizedPassword.length > 72) {
      throw new BadRequestException({ error: "PASSWORD_TOO_LONG", maxLength: 72 });
    }

    const directPrisma = this.prismaDirect.getClient();
    const recoveryToken = await directPrisma.authRecoveryToken.findUnique({
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

    const identity = await directPrisma.authIdentity.findFirst({
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

    await directPrisma.$transaction([
      directPrisma.authIdentity.update({
        where: {
          id: identity.id,
        },
        data: {
          passwordHash,
          lockedUntil: null,
        },
      }),
      directPrisma.authRecoveryToken.update({
        where: {
          id: recoveryToken.id,
        },
        data: {
          usedAt: new Date(),
        },
      }),
    ]);

    // Revoke all outstanding tokens — the user changed their credentials.
    await this.jwtBlocklistService.revokeCredentials(tenantId, userId).catch(() => undefined);

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
    if (!this.isLocalAuthMode()) {
      await this.prisma.tenant(tenantId).accountConsentEvent.create({
        data: {
          id: randomUUID(),
          userId,
          accepted: input.accepted,
          policyVersion,
          purpose,
          consentRecordedAt: new Date(consentRecordedAt),
        },
      });
    }

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

    await this.prisma.tenant(tenantId).accountExportRequest.create({
      data: {
        id: jobId,
        userId,
        actorRole: input.role,
        format: result.format,
        status: EXPORT_STATUS_QUEUED,
        requestedAt: new Date(requestedAt),
        estimatedReadyInSeconds: result.estimatedReadyInSeconds,
      },
    });

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

    await this.dispatchAccountExport(
      {
        jobId,
        tenantId,
        userId,
        format: result.format,
      } satisfies AccountExportJobPayload,
      "request_account_export",
    );

    return result;
  }

  async getAccountPrivacyStatus(userIdInput: string, tenantIdInput: string): Promise<AccountPrivacyStatusResult> {
    const tenantId = normalizeTenantKey(tenantIdInput);
    const userId = userIdInput.trim();
    const tenantPrisma = this.prisma.tenant(tenantId);
    const [commercialProfile, latestConsent, latestExport, latestDeletion] = await Promise.all([
      this.planUsageService.getTenantPlanProfile(tenantId),
      tenantPrisma.accountConsentEvent.findFirst({
        where: { userId },
        orderBy: { consentRecordedAt: "desc" },
        select: {
          accepted: true,
          policyVersion: true,
          purpose: true,
          consentRecordedAt: true,
        },
      }),
      tenantPrisma.accountExportRequest.findFirst({
        where: { userId },
        orderBy: { requestedAt: "desc" },
        select: {
          id: true,
          status: true,
          format: true,
          requestedAt: true,
          estimatedReadyInSeconds: true,
          completedAt: true,
          failedAt: true,
          errorMessage: true,
          artifactPath: true,
        },
      }),
      tenantPrisma.accountDeletionRequest.findFirst({
        where: { userId },
        orderBy: { requestedAt: "desc" },
        select: {
          id: true,
          status: true,
          requestedAt: true,
          scheduledFor: true,
        },
      }),
    ]);

    return {
      ok: true,
      userId,
      tenantId,
      commercialState: {
        billingStatus: commercialProfile.billingStatus,
        accessStatus: commercialProfile.accessStatus,
        suspensionReason: commercialProfile.suspensionReason,
        suspendedAt: commercialProfile.suspendedAt,
      },
      latestConsent: latestConsent ? toPrivacyConsentSummary(latestConsent) : null,
      latestExport: latestExport ? toPrivacyExportSummary(latestExport) : null,
      latestDeletion: latestDeletion ? toPrivacyDeletionSummary(latestDeletion) : null,
    };
  }

  async downloadAccountExport(
    jobIdInput: string,
    userIdInput: string,
    tenantIdInput: string,
  ): Promise<AccountExportDownloadResult> {
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
      return {
        kind: "unavailable",
        status: "unavailable",
        reason: "Export not yet ready or has expired.",
      };
    }

    const download = await this.authExportStorageService.resolveAccountExportDownload({
      artifactPath: exportRequest.artifactPath,
      format: exportRequest.format === "csv" ? "csv" : "json",
      fileName: exportRequest.artifactFileName || `${jobId}.${exportRequest.format === "csv" ? "csv" : "json"}`,
    });
    if (download.kind === "binary") {
      return download;
    }
    if (download.kind === "unavailable") {
      return {
        kind: "unavailable",
        status: "unavailable",
        reason: download.reason,
      };
    }
    return {
      kind: "ready",
      downloadUrl: download.downloadUrl,
      expiresInSeconds: download.expiresInSeconds,
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

    await this.prisma.tenant(tenantId).accountDeletionRequest.create({
      data: {
        id: ticketId,
        userId,
        actorRole: input.role,
        reason: input.reason ?? null,
        status: result.status,
        scheduledFor: new Date(scheduledFor),
      },
    });

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

    const isDbMode = String(process.env.AUTH_MODE ?? "").trim().toLowerCase() === "db";
    if (isDbMode) {
      await this.queueService.enqueue(
        QUEUE_NAMES.ACCOUNT_DELETION_EXECUTION,
        { ticketId, tenantId, userId },
        { delayMs: 24 * 60 * 60 * 1000 },
      );
    }

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
    const appEnv = String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "development");
    if (appEnv === "production" || appEnv === "staging") {
      throw new ServiceUnavailableException("Auth rate-limiting service unavailable.");
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

  private async checkAndIncrementResetRateLimit(
    email: string,
    now: number,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    await this.ensureRedisConnection();
    if (this.redisAvailable && this.redisClient) {
      try {
        return await this.checkAndIncrementResetRateLimitRedis(email);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error ?? "unknown error");
        this.markRedisUnavailable(`Failed to evaluate password reset rate limit in Redis: ${message}`);
      }
    }
    const appEnv = String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "development");
    if (appEnv === "production" || appEnv === "staging") {
      throw new ServiceUnavailableException("Auth rate-limiting service unavailable.");
    }
    return this.checkAndIncrementResetRateLimitInMemory(email, now);
  }

  private checkAndIncrementResetRateLimitInMemory(
    email: string,
    now: number,
  ): { allowed: boolean; retryAfterSeconds: number } {
    const emailKey = this.normalizeUserKey(email) || "unknown";
    const existing = this.passwordResetAttempts.get(emailKey);
    if (!existing || now - existing.windowStartMs >= RESET_WINDOW_MS) {
      this.passwordResetAttempts.set(emailKey, {
        windowStartMs: now,
        attempts: 1,
      });
      return {
        allowed: true,
        retryAfterSeconds: 0,
      };
    }

    if (existing.attempts >= RESET_ATTEMPT_LIMIT) {
      const remainingMs = Math.max(0, RESET_WINDOW_MS - (now - existing.windowStartMs));
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
      };
    }

    existing.attempts += 1;
    this.passwordResetAttempts.set(emailKey, existing);
    return {
      allowed: true,
      retryAfterSeconds: 0,
    };
  }

  private async checkAndIncrementResetRateLimitRedis(
    email: string,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const client = this.redisClient;
    if (!client) {
      return {
        allowed: true,
        retryAfterSeconds: 0,
      };
    }
    const emailKey = this.normalizeUserKey(email) || "unknown";
    const key = this.resetRateKey(emailKey);
    const attempts = Number(await client.incr(key));
    if (attempts === 1) {
      await client.pExpire(key, RESET_WINDOW_MS);
      return {
        allowed: true,
        retryAfterSeconds: 0,
      };
    }
    if (attempts <= RESET_ATTEMPT_LIMIT) {
      return {
        allowed: true,
        retryAfterSeconds: 0,
      };
    }
    const ttlMs = Number(await client.pTTL(key));
    const effectiveTtlMs = ttlMs > 0 ? ttlMs : RESET_WINDOW_MS;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(effectiveTtlMs / 1000)),
    };
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
      const fromDb = await this.resolveIdentityFromDatabase(normalizedUserId, tenantId);
      if (fromDb) {
        this.logger.warn(
          `[AUTH] User "${normalizedUserId}" not in PIM_AUTH_IDENTITIES_JSON but found in DB with role="${fromDb.role}". ` +
            `Add this user to the identity JSON to avoid the DB fallback.`,
        );
        return fromDb;
      }
      return {
        userId: normalizedUserId,
        tenantId,
        role: defaultRole,
        assignedRoles: [],
        lockedUntil: null,
        passwordHash: null,
      };
    }

    return null;
  }

  private async resolveIdentityFromDatabase(normalizedUserId: string, tenantId: string): Promise<ResolvedLoginIdentity | null> {
    // Login is unauthenticated, so there is no tenant context. Pass tenantId explicitly so
    // the tenant-scope extension does not fall back to DEFAULT_TENANT_KEY and contradict
    // the where clause for cross-tenant workspaces (see PR #147 for the write-path fix).
    const row = await this.prisma.tenant(tenantId).authIdentity.findFirst({
      where: {
        tenantKey: tenantId,
        userId: normalizedUserId,
      },
      select: {
        userId: true,
        tenantKey: true,
        role: true,
        assignedRoles: true,
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
      assignedRoles: this.resolvePersistedAssignedRoles(row),
      lockedUntil: row.lockedUntil,
      passwordHash: row.passwordHash ?? null,
    };
  }

  private resolvePersistedAssignedRoles(row: Pick<AuthIdentityRow, "assignedRoles">): FoundationRole[] {
    if (!Array.isArray(row.assignedRoles) || row.assignedRoles.length === 0) {
      return [];
    }
    return row.assignedRoles
      .map((entry) => normalizeFoundationRole(entry))
      .filter(Boolean) as FoundationRole[];
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
        const assignedRoles = Array.isArray(candidate.assignedRoles)
          ? candidate.assignedRoles
              .map((entry) => normalizeFoundationRole(entry))
              .filter((entry): entry is FoundationRole => Boolean(entry))
          : [];
        directory.set(normalizedUserId, {
          userId: normalizedUserId,
          tenantId,
          role,
          assignedRoles,
          lockedUntil: null,
          passwordHash: typeof candidate.passwordHash === "string" ? candidate.passwordHash : null,
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error ?? "unknown error");
      // Upgraded from warn → error: a broken identity JSON is never a silent event.
      this.logger.error(
        `[AUTH] PIM_AUTH_IDENTITIES_JSON parse failed — identity directory is EMPTY. ` +
        `All logins will fall through to resolveDefaultRole() = "${resolveDefaultRole()}". ` +
        `Cause: bash 'source .env' silently strips JSON object values containing '{'. ` +
        `Fix: use 'npm run dev:api' or 'npm run start --workspace @pim1/api' (both invoke dotenv-cli). ` +
        `Parse error: ${message}`,
      );
    }

    // Fail-fast: if local-auth mode, a non-empty JSON string was provided, but the
    // directory is still empty after parsing, something is critically wrong.
    // Throw at boot time rather than silently serving a broken auth layer.
    // Guard: only active outside production so staging/prod cannot be accidentally bricked.
    const appEnv = String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "development")
      .trim()
      .toLowerCase();
    if (this.isLocalAuthMode() && raw && directory.size === 0 && appEnv !== "production") {
      throw new Error(
        "[AUTH BOOT FAILURE] AUTH_MODE=local and PIM_AUTH_IDENTITIES_JSON is set " +
          "but the parsed identity directory is empty. " +
          "This means JSON values were stripped before startup (e.g. via 'source .env' in bash — " +
          "bash silently discards values containing '{' characters). " +
          "Fix: use 'npm run dev:api' or 'npm run start --workspace @pim1/api' " +
          "which both invoke dotenv-cli and handle JSON values correctly. " +
          "See docs/getting-started.md for the supported startup commands.",
      );
    }

    return directory;
  }

  private async createRecoveryToken(identity: ResolvedLoginIdentity, purpose: "password_reset"): Promise<string> {
    const rawToken = randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString("hex");
    const tokenHash = this.hashRecoveryToken(rawToken);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRY_MS);
    const prisma = this.prisma.tenant(identity.tenantId);

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
        subject: "Your Vexa PIM account export is ready",
        text: `Your account export is ready. Sign in to Vexa PIM and open ${privacyUrl} to download it securely.`,
        html: `<p>Your account export is ready.</p><p><a href=\"${privacyUrl}\">Sign in to Vexa PIM</a> and open Privacy settings to download it securely.</p>`,
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
    const subject = isUnlock ? "Unlock your Vexa PIM account" : "Reset your Vexa PIM password";
    const intro = isUnlock
      ? "Your account was locked after repeated sign-in attempts. Use the link below to set a new password and regain access."
      : "Use the link below to set a new password for your Vexa PIM account.";

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
    const commercialProfile = await this.planUsageService.getTenantPlanProfile(tenantId);

    if (commercialProfile.accessStatus === "suspended") {
      const skippedAt = new Date();
      await tenantPrisma.accountExportRequest.updateMany({
        where: {
          id: payload.jobId,
          tenantKey: tenantId,
          userId: payload.userId,
        },
        data: {
          status: EXPORT_STATUS_SKIPPED,
          artifactPath: null,
          artifactFileName: null,
          completedAt: null,
          failedAt: skippedAt,
          errorMessage: "tenant_suspended",
          estimatedReadyInSeconds: 0,
        },
      });

      await this.auditService.record({
        actorId: payload.userId,
        actorRole: "public",
        action: "account.export_skipped",
        resource: "account_export_requests",
        resourceId: payload.jobId,
        metadata: {
          tenantId,
          format: payload.format,
          reason: "tenant_suspended",
        },
      });
      return;
    }

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
      const artifactContents =
        payload.format === "csv"
          ? this.renderAccountExportCsv(exportDocument)
          : JSON.stringify(exportDocument, null, 2);
      const artifact = await this.authExportStorageService.storeAccountExportArtifact({
        tenantId: payload.tenantId,
        userId: payload.userId,
        jobId: payload.jobId,
        format: payload.format,
        fileContents: artifactContents,
      });

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

      await this.dispatchAuthEmail(
        {
          tenantId,
          userId: payload.userId,
          kind: "account_export_ready",
          jobId: payload.jobId,
        } satisfies AuthEmailJobPayload,
        "account_export_ready",
      );
    } catch (error: unknown) {
      const errorMessage = this.toAccountExportErrorMessage(error);
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
    // authIdentity and workspace are independent — fetch in parallel.
    const tenantPrisma = this.prisma.tenant(tenantId);
    const [authIdentity, workspace, consents, exportRequests, deletionRequests, notifications, auditRows, mfaEnrollments] = await Promise.all([
      this.prisma.tenant(DEFAULT_TENANT_KEY).authIdentity.findFirst({
        where: { tenantKey: tenantId, userId },
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
      }),
      this.tenantDirectoryService.resolveTenantAlias(tenantId),
      tenantPrisma.accountConsentEvent.findMany({
        where: { userId },
        orderBy: { consentRecordedAt: "desc" },
        take: 500,
        select: {
          id: true,
          accepted: true,
          policyVersion: true,
          purpose: true,
          consentRecordedAt: true,
          createdAt: true,
        },
      }),
      tenantPrisma.accountExportRequest.findMany({
        where: { userId },
        orderBy: { requestedAt: "desc" },
        take: 100,
        select: {
          id: true,
          actorRole: true,
          format: true,
          status: true,
          requestedAt: true,
          estimatedReadyInSeconds: true,
          artifactFileName: true,
          completedAt: true,
          failedAt: true,
          errorMessage: true,
        },
      }),
      tenantPrisma.accountDeletionRequest.findMany({
        where: { userId },
        orderBy: { requestedAt: "desc" },
        take: 100,
        select: {
          id: true,
          actorRole: true,
          reason: true,
          status: true,
          requestedAt: true,
          scheduledFor: true,
        },
      }),
      tenantPrisma.userNotification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 1_000,
        select: {
          id: true,
          eventType: true,
          title: true,
          message: true,
          actionUrl: true,
          actionLabel: true,
          readAt: true,
          createdAt: true,
        },
      }),
      tenantPrisma.auditLog.findMany({
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
      }),
      tenantPrisma.userMfaEnrollment.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          method: true,
          status: true,
          enrolledAt: true,
          verifiedAt: true,
          lastUsedAt: true,
          createdAt: true,
        },
      }),
    ]);

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
      consentEvents: consents.map((row) => ({
        id: row.id,
        accepted: row.accepted,
        policyVersion: row.policyVersion,
        purpose: row.purpose,
        consentRecordedAt: row.consentRecordedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      })),
      exportRequests: exportRequests.map((row) => ({
        id: row.id,
        actorRole: row.actorRole,
        format: row.format,
        status: row.status,
        requestedAt: row.requestedAt.toISOString(),
        estimatedReadyInSeconds: row.estimatedReadyInSeconds,
        artifactFileName: row.artifactFileName,
        completedAt: toIsoStringOrNull(row.completedAt),
        failedAt: toIsoStringOrNull(row.failedAt),
        errorMessage: row.errorMessage,
      })),
      deletionRequests: deletionRequests.map((row) => ({
        id: row.id,
        actorRole: row.actorRole,
        reason: row.reason,
        status: row.status,
        requestedAt: row.requestedAt.toISOString(),
        scheduledFor: row.scheduledFor.toISOString(),
      })),
      notifications: notifications.map((row) => ({
        id: row.id,
        eventType: row.eventType,
        title: row.title,
        message: row.message,
        actionUrl: row.actionUrl,
        actionLabel: row.actionLabel,
        readAt: toIsoStringOrNull(row.readAt),
        createdAt: row.createdAt.toISOString(),
      })),
      auditLog: auditRows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
      mfaEnrollments: mfaEnrollments.map((row) => ({
        id: row.id,
        method: row.method,
        status: row.status,
        enrolledAt: toIsoStringOrNull(row.enrolledAt),
        verifiedAt: toIsoStringOrNull(row.verifiedAt),
        lastUsedAt: toIsoStringOrNull(row.lastUsedAt),
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  private async dispatchAuthEmail(payload: AuthEmailJobPayload, context: string): Promise<void> {
    try {
      await this.queueService.enqueue(QUEUE_NAMES.AUTH_EMAIL, payload);
    } catch (error: unknown) {
      this.logger.warn(
        `Auth email queue unavailable during ${context}; processing inline instead. ${this.toErrorMessage(error)}`,
      );
      await this.processAuthEmailJob(payload);
    }
  }

  private async dispatchAccountExport(payload: AccountExportJobPayload, context: string): Promise<void> {
    try {
      await this.queueService.enqueue(QUEUE_NAMES.ACCOUNT_EXPORT, payload);
    } catch (error: unknown) {
      this.logger.warn(
        `Account export queue unavailable during ${context}; processing inline instead. ${this.toErrorMessage(error)}`,
      );
      try {
        await this.processAccountExportJob(payload);
      } catch (inlineError: unknown) {
        this.logger.error(
          `Inline account export processing failed during ${context}. ${this.toErrorMessage(inlineError)}`,
        );
      }
    }
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
    if (this.isDbAuthMode()) {
      throw new UnauthorizedException({ error: "AUTH_CREDENTIAL_MIGRATION_INCOMPLETE" });
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
    const expected = configuredPassword || "vexa-pim-demo-password";
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
    return Math.min(MAX_STEP_UP_EXPIRY_SECONDS, Math.max(MIN_STEP_UP_EXPIRY_SECONDS, configured));
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

  private resetRateKey(emailKey: string): string {
    return `${this.redisKeyPrefix()}reset:${emailKey}`;
  }

  private redisKeyPrefix(): string {
    const configured = String(process.env.PIM_AUTH_REDIS_KEY_PREFIX ?? "PIM1:auth:").trim();
    return configured.length > 0 ? configured : "PIM1:auth:";
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

  private toAccountExportErrorMessage(error: unknown): string {
    if (error instanceof AccountExportStorageError) {
      return error.publicMessage;
    }
    return this.toErrorMessage(error);
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
