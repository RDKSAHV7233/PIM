import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { PrismaService } from "../prisma/prisma.service";
import { PLAN_LIMITS } from "./plan-limits.seed";
import { PlanResource } from "./require-plan-limit.decorator";

const PLAN_TIERS = ["STARTER", "GROWTH", "ENTERPRISE"] as const;
const BILLING_STATUSES = ["trial", "active_paid", "past_due", "cancelled"] as const;
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
  maxSkus: number;
  maxSubmissionsPerMonth: number;
  maxUsers: number;
  maxStorageGb: number;
  maxConnectorInstallations: number;
  maxAccountsPerConnector: number;
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

interface BytesRow {
  bytes: number | bigint | string;
}

interface ConnectorCountsRow {
  installationCount: number;
  maxAccountsPerConnector: number;
}

export interface PlanCheckResult {
  allowed: boolean;
  resource: "skus" | "submissions" | "storageGb" | "connectors_installations" | "connector_accounts";
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

  constructor(private readonly prisma: PrismaService) {}

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
          "updatedAt" = NOW()
      `);
    }
  }

  async touchUsageForCurrentTenant(): Promise<UsageRow> {
    const tenantKey = normalizeTenantKey(getTenantKeyFromContext());
    return this.recomputeUsage(tenantKey);
  }

  async checkLimit(
    resource: PlanResource,
    requestDelta = 1,
    tenantKeyInput?: string,
    options?: { connectorSlug?: string },
  ): Promise<PlanCheckResult> {
    const tenantKey = normalizeTenantKey(tenantKeyInput ?? getTenantKeyFromContext());
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

    const current = usage.storageGb + requestDelta;
    return {
      allowed: current <= limits.maxStorageGb,
      resource: "storageGb",
      limit: limits.maxStorageGb,
      current: Number(current.toFixed(6)),
    };
  }

  async getUsageSummary(tenantKeyInput?: string): Promise<PlanUsageSummary> {
    const tenantKey = normalizeTenantKey(tenantKeyInput ?? getTenantKeyFromContext());
    const month = this.getMonthKey();
    const warmSummaryRow = await this.getUsageSummaryRow(tenantKey, month);
    if (this.isUsageSummaryRowFresh(warmSummaryRow)) {
      return this.buildUsageSummary(
        tenantKey,
        this.mapUsageSummaryRowToUsage(warmSummaryRow),
        this.mapUsageSummaryRowToLimits(warmSummaryRow),
        this.mapUsageSummaryRowToProfile(warmSummaryRow),
      );
    }

    const [cachedUsage, profile] = await Promise.all([
      this.getUsageRow(tenantKey, month),
      this.getOrCreateTenantPlanProfile(tenantKey),
    ]);
    const usage = this.isUsageRowFresh(cachedUsage)
      ? cachedUsage
      : await this.recomputeUsage(tenantKey, { month, profile });
    const limits = await this.getPlanLimits(usage.planTier);
    return this.buildUsageSummary(tenantKey, usage, limits, profile);
  }

  async getTenantPlanProfile(tenantKeyInput?: string): Promise<PlanProfileSummary> {
    const tenantKey = normalizeTenantKey(tenantKeyInput ?? getTenantKeyFromContext());
    return this.getOrCreateTenantPlanProfile(tenantKey);
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
    if (!hasBillingStatus && !hasAccessStatus && !hasDateMutation && !hasSuspensionReason) {
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
    const exactQuery = query.toLowerCase();
    const fuzzyQuery = `%${query}%`;

    // RLS-BYPASS: manual tenant filter
    const rows = await this.prisma.tenant().$queryRawUnsafe<CommercialTenantSearchRow[]>(
      `
      SELECT
        wd."tenantKey" AS "tenantKey",
        wd."workspaceSlug" AS "workspaceSlug",
        wd."displayName" AS "displayName",
        wd."isActive" AS "workspaceIsActive",
        COALESCE(profile."planTier", usage."planTier", 'STARTER') AS "planTier",
        COALESCE(
          profile."billingStatus",
          CASE
            WHEN COALESCE(profile."planTier", usage."planTier", 'STARTER') = 'STARTER' THEN 'trial'
            ELSE 'active_paid'
          END
        ) AS "billingStatus",
        COALESCE(profile."accessStatus", 'active') AS "accessStatus",
        profile."trialEndsAt" AS "trialEndsAt",
        profile."paidThroughAt" AS "paidThroughAt",
        profile."graceEndsAt" AS "graceEndsAt",
        profile."cancelledAt" AS "cancelledAt",
        profile."suspendedAt" AS "suspendedAt",
        profile."suspensionReason" AS "suspensionReason",
        profile."billingContactEmail" AS "billingContactEmail",
        COALESCE(
          (
            SELECT json_agg(admin_rows."userId" ORDER BY admin_rows."userId")
            FROM (
              SELECT ai."userId"
              FROM "AuthIdentity" ai
              WHERE ai."tenantKey" = wd."tenantKey"
                AND LOWER(ai.role) = 'admin'
                AND ai."isActive" = TRUE
              ORDER BY ai."userId" ASC
              LIMIT 5
            ) admin_rows
          ),
          '[]'::json
        ) AS "adminEmails"
      FROM "WorkspaceDirectory" wd
      LEFT JOIN "TenantPlanProfile" profile
        ON profile."tenantKey" = wd."tenantKey"
      LEFT JOIN LATERAL (
        SELECT pu."planTier" AS "planTier"
        FROM "PlanUsage" pu
        WHERE pu."tenantKey" = wd."tenantKey"
        ORDER BY pu."month" DESC, pu."updatedAt" DESC
        LIMIT 1
      ) usage ON TRUE
      WHERE
        LOWER(wd."tenantKey") = $1
        OR LOWER(wd."workspaceSlug") = $1
        OR LOWER(wd."displayName") = $1
        OR wd."tenantKey" ILIKE $2
        OR wd."workspaceSlug" ILIKE $2
        OR wd."displayName" ILIKE $2
        OR EXISTS (
          SELECT 1
          FROM "AuthIdentity" ai_match
          WHERE ai_match."tenantKey" = wd."tenantKey"
            AND LOWER(ai_match.role) = 'admin'
            AND ai_match."userId" ILIKE $2
        )
      ORDER BY
        CASE
          WHEN LOWER(wd."tenantKey") = $1 THEN 0
          WHEN LOWER(wd."workspaceSlug") = $1 THEN 1
          WHEN LOWER(wd."displayName") = $1 THEN 2
          WHEN wd."tenantKey" ILIKE $2 THEN 3
          WHEN wd."workspaceSlug" ILIKE $2 THEN 4
          WHEN wd."displayName" ILIKE $2 THEN 5
          ELSE 6
        END,
        wd."updatedAt" DESC,
        wd."tenantKey" ASC
      LIMIT $3
      `,
      exactQuery,
      fuzzyQuery,
      limit,
    );

    return rows.map((row) => {
      const planTier = this.normalizePlanTier(row.planTier ?? "STARTER");
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
    });
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
    const [productCount, submissionCount, storageRows, connectorCountsRows, profile] = await Promise.all([
      this.prisma.tenant(tenantKey).product.count(),
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
          ${productCount},
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

    for (const row of rows) {
      await this.recomputeUsage(normalizeTenantKey(row.tenantKey));
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
        "maxAccountsPerConnector" AS "maxAccountsPerConnector"
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
        "maxAccountsPerConnector" AS "maxAccountsPerConnector"
      FROM "PlanLimits"
      WHERE "planTier" = 'STARTER'
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
        "maxAccountsPerConnector" AS "maxAccountsPerConnector"
      FROM "PlanLimits"
      WHERE "planTier" = 'STARTER'
      LIMIT 1
    `);
    if (!seeded[0]) {
      throw new Error("PlanLimits seed missing STARTER tier");
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

  private normalizePlanTier(value: string): PlanTier {
    const normalized = String(value ?? "").trim().toUpperCase();
    if (normalized === "GROWTH" || normalized === "ENTERPRISE") {
      return normalized;
    }
    return "STARTER";
  }

  private normalizeBillingStatus(value: string | null | undefined, planTier: PlanTier): BillingStatus {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized === "active_paid" || normalized === "past_due" || normalized === "cancelled") {
      return normalized;
    }
    if (normalized === "trial") {
      return "trial";
    }
    return planTier === "STARTER" ? "trial" : "active_paid";
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
      JOIN "PlanLimits" limits
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
    return {
      planTier: row.planTier,
      maxSkus: row.maxSkus,
      maxSubmissionsPerMonth: row.maxSubmissionsPerMonth,
      maxUsers: row.maxUsers,
      maxStorageGb: row.maxStorageGb,
      maxConnectorInstallations: row.maxConnectorInstallations,
      maxAccountsPerConnector: row.maxAccountsPerConnector,
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
