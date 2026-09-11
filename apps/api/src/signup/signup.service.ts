import { Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "redis";
import { StripeService } from "../billing/stripe.service";
import { PlanUsageService } from "../billing/plan-usage.service";
import { AuthEmailService } from "../auth/auth-email.service";
import { escapeHtml, formatDateUtc, renderEmailHtml, renderEmailText, resolveEmailBrandConfig } from "../auth/email-template";
import { MetricsService } from "../metrics/metrics.service";
import {
  DEFAULT_TENANT_KEY,
  isValidWorkspaceSlug,
  normalizeWorkspaceSlug,
} from "../common/tenant/tenant.constants";
import { TenantDirectoryService } from "../common/tenant/tenant-directory.service";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { QUEUE_NAMES } from "../queue/queue.constants";
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
const SIGNUP_STATUS_PENDING = "pending";
const SIGNUP_STATUS_VERIFIED = "verified";
const SIGNUP_STATUS_EXPIRED = "expired";
const SIGNUP_STATUS_DELIVERY_FAILED = "delivery_failed";

interface AttemptState {
  windowStartMs: number;
  attempts: number;
}

// H-3: payload for the billing-provisioning retry job. adminEmail is required to
// create the Stripe customer; it is never written to logs — correlation uses the
// signupRequestId ref only.
export interface SignupBillingProvisionJobPayload {
  tenantKey: string;
  adminEmail: string;
  displayName: string;
  planTier: "TRIAL";
  signupRequestId: string;
}

export class SignupRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("SIGNUP_RATE_LIMITED");
  }
}

