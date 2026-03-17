import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { createClient } from "redis";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { MetricsService } from "../metrics/metrics.service";
import { PrismaService } from "../prisma/prisma.service";

type ReadinessConnector = {
  slug: string;
  displayName: string;
  ready: number;
  blocked: number;
  pending: number;
  notConnected?: boolean;
};

type ReadinessResponse = {
  connectors: ReadinessConnector[];
  asOf: string;
};

type CatalogHealthResponse = {
  averageCompleteness: number;
  belowThreshold: number;
  completeSkus: number;
  incompleteSkus: number;
  missingMainImage: number;
  missingRequiredAttrs: number;
  distribution: Array<{ bucket: string; count: number }>;
  asOf: string;
};

type DashboardHealthSnapshot = {
  capturedAt: string;
  totalSkus: number;
  completeSkus: number;
  incompleteSkus: number;
  publishReadyByConnector: Record<string, number>;
  blockedByConnector: Record<string, number>;
  rejectionRiskHigh: number;
  openIssuesBlocking: number;
  openIssuesWarning: number;
};

type DashboardHealthResponse = {
  snapshot: DashboardHealthSnapshot;
  trend: DashboardHealthSnapshot[];
  asOf: string;
};

type DashboardOperationsSummaryResponse = {
  activeConnectors: number;
  installedConnectors: number;
  failedImportJobs: number;
  failedSubmissionJobs: number;
  deadLetterJobs: number;
  jobsNeedingRetry: number;
  asOf: string;
};

type DashboardCachedValue =
  | ReadinessResponse
  | CatalogHealthResponse
  | DashboardHealthResponse
  | DashboardOperationsSummaryResponse;

const CACHE_TTL_SECONDS = 5 * 60;
const SNAPSHOT_REFRESH_MS = 6 * 60 * 60 * 1000;
const SNAPSHOT_TREND_DAYS = 30;
const REDIS_RETRY_BACKOFF_MS = 30_000;
const DISTRIBUTION_BUCKETS = [
  "0-10",
  "10-20",
  "20-30",
  "30-40",
  "40-50",
  "50-60",
  "60-70",
  "70-80",
  "80-90",
  "90-100",
] as const;

function isProductionAppEnv(): boolean {
  const appEnv = String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "development")
    .trim()
    .toLowerCase();
  return appEnv === "production";
}

