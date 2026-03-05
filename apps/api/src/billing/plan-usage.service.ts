import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { PrismaService } from "../prisma/prisma.service";
import { PLAN_LIMITS } from "./plan-limits.seed";
import { PlanResource } from "./require-plan-limit.decorator";

const PLAN_TIERS = ["STARTER", "GROWTH", "ENTERPRISE"] as const;

type PlanTier = (typeof PLAN_TIERS)[number];

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
}

interface TenantPlanProfileRow {
  tenantKey: string;
  planTier: string;
  effectiveFrom: Date | string | null;
  updatedBy: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
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
  effectiveFrom: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlanUsageSummary {
  planTier: string;
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

@Injectable()
export class PlanUsageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlanUsageService.name);
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
    const usage = await this.recomputeUsage(tenantKey);
    const limits = await this.getPlanLimits(usage.planTier);
    const monthBounds = this.getMonthBounds(usage.month);
    const profile = await this.getOrCreateTenantPlanProfile(tenantKey);

    return {
      planTier: usage.planTier,
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
        effectiveFrom: profile.effectiveFrom,
        updatedBy: profile.updatedBy,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      },
    };
  }

  async getTenantPlanProfile(tenantKeyInput?: string): Promise<PlanProfileSummary> {
    const tenantKey = normalizeTenantKey(tenantKeyInput ?? getTenantKeyFromContext());
    return this.getOrCreateTenantPlanProfile(tenantKey);
  }

  async setTenantPlanTier(
    planTierInput: string,
    actorId: string,
  ): Promise<PlanProfileSummary> {
    const tenantKey = normalizeTenantKey(getTenantKeyFromContext());
    const planTier = this.normalizePlanTier(planTierInput);

    await this.prisma.tenant(tenantKey).$executeRaw(Prisma.sql`
      INSERT INTO "TenantPlanProfile"
        ("id", "tenantKey", "planTier", "effectiveFrom", "updatedBy", "createdAt", "updatedAt")
      VALUES
        (${this.randomId()}, ${tenantKey}, ${planTier}, NOW(), ${actorId}, NOW(), NOW())
      ON CONFLICT ("tenantKey")
      DO UPDATE SET
        "planTier" = EXCLUDED."planTier",
        "effectiveFrom" = NOW(),
        "updatedBy" = EXCLUDED."updatedBy",
        "updatedAt" = NOW()
    `);

    await this.recomputeUsage(tenantKey);
    return this.getOrCreateTenantPlanProfile(tenantKey);
  }

  async recomputeUsage(tenantKeyInput?: string): Promise<UsageRow> {
    const tenantKey = normalizeTenantKey(tenantKeyInput ?? getTenantKeyFromContext());
    const month = this.getMonthKey();
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
      this.getOrCreateTenantPlanProfile(tenantKey),
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

    const rows = await this.prisma.tenant(tenantKey).$queryRaw<UsageRow[]>(Prisma.sql`
      SELECT
        "tenantKey" AS "tenantKey",
        "month" AS "month",
        "planTier" AS "planTier",
        "skuCount" AS "skuCount",
        "submissionCount" AS "submissionCount",
        "storageGb" AS "storageGb",
        "connectorInstallationsCount" AS "connectorInstallationsCount",
        "connectorAccountsCount" AS "connectorAccountsCount"
      FROM "PlanUsage"
      WHERE "tenantKey" = ${tenantKey} AND "month" = ${month}
      LIMIT 1
    `);

    const row = rows[0];
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
        "effectiveFrom" AS "effectiveFrom",
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

    await this.prisma.tenant(tenantKey).$executeRaw(Prisma.sql`
      INSERT INTO "TenantPlanProfile"
        ("id", "tenantKey", "planTier", "effectiveFrom", "createdAt", "updatedAt")
      VALUES
        (${this.randomId()}, ${tenantKey}, 'STARTER', NOW(), NOW(), NOW())
      ON CONFLICT ("tenantKey") DO NOTHING
    `);

    const createdRows = await this.prisma.tenant(tenantKey).$queryRaw<TenantPlanProfileRow[]>(Prisma.sql`
      SELECT
        "tenantKey" AS "tenantKey",
        "planTier" AS "planTier",
        "effectiveFrom" AS "effectiveFrom",
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
    return {
      tenantKey: normalizeTenantKey(row.tenantKey),
      planTier: this.normalizePlanTier(row.planTier),
      effectiveFrom: row.effectiveFrom ? new Date(row.effectiveFrom).toISOString() : null,
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
}