@Injectable()
export class SignupService implements OnModuleInit, OnModuleDestroy {
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
    private readonly metricsService: MetricsService,
    private readonly stripeService: StripeService,
    private readonly queueService: QueueService,
  ) {}

  onModuleInit(): void {
    // H-3: consumer for billing provisioning that could not complete synchronously
    // during verifyPublicSignup (e.g. Stripe/plan-profile outage). Registered here to
    // mirror the other queueService.process(...) handlers (auth-email, account
    // export/deletion). Errors are allowed to propagate so the queue's built-in
    // retry/backoff (BullMQ: 3 attempts, exponential) can take over.
    this.queueService.process<SignupBillingProvisionJobPayload>(
      QUEUE_NAMES.SIGNUP_BILLING_PROVISION,
      async (payload) => {
        await this.runSignupBillingProvision(payload, "retry");
      },
    );
  }

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
          status: SIGNUP_STATUS_PENDING,
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
    const [existingWorkspace, existingIdentity] = await Promise.all([
      prisma.workspaceDirectory.findUnique({
        where: { workspaceSlug },
        select: { tenantKey: true, isActive: true },
      }),
      prisma.authIdentity.findUnique({
        where: { userId: adminEmail },
        select: { tenantKey: true },
      }),
    ]);

    if (existingWorkspace?.isActive) {
      throw new Error("WORKSPACE_SLUG_ALREADY_ASSIGNED");
    }
    if (existingIdentity) {
      throw new Error("ADMIN_EMAIL_ALREADY_REGISTERED");
    }

    const passwordHash = await bcrypt.hash(String(dto.password), 12);
    const verificationToken = randomBytes(SIGNUP_TOKEN_BYTES).toString("hex");
    const verificationTokenHash = this.hashVerificationToken(verificationToken);
    const expiresAt = new Date(now + SIGNUP_VERIFICATION_EXPIRY_MS);
    let signupRequestId = "";

    try {
      signupRequestId = await prisma.$transaction(async (tx) => {
        const signupRequests = this.signupRequestStore(tx);
        await this.expirePendingRequests(new Date(now), signupRequests);

        const matchingRequests = await signupRequests.findMany({
          where: {
            OR: [{ workspaceSlug }, { adminEmail }],
          },
          orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          take: 100,
        });

        const verifiedWorkspace = matchingRequests.find(
          (request: any) => request.workspaceSlug === workspaceSlug && request.status === SIGNUP_STATUS_VERIFIED,
        );
        if (verifiedWorkspace) {
          throw new Error("WORKSPACE_SLUG_ALREADY_ASSIGNED");
        }

        const verifiedEmail = matchingRequests.find(
          (request: any) => request.adminEmail === adminEmail && request.status === SIGNUP_STATUS_VERIFIED,
        );
        if (verifiedEmail) {
          throw new Error("ADMIN_EMAIL_ALREADY_REGISTERED");
        }

        const pendingWorkspace = matchingRequests.find(
          (request: any) => request.workspaceSlug === workspaceSlug && request.status === SIGNUP_STATUS_PENDING,
        );
        if (pendingWorkspace) {
          throw new Error("WORKSPACE_SLUG_ALREADY_PENDING");
        }

        const pendingEmail = matchingRequests.find(
          (request: any) => request.adminEmail === adminEmail && request.status === SIGNUP_STATUS_PENDING,
        );
        if (pendingEmail) {
          throw new Error("SIGNUP_VERIFICATION_ALREADY_PENDING");
        }

        const reusableByEmail = matchingRequests.find((request: any) => request.adminEmail === adminEmail) ?? null;
        const reusableByWorkspace =
          matchingRequests.find((request: any) => request.workspaceSlug === workspaceSlug) ?? null;

        const targetRequest = reusableByEmail ?? reusableByWorkspace;
        const duplicateRequestIds =
          reusableByEmail && reusableByWorkspace && reusableByEmail.id !== reusableByWorkspace.id
            ? [reusableByEmail.id === targetRequest?.id ? reusableByWorkspace.id : reusableByEmail.id]
            : [];

        if (duplicateRequestIds.length > 0) {
          await signupRequests.deleteMany({
            where: {
              id: {
                in: duplicateRequestIds,
              },
            },
          });
        }

        const data = {
          displayName: String(dto.displayName ?? "").trim(),
          workspaceSlug,
          adminEmail,
          passwordHash,
          verificationTokenHash,
          status: SIGNUP_STATUS_PENDING,
          acceptedTerms: dto.acceptedTerms,
          expiresAt,
          verifiedAt: null,
        };

        if (targetRequest) {
          const updated = await signupRequests.update({
            where: { id: targetRequest.id },
            data,
          });
          return String(updated.id);
        }

        const created = await signupRequests.create({
          data: {
            id: `signup_${randomUUID()}`,
            ...data,
          },
        });
        return String(created.id);
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const targets = Array.isArray(error.meta?.target) ? error.meta.target.map(String) : [];
        if (targets.includes("workspaceSlug")) {
          throw new Error("WORKSPACE_SLUG_ALREADY_PENDING");
        }
        if (targets.includes("adminEmail")) {
          throw new Error("SIGNUP_VERIFICATION_ALREADY_PENDING");
        }
      }
      throw error;
    }

    try {
      await this.sendVerificationEmail({
        adminEmail,
        workspaceSlug,
        verificationToken,
        expiresAt,
      });
    } catch (error: unknown) {
      const code = error instanceof Error ? error.message : String(error ?? "unknown error");
      await this.markSignupRequestDeliveryFailed(signupRequestId);
      if (code === "EMAIL_PROVIDER_MISCONFIGURED") {
        throw new Error(code);
      }
      // Do not log the raw email address — it is PII. Use the request ID for correlation.
      this.logger.error(`Public signup verification email failed [ref:${signupRequestId}]: ${code}`);
      throw new Error("SIGNUP_VERIFICATION_SEND_FAILED");
    }

    await this.emitSignupMetric({
      tenantKey: workspaceSlug,
      metricKey: "signup.request_total",
      metricValue: 1,
      tags: {
        source: "public_signup",
      },
    });

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

    if (!request || request.status !== SIGNUP_STATUS_PENDING || new Date(request.expiresAt).getTime() <= Date.now()) {
      if (request && request.status === SIGNUP_STATUS_PENDING && new Date(request.expiresAt).getTime() <= Date.now()) {
        await signupRequests.update({
          where: { id: request.id },
          data: { status: SIGNUP_STATUS_EXPIRED },
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
        status: SIGNUP_STATUS_VERIFIED,
        verifiedAt: new Date(),
      },
    });

    // H-3: the workspace is provisioned and the request is marked verified above —
    // that state must commit and the success response must return even if billing is
    // down. Plan-profile seeding, Stripe customer/subscription creation and the
    // verification metrics are isolated here so NONE of them can throw a 500 onto a
    // user whose account already works. On failure we log with the request ref
    // (never the raw email) and hand the work to the retry queue.
    const billingPayload: SignupBillingProvisionJobPayload = {
      tenantKey: workspace.tenantId,
      adminEmail: request.adminEmail,
      displayName: request.displayName,
      planTier: "TRIAL",
      signupRequestId: request.id,
    };
    try {
      await this.runSignupBillingProvision(billingPayload, "verify");

      const hoursToVerify = Math.max(0, (Date.now() - new Date(request.createdAt).getTime()) / (60 * 60 * 1000));
      await Promise.all([
        this.emitSignupMetric({
          tenantKey: workspace.tenantId,
          metricKey: "signup.verification_total",
          metricValue: 1,
          tags: {
            source: "public_signup",
          },
        }),
        this.emitSignupMetric({
          tenantKey: workspace.tenantId,
          metricKey: "signup.hours_to_verify",
          metricValue: hoursToVerify,
          unit: "hours",
          tags: {
            source: "public_signup",
          },
        }),
      ]);
    } catch (error: unknown) {
      const code = error instanceof Error ? error.message : String(error ?? "unknown error");
      // Do not log the raw email address — it is PII. Use the request ID for correlation.
      this.logger.error(
        `Public signup billing provisioning deferred to retry queue [ref:${request.id}]: ${code}`,
      );
      await this.enqueueSignupBillingProvisionRetry(billingPayload);
    }

    return {
      ok: true,
      status: "verified",
      workspaceSlug: workspace.workspaceSlug,
      userId: request.adminEmail,
    };
  }

  async resendVerification(adminEmailInput: string, ipAddress: string): Promise<{ ok: true; resent: true }> {
    this.assertFeatureEnabled();
    await this.expirePendingRequests();

    const adminEmail = this.normalizeEmail(adminEmailInput);
    const now = Date.now();
    const ipRetryAfterSeconds = await this.incrementAndCheckIpRateLimit(ipAddress, now);
    if (ipRetryAfterSeconds > 0) {
      throw new SignupRateLimitError(ipRetryAfterSeconds);
    }

    const emailRetryAfterSeconds = await this.incrementAndCheckEmailRateLimit(adminEmail, now);
    if (emailRetryAfterSeconds > 0) {
      throw new SignupRateLimitError(emailRetryAfterSeconds);
    }

    const signupRequests = this.signupRequestStore();
    const signup = await signupRequests.findFirst({
      where: {
        adminEmail,
        status: {
          in: [SIGNUP_STATUS_PENDING, SIGNUP_STATUS_EXPIRED, SIGNUP_STATUS_DELIVERY_FAILED],
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
        status: SIGNUP_STATUS_PENDING,
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
      await this.markSignupRequestDeliveryFailed(signup.id);
      if (code === "EMAIL_PROVIDER_MISCONFIGURED") {
        throw new Error(code);
      }
      this.logger.error(`Public signup verification resend failed [ref:${signup.id}]: ${code}`);
      throw new Error("SIGNUP_VERIFICATION_SEND_FAILED");
    }

    await this.emitSignupMetric({
      tenantKey: signup.workspaceSlug,
      metricKey: "signup.resend_total",
      metricValue: 1,
      tags: {
        source: "public_signup",
      },
    });

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

  private signupRequestStore(client: any = this.prisma.tenant(DEFAULT_TENANT_KEY)): any {
    return client.publicSignupRequest;
  }

  private async expirePendingRequests(now = new Date(), signupRequests = this.signupRequestStore()): Promise<void> {
    await signupRequests.updateMany({
      where: {
        status: SIGNUP_STATUS_PENDING,
        expiresAt: {
          lt: now,
        },
      },
      data: {
        status: SIGNUP_STATUS_EXPIRED,
      },
    });
  }

  private async markSignupRequestDeliveryFailed(signupRequestId: string): Promise<void> {
    if (!String(signupRequestId ?? "").trim()) {
      return;
    }
    try {
      await this.signupRequestStore().updateMany({
        where: {
          id: signupRequestId,
          status: SIGNUP_STATUS_PENDING,
        },
        data: {
          status: SIGNUP_STATUS_DELIVERY_FAILED,
        },
      });
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error ?? "unknown error");
      this.logger.warn(`Unable to mark signup request ${signupRequestId} as delivery_failed: ${reason}`);
    }
  }

  private async sendVerificationEmail(input: {
    adminEmail: string;
    workspaceSlug: string;
    verificationToken: string;
    expiresAt: Date;
  }): Promise<void> {
    const verifyUrl = `${this.resolveWebBaseUrl()}/signup/verify?token=${encodeURIComponent(input.verificationToken)}&email=${encodeURIComponent(input.adminEmail)}&workspace=${encodeURIComponent(input.workspaceSlug)}`;
    const expiryText = formatDateUtc(input.expiresAt);
    const brand = resolveEmailBrandConfig();

    const bodyText =
      `Verify your Vexa PIM workspace to finish setup.\n\n` +
      `Workspace: ${input.workspaceSlug}\n\n` +
      `This link expires ${expiryText}.`;

    const bodyHtml =
      `<p>Verify your Vexa PIM workspace to finish setup.</p>` +
      `<p><strong>Workspace:</strong> ${escapeHtml(input.workspaceSlug)}</p>` +
      `<p>This link expires ${escapeHtml(expiryText)}.</p>`;

    const title = "Verify your Vexa PIM workspace";

    await this.authEmailService.send({
      to: input.adminEmail,
      subject: title,
      from: brand.onboardingFrom || undefined,
      text: renderEmailText({
        ...brand,
        title,
        bodyText,
        bodyHtml,
        ctaLabel: "Verify your workspace",
        ctaUrl: verifyUrl,
        signatureType: "security",
        footerReason: "You received this email because a workspace signup was requested with this address.",
      }),
      html: renderEmailHtml({
        ...brand,
        title,
        preheader: "Finish setting up your Vexa PIM workspace",
        bodyText,
        bodyHtml,
        ctaLabel: "Verify your workspace",
        ctaUrl: verifyUrl,
        signatureType: "security",
        footerReason: "You received this email because a workspace signup was requested with this address.",
      }),
      category: "signup_verification",
      metadata: {
        workspaceSlug: input.workspaceSlug,
      },
    });
  }

  private async emitSignupMetric(input: {
    tenantKey: string;
    metricKey: string;
    metricValue: number;
    unit?: string;
    tags?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.metricsService.emit({
        tenantKey: input.tenantKey,
        metricKey: input.metricKey,
        metricValue: input.metricValue,
        unit: input.unit ?? null,
        tags: input.tags ?? {},
      });
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error ?? "unknown error");
      this.logger.warn(`Signup metrics emission failed for ${input.metricKey}/${input.tenantKey}: ${reason}`);
    }
  }

  /**
   * H-3: the single idempotent billing-provisioning path, shared by the synchronous
   * verify flow and the retry queue consumer. Seeds the tenant plan profile
   * (get-or-create) and creates the Stripe customer/subscription with a stable
   * idempotency key so running it twice yields exactly one customer + subscription.
   * Callers decide how to handle a throw: verify swallows + enqueues, the queue
   * consumer rethrows so BullMQ retries.
   */
  private async runSignupBillingProvision(
    payload: SignupBillingProvisionJobPayload,
    source: "verify" | "retry",
  ): Promise<void> {
    await this.planUsageService.getTenantPlanProfile(payload.tenantKey);

    await this.stripeService.createCustomerAndSubscription({
      tenantKey: payload.tenantKey,
      adminEmail: payload.adminEmail,
      displayName: payload.displayName,
      planTier: payload.planTier,
      idempotencyKey: `signup-trial:${payload.tenantKey}`,
    });
  }

  private async enqueueSignupBillingProvisionRetry(payload: SignupBillingProvisionJobPayload): Promise<void> {
    try {
      await this.queueService.enqueue(QUEUE_NAMES.SIGNUP_BILLING_PROVISION, payload, {
        // Dedup key: at most one in-flight retry per tenant (BullMQ jobId; ignored by
        // the in-memory backend, which is harmless here).
        jobId: `signup-billing:${payload.tenantKey}`,
      });
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error ?? "unknown error");
      this.logger.error(
        `Failed to enqueue signup billing retry [ref:${payload.signupRequestId}]: ${reason}`,
      );
    }
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
    const appEnv = String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "development");
    if (appEnv === "production" || appEnv === "staging") {
      throw new ServiceUnavailableException("Signup rate-limiting service unavailable.");
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
    const appEnv = String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "development");
    if (appEnv === "production" || appEnv === "staging") {
      throw new ServiceUnavailableException("Signup rate-limiting service unavailable.");
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
