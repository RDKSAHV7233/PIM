import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "redis";
import { PlanUsageService } from "../billing/plan-usage.service";
import { AuthEmailService } from "../auth/auth-email.service";
import {
  DEFAULT_TENANT_KEY,
  isValidWorkspaceSlug,
  normalizeWorkspaceSlug,
} from "../common/tenant/tenant.constants";
import { TenantDirectoryService } from "../common/tenant/tenant-directory.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreatePublicSignupDto } from "./dto/create-public-signup.dto";

const SIGNUP_VERIFICATION_EXPIRY_MS = 30 * 60 * 1000;
const SIGNUP_TOKEN_BYTES = 24;
const SIGNUP_IP_ATTEMPT_LIMIT = 5;
const SIGNUP_EMAIL_ATTEMPT_LIMIT = 3;
const SIGNUP_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_REDIS_URL = "redis://localhost:6379";
const REDIS_RETRY_BACKOFF_MS = 30_000;
const REDIS_WARN_THROTTLE_MS = 10_000;
const REDIS_CONNECT_TIMEOUT_MS = 1_000;

interface AttemptState {
  windowStartMs: number;
  attempts: number;
}

export class SignupRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("SIGNUP_RATE_LIMITED");
  }
}

@Injectable()
export class SignupService implements OnModuleDestroy {
  private readonly logger = new Logger(SignupService.name);
  private readonly signupIpAttempts = new Map<string, AttemptState>();
  private readonly signupEmailAttempts = new Map<string, AttemptState>();
  private redisClient: ReturnType<typeof createClient> | null = null;
  private redisConnecting: Promise<void> | null = null;
  private redisAvailable = false;
  private redisRetryAfterMs = 0;
  private redisLastWarnedAtMs = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantDirectoryService: TenantDirectoryService,
    private readonly authEmailService: AuthEmailService,
    private readonly planUsageService: PlanUsageService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    if (!this.redisClient) {
      return;
    }
    try {
      await this.redisClient.quit();
    } catch {
      try {
        await this.redisClient.disconnect();
      } catch {
        // ignore disconnect failures during shutdown
      }
    } finally {
      this.redisClient = null;
      this.redisAvailable = false;
    }
  }

  async checkWorkspaceAvailability(workspaceSlugInput: string): Promise<{ available: boolean; reason?: string }> {
    this.assertFeatureEnabled();
    await this.expirePendingRequests();

    const workspaceSlug = normalizeWorkspaceSlug(workspaceSlugInput);
    if (!isValidWorkspaceSlug(workspaceSlug)) {
      throw new Error("WORKSPACE_SLUG_INVALID");
    }

    const prisma = this.prisma.tenant(DEFAULT_TENANT_KEY);
    const signupRequests = this.signupRequestStore();
    const [existingWorkspace, pendingSignup] = await Promise.all([
      prisma.workspaceDirectory.findUnique({
        where: { workspaceSlug },
        select: { tenantKey: true, isActive: true },
      }),
      signupRequests.findFirst({
        where: {
          workspaceSlug,
          status: "pending",
          expiresAt: {
            gt: new Date(),
          },
        },
        select: { id: true },
      }),
    ]);

    if (existingWorkspace?.isActive) {
      return { available: false, reason: "WORKSPACE_SLUG_ALREADY_ASSIGNED" };
    }
    if (pendingSignup) {
      return { available: false, reason: "WORKSPACE_SLUG_ALREADY_PENDING" };
    }
    return { available: true };
  }

  async createPublicSignup(
    dto: CreatePublicSignupDto,
    ipAddress: string,
  ): Promise<{ ok: true; status: "pending_verification" }> {
    this.assertFeatureEnabled();
    await this.expirePendingRequests();

    const now = Date.now();
    const ipRetryAfterSeconds = await this.incrementAndCheckIpRateLimit(ipAddress, now);
    if (ipRetryAfterSeconds > 0) {
      throw new SignupRateLimitError(ipRetryAfterSeconds);
    }

    const adminEmail = this.normalizeEmail(dto.adminEmail);
    const emailRetryAfterSeconds = await this.incrementAndCheckEmailRateLimit(adminEmail, now);
    if (emailRetryAfterSeconds > 0) {
      throw new SignupRateLimitError(emailRetryAfterSeconds);
    }

    const workspaceSlug = normalizeWorkspaceSlug(dto.workspaceSlug);
    if (!String(dto.displayName ?? "").trim()) {
      throw new Error("DISPLAY_NAME_REQUIRED");
    }
    if (!isValidWorkspaceSlug(workspaceSlug)) {
      throw new Error("WORKSPACE_SLUG_INVALID");
    }
    if (String(dto.password ?? "").trim().length < 8) {
      throw new Error("PASSWORD_TOO_SHORT");
    }
    if (!dto.acceptedTerms) {
      throw new Error("TERMS_ACCEPTANCE_REQUIRED");
    }

    const prisma = this.prisma.tenant(DEFAULT_TENANT_KEY);
    const signupRequests = this.signupRequestStore();
    const [existingWorkspace, existingIdentity, existingPendingSlug, existingPendingEmail] = await Promise.all([
      prisma.workspaceDirectory.findUnique({
        where: { workspaceSlug },
        select: { tenantKey: true, isActive: true },
      }),
      prisma.authIdentity.findUnique({
        where: { userId: adminEmail },
        select: { tenantKey: true },
      }),
      signupRequests.findFirst({
        where: {
          workspaceSlug,
          status: "pending",
          expiresAt: {
            gt: new Date(now),
          },
        },
        select: { id: true },
      }),
      signupRequests.findFirst({
        where: {
          adminEmail,
          status: "pending",
          expiresAt: {
            gt: new Date(now),
          },
        },
        select: { id: true },
      }),
    ]);

    if (existingWorkspace?.isActive) {
      throw new Error("WORKSPACE_SLUG_ALREADY_ASSIGNED");
    }
    if (existingPendingSlug) {
      throw new Error("WORKSPACE_SLUG_ALREADY_PENDING");
    }
    if (existingIdentity) {
      throw new Error("ADMIN_EMAIL_ALREADY_REGISTERED");
    }
    if (existingPendingEmail) {
      throw new Error("SIGNUP_VERIFICATION_ALREADY_PENDING");
    }

    const passwordHash = await bcrypt.hash(String(dto.password), 12);
    const verificationToken = randomBytes(SIGNUP_TOKEN_BYTES).toString("hex");
    const verificationTokenHash = this.hashVerificationToken(verificationToken);
    const expiresAt = new Date(now + SIGNUP_VERIFICATION_EXPIRY_MS);

    await signupRequests.create({
      data: {
        id: `signup_${randomUUID()}`,
        displayName: String(dto.displayName ?? "").trim(),
        workspaceSlug,
        adminEmail,
        passwordHash,
        verificationTokenHash,
        status: "pending",
        acceptedTerms: dto.acceptedTerms,
        expiresAt,
      },
    });

    try {
      await this.sendVerificationEmail({
        adminEmail,
        workspaceSlug,
        verificationToken,
        expiresAt,
      });
    } catch (error: unknown) {
      const code = error instanceof Error ? error.message : String(error ?? "unknown error");
      if (code === "EMAIL_PROVIDER_MISCONFIGURED") {
        throw new Error(code);
      }
      this.logger.error(`Public signup verification email failed for ${adminEmail}: ${code}`);
      throw new Error("SIGNUP_VERIFICATION_SEND_FAILED");
    }

    return {
      ok: true,
      status: "pending_verification",
    };
  }

  async verifyPublicSignup(
    token: string,
  ): Promise<{ ok: true; status: "verified"; workspaceSlug: string; userId: string }> {
    this.assertFeatureEnabled();
    await this.expirePendingRequests();

    const normalizedToken = String(token ?? "").trim();
    if (!normalizedToken) {
      throw new Error("SIGNUP_VERIFICATION_TOKEN_INVALID");
    }

    const signupRequests = this.signupRequestStore();
    const tokenHash = this.hashVerificationToken(normalizedToken);
    const request = await signupRequests.findUnique({
      where: {
        verificationTokenHash: tokenHash,
      },
    });

    if (!request || request.status !== "pending" || new Date(request.expiresAt).getTime() <= Date.now()) {
      if (request && request.status === "pending" && new Date(request.expiresAt).getTime() <= Date.now()) {
        await signupRequests.update({
          where: { id: request.id },
          data: { status: "expired" },
        });
      }
      throw new Error("SIGNUP_VERIFICATION_TOKEN_INVALID");
    }

    let workspace;
    try {
      workspace = await this.tenantDirectoryService.provisionWorkspaceWithPasswordHash({
        tenantKey: request.workspaceSlug,
        workspaceSlug: request.workspaceSlug,
        displayName: request.displayName,
        initialAdminUserId: request.adminEmail,
        initialAdminPasswordHash: request.passwordHash,
      });
    } catch (error: unknown) {
      const code = error instanceof Error ? error.message : String(error ?? "unknown error");
      if (code === "INITIAL_ADMIN_USER_ALREADY_ASSIGNED") {
        throw new Error("ADMIN_EMAIL_ALREADY_REGISTERED");
      }
      throw error;
    }

    await signupRequests.update({
      where: { id: request.id },
      data: {
        status: "verified",
        verifiedAt: new Date(),
      },
    });

    await this.planUsageService.getTenantPlanProfile(workspace.tenantId);

    return {
      ok: true,
      status: "verified",
      workspaceSlug: workspace.workspaceSlug,
      userId: request.adminEmail,
    };
  }

  async resendVerification(adminEmailInput: string): Promise<{ ok: true; resent: true }> {
    this.assertFeatureEnabled();
    await this.expirePendingRequests();

    const adminEmail = this.normalizeEmail(adminEmailInput);
    const signupRequests = this.signupRequestStore();
    const signup = await signupRequests.findFirst({
      where: {
        adminEmail,
        status: {
          in: ["pending", "expired"],
        },
      },
      orderBy: [
        {
          createdAt: "desc",
        },
        {
          id: "desc",
        },
      ],
    });

    if (!signup) {
      return { ok: true, resent: true };
    }

    const verificationToken = randomBytes(SIGNUP_TOKEN_BYTES).toString("hex");
    const verificationTokenHash = this.hashVerificationToken(verificationToken);
    const expiresAt = new Date(Date.now() + SIGNUP_VERIFICATION_EXPIRY_MS);

    await signupRequests.update({
      where: {
        id: signup.id,
      },
      data: {
        verificationTokenHash,
        status: "pending",
        expiresAt,
        verifiedAt: null,
      },
    });

    try {
      await this.sendVerificationEmail({
        adminEmail,
        workspaceSlug: signup.workspaceSlug,
        verificationToken,
        expiresAt,
      });
    } catch (error: unknown) {
      const code = error instanceof Error ? error.message : String(error ?? "unknown error");
      if (code === "EMAIL_PROVIDER_MISCONFIGURED") {
        throw new Error(code);
      }
      this.logger.error(`Public signup verification resend failed for ${adminEmail}: ${code}`);
      throw new Error("SIGNUP_VERIFICATION_SEND_FAILED");
    }

    return { ok: true, resent: true };
  }

  private assertFeatureEnabled(): void {
    const enabled = String(process.env.FEATURE_PUBLIC_SIGNUP_ENABLED ?? "false").trim().toLowerCase() === "true";
    if (!enabled) {
      throw new Error("FEATURE_DISABLED");
    }
  }

  private normalizeEmail(value: string): string {
    return String(value ?? "").trim().toLowerCase();
  }

  private hashVerificationToken(token: string): string {
    return createHash("sha256").update(String(token ?? "").trim(), "utf8").digest("hex");
  }

  private signupRequestStore(): any {
    return (this.prisma.tenant(DEFAULT_TENANT_KEY) as any).publicSignupRequest;
  }

  private async expirePendingRequests(now = new Date()): Promise<void> {
    await this.signupRequestStore().updateMany({
      where: {
        status: "pending",
        expiresAt: {
          lt: now,
        },
      },
      data: {
        status: "expired",
      },
    });
  }

  private async sendVerificationEmail(input: {
    adminEmail: string;
    workspaceSlug: string;
    verificationToken: string;
    expiresAt: Date;
  }): Promise<void> {
    const verifyUrl = `${this.resolveWebBaseUrl()}/signup/verify?token=${encodeURIComponent(input.verificationToken)}&email=${encodeURIComponent(input.adminEmail)}&workspace=${encodeURIComponent(input.workspaceSlug)}`;
    await this.authEmailService.send({
      to: input.adminEmail,
      subject: "Verify your TEJ PIM workspace",
      text:
        `Verify your TEJ PIM workspace to finish setup.\n\n` +
        `Workspace: ${input.workspaceSlug}\n` +
        `Verification link: ${verifyUrl}\n\n` +
        `This link expires at ${input.expiresAt.toISOString()}.`,
      html:
        `<p>Verify your TEJ PIM workspace to finish setup.</p>` +
        `<p><strong>Workspace:</strong> ${this.escapeHtml(input.workspaceSlug)}</p>` +
        `<p><a href="${verifyUrl}">Verify your workspace</a></p>` +
        `<p>This link expires at ${this.escapeHtml(input.expiresAt.toISOString())}.</p>`,
      category: "signup_verification",
      metadata: {
        workspaceSlug: input.workspaceSlug,
      },
    });
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

  private async incrementAndCheckIpRateLimit(ipAddress: string, now: number): Promise<number> {
    await this.ensureRedisConnection();
    if (this.redisAvailable && this.redisClient) {
      try {
        return await this.incrementAndCheckRedisLimit(this.signupIpRateKey(ipAddress), SIGNUP_WINDOW_MS, SIGNUP_IP_ATTEMPT_LIMIT);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error ?? "unknown error");
        this.markRedisUnavailable(`Failed to evaluate signup IP rate limit in Redis: ${message}`);
      }
    }
    return this.incrementAndCheckInMemoryLimit(this.signupIpAttempts, this.normalizeRateKey(ipAddress), now, SIGNUP_WINDOW_MS, SIGNUP_IP_ATTEMPT_LIMIT);
  }

  private async incrementAndCheckEmailRateLimit(adminEmail: string, now: number): Promise<number> {
    await this.ensureRedisConnection();
    if (this.redisAvailable && this.redisClient) {
      try {
        return await this.incrementAndCheckRedisLimit(
          this.signupEmailRateKey(adminEmail),
          SIGNUP_WINDOW_MS,
          SIGNUP_EMAIL_ATTEMPT_LIMIT,
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error ?? "unknown error");
        this.markRedisUnavailable(`Failed to evaluate signup email rate limit in Redis: ${message}`);
      }
    }
    return this.incrementAndCheckInMemoryLimit(
      this.signupEmailAttempts,
      this.normalizeRateKey(adminEmail),
      now,
      SIGNUP_WINDOW_MS,
      SIGNUP_EMAIL_ATTEMPT_LIMIT,
    );
  }

  private incrementAndCheckInMemoryLimit(
    store: Map<string, AttemptState>,
    key: string,
    now: number,
    windowMs: number,
    limit: number,
  ): number {
    const existing = store.get(key);
    if (!existing || now - existing.windowStartMs >= windowMs) {
      store.set(key, {
        windowStartMs: now,
        attempts: 1,
      });
      return 0;
    }

    if (existing.attempts >= limit) {
      const remainingMs = Math.max(0, windowMs - (now - existing.windowStartMs));
      return Math.max(1, Math.ceil(remainingMs / 1000));
    }

    existing.attempts += 1;
    store.set(key, existing);
    return 0;
  }

  private async incrementAndCheckRedisLimit(key: string, windowMs: number, limit: number): Promise<number> {
    const client = this.redisClient;
    if (!client) {
      return 0;
    }
    const attempts = Number(await client.incr(key));
    if (attempts === 1) {
      await client.pExpire(key, windowMs);
      return 0;
    }
    if (attempts <= limit) {
      return 0;
    }
    const ttlMs = Number(await client.pTTL(key));
    const effectiveTtlMs = ttlMs > 0 ? ttlMs : windowMs;
    return Math.max(1, Math.ceil(effectiveTtlMs / 1000));
  }

  private signupIpRateKey(ipAddress: string): string {
    return `${this.redisKeyPrefix()}signup:ip:${this.normalizeRateKey(ipAddress)}`;
  }

  private signupEmailRateKey(adminEmail: string): string {
    return `${this.redisKeyPrefix()}signup:email:${this.normalizeRateKey(adminEmail)}`;
  }

  private normalizeRateKey(value: string): string {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9:._-]+/g, "_") || "unknown";
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
            connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
          },
        });
        pendingClient = client;
        client.on("error", (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error ?? "unknown error");
          this.markRedisUnavailable(`Redis error for signup protections: ${message}`);
        });
        await Promise.race([
          client.connect(),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("REDIS_CONNECT_TIMEOUT")), REDIS_CONNECT_TIMEOUT_MS);
          }),
        ]);
        this.redisClient = client;
        this.redisAvailable = true;
        this.redisRetryAfterMs = 0;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error ?? "unknown error");
        this.redisAvailable = false;
        this.redisRetryAfterMs = Date.now() + REDIS_RETRY_BACKOFF_MS;
        if (pendingClient) {
          try {
            await pendingClient.disconnect();
          } catch {
            // ignore disconnect failures on initial connection
          }
        }
        this.markRedisUnavailable(`Failed connecting Redis for signup protections: ${message}`);
      } finally {
        this.redisConnecting = null;
      }
    })();

    await this.redisConnecting;
  }

  private markRedisUnavailable(message: string): void {
    this.redisAvailable = false;
    this.redisRetryAfterMs = Date.now() + REDIS_RETRY_BACKOFF_MS;
    const nowMs = Date.now();
    if (nowMs - this.redisLastWarnedAtMs >= REDIS_WARN_THROTTLE_MS) {
      this.redisLastWarnedAtMs = nowMs;
      this.logger.warn(message);
    }
  }
}

