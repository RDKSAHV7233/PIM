import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CacheService } from "../common/cache/cache.service";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { PrismaDirectService } from "../prisma/prisma-direct.service";
import { PrismaService } from "../prisma/prisma.service";
import { PLAN_LIMITS } from "./plan-limits.seed";
import { PlanResource } from "./require-plan-limit.decorator";

/** Plan profiles change only on admin billing operations — 5-minute TTL is safe. */
const PLAN_PROFILE_CACHE_TTL_SECONDS = 300;

const PLAN_TIERS = ["TRIAL", "STARTER", "GROWTH", "BUSINESS", "ENTERPRISE"] as const;
const BILLING_STATUSES = ["trial", "active_paid", "past_due", "cancelled", "expired"] as const;
const ACCESS_STATUSES = ["active", "suspended"] as const;
const USAGE_SUMMARY_TTL_MS = 60_000;

type PlanTier = (typeof PLAN_TIERS)[number];
type BillingStatus = (typeof BILLING_STATUSES)[number];
type AccessStatus = (typeof ACCESS_STATUSES)[number];

interface PlanLimitsRow {
  planTier: string;
  maxSkus: number;
  maxSubmissionsPerMonth: number;
  maxUsers: number;
  maxStorageGb: number;
  maxConnectorInstallations: number;
  maxAccountsPerConnector: number;
  maxApiKeys: number;
  maxOutboundWebhooks: number;
  maxImportRowsPerJob: number;
}

interface UsageRow {
  tenantKey: string;
  month: string;
  planTier: string;
  skuCount: number;
  submissionCount: number;
  storageGb: number;
  connectorInstallationsCount: number;
  connectorAccountsCount: number;
  updatedAt: Date | string;
}

interface LatestPlanUsageTierRow {
  planTier: string;
}

interface UsageSummaryReadRow {
  tenantKey: string;
  month: string;
  planTier: string;
  skuCount: number;
  submissionCount: number;
  storageGb: number;
  connectorInstallationsCount: number;
  connectorAccountsCount: number;
  usageUpdatedAt: Date | string;
  maxSkus: number | null;
  maxSubmissionsPerMonth: number | null;
  maxUsers: number | null;
  maxStorageGb: number | null;
  maxConnectorInstallations: number | null;
  maxAccountsPerConnector: number | null;
  maxApiKeys: number | null;
  maxOutboundWebhooks: number | null;
  maxImportRowsPerJob: number | null;
  profileTenantKey: string | null;
  profilePlanTier: string | null;
  profileBillingStatus: string | null;
  profileAccessStatus: string | null;
  profileEffectiveFrom: Date | string | null;
  profileTrialEndsAt: Date | string | null;
  profilePaidThroughAt: Date | string | null;
  profileGraceEndsAt: Date | string | null;
  profileCancelledAt: Date | string | null;
  profileSuspendedAt: Date | string | null;
  profileSuspensionReason: string | null;
  profileBillingContactEmail: string | null;
  profileUpdatedBy: string | null;
  profileCreatedAt: Date | string | null;
  profileUpdatedAt: Date | string | null;
}