function resolveStubConnectorSlugs(): string[] {
  return String(process.env.CONNECTOR_STUB_SLUGS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

@Injectable()
export class DashboardService implements OnModuleDestroy {
  private readonly redisDisabled =
    String(process.env.DASHBOARD_CACHE_REDIS_DISABLED ?? "").trim().toLowerCase() === "true";
  private readonly redisUrl = String(process.env.REDIS_URL ?? "redis://localhost:6379").trim();
  private redisClient: ReturnType<typeof createClient> | null = null;
  private redisConnecting: Promise<void> | null = null;
  private redisAvailable = false;
  private redisRetryAfterMs = 0;
  private readonly allowInMemoryFallbackCache = !isProductionAppEnv();
  private readonly fallbackCache = new Map<
    string,
    { value: DashboardCachedValue; expiresAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly metricsService: MetricsService,
  ) {}

  async getReadiness(): Promise<ReadinessResponse> {
    const tenantKey = normalizeTenantKey(getTenantKeyFromContext());
    const cacheKey = `dashboard:readiness:${tenantKey}`;
    return this.getOrSetCache(cacheKey, async () => this.computeReadiness(tenantKey));
  }

  async getCatalogHealth(): Promise<CatalogHealthResponse> {
    const tenantKey = normalizeTenantKey(getTenantKeyFromContext());
    const cacheKey = `dashboard:catalog-health:${tenantKey}`;
    return this.getOrSetCache(cacheKey, async () => this.computeCatalogHealth(tenantKey));
  }

  async getHealth(): Promise<DashboardHealthResponse> {
    const tenantKey = normalizeTenantKey(getTenantKeyFromContext());
    const cacheKey = `dashboard:health:${tenantKey}`;
    return this.getOrSetCache(cacheKey, async () => this.computeDashboardHealth(tenantKey));
  }

  async getOperationsSummary(): Promise<DashboardOperationsSummaryResponse> {
    const tenantKey = normalizeTenantKey(getTenantKeyFromContext());
    const cacheKey = `dashboard:operations-summary:${tenantKey}`;
    return this.getOrSetCache(cacheKey, async () => this.computeOperationsSummary(tenantKey));
  }

  private async getOrSetCache<T extends DashboardCachedValue>(
    key: string,
    producer: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.readCache<T>(key);
    if (cached) {
      return cached;
    }
    const value = await producer();
    await this.writeCache(key, value);
    return value;
  }

  private async readCache<T>(key: string): Promise<T | null> {
    if (this.allowInMemoryFallbackCache) {
      const fallback = this.readFallbackCache<T>(key);
      if (fallback) {
        return fallback;
      }
    }
    if (!(await this.ensureRedisAvailable()) || !this.redisClient) {
      return null;
    }
    try {
      const raw = await this.redisClient.get(key);
      if (!raw) {
        return null;
      }
      const rawText = String(raw);
      const parsed = JSON.parse(rawText) as T;
      if (this.allowInMemoryFallbackCache) {
        this.writeFallbackCache(
          key,
          parsed as DashboardCachedValue,
        );
      }
      return parsed;
    } catch {
      this.markRedisUnavailable();
      return null;
    }
  }

  private async writeCache<T>(key: string, value: T): Promise<void> {
    if (this.allowInMemoryFallbackCache) {
      this.writeFallbackCache(
        key,
        value as DashboardCachedValue,
      );
    }
    if (!(await this.ensureRedisAvailable()) || !this.redisClient) {
      return;
    }
    try {
      await this.redisClient.setEx(key, CACHE_TTL_SECONDS, JSON.stringify(value));
    } catch {
      this.markRedisUnavailable();
    }
  }

  private readFallbackCache<T>(key: string): T | null {
    const cached = this.fallbackCache.get(key);
    if (!cached) {
      return null;
    }
    if (Date.now() >= cached.expiresAt) {
      this.fallbackCache.delete(key);
      return null;
    }
    return cached.value as T;
  }

  private writeFallbackCache(
    key: string,
    value: DashboardCachedValue,
  ): void {
    this.fallbackCache.set(key, {
      value,
      expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000,
    });
  }

  private async ensureRedisAvailable(): Promise<boolean> {
    if (this.redisDisabled) {
      this.redisAvailable = false;
      return false;
    }
    if (this.redisAvailable) {
      return true;
    }
    const nowMs = Date.now();
    if (nowMs < this.redisRetryAfterMs) {
      return false;
    }
    if (this.redisConnecting) {
      await this.redisConnecting;
      return this.redisAvailable;
    }

    this.redisConnecting = (async () => {
      try {
        const client = createClient({
          url: this.redisUrl,
          socket: {
            connectTimeout: 2_000,
            reconnectStrategy: () => false,
          },
        });
        client.on("error", () => {
          this.markRedisUnavailable();
        });
        await client.connect();
        this.redisClient = client;
        this.redisAvailable = true;
        this.redisRetryAfterMs = 0;
      } catch {
        this.markRedisUnavailable();
      } finally {
        this.redisConnecting = null;
      }
    })();

    await this.redisConnecting;
    return this.redisAvailable;
  }

  private markRedisUnavailable(): void {
    this.redisAvailable = false;
    this.redisRetryAfterMs = Date.now() + REDIS_RETRY_BACKOFF_MS;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redisClient) {
      await this.redisClient.quit().catch(() => undefined);
      this.redisClient = null;
    }
    this.redisAvailable = false;
  }

  private async computeReadiness(tenantKey: string): Promise<ReadinessResponse> {
    // RLS-BYPASS: manual tenant filter
    const rows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<
      Array<{
        slug: string;
        displayName: string;
        installationCount: number;
        ready: number;
        blocked: number;
        pending: number;
      }>
    >(
      `
      SELECT
        cd.slug AS slug,
        cd.display_name AS "displayName",
        COUNT(DISTINCT ci.id)::int AS "installationCount",
        COUNT(*) FILTER (WHERE UPPER(cs.status) = 'SUCCESS')::int AS ready,
        COUNT(*) FILTER (WHERE UPPER(cs.status) = 'PENDING')::int AS pending,
        COUNT(*) FILTER (WHERE UPPER(cs.status) IN ('REJECTED', 'SUPPRESSED', 'ERROR'))::int AS blocked
      FROM connector_definitions cd
      LEFT JOIN connector_installations ci
        ON ci.connector_id = cd.id
       AND ci.tenant_key = $1
       AND ci.status <> 'DISABLED'
      LEFT JOIN connector_submissions cs
        ON cs.installation_id = ci.id
      WHERE cd.is_active = TRUE
      GROUP BY cd.slug, cd.display_name
      ORDER BY cd.display_name ASC
      `,
      tenantKey,
    );

    const results: ReadinessConnector[] = rows.map((row) => {
      if (row.installationCount === 0) {
        return {
          slug: row.slug,
          displayName: row.displayName,
          ready: 0,
          blocked: 0,
          pending: 0,
          notConnected: true,
        };
      }
      return {
        slug: row.slug,
        displayName: row.displayName,
        ready: Number(row.ready),
        blocked: Number(row.blocked),
        pending: Number(row.pending),
      };
    });

    const response: ReadinessResponse = {
      connectors: results,
      asOf: new Date().toISOString(),
    };
    await this.emitReadinessAccuracyMetric(tenantKey, response.connectors);
    return response;
  }

  private async computeCatalogHealth(tenantKey: string): Promise<CatalogHealthResponse> {
    // RLS-BYPASS: manual tenant filter
    const rows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<
      Array<{
        averageCompleteness: number | string;
        belowThreshold: number;
        completeSkus: number;
        incompleteSkus: number;
        missingMainImage: number;
        missingRequiredAttrs: number;
        bucket0_10: number;
        bucket10_20: number;
        bucket20_30: number;
        bucket30_40: number;
        bucket40_50: number;
        bucket50_60: number;
        bucket60_70: number;
        bucket70_80: number;
        bucket80_90: number;
        bucket90_100: number;
      }>
    >(
      `
      WITH required_by_category AS (
        SELECT
          ad."categoryId" AS category_id,
          COUNT(*) FILTER (WHERE ad.required = TRUE AND ad."appliesTo" = 'product')::int AS required_count,
          COALESCE(
            ARRAY_AGG(ad.key) FILTER (WHERE ad.required = TRUE AND ad."appliesTo" = 'product'),
            ARRAY[]::text[]
          ) AS required_keys
        FROM "AttributeDefinition" ad
        WHERE ad."tenantKey" = $1
        GROUP BY ad."categoryId"
      ),
      product_base AS (
        SELECT
          p.id,
          p.attributes::jsonb AS attrs,
          (
            CASE WHEN COALESCE(BTRIM(p.title), '') <> '' THEN 1 ELSE 0 END +
            CASE WHEN COALESCE(BTRIM(p.brand), '') <> '' THEN 1 ELSE 0 END +
            CASE WHEN COALESCE(BTRIM(p.description), '') <> '' THEN 1 ELSE 0 END +
            CASE WHEN COALESCE(BTRIM(p."hsnCode"), '') <> '' THEN 1 ELSE 0 END +
            CASE WHEN p."gstRate" IS NOT NULL THEN 1 ELSE 0 END
          )::int AS core_filled,
          COALESCE(r.required_count, 0)::int AS required_count,
          COALESCE(r.required_keys, ARRAY[]::text[]) AS required_keys
        FROM "Product" p
        LEFT JOIN required_by_category r ON r.category_id = p."categoryId"
        WHERE p."tenantKey" = $1
          AND p."deletedAt" IS NULL
      ),
      scored AS (
        SELECT
          pb.id,
          pb.required_count,
          (
            SELECT COUNT(*)
            FROM UNNEST(pb.required_keys) AS key_name
            WHERE COALESCE(NULLIF(BTRIM(pb.attrs ->> key_name), ''), NULL) IS NOT NULL
          )::int AS filled_required_attrs,
          (
            CASE
              WHEN (5 + pb.required_count) = 0 THEN 100
              ELSE ROUND(((pb.core_filled + (
                SELECT COUNT(*)
                FROM UNNEST(pb.required_keys) AS key_name
                WHERE COALESCE(NULLIF(BTRIM(pb.attrs ->> key_name), ''), NULL) IS NOT NULL
              ))::numeric * 100) / (5 + pb.required_count))
            END
          )::int AS score
        FROM product_base pb
      ),
      media_products AS (
        SELECT DISTINCT product_id
        FROM media_assets
        WHERE tenant_key = $1
          AND product_id IS NOT NULL
      )
      SELECT
        COALESCE(ROUND(AVG(sc.score)::numeric, 2), 0) AS "averageCompleteness",
        COUNT(*) FILTER (WHERE sc.score < 50)::int AS "belowThreshold",
        COUNT(*) FILTER (WHERE sc.score >= 100)::int AS "completeSkus",
        COUNT(*) FILTER (WHERE sc.score < 100)::int AS "incompleteSkus",
        COUNT(*) FILTER (WHERE mp.product_id IS NULL)::int AS "missingMainImage",
        COUNT(*) FILTER (WHERE sc.required_count > sc.filled_required_attrs)::int AS "missingRequiredAttrs",
        COUNT(*) FILTER (WHERE sc.score >= 0  AND sc.score < 10)::int AS "bucket0_10",
        COUNT(*) FILTER (WHERE sc.score >= 10 AND sc.score < 20)::int AS "bucket10_20",
        COUNT(*) FILTER (WHERE sc.score >= 20 AND sc.score < 30)::int AS "bucket20_30",
        COUNT(*) FILTER (WHERE sc.score >= 30 AND sc.score < 40)::int AS "bucket30_40",
        COUNT(*) FILTER (WHERE sc.score >= 40 AND sc.score < 50)::int AS "bucket40_50",
        COUNT(*) FILTER (WHERE sc.score >= 50 AND sc.score < 60)::int AS "bucket50_60",
        COUNT(*) FILTER (WHERE sc.score >= 60 AND sc.score < 70)::int AS "bucket60_70",
        COUNT(*) FILTER (WHERE sc.score >= 70 AND sc.score < 80)::int AS "bucket70_80",
        COUNT(*) FILTER (WHERE sc.score >= 80 AND sc.score < 90)::int AS "bucket80_90",
        COUNT(*) FILTER (WHERE sc.score >= 90)::int AS "bucket90_100"
      FROM scored sc
      LEFT JOIN media_products mp ON mp.product_id = sc.id
      `,
      tenantKey,
    );

    const row = rows[0];
    const distributionCounts = [
      row?.bucket0_10 ?? 0,
      row?.bucket10_20 ?? 0,
      row?.bucket20_30 ?? 0,
      row?.bucket30_40 ?? 0,
      row?.bucket40_50 ?? 0,
      row?.bucket50_60 ?? 0,
      row?.bucket60_70 ?? 0,
      row?.bucket70_80 ?? 0,
      row?.bucket80_90 ?? 0,
      row?.bucket90_100 ?? 0,
    ];

    return {
      averageCompleteness: Number(row?.averageCompleteness ?? 0),
      belowThreshold: Number(row?.belowThreshold ?? 0),
      completeSkus: Number(row?.completeSkus ?? 0),
      incompleteSkus: Number(row?.incompleteSkus ?? 0),
      missingMainImage: Number(row?.missingMainImage ?? 0),
      missingRequiredAttrs: Number(row?.missingRequiredAttrs ?? 0),
      distribution: DISTRIBUTION_BUCKETS.map((bucket, index) => ({
        bucket,
        count: Number(distributionCounts[index] ?? 0),
      })),
      asOf: new Date().toISOString(),
    };
  }

  private async computeOperationsSummary(tenantKey: string): Promise<DashboardOperationsSummaryResponse> {
    const connectorParams: unknown[] = [tenantKey];
    const stubSlugs = resolveStubConnectorSlugs();
    let hiddenStubWhere = "";

    if (stubSlugs.length > 0) {
      const placeholders = stubSlugs.map((slug) => {
        connectorParams.push(slug);
        return `$${connectorParams.length}`;
      });
      hiddenStubWhere = ` AND LOWER(cd.slug) NOT IN (${placeholders.join(", ")})`;
    }

    const [connectorRows, submissionRows, deadLetterRows, importRows] = await Promise.all([
      this.prisma.tenant(tenantKey).$queryRawUnsafe<
        Array<{ activeConnectors: number; installedConnectors: number }>
      >(
        `
        SELECT
          COUNT(*) FILTER (WHERE ci.status = 'ACTIVE')::int AS "activeConnectors",
          COUNT(*)::int AS "installedConnectors"
        FROM connector_installations ci
        JOIN connector_definitions cd ON cd.id = ci.connector_id
        WHERE ci.tenant_key = $1
        ${hiddenStubWhere}
        `,
        ...connectorParams,
      ),
      this.prisma.tenant(tenantKey).$queryRawUnsafe<Array<{ failedSubmissionJobs: number }>>(
        `
        SELECT COUNT(*)::int AS "failedSubmissionJobs"
        FROM (
          SELECT cs.status
          FROM connector_submissions cs
          WHERE cs.tenant_key = $1
          ORDER BY cs.submitted_at DESC, cs.id DESC
          LIMIT 50
        ) recent
        WHERE UPPER(COALESCE(recent.status, '')) IN ('REJECTED', 'ERROR')
        `,
        tenantKey,
      ),
      this.prisma.tenant(tenantKey).$queryRawUnsafe<Array<{ deadLetterJobs: number }>>(
        `
        SELECT COUNT(*)::int AS "deadLetterJobs"
        FROM (
          SELECT mej.id
          FROM "MarketplaceExportJob" mej
          WHERE mej."tenantKey" = $1
            AND mej.status = 'dead_letter'
          ORDER BY mej."updatedAt" DESC, mej.id DESC
          LIMIT 50
        ) recent
        `,
        tenantKey,
      ),
      this.prisma.tenant(tenantKey).$queryRawUnsafe<Array<{ failedImportJobs: number }>>(
        `
        SELECT COUNT(*)::int AS "failedImportJobs"
        FROM (
          SELECT bij.status
          FROM "BulkImportJob" bij
          WHERE bij."tenantKey" = $1
          ORDER BY bij."updatedAt" DESC, bij.id DESC
          LIMIT 50
        ) recent
        WHERE recent.status IN ('failed', 'dead_letter')
        `,
        tenantKey,
      ),
    ]);

    const activeConnectors = Number(connectorRows[0]?.activeConnectors ?? 0);
    const installedConnectors = Number(connectorRows[0]?.installedConnectors ?? 0);
    const failedSubmissionJobs = Number(submissionRows[0]?.failedSubmissionJobs ?? 0);
    const deadLetterJobs = Number(deadLetterRows[0]?.deadLetterJobs ?? 0);
    const failedImportJobs = Number(importRows[0]?.failedImportJobs ?? 0);

    return {
      activeConnectors,
      installedConnectors,
      failedImportJobs,
      failedSubmissionJobs,
      deadLetterJobs,
      jobsNeedingRetry: failedSubmissionJobs + deadLetterJobs,
      asOf: new Date().toISOString(),
    };
  }

  private async computeDashboardHealth(tenantKey: string): Promise<DashboardHealthResponse> {
    const latestSnapshot = await this.getLatestSnapshotRow(tenantKey);
    const shouldRefresh =
      !latestSnapshot ||
      Date.now() - new Date(latestSnapshot.captured_at).getTime() >= SNAPSHOT_REFRESH_MS;

    const snapshot = shouldRefresh
      ? await this.captureSnapshot(tenantKey)
      : this.mapSnapshotRow(latestSnapshot);

    // RLS-BYPASS: manual tenant filter
    const trendRows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<
      Array<{
        captured_at: Date;
        total_skus: number;
        complete_skus: number;
        incomplete_skus: number;
        publish_ready_by_connector: Prisma.JsonValue;
        blocked_by_connector: Prisma.JsonValue;
        rejection_risk_high: number;
        open_issues_blocking: number;
        open_issues_warning: number;
      }>
    >(
      `
      SELECT
        captured_at,
        total_skus,
        complete_skus,
        incomplete_skus,
        publish_ready_by_connector,
        blocked_by_connector,
        rejection_risk_high,
        open_issues_blocking,
        open_issues_warning
      FROM dashboard_snapshots
      WHERE tenant_key = $1
        AND captured_at >= (NOW() - ($2 || ' days')::interval)
      ORDER BY captured_at ASC
      `,
      tenantKey,
      SNAPSHOT_TREND_DAYS,
    );

    const trend = trendRows.map((row) =>
      this.mapSnapshotRow({
        captured_at: row.captured_at,
        total_skus: row.total_skus,
        complete_skus: row.complete_skus,
        incomplete_skus: row.incomplete_skus,
        publish_ready_by_connector: row.publish_ready_by_connector,
        blocked_by_connector: row.blocked_by_connector,
        rejection_risk_high: row.rejection_risk_high,
        open_issues_blocking: row.open_issues_blocking,
        open_issues_warning: row.open_issues_warning,
      }),
    );

    if (trend.length === 0) {
      trend.push(snapshot);
    }

    return {
      snapshot,
      trend,
      asOf: snapshot.capturedAt,
    };
  }

  private async captureSnapshot(tenantKey: string): Promise<DashboardHealthSnapshot> {
    const [readiness, catalogHealth, totalSkus, issueCounts] = await Promise.all([
      this.computeReadiness(tenantKey),
      this.computeCatalogHealth(tenantKey),
      this.prisma.tenant(tenantKey).product.count(),
      // RLS-BYPASS: manual tenant filter
      this.prisma.tenant(tenantKey).$queryRawUnsafe<Array<{ blocking: number; warning: number }>>(
        `
        SELECT
          COUNT(*) FILTER (WHERE severity = 'error' AND status = 'open')::int AS blocking,
          COUNT(*) FILTER (WHERE severity = 'warning' AND status = 'open')::int AS warning
        FROM "ValidationIssue"
        WHERE "tenantKey" = $1
        `,
        tenantKey,
      ),
    ]);

    const publishReadyByConnector: Record<string, number> = {};
    const blockedByConnector: Record<string, number> = {};
    for (const connector of readiness.connectors) {
      publishReadyByConnector[connector.slug] = connector.ready;
      blockedByConnector[connector.slug] = connector.blocked;
    }

    const issueSummary = issueCounts[0] ?? { blocking: 0, warning: 0 };
    const snapshot: DashboardHealthSnapshot = {
      capturedAt: new Date().toISOString(),
      totalSkus,
      completeSkus: catalogHealth.completeSkus,
      incompleteSkus: catalogHealth.incompleteSkus,
      publishReadyByConnector,
      blockedByConnector,
      rejectionRiskHigh: 0,
      openIssuesBlocking: issueSummary.blocking,
      openIssuesWarning: issueSummary.warning,
    };

    // RLS-BYPASS: manual tenant filter
    await this.prisma.tenant(tenantKey).$executeRawUnsafe(
      `
      INSERT INTO dashboard_snapshots (
        id,
        tenant_key,
        captured_at,
        total_skus,
        complete_skus,
        incomplete_skus,
        publish_ready_by_connector,
        blocked_by_connector,
        rejection_risk_high,
        open_issues_blocking,
        open_issues_warning
      ) VALUES (
        $1,
        $2,
        $3::timestamptz,
        $4,
        $5,
        $6,
        $7::jsonb,
        $8::jsonb,
        $9,
        $10,
        $11
      )
      `,
      randomUUID(),
      tenantKey,
      snapshot.capturedAt,
      snapshot.totalSkus,
      snapshot.completeSkus,
      snapshot.incompleteSkus,
      JSON.stringify(snapshot.publishReadyByConnector),
      JSON.stringify(snapshot.blockedByConnector),
      snapshot.rejectionRiskHigh,
      snapshot.openIssuesBlocking,
      snapshot.openIssuesWarning,
    );

    return snapshot;
  }

  private async getLatestSnapshotRow(tenantKey: string) {
    // RLS-BYPASS: manual tenant filter
    const rows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<
      Array<{
        captured_at: Date;
        total_skus: number;
        complete_skus: number;
        incomplete_skus: number;
        publish_ready_by_connector: Prisma.JsonValue;
        blocked_by_connector: Prisma.JsonValue;
        rejection_risk_high: number;
        open_issues_blocking: number;
        open_issues_warning: number;
      }>
    >(
      `
      SELECT
        captured_at,
        total_skus,
        complete_skus,
        incomplete_skus,
        publish_ready_by_connector,
        blocked_by_connector,
        rejection_risk_high,
        open_issues_blocking,
        open_issues_warning
      FROM dashboard_snapshots
      WHERE tenant_key = $1
      ORDER BY captured_at DESC
      LIMIT 1
      `,
      tenantKey,
    );
    return rows[0] ?? null;
  }

  private mapSnapshotRow(row: {
    captured_at: Date;
    total_skus: number;
    complete_skus: number;
    incomplete_skus: number;
    publish_ready_by_connector: Prisma.JsonValue;
    blocked_by_connector: Prisma.JsonValue;
    rejection_risk_high: number;
    open_issues_blocking: number;
    open_issues_warning: number;
  }): DashboardHealthSnapshot {
    return {
      capturedAt: row.captured_at.toISOString(),
      totalSkus: row.total_skus,
      completeSkus: row.complete_skus,
      incompleteSkus: row.incomplete_skus,
      publishReadyByConnector: this.asNumberRecord(row.publish_ready_by_connector),
      blockedByConnector: this.asNumberRecord(row.blocked_by_connector),
      rejectionRiskHigh: row.rejection_risk_high,
      openIssuesBlocking: row.open_issues_blocking,
      openIssuesWarning: row.open_issues_warning,
    };
  }

  private asNumberRecord(value: Prisma.JsonValue): Record<string, number> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    const result: Record<string, number> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const num = Number(raw);
      result[key] = Number.isFinite(num) ? num : 0;
    }
    return result;
  }

  private async emitReadinessAccuracyMetric(
    tenantKey: string,
    connectors: ReadinessConnector[],
  ): Promise<void> {
    const totalProducts = await this.prisma.tenant(tenantKey).product.count();
    const classifiedProducts = connectors.reduce((sum, connector) => {
      return sum + connector.ready + connector.blocked + connector.pending;
    }, 0);
    const mismatch = Math.abs(totalProducts - classifiedProducts);
    const accuracyPercent =
      totalProducts === 0
        ? 100
        : Math.max(0, Number((100 - (mismatch * 100) / totalProducts).toFixed(2)));
    try {
      await this.metricsService.emit({
        tenantKey,
        metricKey: "readiness.accuracy_percent",
        metricValue: accuracyPercent,
        unit: "percent",
        tags: {
          totalProducts,
          classifiedProducts,
          mismatch,
        },
      });
    } catch {
      // Emission failures must not break dashboard responses.
    }
  }
}