interface TenantPlanProfileRow {
  tenantKey: string;
  planTier: string;
  billingStatus: string | null;
  accessStatus: string | null;
  effectiveFrom: Date | string | null;
  trialEndsAt: Date | string | null;
  paidThroughAt: Date | string | null;
  graceEndsAt: Date | string | null;
  cancelledAt: Date | string | null;
  suspendedAt: Date | string | null;
  suspensionReason: string | null;
  billingContactEmail: string | null;
  updatedBy: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface CommercialTenantSearchRow {
  tenantKey: string;
  workspaceSlug: string;
  displayName: string;
  workspaceIsActive: boolean;
  planTier: string | null;
  billingStatus: string | null;
  accessStatus: string | null;
  trialEndsAt: Date | string | null;
  paidThroughAt: Date | string | null;
  graceEndsAt: Date | string | null;
  cancelledAt: Date | string | null;
  suspendedAt: Date | string | null;
  suspensionReason: string | null;
  billingContactEmail: string | null;
  adminEmails: unknown;
}

interface CommercialOverviewRow {
  totalTenants: number;
  activeWorkspaces: number;
  inactiveWorkspaces: number;
  trialPlanTenants: number;
  starterTenants: number;
  growthTenants: number;
  businessTenants: number;
  enterpriseTenants: number;
  trialTenants: number;
  paidTenants: number;
  pastDueTenants: number;
  cancelledTenants: number;
  activeAccessTenants: number;
  suspendedTenants: number;
}

interface CommercialWorkspaceCandidate {
  tenantKey: string;
  workspaceSlug: string;
  displayName: string;
  workspaceIsActive: boolean;
  updatedAt: Date;
}

interface BytesRow {
  bytes: number | bigint | string;
}

interface ConnectorCountsRow {
  installationCount: number;
  maxAccountsPerConnector: number;
}

export interface PlanCheckResult {
  allowed: boolean;
  resource: "skus" | "submissions" | "storage_gb" | "connectors_installations" | "connector_accounts" | "users" | "api_keys" | "outbound_webhooks";
  limit: number;
  current: number;
}

export interface PlanProfileSummary {
  tenantKey: string;
  planTier: string;
  billingStatus: BillingStatus;
  accessStatus: AccessStatus;
  effectiveFrom: string | null;
  trialEndsAt: string | null;
  paidThroughAt: string | null;
  graceEndsAt: string | null;
  cancelledAt: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  billingContactEmail: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlanUsageSummary {
  planTier: string;
  billingStatus: BillingStatus;
  accessStatus: AccessStatus;
  month: string;
  billingCycleResetAt: string;
  skus: {
    current: number;
    limit: number;
  };
  submissions: {
    current: number;
    limit: number;
  };
  storageGb: {
    current: number;
    limit: number;
  };
  users: {
    current: number;
    limit: number;
  };
  connectorsInstallations: {
    current: number;
    limit: number;
  };
  connectorAccounts: {
    current: number;
    limit: number;
  };
  apiKeys: {
    current: number;
    limit: number;
  };
  outboundWebhooks: {
    current: number;
    limit: number;
  };
  importRowsPerJob: {
    limit: number;
  };
  profile: PlanProfileSummary;
}

export interface CommercialTenantSearchResult {
  tenantKey: string;
  workspaceSlug: string;
  displayName: string;
  workspaceIsActive: boolean;
  planTier: string;
  billingStatus: BillingStatus;
  accessStatus: AccessStatus;
  trialEndsAt: string | null;
  paidThroughAt: string | null;
  graceEndsAt: string | null;
  cancelledAt: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  billingContactEmail: string | null;
  adminEmails: string[];
}

export interface CommercialTenantOverview {
  totalTenants: number;
  activeWorkspaces: number;
  inactiveWorkspaces: number;
  planTierCounts: {
    trial: number;
    starter: number;
    growth: number;
    business: number;
    enterprise: number;
  };
  billingStatusCounts: {
    trial: number;
    activePaid: number;
    pastDue: number;
    cancelled: number;
  };
  accessStatusCounts: {
    active: number;
    suspended: number;
  };
}

interface ListCommercialTenantsInternalInput {
  query?: string;
  limit?: number;
}

export interface EnrichedTenantResult extends CommercialTenantSearchResult {
  usage: {
    skuCount: number;
    userCount: number;
    submissionCount: number;
    storageGb: number;
    connectorInstallationsCount: number;
  } | null;
  connectors: Array<{ slug: string; displayName: string; accountCount: number }>;
  createdAt: string;
}

export interface RecentSignupResult {
  id: string;
  displayName: string;
  workspaceSlug: string;
  adminEmail: string;
  status: string;
  createdAt: string;
  verifiedAt: string | null;
}

export interface CommercialTenantDetailUser {
  userId: string;
  identityType: "email" | "external_identifier" | "unknown";
  role: string;
  isActive: boolean;
  isLocked: boolean;
  lockedUntil: string | null;
  createdAt: string;
}

export interface CommercialTenantDetailConnector {
  installationId: string;
  connectorName: string;
  connectorSlug: string;
  status: string;
  createdAt: string;
}

export interface CommercialTenantDetail {
  tenant: {
    tenantKey: string;
    workspaceName: string;
    workspaceSlug: string;
    createdAt: string;
  };
  commercial: {
    planTier: string;
    billingStatus: string;
    accessStatus: string;
    trialEndsAt: string | null;
    paidThroughAt: string | null;
    graceEndsAt: string | null;
    cancelledAt: string | null;
    suspendedAt: string | null;
    suspensionReason: string | null;
    billingContactEmail: string | null;
  };
  usage: {
    skuCount: number;
    userCount: number;
    submissionCount: number;
    storageBytes: number;
  };
  signup: {
    adminEmail: string;
    status: string;
    requestedAt: string;
    verifiedAt: string | null;
  } | null;
  users: {
    items: CommercialTenantDetailUser[];
    total: number;
    limit: number;
    truncated: boolean;
  };
  connectors: {
    items: CommercialTenantDetailConnector[];
    total: number;
    limit: number;
    truncated: boolean;
  };
}

export interface UpdateCommercialStateInput {
  billingStatus?: string;
  accessStatus?: string;
  suspensionReason?: string | null;
  trialEndsAt?: string | null;
  paidThroughAt?: string | null;
  graceEndsAt?: string | null;
  cancelledAt?: string | null;
  suspendedAt?: string | null;
  billingContactEmail?: string | null;
}

@Injectable()
export class PlanUsageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlanUsageService.name);
  private readonly commercialTrialDays = this.resolvePositiveIntegerEnv(process.env.PIM_COMMERCIAL_TRIAL_DAYS, 14);
  private rollupTimeout: NodeJS.Timeout | null = null;
  private rollupInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaDirect: PrismaDirectService,
    private readonly cache: CacheService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedPlanLimits();
    this.startNightlyRollup();
  }

  onModuleDestroy(): void {
    if (this.rollupTimeout) {
      clearTimeout(this.rollupTimeout);
      this.rollupTimeout = null;
    }
    if (this.rollupInterval) {
      clearInterval(this.rollupInterval);
      this.rollupInterval = null;
    }
  }

  async seedPlanLimits(): Promise<void> {
    for (const item of PLAN_LIMITS) {
      await this.prisma.tenant().$executeRaw(Prisma.sql`
        INSERT INTO "PlanLimits" (
          "id",
          "planTier",
          "maxSkus",
          "maxSubmissionsPerMonth",
          "maxUsers",
          "maxStorageGb",
          "maxConnectorInstallations",
          "maxAccountsPerConnector",
          "maxApiKeys",
          "maxOutboundWebhooks",
          "maxImportRowsPerJob",
          "createdAt",
          "updatedAt"
        )
        VALUES (
          ${this.randomId()},
          ${item.planTier},
          ${item.maxSkus},
          ${item.maxSubmissionsPerMonth},
          ${item.maxUsers},
          ${item.maxStorageGb},
          ${item.maxConnectorInstallations},
          ${item.maxAccountsPerConnector},
          ${item.maxApiKeys},
          ${item.maxOutboundWebhooks},
          ${item.maxImportRowsPerJob},
          NOW(),
          NOW()
        )
        ON CONFLICT ("planTier")
        DO UPDATE SET
          "maxSkus" = EXCLUDED."maxSkus",
          "maxSubmissionsPerMonth" = EXCLUDED."maxSubmissionsPerMonth",
          "maxUsers" = EXCLUDED."maxUsers",
          "maxStorageGb" = EXCLUDED."maxStorageGb",
          "maxConnectorInstallations" = EXCLUDED."maxConnectorInstallations",
          "maxAccountsPerConnector" = EXCLUDED."maxAccountsPerConnector",
          "maxApiKeys" = EXCLUDED."maxApiKeys",
          "maxOutboundWebhooks" = EXCLUDED."maxOutboundWebhooks",
          "maxImportRowsPerJob" = EXCLUDED."maxImportRowsPerJob",
          "updatedAt" = NOW()
      `);
    }
  }

  async touchUsageForCurrentTenant(): Promise<UsageRow> {
    const tenantKey = normalizeTenantKey(getTenantKeyFromContext());
    return this.recomputeUsage(tenantKey);
  }

  async getTenantPlanTier(tenantKeyInput: string): Promise<PlanTier> {
    const tenantKey = normalizeTenantKey(tenantKeyInput);
    const profile = await this.prisma
      .tenant(tenantKey)
      .tenantPlanProfile.findUnique({
        where: { tenantKey },
        select: { planTier: true },
      });
    return this.normalizePlanTier(profile?.planTier ?? "TRIAL");
  }

  async getImportRowLimit(tenantKeyInput: string): Promise<number> {
    const tenantKey = normalizeTenantKey(tenantKeyInput);
    const planTier = await this.getTenantPlanTier(tenantKey);
    const limits = await this.getPlanLimits(planTier);
    return limits.maxImportRowsPerJob;
  }

  async checkLimit(
    resource: PlanResource,
    requestDelta = 1,
    tenantKeyInput?: string,
    options?: { connectorSlug?: string },
  ): Promise<PlanCheckResult> {
    const tenantKey = normalizeTenantKey(tenantKeyInput ?? getTenantKeyFromContext());

    // Expired workspaces (trial ended without upgrade) are hard-blocked from all
    // resource creation — returning limit=0 / current=1 so the guard throws 402.
    const profile = await this.getOrCreateTenantPlanProfile(tenantKey);
    if (profile.billingStatus === "expired") {
      return { allowed: false, resource, limit: 0, current: 1 };
    }

    const usage = await this.recomputeUsage(tenantKey);
    const limits = await this.getPlanLimits(usage.planTier);

    if (resource === "skus") {
      const current = usage.skuCount + requestDelta;
      return {
        allowed: current <= limits.maxSkus,
        resource: "skus",
        limit: limits.maxSkus,
        current,
      };
    }

    if (resource === "submissions") {
      const current = usage.submissionCount + requestDelta;
      return {
        allowed: current <= limits.maxSubmissionsPerMonth,
        resource: "submissions",
        limit: limits.maxSubmissionsPerMonth,
        current,
      };
    }

    if (resource === "connectors_installations") {
      const current = usage.connectorInstallationsCount + requestDelta;
      return {
        allowed: current <= limits.maxConnectorInstallations,
        resource: "connectors_installations",
        limit: limits.maxConnectorInstallations,
        current,
      };
    }

    if (resource === "connector_accounts") {
      const scopedConnectorSlug = String(options?.connectorSlug ?? "").trim().toLowerCase();
      const current = scopedConnectorSlug
        ? (await this.getConnectorAccountCount(tenantKey, scopedConnectorSlug)) + requestDelta
        : usage.connectorAccountsCount + requestDelta;

      return {
        allowed: current <= limits.maxAccountsPerConnector,
        resource: "connector_accounts",
        limit: limits.maxAccountsPerConnector,
        current,
      };
    }

    if (resource === "users") {
      // User count is not stored in PlanUsage — always fetch live to avoid stale data
      // on the create-user hot path where accuracy matters most.
      const liveCount = await this.prisma
        .tenant(tenantKey)
        .authIdentity.count({ where: { isActive: true } });
      const current = liveCount + requestDelta;
      return {
        allowed: current <= limits.maxUsers,
        resource: "users",
        limit: limits.maxUsers,
        current,
      };
    }

    if (resource === "api_keys") {
      const liveCount = await this.prisma.tenant(tenantKey).apiAccessKey.count({
        where: { revokedAt: null },
      });
      const current = liveCount + requestDelta;
      return {
        allowed: current <= limits.maxApiKeys,
        resource: "api_keys",
        limit: limits.maxApiKeys,
        current,
      };
    }

    if (resource === "outbound_webhooks") {
      const liveCount = await this.prisma.tenant(tenantKey).outboundWebhookEndpoint.count({
        where: { isActive: true },
      });
      const current = liveCount + requestDelta;
      return {
        allowed: current <= limits.maxOutboundWebhooks,
        resource: "outbound_webhooks",
        limit: limits.maxOutboundWebhooks,
        current,
      };
    }

    const current = usage.storageGb + requestDelta;
    return {
      allowed: current <= limits.maxStorageGb,
      resource: "storage_gb",
      limit: limits.maxStorageGb,
      current: Number(current.toFixed(6)),
    };
  }

  /**
   * Batch install-plan check for multiple connector slugs.
   * Calls recomputeUsage + getPlanLimits once, then getConnectorAccountCount
   * in parallel — replacing N×2 sequential queries with 2 + N parallel queries.
   */
  async checkInstallLimitBatch(
    slugs: string[],
    tenantKeyInput: string,
  ): Promise<Map<string, { allowed: boolean; reason: string | null }>> {
    const tenantKey = normalizeTenantKey(tenantKeyInput);
    const result = new Map<string, { allowed: boolean; reason: string | null }>();
    if (slugs.length === 0) return result;

    const usage = await this.recomputeUsage(tenantKey);
    const limits = await this.getPlanLimits(usage.planTier);

    // Global installation cap — same answer for every slug
    if (usage.connectorInstallationsCount + 1 > limits.maxConnectorInstallations) {
      for (const slug of slugs) {
        result.set(slug, { allowed: false, reason: "PLAN_CONNECTOR_INSTALLATIONS_LIMIT_EXCEEDED" });
      }
      return result;
    }

    // Per-slug account cap — independent queries, run in parallel
    const accountCounts = await Promise.all(
      slugs.map((slug) => this.getConnectorAccountCount(tenantKey, slug)),
    );

    for (let i = 0; i < slugs.length; i++) {
      if (accountCounts[i] + 1 > limits.maxAccountsPerConnector) {
        result.set(slugs[i], { allowed: false, reason: "PLAN_CONNECTOR_ACCOUNTS_LIMIT_EXCEEDED" });
      } else {
        result.set(slugs[i], { allowed: true, reason: null });
      }
    }

    return result;
  }

  async getUsageSummary(tenantKeyInput?: string): Promise<PlanUsageSummary> {
    const tenantKey = normalizeTenantKey(tenantKeyInput ?? getTenantKeyFromContext());
    const month = this.getMonthKey();

    const [warmSummaryRow, liveUserCount, liveApiKeyCount, liveWebhookCount] = await Promise.all([
      this.getUsageSummaryRow(tenantKey, month),
      this.prisma
        .tenant(tenantKey)
        .authIdentity.count({ where: { isActive: true } })
        .catch(() => 1),
      this.prisma
        .tenant(tenantKey)
        .apiAccessKey.count({ where: { revokedAt: null } })
        .catch(() => 0),
      this.prisma
        .tenant(tenantKey)
        .outboundWebhookEndpoint.count({ where: { isActive: true } })
        .catch(() => 0),
    ]);

    let summary: PlanUsageSummary;
    if (this.isUsageSummaryRowFresh(warmSummaryRow)) {
      summary = this.buildUsageSummary(
        tenantKey,
        this.mapUsageSummaryRowToUsage(warmSummaryRow),
        this.mapUsageSummaryRowToLimits(warmSummaryRow),
        this.mapUsageSummaryRowToProfile(warmSummaryRow),
      );
    } else {
      const [cachedUsage, profile] = await Promise.all([
        this.getUsageRow(tenantKey, month),
        this.getOrCreateTenantPlanProfile(tenantKey),
      ]);
      const usage = this.isUsageRowFresh(cachedUsage)
        ? cachedUsage
        : await this.recomputeUsage(tenantKey, { month, profile });
      const limits = await this.getPlanLimits(usage.planTier);
      summary = this.buildUsageSummary(tenantKey, usage, limits, profile);
    }

    return {
      ...summary,
      users: { current: liveUserCount, limit: summary.users.limit },
      apiKeys: { current: liveApiKeyCount, limit: summary.apiKeys.limit },
      outboundWebhooks: { current: liveWebhookCount, limit: summary.outboundWebhooks.limit },
    };
  }

  async getTenantPlanProfile(tenantKeyInput?: string): Promise<PlanProfileSummary> {
    const tenantKey = normalizeTenantKey(tenantKeyInput ?? getTenantKeyFromContext());
    const databaseUrl = String(process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL ?? "").trim();
    if (!databaseUrl) {
      const now = new Date().toISOString();
      return {
        tenantKey,
        planTier: "STARTER",
        billingStatus: "active_paid",
        accessStatus: "active",
        effectiveFrom: now,
        trialEndsAt: null,
        paidThroughAt: null,
        graceEndsAt: null,
        cancelledAt: null,
        suspendedAt: null,
        suspensionReason: null,
        billingContactEmail: null,
        updatedBy: null,
        createdAt: now,
        updatedAt: now,
      };
    }
    return this.cache.getOrSet(
      `plan:profile:${tenantKey}`,
      PLAN_PROFILE_CACHE_TTL_SECONDS,
      () => this.getOrCreateTenantPlanProfile(tenantKey),
    );
  }

  async setTenantPlanTier(
    planTierInput: string,
    actorId: string,
  ): Promise<PlanProfileSummary> {
    return this.setTenantPlanTierForTenant(getTenantKeyFromContext(), planTierInput, actorId);
  }

  async setTenantPlanTierForTenant(
    tenantKeyInput: string,
    planTierInput: string,
    actorId: string,
  ): Promise<PlanProfileSummary> {
    const rawTenantKey = String(tenantKeyInput ?? "").trim();
    if (!rawTenantKey) {
      throw new Error("TENANT_KEY_REQUIRED");
    }
    const tenantKey = normalizeTenantKey(rawTenantKey);
    const planTier = this.normalizePlanTier(planTierInput);
    const current = await this.getOrCreateTenantPlanProfile(tenantKey);
    const nextBillingStatus =
      current.billingStatus === "trial" && planTier !== "STARTER" ? "active_paid" : current.billingStatus;
    const nextTrialEndsAt =
      nextBillingStatus === "trial"
        ? current.trialEndsAt
          ? new Date(current.trialEndsAt)
          : this.buildTrialEndsAt()
        : null;

    await this.prisma.tenant(tenantKey).$executeRaw(Prisma.sql`
      INSERT INTO "TenantPlanProfile"
        ("id", "tenantKey", "planTier", "billingStatus", "accessStatus", "effectiveFrom", "trialEndsAt", "billingContactEmail", "updatedBy", "createdAt", "updatedAt")
      VALUES
        (${this.randomId()}, ${tenantKey}, ${planTier}, ${nextBillingStatus}, ${current.accessStatus}, NOW(), ${nextTrialEndsAt}, ${current.billingContactEmail}, ${actorId}, NOW(), NOW())
      ON CONFLICT ("tenantKey")
      DO UPDATE SET
        "planTier" = EXCLUDED."planTier",
        "billingStatus" = EXCLUDED."billingStatus",
        "effectiveFrom" = NOW(),
        "trialEndsAt" = EXCLUDED."trialEndsAt",
        "billingContactEmail" = EXCLUDED."billingContactEmail",
        "updatedBy" = EXCLUDED."updatedBy",
        "updatedAt" = NOW()
    `);

    await this.recomputeUsage(tenantKey);
    await this.cache.invalidate(`plan:profile:${tenantKey}`);
    return this.getOrCreateTenantPlanProfile(tenantKey);
  }

  async updateCommercialStateForTenant(
    tenantKeyInput: string,
    input: UpdateCommercialStateInput,
    actorId: string,
  ): Promise<PlanProfileSummary> {
    const rawTenantKey = String(tenantKeyInput ?? "").trim();
    if (!rawTenantKey) {
      throw new Error("TENANT_KEY_REQUIRED");
    }
    const hasBillingStatus = input.billingStatus !== undefined && input.billingStatus !== null;
    const hasAccessStatus = input.accessStatus !== undefined && input.accessStatus !== null;
    const hasDateMutation = [
      input.trialEndsAt,
      input.paidThroughAt,
      input.graceEndsAt,
      input.cancelledAt,
      input.suspendedAt,
    ].some((value) => value !== undefined);
    const hasSuspensionReason = input.suspensionReason !== undefined && input.suspensionReason !== null;
    const hasBillingContactMutation = input.billingContactEmail !== undefined;
    if (!hasBillingStatus && !hasAccessStatus && !hasDateMutation && !hasSuspensionReason && !hasBillingContactMutation) {
      throw new Error("COMMERCIAL_STATE_CHANGE_REQUIRED");
    }

    const tenantKey = normalizeTenantKey(rawTenantKey);
    const current = await this.getOrCreateTenantPlanProfile(tenantKey);
    const currentPlanTier = this.normalizePlanTier(current.planTier);
    const nextBillingStatus = hasBillingStatus
      ? this.normalizeBillingStatus(input.billingStatus, currentPlanTier)
      : current.billingStatus;
    const nextAccessStatus = hasAccessStatus
      ? this.normalizeAccessStatus(input.accessStatus)
      : current.accessStatus;
    const providedReason = String(input.suspensionReason ?? "").trim();
    const nextSuspensionReason =
      nextAccessStatus === "suspended"
        ? providedReason || current.suspensionReason || "commercial_control"
        : null;
    const nextBillingContactEmail =
      input.billingContactEmail !== undefined
        ? this.normalizeOptionalEmail(input.billingContactEmail)
        : current.billingContactEmail;
    const nextSuspendedAt =
      input.suspendedAt !== undefined
        ? this.parseOptionalDate(input.suspendedAt, "suspendedAt")
        : nextAccessStatus === "suspended"
          ? current.suspendedAt
            ? new Date(current.suspendedAt)
            : new Date()
          : null;
    const nextTrialEndsAt =
      input.trialEndsAt !== undefined
        ? this.parseOptionalDate(input.trialEndsAt, "trialEndsAt")
        : nextBillingStatus === "trial"
          ? current.trialEndsAt
            ? new Date(current.trialEndsAt)
            : this.buildTrialEndsAt()
          : null;
    const nextPaidThroughAt =
      input.paidThroughAt !== undefined
        ? this.parseOptionalDate(input.paidThroughAt, "paidThroughAt")
        : nextBillingStatus === "cancelled"
          ? current.paidThroughAt
            ? new Date(current.paidThroughAt)
            : null
          : null;
    const nextGraceEndsAt =
      input.graceEndsAt !== undefined
        ? this.parseOptionalDate(input.graceEndsAt, "graceEndsAt")
        : nextBillingStatus === "past_due"
          ? current.graceEndsAt
            ? new Date(current.graceEndsAt)
            : null
          : null;
    const nextCancelledAt =
      input.cancelledAt !== undefined
        ? this.parseOptionalDate(input.cancelledAt, "cancelledAt")
        : nextBillingStatus === "cancelled"
          ? current.cancelledAt
            ? new Date(current.cancelledAt)
            : new Date()
          : null;

    await this.prisma.tenant(tenantKey).$executeRaw(Prisma.sql`
      UPDATE "TenantPlanProfile"
      SET
        "billingStatus" = ${nextBillingStatus},
        "accessStatus" = ${nextAccessStatus},
        "trialEndsAt" = ${nextTrialEndsAt},
        "paidThroughAt" = ${nextPaidThroughAt},
        "graceEndsAt" = ${nextGraceEndsAt},
        "cancelledAt" = ${nextCancelledAt},
        "suspendedAt" = ${nextSuspendedAt},
        "suspensionReason" = ${nextSuspensionReason},
        "billingContactEmail" = ${nextBillingContactEmail},
        "updatedBy" = ${actorId},
        "updatedAt" = NOW()
      WHERE "tenantKey" = ${tenantKey}
    `);

    await this.cache.invalidate(`plan:profile:${tenantKey}`);
    return this.getOrCreateTenantPlanProfile(tenantKey);
  }

  async searchCommercialTenants(queryInput: string, limitInput?: number): Promise<CommercialTenantSearchResult[]> {
    const query = String(queryInput ?? "").trim();
    if (!query) {
      throw new Error("TENANT_SEARCH_QUERY_REQUIRED");
    }
    if (query.length < 2) {
      throw new Error("TENANT_SEARCH_QUERY_TOO_SHORT");
    }

    const normalizedLimit = Number.isFinite(limitInput) ? Math.trunc(Number(limitInput)) : 10;
    const limit = Math.max(1, Math.min(normalizedLimit || 10, 25));
    return this.listCommercialTenantsInternal({
      query,
      limit,
    });
  }

  async listCommercialTenantsInternal(input?: ListCommercialTenantsInternalInput): Promise<CommercialTenantSearchResult[]> {
    const query = String(input?.query ?? "").trim();
    const normalizedLimit = Number.isFinite(input?.limit) ? Math.trunc(Number(input?.limit)) : 50;
    const limit = Math.max(1, Math.min(normalizedLimit || 50, 250));
    const exactQuery = query.toLowerCase();
    const hasQuery = query.length >= 2;
    const matchingAdminTenantKeys = hasQuery
      ? await this.findCommercialAdminMatchTenantKeys(query)
      : new Set<string>();

    const workspaceCandidates = await this.prismaDirect.getClient().workspaceDirectory.findMany({
      where: hasQuery
        ? {
            OR: [
              { tenantKey: { equals: query, mode: "insensitive" } },
              { workspaceSlug: { equals: query, mode: "insensitive" } },
              { displayName: { equals: query, mode: "insensitive" } },
              { tenantKey: { contains: query, mode: "insensitive" } },
              { workspaceSlug: { contains: query, mode: "insensitive" } },
              { displayName: { contains: query, mode: "insensitive" } },
              ...(matchingAdminTenantKeys.size > 0
                ? [{ tenantKey: { in: Array.from(matchingAdminTenantKeys) } }]
                : []),
            ],
          }
        : undefined,
      select: {
        tenantKey: true,
        workspaceSlug: true,
        displayName: true,
        isActive: true,
        updatedAt: true,
      },
      // Generous cap — ranking + slicing happens in-memory below. limit max is 250.
      take: 2_500,
    });

    const rows = await this.buildCommercialTenantRows(
      workspaceCandidates.map((workspace) => ({
        tenantKey: workspace.tenantKey,
        workspaceSlug: workspace.workspaceSlug,
        displayName: workspace.displayName,
        workspaceIsActive: workspace.isActive,
        updatedAt: workspace.updatedAt,
      })),
    );

    return rows
      .sort((left, right) => {
        const rankDiff =
          this.rankCommercialTenantMatch(left, exactQuery, query, hasQuery, matchingAdminTenantKeys) -
          this.rankCommercialTenantMatch(right, exactQuery, query, hasQuery, matchingAdminTenantKeys);
        if (rankDiff !== 0) {
          return rankDiff;
        }
        const updatedAtDiff = Date.parse(right.updatedAt.toISOString()) - Date.parse(left.updatedAt.toISOString());
        if (updatedAtDiff !== 0) {
          return updatedAtDiff;
        }
        return left.tenantKey.localeCompare(right.tenantKey);
      })
      .slice(0, limit)
      .map((row) => this.mapCommercialTenantSearchRow(row));
  }

  async exportCommercialTenantsCsvInternal(input?: ListCommercialTenantsInternalInput): Promise<string> {
    const items = await this.listCommercialTenantsInternal({
      query: input?.query,
      limit: input?.limit ?? 250,
    });
    const lines = [
      [
        "tenantKey",
        "workspaceSlug",
        "displayName",
        "workspaceIsActive",
        "planTier",
        "billingStatus",
        "accessStatus",
        "trialEndsAt",
        "paidThroughAt",
        "graceEndsAt",
        "cancelledAt",
        "suspendedAt",
        "suspensionReason",
        "billingContactEmail",
        "adminEmails",
      ].join(","),
      ...items.map((item) =>
        [
          item.tenantKey,
          item.workspaceSlug,
          item.displayName,
          item.workspaceIsActive ? "true" : "false",
          item.planTier,
          item.billingStatus,
          item.accessStatus,
          item.trialEndsAt ?? "",
          item.paidThroughAt ?? "",
          item.graceEndsAt ?? "",
          item.cancelledAt ?? "",
          item.suspendedAt ?? "",
          item.suspensionReason ?? "",
          item.billingContactEmail ?? "",
          item.adminEmails.join("; "),
        ]
          .map((value) => this.csvCell(value))
          .join(","),
      ),
    ];
    return `${lines.join("\n")}\n`;
  }

  async listEnrichedTenants(filters?: {
    planTier?: string;
    billingStatus?: string;
    limit?: number;
  }): Promise<EnrichedTenantResult[]> {
    const limit = Math.max(1, Math.min(filters?.limit ?? 50, 100));
    const db = this.prismaDirect.getClient();
    const month = this.getMonthKey();

    // Step 1: Resolve tenant keys that match plan/billing filters (DB-level).
    const hasFilters = !!(filters?.planTier || filters?.billingStatus);
    let filteredTenantKeys: string[] | null = null;
    if (hasFilters) {
      const profileWhere: Record<string, unknown> = {};
      if (filters?.planTier) profileWhere.planTier = filters.planTier.toUpperCase();
      if (filters?.billingStatus) profileWhere.billingStatus = filters.billingStatus.toLowerCase();
      const matchingProfiles = await db.tenantPlanProfile.findMany({
        where: profileWhere,
        select: { tenantKey: true },
        take: limit,
      });
      filteredTenantKeys = matchingProfiles.map((p) => normalizeTenantKey(p.tenantKey));
      if (filteredTenantKeys.length === 0) return [];
    }

    // Step 2: Fetch workspaces (bounded by filter set or global limit).
    const workspaces = await db.workspaceDirectory.findMany({
      where: filteredTenantKeys ? { tenantKey: { in: filteredTenantKeys } } : undefined,
      select: { tenantKey: true, workspaceSlug: true, displayName: true, isActive: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: filteredTenantKeys ? filteredTenantKeys.length : limit,
    });
    if (workspaces.length === 0) return [];

    const tenantKeys = workspaces.map((w) => normalizeTenantKey(w.tenantKey)).slice(0, limit);

    // Step 3: Batch-enrich with profiles, usage, connectors, admin emails, and user counts.
    const [profiles, usageRows, connectorRows, adminIdentities, userCounts] = await Promise.all([
      db.tenantPlanProfile.findMany({
        where: { tenantKey: { in: tenantKeys } },
        select: {
          tenantKey: true, planTier: true, billingStatus: true, accessStatus: true,
          trialEndsAt: true, paidThroughAt: true, graceEndsAt: true, cancelledAt: true,
          suspendedAt: true, suspensionReason: true, billingContactEmail: true,
        },
      }),
      db.planUsage.findMany({
        where: { tenantKey: { in: tenantKeys }, month },
        select: {
          tenantKey: true, skuCount: true, submissionCount: true,
          storageGb: true, connectorInstallationsCount: true,
        },
      }),
      db.$queryRaw<
        Array<{ tenantKey: string; slug: string; displayName: string; accountCount: number }>
      >`
        SELECT
          ci.tenant_key AS "tenantKey",
          cd.slug AS slug,
          cd.display_name AS "displayName",
          COUNT(*)::int AS "accountCount"
        FROM connector_installations ci
        JOIN connector_definitions cd ON cd.id = ci.connector_id
        WHERE ci.tenant_key = ANY(${tenantKeys}::text[])
          AND ci.status <> 'DISABLED'
        GROUP BY ci.tenant_key, cd.slug, cd.display_name
        ORDER BY ci.tenant_key, "accountCount" DESC
      `,
      db.authIdentity.findMany({
        where: { tenantKey: { in: tenantKeys }, role: { equals: "admin", mode: "insensitive" }, isActive: true },
        select: { tenantKey: true, userId: true },
        take: Math.max(tenantKeys.length * 5, 100),
      }),
      db.authIdentity.groupBy({
        by: ["tenantKey"],
        where: { tenantKey: { in: tenantKeys }, isActive: true },
        _count: true,
      }),
    ]);

    const profileMap = new Map(profiles.map((p) => [normalizeTenantKey(p.tenantKey), p]));
    const usageMap = new Map(usageRows.map((r) => [normalizeTenantKey(r.tenantKey), r]));
    const connectorMap = new Map<string, Array<{ slug: string; displayName: string; accountCount: number }>>();
    for (const row of connectorRows) {
      const key = normalizeTenantKey(row.tenantKey);
      const list = connectorMap.get(key) ?? [];
      list.push({ slug: row.slug, displayName: row.displayName, accountCount: row.accountCount });
      connectorMap.set(key, list);
    }
    const adminMap = new Map<string, string[]>();
    for (const identity of adminIdentities) {
      const key = normalizeTenantKey(identity.tenantKey);
      const list = adminMap.get(key) ?? [];
      if (list.length < 5) list.push(String(identity.userId ?? "").trim().toLowerCase());
      adminMap.set(key, list);
    }
    const userCountMap = new Map(
      userCounts.map((r) => [normalizeTenantKey(r.tenantKey), r._count]),
    );

    return workspaces.slice(0, limit).map((w) => {
      const tk = normalizeTenantKey(w.tenantKey);
      const profile = profileMap.get(tk);
      const planTier = this.normalizePlanTier(profile?.planTier ?? "TRIAL");
      const usageRow = usageMap.get(tk);
      return {
        tenantKey: tk,
        workspaceSlug: w.workspaceSlug,
        displayName: w.displayName,
        workspaceIsActive: w.isActive,
        planTier,
        billingStatus: this.normalizeBillingStatus(profile?.billingStatus ?? null, planTier),
        accessStatus: this.normalizeAccessStatus(profile?.accessStatus ?? null),
        trialEndsAt: this.toIsoString(profile?.trialEndsAt ?? null),
        paidThroughAt: this.toIsoString(profile?.paidThroughAt ?? null),
        graceEndsAt: this.toIsoString(profile?.graceEndsAt ?? null),
        cancelledAt: this.toIsoString(profile?.cancelledAt ?? null),
        suspendedAt: this.toIsoString(profile?.suspendedAt ?? null),
        suspensionReason: profile?.suspensionReason ? String(profile.suspensionReason).trim() || null : null,
        billingContactEmail: this.normalizeOptionalEmail(profile?.billingContactEmail ?? null),
        adminEmails: adminMap.get(tk) ?? [],
        usage: usageRow
          ? {
              skuCount: usageRow.skuCount,
              userCount: userCountMap.get(tk) ?? 0,
              submissionCount: usageRow.submissionCount,
              storageGb: Number(usageRow.storageGb.toFixed(2)),
              connectorInstallationsCount: usageRow.connectorInstallationsCount,
            }
          : null,
        connectors: connectorMap.get(tk) ?? [],
        createdAt: w.createdAt.toISOString(),
      };
    });
  }

  async listRecentSignups(limitInput?: number): Promise<RecentSignupResult[]> {
    const limit = Math.max(1, Math.min(limitInput ?? 20, 50));
    const db = this.prismaDirect.getClient();
    const rows = await db.publicSignupRequest.findMany({
      select: {
        id: true,
        displayName: true,
        workspaceSlug: true,
        adminEmail: true,
        status: true,
        createdAt: true,
        verifiedAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return rows.map((r) => ({
      id: r.id,
      displayName: r.displayName,
      workspaceSlug: r.workspaceSlug,
      adminEmail: r.adminEmail,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      verifiedAt: r.verifiedAt?.toISOString() ?? null,
    }));
  }

  async getTenantDetail(tenantKeyInput: string): Promise<CommercialTenantDetail | null> {
    const tenantKey = normalizeTenantKey(tenantKeyInput);
    const db = this.prismaDirect.getClient();
    const month = this.getMonthKey();

    const workspace = await db.workspaceDirectory.findUnique({
      where: { tenantKey },
      select: { tenantKey: true, displayName: true, workspaceSlug: true, createdAt: true },
    });
    if (!workspace) return null;

    const USER_LIMIT = 200;
    const CONNECTOR_LIMIT = 50;

    const [profile, usageRow, signupRow, userRows, userTotal, connectorRows, connectorTotal] = await Promise.all([
      db.tenantPlanProfile.findFirst({
        where: { tenantKey },
        select: {
          planTier: true, billingStatus: true, accessStatus: true,
          trialEndsAt: true, paidThroughAt: true, graceEndsAt: true,
          cancelledAt: true, suspendedAt: true, suspensionReason: true,
          billingContactEmail: true,
        },
      }),
      db.planUsage.findFirst({
        where: { tenantKey, month },
        select: { skuCount: true, submissionCount: true, storageGb: true },
      }),
      db.publicSignupRequest.findFirst({
        where: { workspaceSlug: workspace.workspaceSlug },
        select: { adminEmail: true, status: true, createdAt: true, verifiedAt: true },
        orderBy: { createdAt: "desc" },
      }),
      db.authIdentity.findMany({
        where: { tenantKey },
        select: { userId: true, role: true, isActive: true, lockedUntil: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: USER_LIMIT,
      }),
      db.authIdentity.count({ where: { tenantKey } }),
      db.$queryRaw<Array<{
        installationId: string;
        connectorName: string;
        connectorSlug: string;
        status: string;
        createdAt: Date;
      }>>`
        SELECT
          ci.id AS "installationId",
          cd.display_name AS "connectorName",
          cd.slug AS "connectorSlug",
          ci.status AS "status",
          ci.created_at AS "createdAt"
        FROM connector_installations ci
        JOIN connector_definitions cd ON cd.id = ci.connector_id
        WHERE ci.tenant_key = ${tenantKey}
        ORDER BY ci.created_at DESC
        LIMIT ${CONNECTOR_LIMIT}
      `,
      db.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS "count"
        FROM connector_installations
        WHERE tenant_key = ${tenantKey}
      `,
    ]);

    const now = new Date();
    const planTier = this.normalizePlanTier(profile?.planTier ?? "TRIAL");

    return {
      tenant: {
        tenantKey,
        workspaceName: workspace.displayName,
        workspaceSlug: workspace.workspaceSlug,
        createdAt: workspace.createdAt.toISOString(),
      },
      commercial: {
        planTier,
        billingStatus: this.normalizeBillingStatus(profile?.billingStatus ?? null, planTier),
        accessStatus: this.normalizeAccessStatus(profile?.accessStatus ?? null),
        trialEndsAt: this.toIsoString(profile?.trialEndsAt ?? null),
        paidThroughAt: this.toIsoString(profile?.paidThroughAt ?? null),
        graceEndsAt: this.toIsoString(profile?.graceEndsAt ?? null),
        cancelledAt: this.toIsoString(profile?.cancelledAt ?? null),
        suspendedAt: this.toIsoString(profile?.suspendedAt ?? null),
        suspensionReason: profile?.suspensionReason ? String(profile.suspensionReason).trim() || null : null,
        billingContactEmail: this.normalizeOptionalEmail(profile?.billingContactEmail ?? null),
      },
      usage: {
        skuCount: usageRow?.skuCount ?? 0,
        userCount: userTotal,
        submissionCount: usageRow?.submissionCount ?? 0,
        storageBytes: Math.round((usageRow?.storageGb ?? 0) * 1024 * 1024 * 1024),
      },
      signup: signupRow
        ? {
            adminEmail: signupRow.adminEmail,
            status: signupRow.status,
            requestedAt: signupRow.createdAt.toISOString(),
            verifiedAt: signupRow.verifiedAt?.toISOString() ?? null,
          }
        : null,
      users: {
        items: userRows.map((u) => {
          const lockedUntil = u.lockedUntil ? new Date(u.lockedUntil) : null;
          const isLocked = lockedUntil !== null && lockedUntil > now;
          return {
            userId: String(u.userId ?? ""),
            identityType: this.classifyIdentityType(String(u.userId ?? "")),
            role: String(u.role ?? "viewer"),
            isActive: Boolean(u.isActive),
            isLocked,
            lockedUntil: isLocked ? lockedUntil.toISOString() : null,
            createdAt: u.createdAt.toISOString(),
          };
        }),
        total: userTotal,
        limit: USER_LIMIT,
        truncated: userTotal > USER_LIMIT,
      },
      connectors: {
        items: connectorRows.map((c) => ({
          installationId: c.installationId,
          connectorName: c.connectorName,
          connectorSlug: c.connectorSlug,
          status: c.status,
          createdAt: new Date(c.createdAt).toISOString(),
        })),
        total: connectorTotal[0]?.count ?? 0,
        limit: CONNECTOR_LIMIT,
        truncated: (connectorTotal[0]?.count ?? 0) > CONNECTOR_LIMIT,
      },
    };
  }

  async getCommercialTenantOverview(): Promise<CommercialTenantOverview> {
    const workspaces = await this.prismaDirect.getClient().workspaceDirectory.findMany({
      select: {
        tenantKey: true,
        workspaceSlug: true,
        displayName: true,
        isActive: true,
        updatedAt: true,
      },
      // Safety cap — counts are sampled above this threshold on very large deployments.
      take: 10_000,
    });
    const rows = await this.buildCommercialTenantRows(
      workspaces.map((workspace) => ({
        tenantKey: workspace.tenantKey,
        workspaceSlug: workspace.workspaceSlug,
        displayName: workspace.displayName,
        workspaceIsActive: workspace.isActive,
        updatedAt: workspace.updatedAt,
      })),
    );
    const row = rows.reduce<CommercialOverviewRow>(
      (acc, item) => {
        acc.totalTenants += 1;
        if (item.workspaceIsActive) {
          acc.activeWorkspaces += 1;
        } else {
          acc.inactiveWorkspaces += 1;
        }
        const planTier = this.normalizePlanTier(item.planTier ?? "TRIAL");
        if (planTier === "TRIAL") {
          acc.trialPlanTenants += 1;
        } else if (planTier === "STARTER") {
          acc.starterTenants += 1;
        } else if (planTier === "GROWTH") {
          acc.growthTenants += 1;
        } else if (planTier === "BUSINESS") {
          acc.businessTenants += 1;
        } else {
          acc.enterpriseTenants += 1;
        }
        const billingStatus = this.normalizeBillingStatus(item.billingStatus, planTier);
        if (billingStatus === "trial") {
          acc.trialTenants += 1;
        } else if (billingStatus === "active_paid") {
          acc.paidTenants += 1;
        } else if (billingStatus === "past_due") {
          acc.pastDueTenants += 1;
        } else {
          acc.cancelledTenants += 1;
        }
        const accessStatus = this.normalizeAccessStatus(item.accessStatus);
        if (accessStatus === "suspended") {
          acc.suspendedTenants += 1;
        } else {
          acc.activeAccessTenants += 1;
        }
        return acc;
      },
      {
        totalTenants: 0,
        activeWorkspaces: 0,
        inactiveWorkspaces: 0,
        trialPlanTenants: 0,
        starterTenants: 0,
        growthTenants: 0,
        businessTenants: 0,
        enterpriseTenants: 0,
        trialTenants: 0,
        paidTenants: 0,
        pastDueTenants: 0,
        cancelledTenants: 0,
        activeAccessTenants: 0,
        suspendedTenants: 0,
      },
    );
    return {
      totalTenants: Number(row.totalTenants ?? 0),
      activeWorkspaces: Number(row.activeWorkspaces ?? 0),
      inactiveWorkspaces: Number(row.inactiveWorkspaces ?? 0),
      planTierCounts: {
        trial: Number(row.trialPlanTenants ?? 0),
        starter: Number(row.starterTenants ?? 0),
        growth: Number(row.growthTenants ?? 0),
        business: Number(row.businessTenants ?? 0),
        enterprise: Number(row.enterpriseTenants ?? 0),
      },
      billingStatusCounts: {
        trial: Number(row.trialTenants ?? 0),
        activePaid: Number(row.paidTenants ?? 0),
        pastDue: Number(row.pastDueTenants ?? 0),
        cancelled: Number(row.cancelledTenants ?? 0),
      },
      accessStatusCounts: {
        active: Number(row.activeAccessTenants ?? 0),
        suspended: Number(row.suspendedTenants ?? 0),
      },
    };
  }

  async recomputeUsage(
    tenantKeyInput?: string,
    options?: {
      month?: string;
      profile?: PlanProfileSummary;
    },
  ): Promise<UsageRow> {
    const tenantKey = normalizeTenantKey(tenantKeyInput ?? getTenantKeyFromContext());
    const month = options?.month ?? this.getMonthKey();
    const bounds = this.getMonthBounds(month);
    const [activeSkuCount, submissionCount, storageRows, connectorCountsRows, profile] = await Promise.all([
      this.prisma.tenant(tenantKey).variant.count(),
      this.prisma.tenant(tenantKey).marketplaceExportJob.count({
        where: {
          createdAt: {
            gte: bounds.start,
            lt: bounds.end,
          },
        },
      }),
      this.prisma.tenant(tenantKey).$queryRaw<BytesRow[]>(Prisma.sql`
        SELECT COALESCE(SUM(size_bytes), 0)::double precision AS bytes
        FROM media_assets
        WHERE tenant_key = ${tenantKey}
      `),
      this.prisma.tenant(tenantKey).$queryRaw<ConnectorCountsRow[]>(Prisma.sql`
        SELECT
          COUNT(*)::int AS "installationCount",
          COALESCE(
            MAX(account_count),
            0
          )::int AS "maxAccountsPerConnector"
        FROM (
          SELECT
            ci.connector_id,
            COUNT(*)::int AS account_count
          FROM connector_installations ci
          WHERE ci.tenant_key = ${tenantKey}
            AND ci.status <> 'DISABLED'
          GROUP BY ci.connector_id
        ) grouped
      `),
      options?.profile ? Promise.resolve(options.profile) : this.getOrCreateTenantPlanProfile(tenantKey),
    ]);

    const bytesValue = storageRows[0]?.bytes ?? 0;
    const storageBytes =
      typeof bytesValue === "bigint" ? Number(bytesValue) : typeof bytesValue === "string" ? Number(bytesValue) : bytesValue;
    const storageGb = storageBytes / (1024 * 1024 * 1024);

    const connectorCounts = connectorCountsRows[0] ?? {
      installationCount: 0,
      maxAccountsPerConnector: 0,
    };

    await this.prisma.tenant(tenantKey).$executeRaw(Prisma.sql`
      INSERT INTO "PlanUsage"
        (
          "id",
          "tenantKey",
          "month",
          "planTier",
          "skuCount",
          "submissionCount",
          "storageGb",
          "connectorInstallationsCount",
          "connectorAccountsCount",
          "createdAt",
          "updatedAt"
        )
      VALUES
        (
          ${this.randomId()},
          ${tenantKey},
          ${month},
          ${profile.planTier},
          ${activeSkuCount},
          ${submissionCount},
          ${storageGb},
          ${connectorCounts.installationCount},
          ${connectorCounts.maxAccountsPerConnector},
          NOW(),
          NOW()
        )
      ON CONFLICT ("tenantKey", "month")
      DO UPDATE SET
        "planTier" = EXCLUDED."planTier",
        "skuCount" = EXCLUDED."skuCount",
        "submissionCount" = EXCLUDED."submissionCount",
        "storageGb" = EXCLUDED."storageGb",
        "connectorInstallationsCount" = EXCLUDED."connectorInstallationsCount",
        "connectorAccountsCount" = EXCLUDED."connectorAccountsCount",
        "updatedAt" = NOW()
    `);

    const row = await this.getUsageRow(tenantKey, month);
    if (!row) {
      throw new Error("Failed to upsert PlanUsage row");
    }
    return row;
  }

  async rollupAllTenantsUsage(): Promise<void> {
    const rows = await this.prisma.tenant().$queryRaw<Array<{ tenantKey: string }>>(Prisma.sql`
      SELECT DISTINCT "tenantKey" AS "tenantKey" FROM "Product"
      UNION
      SELECT DISTINCT "tenantKey" AS "tenantKey" FROM "MarketplaceExportJob"
      UNION
      SELECT DISTINCT tenant_key AS "tenantKey" FROM media_assets
      UNION
      SELECT DISTINCT "tenantKey" AS "tenantKey" FROM "PlanUsage"
      UNION
      SELECT DISTINCT tenant_key AS "tenantKey" FROM connector_installations
      UNION
      SELECT DISTINCT "tenantKey" AS "tenantKey" FROM "TenantPlanProfile"
      ORDER BY "tenantKey"
    `);

    // Process tenants in parallel chunks to avoid starving the DB connection pool
    // while still being ~10× faster than purely sequential processing.
    // CHUNK_SIZE = 10 keeps peak parallelism bounded regardless of tenant count.
    const CHUNK_SIZE = 10;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      // allSettled: a single tenant failure must not abort the rest of the batch.
      const results = await Promise.allSettled(
        chunk.map((row) => this.recomputeUsage(normalizeTenantKey(row.tenantKey))),
      );
      for (const [j, result] of results.entries()) {
        if (result.status === "rejected") {
          const tenantKey = chunk[j]?.tenantKey ?? "unknown";
          this.logger.error(`rollupAllTenantsUsage: failed for tenant ${tenantKey}`, result.reason);
        }
      }
    }
  }

  private async getPlanLimits(planTierInput: string): Promise<PlanLimitsRow> {
    const planTier = this.normalizePlanTier(planTierInput);
    const rows = await this.prisma.tenant().$queryRaw<PlanLimitsRow[]>(Prisma.sql`
      SELECT
        "planTier" AS "planTier",
        "maxSkus" AS "maxSkus",
        "maxSubmissionsPerMonth" AS "maxSubmissionsPerMonth",
        "maxUsers" AS "maxUsers",
        "maxStorageGb" AS "maxStorageGb",
        "maxConnectorInstallations" AS "maxConnectorInstallations",
        "maxAccountsPerConnector" AS "maxAccountsPerConnector",
        "maxApiKeys" AS "maxApiKeys",
        "maxOutboundWebhooks" AS "maxOutboundWebhooks",
        "maxImportRowsPerJob" AS "maxImportRowsPerJob"
      FROM "PlanLimits"
      WHERE "planTier" = ${planTier}
      LIMIT 1
    `);
    if (rows[0]) {
      return rows[0];
    }

    const fallback = await this.prisma.tenant().$queryRaw<PlanLimitsRow[]>(Prisma.sql`
      SELECT
        "planTier" AS "planTier",
        "maxSkus" AS "maxSkus",
        "maxSubmissionsPerMonth" AS "maxSubmissionsPerMonth",
        "maxUsers" AS "maxUsers",
        "maxStorageGb" AS "maxStorageGb",
        "maxConnectorInstallations" AS "maxConnectorInstallations",
        "maxAccountsPerConnector" AS "maxAccountsPerConnector",
        "maxApiKeys" AS "maxApiKeys",
        "maxOutboundWebhooks" AS "maxOutboundWebhooks",
        "maxImportRowsPerJob" AS "maxImportRowsPerJob"
      FROM "PlanLimits"
      WHERE "planTier" = 'TRIAL'
      LIMIT 1
    `);
    if (fallback[0]) {
      return fallback[0];
    }

    await this.seedPlanLimits();
    const seeded = await this.prisma.tenant().$queryRaw<PlanLimitsRow[]>(Prisma.sql`
      SELECT
        "planTier" AS "planTier",
        "maxSkus" AS "maxSkus",
        "maxSubmissionsPerMonth" AS "maxSubmissionsPerMonth",
        "maxUsers" AS "maxUsers",
        "maxStorageGb" AS "maxStorageGb",
        "maxConnectorInstallations" AS "maxConnectorInstallations",
        "maxAccountsPerConnector" AS "maxAccountsPerConnector",
        "maxApiKeys" AS "maxApiKeys",
        "maxOutboundWebhooks" AS "maxOutboundWebhooks",
        "maxImportRowsPerJob" AS "maxImportRowsPerJob"
      FROM "PlanLimits"
      WHERE "planTier" = 'TRIAL'
      LIMIT 1
    `);
    if (!seeded[0]) {
      throw new Error("PlanLimits seed missing TRIAL tier");
    }
    return seeded[0];
  }

  private async getConnectorAccountCount(tenantKey: string, connectorSlug: string): Promise<number> {
    const rows = await this.prisma.tenant(tenantKey).$queryRaw<Array<{ accountCount: number }>>(Prisma.sql`
      SELECT COALESCE(COUNT(*), 0)::int AS "accountCount"
      FROM connector_installations ci
      JOIN connector_definitions cd ON cd.id = ci.connector_id
      WHERE ci.tenant_key = ${tenantKey}
        AND cd.slug = ${connectorSlug}
        AND ci.status <> 'DISABLED'
    `);
    return Number(rows[0]?.accountCount ?? 0);
  }

  private async getOrCreateTenantPlanProfile(tenantKey: string): Promise<PlanProfileSummary> {
    const rows = await this.prisma.tenant(tenantKey).$queryRaw<TenantPlanProfileRow[]>(Prisma.sql`
      SELECT
        "tenantKey" AS "tenantKey",
        "planTier" AS "planTier",
        "billingStatus" AS "billingStatus",
        "accessStatus" AS "accessStatus",
        "effectiveFrom" AS "effectiveFrom",
        "trialEndsAt" AS "trialEndsAt",
        "paidThroughAt" AS "paidThroughAt",
        "graceEndsAt" AS "graceEndsAt",
        "cancelledAt" AS "cancelledAt",
        "suspendedAt" AS "suspendedAt",
        "suspensionReason" AS "suspensionReason",
        "billingContactEmail" AS "billingContactEmail",
        "updatedBy" AS "updatedBy",
        "createdAt" AS "createdAt",
        "updatedAt" AS "updatedAt"
      FROM "TenantPlanProfile"
      WHERE "tenantKey" = ${tenantKey}
      LIMIT 1
    `);

    const row = rows[0];
    if (row) {
      return this.mapPlanProfileRow(row);
    }

    const latestUsageRows = await this.prisma.tenant(tenantKey).$queryRaw<LatestPlanUsageTierRow[]>(Prisma.sql`
      SELECT
        "planTier" AS "planTier"
      FROM "PlanUsage"
      WHERE "tenantKey" = ${tenantKey}
      ORDER BY "month" DESC, "updatedAt" DESC
      LIMIT 1
    `);
    const seedPlanTier = this.normalizePlanTier(latestUsageRows[0]?.planTier ?? "STARTER");
    const seedBillingStatus = this.normalizeBillingStatus(null, seedPlanTier);
    const seedTrialEndsAt = seedBillingStatus === "trial" ? this.buildTrialEndsAt() : null;

    await this.prisma.tenant(tenantKey).$executeRaw(Prisma.sql`
      INSERT INTO "TenantPlanProfile"
        ("id", "tenantKey", "planTier", "billingStatus", "accessStatus", "effectiveFrom", "trialEndsAt", "billingContactEmail", "createdAt", "updatedAt")
      VALUES
        (
          ${this.randomId()},
          ${tenantKey},
          ${seedPlanTier},
          ${seedBillingStatus},
          'active',
          NOW(),
          ${seedTrialEndsAt},
          NULL,
          NOW(),
          NOW()
        )
      ON CONFLICT ("tenantKey") DO NOTHING
    `);

    const createdRows = await this.prisma.tenant(tenantKey).$queryRaw<TenantPlanProfileRow[]>(Prisma.sql`
      SELECT
        "tenantKey" AS "tenantKey",
        "planTier" AS "planTier",
        "billingStatus" AS "billingStatus",
        "accessStatus" AS "accessStatus",
        "effectiveFrom" AS "effectiveFrom",
        "trialEndsAt" AS "trialEndsAt",
        "paidThroughAt" AS "paidThroughAt",
        "graceEndsAt" AS "graceEndsAt",
        "cancelledAt" AS "cancelledAt",
        "suspendedAt" AS "suspendedAt",
        "suspensionReason" AS "suspensionReason",
        "billingContactEmail" AS "billingContactEmail",
        "updatedBy" AS "updatedBy",
        "createdAt" AS "createdAt",
        "updatedAt" AS "updatedAt"
      FROM "TenantPlanProfile"
      WHERE "tenantKey" = ${tenantKey}
      LIMIT 1
    `);

    const created = createdRows[0];
    if (!created) {
      throw new Error("Failed to initialize TenantPlanProfile row");
    }
    return this.mapPlanProfileRow(created);
  }

  private mapPlanProfileRow(row: TenantPlanProfileRow): PlanProfileSummary {
    const normalizedPlanTier = this.normalizePlanTier(row.planTier);
    return {
      tenantKey: normalizeTenantKey(row.tenantKey),
      planTier: normalizedPlanTier,
      billingStatus: this.normalizeBillingStatus(row.billingStatus, normalizedPlanTier),
      accessStatus: this.normalizeAccessStatus(row.accessStatus),
      effectiveFrom: this.toIsoString(row.effectiveFrom),
      trialEndsAt: this.toIsoString(row.trialEndsAt),
      paidThroughAt: this.toIsoString(row.paidThroughAt),
      graceEndsAt: this.toIsoString(row.graceEndsAt),
      cancelledAt: this.toIsoString(row.cancelledAt),
      suspendedAt: this.toIsoString(row.suspendedAt),
      suspensionReason: row.suspensionReason ? String(row.suspensionReason).trim() || null : null,
      billingContactEmail: this.normalizeOptionalEmail(row.billingContactEmail),
      updatedBy: row.updatedBy,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }

  private classifyIdentityType(userId: string): "email" | "external_identifier" | "unknown" {
    const value = userId.trim();
    if (!value) return "unknown";
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? "email" : "external_identifier";
  }

  private normalizePlanTier(value: string): PlanTier {
    const normalized = String(value ?? "").trim().toUpperCase();
    if (normalized === "TRIAL" || normalized === "STARTER" || normalized === "GROWTH" || normalized === "BUSINESS" || normalized === "ENTERPRISE") {
      return normalized;
    }
    return "TRIAL";
  }

  private normalizeBillingStatus(value: string | null | undefined, planTier: PlanTier): BillingStatus {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized === "active_paid" || normalized === "past_due" || normalized === "cancelled" || normalized === "expired") {
      return normalized;
    }
    if (normalized === "trial") {
      return "trial";
    }
    return planTier === "TRIAL" || planTier === "STARTER" ? "trial" : "active_paid";
  }

  private normalizeAccessStatus(value: string | null | undefined): AccessStatus {
    return String(value ?? "").trim().toLowerCase() === "suspended" ? "suspended" : "active";
  }

  private toIsoString(value: Date | string | null | undefined): string | null {
    if (!value) {
      return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  private buildTrialEndsAt(from = new Date()): Date {
    return new Date(from.getTime() + this.commercialTrialDays * 24 * 60 * 60 * 1000);
  }

  private parseOptionalDate(value: string | null | undefined, fieldName: string): Date | null {
    if (value === null || value === undefined || String(value).trim().length === 0) {
      return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`INVALID_${fieldName.toUpperCase()}`);
    }
    return parsed;
  }

  private normalizeAdminEmails(value: unknown): string[] {
    let input = value;
    if (typeof input === "string") {
      try {
        input = JSON.parse(input);
      } catch {
        input = [];
      }
    }
    if (!Array.isArray(input)) {
      return [];
    }
    return input
      .map((item) => String(item ?? "").trim().toLowerCase())
      .filter((item, index, items) => item.length > 0 && items.indexOf(item) === index);
  }

  private normalizeOptionalEmail(value: string | null | undefined): string | null {
    const normalized = String(value ?? "").trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
  }

  private async findCommercialAdminMatchTenantKeys(query: string): Promise<Set<string>> {
    const matches = await this.prismaDirect.getClient().authIdentity.findMany({
      where: {
        role: {
          equals: "admin",
          mode: "insensitive",
        },
        isActive: true,
        userId: {
          contains: query,
          mode: "insensitive",
        },
      },
      select: {
        tenantKey: true,
      },
      // We only need the set of matching tenantKeys — 100 is far more than enough.
      take: 100,
    });
    return new Set(matches.map((match) => normalizeTenantKey(match.tenantKey)));
  }

  private rankCommercialTenantMatch(
    row: CommercialTenantSearchRow & { updatedAt: Date },
    exactQuery: string,
    query: string,
    hasQuery: boolean,
    matchingAdminTenantKeys: Set<string>,
  ): number {
    if (!hasQuery) {
      return 0;
    }
    const tenantKey = String(row.tenantKey ?? "").trim().toLowerCase();
    const workspaceSlug = String(row.workspaceSlug ?? "").trim().toLowerCase();
    const displayName = String(row.displayName ?? "").trim().toLowerCase();
    const fuzzyQuery = query.toLowerCase();
    if (tenantKey === exactQuery) {
      return 0;
    }
    if (workspaceSlug === exactQuery) {
      return 1;
    }
    if (displayName === exactQuery) {
      return 2;
    }
    if (tenantKey.includes(fuzzyQuery)) {
      return 3;
    }
    if (workspaceSlug.includes(fuzzyQuery)) {
      return 4;
    }
    if (displayName.includes(fuzzyQuery)) {
      return 5;
    }
    if (matchingAdminTenantKeys.has(normalizeTenantKey(row.tenantKey))) {
      return 6;
    }
    return 7;
  }

  private async buildCommercialTenantRows(
    workspaces: CommercialWorkspaceCandidate[],
  ): Promise<Array<CommercialTenantSearchRow & { updatedAt: Date }>> {
    const tenantKeys = this.uniqueNormalizedTenantKeys(workspaces.map((workspace) => workspace.tenantKey));
    if (tenantKeys.length === 0) {
      return [];
    }

    const db = this.prismaDirect.getClient();

    const [profiles, latestUsageRows, adminIdentities] = await Promise.all([
      db.tenantPlanProfile.findMany({
        where: {
          tenantKey: { in: tenantKeys },
        },
        select: {
          tenantKey: true,
          planTier: true,
          billingStatus: true,
          accessStatus: true,
          trialEndsAt: true,
          paidThroughAt: true,
          graceEndsAt: true,
          cancelledAt: true,
          suspendedAt: true,
          suspensionReason: true,
          billingContactEmail: true,
        },
      }),
      db.planUsage.findMany({
        where: {
          tenantKey: { in: tenantKeys },
        },
        select: {
          tenantKey: true,
          planTier: true,
          month: true,
          updatedAt: true,
        },
        orderBy: [{ tenantKey: "asc" }, { month: "desc" }, { updatedAt: "desc" }],
      }),
      db.authIdentity.findMany({
        where: {
          tenantKey: { in: tenantKeys },
          role: {
            equals: "admin",
            mode: "insensitive",
          },
          isActive: true,
        },
        select: {
          tenantKey: true,
          userId: true,
        },
        orderBy: [{ tenantKey: "asc" }, { userId: "asc" }],
        // Cap at 5 admins per tenant in the batch — in-memory aggregation uses at most 5 per tenant.
        take: Math.max(tenantKeys.length * 5, 500),
      }),
    ]);

    const profileMap = new Map(profiles.map((profile) => [normalizeTenantKey(profile.tenantKey), profile]));
    const latestUsageMap = new Map<string, string>();
    for (const usage of latestUsageRows) {
      const tenantKey = normalizeTenantKey(usage.tenantKey);
      if (!latestUsageMap.has(tenantKey)) {
        latestUsageMap.set(tenantKey, usage.planTier);
      }
    }
    const adminMap = new Map<string, string[]>();
    for (const identity of adminIdentities) {
      const tenantKey = normalizeTenantKey(identity.tenantKey);
      const current = adminMap.get(tenantKey) ?? [];
      if (current.length < 5) {
        current.push(String(identity.userId ?? "").trim().toLowerCase());
        adminMap.set(tenantKey, current);
      }
    }

    return workspaces.map((workspace) => {
      const tenantKey = normalizeTenantKey(workspace.tenantKey);
      const profile = profileMap.get(tenantKey);
      return {
        tenantKey,
        workspaceSlug: workspace.workspaceSlug,
        displayName: workspace.displayName,
        workspaceIsActive: workspace.workspaceIsActive,
        planTier: profile?.planTier ?? latestUsageMap.get(tenantKey) ?? "TRIAL",
        billingStatus: profile?.billingStatus ?? null,
        accessStatus: profile?.accessStatus ?? null,
        trialEndsAt: profile?.trialEndsAt ?? null,
        paidThroughAt: profile?.paidThroughAt ?? null,
        graceEndsAt: profile?.graceEndsAt ?? null,
        cancelledAt: profile?.cancelledAt ?? null,
        suspendedAt: profile?.suspendedAt ?? null,
        suspensionReason: profile?.suspensionReason ?? null,
        billingContactEmail: profile?.billingContactEmail ?? null,
        adminEmails: adminMap.get(tenantKey) ?? [],
        updatedAt: workspace.updatedAt,
      };
    });
  }

  private uniqueNormalizedTenantKeys(values: string[]): string[] {
    return Array.from(
      new Set(
        values
          .map((value) => normalizeTenantKey(value))
          .filter((value) => value.length > 0),
      ),
    );
  }

  private mapCommercialTenantSearchRow(row: CommercialTenantSearchRow): CommercialTenantSearchResult {
    const planTier = this.normalizePlanTier(row.planTier ?? "TRIAL");
    return {
      tenantKey: normalizeTenantKey(row.tenantKey),
      workspaceSlug: String(row.workspaceSlug ?? "").trim(),
      displayName: String(row.displayName ?? "").trim(),
      workspaceIsActive: Boolean(row.workspaceIsActive),
      planTier,
      billingStatus: this.normalizeBillingStatus(row.billingStatus, planTier),
      accessStatus: this.normalizeAccessStatus(row.accessStatus),
      trialEndsAt: this.toIsoString(row.trialEndsAt),
      paidThroughAt: this.toIsoString(row.paidThroughAt),
      graceEndsAt: this.toIsoString(row.graceEndsAt),
      cancelledAt: this.toIsoString(row.cancelledAt),
      suspendedAt: this.toIsoString(row.suspendedAt),
      suspensionReason: row.suspensionReason ? String(row.suspensionReason).trim() || null : null,
      billingContactEmail: this.normalizeOptionalEmail(row.billingContactEmail),
      adminEmails: this.normalizeAdminEmails(row.adminEmails),
    };
  }

  private csvCell(value: string): string {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  private resolvePositiveIntegerEnv(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(String(value ?? "").trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private getMonthKey(date = new Date()): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  }

  private getMonthBounds(monthKey: string): { start: Date; end: Date } {
    const [yearRaw, monthRaw] = monthKey.split("-");
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
    return { start, end };
  }

  private randomId(): string {
    return `plan_${Math.random().toString(36).slice(2, 11)}_${Date.now().toString(36)}`;
  }

  private startNightlyRollup(): void {
    const now = new Date();
    const next = new Date(now);
    const nextUtcForIst2Am = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      20,
      30,
      0,
      0,
    );
    next.setTime(nextUtcForIst2Am);
    if (next <= now) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    const delayMs = Math.max(1000, next.getTime() - now.getTime());
    this.rollupTimeout = setTimeout(() => {
      this.rollupAllTenantsUsage().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Nightly usage rollup failed: ${message}`);
      });
      this.rollupInterval = setInterval(() => {
        this.rollupAllTenantsUsage().catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Nightly usage rollup failed: ${message}`);
        });
      }, 24 * 60 * 60 * 1000);
    }, delayMs);
  }

  private async getUsageRow(tenantKey: string, month: string): Promise<UsageRow | null> {
    const rows = await this.prisma.tenant(tenantKey).$queryRaw<UsageRow[]>(Prisma.sql`
      SELECT
        "tenantKey" AS "tenantKey",
        "month" AS "month",
        "planTier" AS "planTier",
        "skuCount" AS "skuCount",
        "submissionCount" AS "submissionCount",
        "storageGb" AS "storageGb",
        "connectorInstallationsCount" AS "connectorInstallationsCount",
        "connectorAccountsCount" AS "connectorAccountsCount",
        "updatedAt" AS "updatedAt"
      FROM "PlanUsage"
      WHERE "tenantKey" = ${tenantKey} AND "month" = ${month}
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  private async getUsageSummaryRow(tenantKey: string, month: string): Promise<UsageSummaryReadRow | null> {
    const rows = await this.prisma.tenant(tenantKey).$queryRaw<UsageSummaryReadRow[]>(Prisma.sql`
      SELECT
        usage."tenantKey" AS "tenantKey",
        usage."month" AS "month",
        usage."planTier" AS "planTier",
        usage."skuCount" AS "skuCount",
        usage."submissionCount" AS "submissionCount",
        usage."storageGb" AS "storageGb",
        usage."connectorInstallationsCount" AS "connectorInstallationsCount",
        usage."connectorAccountsCount" AS "connectorAccountsCount",
        usage."updatedAt" AS "usageUpdatedAt",
        limits."maxSkus" AS "maxSkus",
        limits."maxSubmissionsPerMonth" AS "maxSubmissionsPerMonth",
        limits."maxUsers" AS "maxUsers",
        limits."maxStorageGb" AS "maxStorageGb",
        limits."maxConnectorInstallations" AS "maxConnectorInstallations",
        limits."maxAccountsPerConnector" AS "maxAccountsPerConnector",
        limits."maxApiKeys" AS "maxApiKeys",
        limits."maxOutboundWebhooks" AS "maxOutboundWebhooks",
        limits."maxImportRowsPerJob" AS "maxImportRowsPerJob",
        profile."tenantKey" AS "profileTenantKey",
        profile."planTier" AS "profilePlanTier",
        profile."billingStatus" AS "profileBillingStatus",
        profile."accessStatus" AS "profileAccessStatus",
        profile."effectiveFrom" AS "profileEffectiveFrom",
        profile."trialEndsAt" AS "profileTrialEndsAt",
        profile."paidThroughAt" AS "profilePaidThroughAt",
        profile."graceEndsAt" AS "profileGraceEndsAt",
        profile."cancelledAt" AS "profileCancelledAt",
        profile."suspendedAt" AS "profileSuspendedAt",
        profile."suspensionReason" AS "profileSuspensionReason",
        profile."billingContactEmail" AS "profileBillingContactEmail",
        profile."updatedBy" AS "profileUpdatedBy",
        profile."createdAt" AS "profileCreatedAt",
        profile."updatedAt" AS "profileUpdatedAt"
      FROM "PlanUsage" usage
      LEFT JOIN "PlanLimits" limits
        ON limits."planTier" = usage."planTier"
      LEFT JOIN "TenantPlanProfile" profile
        ON profile."tenantKey" = usage."tenantKey"
      WHERE usage."tenantKey" = ${tenantKey}
        AND usage."month" = ${month}
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  private isUsageRowFresh(row: UsageRow | null): row is UsageRow {
    if (!row) {
      return false;
    }
    const updatedAt = new Date(row.updatedAt);
    if (Number.isNaN(updatedAt.getTime())) {
      return false;
    }
    return Date.now() - updatedAt.getTime() <= USAGE_SUMMARY_TTL_MS;
  }

  private isUsageSummaryRowFresh(row: UsageSummaryReadRow | null): row is UsageSummaryReadRow {
    if (!row || !this.isUsageRowFresh(this.mapUsageSummaryRowToUsage(row))) {
      return false;
    }

    return !!(
      row.profileTenantKey &&
      row.profilePlanTier &&
      row.profileBillingStatus &&
      row.profileAccessStatus &&
      row.profileCreatedAt &&
      row.profileUpdatedAt
    );
  }

  private mapUsageSummaryRowToUsage(row: UsageSummaryReadRow): UsageRow {
    return {
      tenantKey: row.tenantKey,
      month: row.month,
      planTier: row.planTier,
      skuCount: row.skuCount,
      submissionCount: row.submissionCount,
      storageGb: row.storageGb,
      connectorInstallationsCount: row.connectorInstallationsCount,
      connectorAccountsCount: row.connectorAccountsCount,
      updatedAt: row.usageUpdatedAt,
    };
  }

  private mapUsageSummaryRowToLimits(row: UsageSummaryReadRow): PlanLimitsRow {
    const fallback = PLAN_LIMITS[0];
    return {
      planTier: row.planTier,
      maxSkus: row.maxSkus ?? fallback.maxSkus,
      maxSubmissionsPerMonth: row.maxSubmissionsPerMonth ?? fallback.maxSubmissionsPerMonth,
      maxUsers: row.maxUsers ?? fallback.maxUsers,
      maxStorageGb: row.maxStorageGb ?? fallback.maxStorageGb,
      maxConnectorInstallations: row.maxConnectorInstallations ?? fallback.maxConnectorInstallations,
      maxAccountsPerConnector: row.maxAccountsPerConnector ?? fallback.maxAccountsPerConnector,
      maxApiKeys: row.maxApiKeys ?? fallback.maxApiKeys,
      maxOutboundWebhooks: row.maxOutboundWebhooks ?? fallback.maxOutboundWebhooks,
      maxImportRowsPerJob: row.maxImportRowsPerJob ?? fallback.maxImportRowsPerJob,
    };
  }

  private mapUsageSummaryRowToProfile(row: UsageSummaryReadRow): PlanProfileSummary {
    return this.mapPlanProfileRow({
      tenantKey: row.profileTenantKey ?? row.tenantKey,
      planTier: row.profilePlanTier ?? row.planTier,
      billingStatus: row.profileBillingStatus,
      accessStatus: row.profileAccessStatus,
      effectiveFrom: row.profileEffectiveFrom,
      trialEndsAt: row.profileTrialEndsAt,
      paidThroughAt: row.profilePaidThroughAt,
      graceEndsAt: row.profileGraceEndsAt,
      cancelledAt: row.profileCancelledAt,
      suspendedAt: row.profileSuspendedAt,
      suspensionReason: row.profileSuspensionReason,
      billingContactEmail: row.profileBillingContactEmail,
      updatedBy: row.profileUpdatedBy,
      createdAt: row.profileCreatedAt ?? row.usageUpdatedAt,
      updatedAt: row.profileUpdatedAt ?? row.usageUpdatedAt,
    });
  }

  private buildUsageSummary(
    tenantKey: string,
    usage: UsageRow,
    limits: PlanLimitsRow,
    profile: PlanProfileSummary,
  ): PlanUsageSummary {
    const monthBounds = this.getMonthBounds(usage.month);
    return {
      planTier: usage.planTier,
      billingStatus: profile.billingStatus,
      accessStatus: profile.accessStatus,
      month: usage.month,
      billingCycleResetAt: monthBounds.end.toISOString(),
      skus: {
        current: usage.skuCount,
        limit: limits.maxSkus,
      },
      submissions: {
        current: usage.submissionCount,
        limit: limits.maxSubmissionsPerMonth,
      },
      storageGb: {
        current: Number(usage.storageGb.toFixed(6)),
        limit: limits.maxStorageGb,
      },
      users: {
        current: 1,
        limit: limits.maxUsers,
      },
      connectorsInstallations: {
        current: usage.connectorInstallationsCount,
        limit: limits.maxConnectorInstallations,
      },
      connectorAccounts: {
        current: usage.connectorAccountsCount,
        limit: limits.maxAccountsPerConnector,
      },
      apiKeys: {
        current: 0,
        limit: limits.maxApiKeys,
      },
      outboundWebhooks: {
        current: 0,
        limit: limits.maxOutboundWebhooks,
      },
      importRowsPerJob: {
        limit: limits.maxImportRowsPerJob,
      },
      profile: {
        tenantKey,
        planTier: profile.planTier,
        billingStatus: profile.billingStatus,
        accessStatus: profile.accessStatus,
        effectiveFrom: profile.effectiveFrom,
        trialEndsAt: profile.trialEndsAt,
        paidThroughAt: profile.paidThroughAt,
        graceEndsAt: profile.graceEndsAt,
        cancelledAt: profile.cancelledAt,
        suspendedAt: profile.suspendedAt,
        suspensionReason: profile.suspensionReason,
        billingContactEmail: profile.billingContactEmail,
        updatedBy: profile.updatedBy,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      },
    };
  }
}
