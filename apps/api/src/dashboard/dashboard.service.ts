import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AppliesTo } from "@prisma/client";
import { Prisma } from "@prisma/client";
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

type CacheEntry = {
  expiresAt: number;
  value: ReadinessResponse | CatalogHealthResponse | DashboardHealthResponse;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const SNAPSHOT_REFRESH_MS = 6 * 60 * 60 * 1000;
const SNAPSHOT_TREND_DAYS = 30;
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

@Injectable()
export class DashboardService {
  private readonly cache = new Map<string, CacheEntry>();

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

  private async getOrSetCache<T extends ReadinessResponse | CatalogHealthResponse | DashboardHealthResponse>(
    key: string,
    producer: () => Promise<T>,
  ): Promise<T> {
    const cached = this.cache.get(key);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.value as T;
    }
    const value = await producer();
    this.cache.set(key, {
      expiresAt: now + CACHE_TTL_MS,
      value,
    });
    return value;
  }

  private async computeReadiness(tenantKey: string): Promise<ReadinessResponse> {
    // RLS-BYPASS: manual tenant filter
    const connectors = await this.prisma.tenant(tenantKey).$queryRawUnsafe<
      Array<{ slug: string; displayName: string; installationCount: number }>
    >(
      `
      SELECT
        cd.slug AS slug,
        cd.display_name AS "displayName",
        COUNT(ci.id)::int AS "installationCount"
      FROM connector_definitions cd
      LEFT JOIN connector_installations ci
        ON ci.connector_id = cd.id
       AND ci.tenant_key = $1
       AND ci.status <> 'DISABLED'
      WHERE cd.is_active = TRUE
      GROUP BY cd.slug, cd.display_name
      ORDER BY cd.display_name ASC
      `,
      tenantKey,
    );

    const results: ReadinessConnector[] = [];
    for (const connector of connectors) {
      if (connector.installationCount === 0) {
        results.push({
          slug: connector.slug,
          displayName: connector.displayName,
          ready: 0,
          blocked: 0,
          pending: 0,
          notConnected: true,
        });
        continue;
      }

      // RLS-BYPASS: manual tenant filter
      const statusRows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<
        Array<{ status: string; count: number }>
      >(
        `
        SELECT
          cs.status AS status,
          COUNT(*)::int AS count
        FROM connector_submissions cs
        JOIN connector_installations ci ON ci.id = cs.installation_id
        JOIN connector_definitions cd ON cd.id = ci.connector_id
        WHERE ci.tenant_key = $1 AND cd.slug = $2
        GROUP BY cs.status
        `,
        tenantKey,
        connector.slug,
      );

      let ready = 0;
      let blocked = 0;
      let pending = 0;
      for (const row of statusRows) {
        const status = String(row.status).toUpperCase();
        if (status === "SUCCESS") {
          ready += Number(row.count);
          continue;
        }
        if (status === "PENDING") {
          pending += Number(row.count);
          continue;
        }
        if (status === "REJECTED" || status === "SUPPRESSED" || status === "ERROR") {
          blocked += Number(row.count);
        }
      }

      results.push({
        slug: connector.slug,
        displayName: connector.displayName,
        ready,
        blocked,
        pending,
      });
    }

    const response: ReadinessResponse = {
      connectors: results,
      asOf: new Date().toISOString(),
    };
    await this.emitReadinessAccuracyMetric(tenantKey, response.connectors);
    return response;
  }

  private async computeCatalogHealth(tenantKey: string): Promise<CatalogHealthResponse> {
    const products = await this.prisma.tenant(tenantKey).product.findMany({
      select: {
        id: true,
        categoryId: true,
        title: true,
        brand: true,
        description: true,
        hsnCode: true,
        gstRate: true,
        attributes: true,
      },
    });

    const categoryIds = Array.from(new Set(products.map((product) => product.categoryId)));
    const requiredAttributes = await this.prisma.tenant(tenantKey).attributeDefinition.findMany({
      where: {
        categoryId: { in: categoryIds },
        appliesTo: AppliesTo.product,
        required: true,
      },
      select: {
        categoryId: true,
        key: true,
      },
    });

    const requiredByCategory = new Map<string, string[]>();
    for (const attribute of requiredAttributes) {
      const current = requiredByCategory.get(attribute.categoryId) ?? [];
      current.push(attribute.key);
      requiredByCategory.set(attribute.categoryId, current);
    }

    // RLS-BYPASS: manual tenant filter
    const mediaRows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<Array<{ productId: string }>>(
      `
      SELECT DISTINCT product_id AS "productId"
      FROM media_assets
      WHERE tenant_key = $1
        AND product_id IS NOT NULL
      `,
      tenantKey,
    );
    const productIdsWithMedia = new Set(mediaRows.map((row) => row.productId));

    let scoreSum = 0;
    let belowThreshold = 0;
    let completeSkus = 0;
    let missingMainImage = 0;
    let missingRequiredAttrs = 0;
    const distributionCounts = Array.from({ length: DISTRIBUTION_BUCKETS.length }, () => 0);

    for (const product of products) {
      const requiredAttributeKeys = requiredByCategory.get(product.categoryId) ?? [];
      const score = this.calculateCompletenessScore(product, requiredAttributeKeys);
      scoreSum += score;
      if (score >= 100) {
        completeSkus += 1;
      }
      if (score < 50) {
        belowThreshold += 1;
      }

      if (!productIdsWithMedia.has(product.id)) {
        missingMainImage += 1;
      }

      const attributes = this.asRecord(product.attributes);
      const hasMissingRequiredAttrs = requiredAttributeKeys.some((key) => this.isEmpty(attributes[key]));
      if (hasMissingRequiredAttrs) {
        missingRequiredAttrs += 1;
      }

      const bucketIndex = Math.min(Math.floor(score / 10), DISTRIBUTION_BUCKETS.length - 1);
      distributionCounts[bucketIndex] += 1;
    }

    const averageCompleteness =
      products.length === 0 ? 0 : Number((scoreSum / products.length).toFixed(2));

    return {
      averageCompleteness,
      belowThreshold,
      completeSkus,
      incompleteSkus: Math.max(0, products.length - completeSkus),
      missingMainImage,
      missingRequiredAttrs,
      distribution: DISTRIBUTION_BUCKETS.map((bucket, index) => ({
        bucket,
        count: distributionCounts[index],
      })),
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

  private calculateCompletenessScore(
    product: {
      title: string;
      brand: string;
      description: string;
      hsnCode: string | null;
      gstRate: number | null;
      attributes: unknown;
    },
    requiredAttributeKeys: string[],
  ) {
    const coreValues = [product.title, product.brand, product.description, product.hsnCode, product.gstRate];
    const filledCore = coreValues.filter((value) => !this.isEmpty(value)).length;
    const requiredTotal = coreValues.length + requiredAttributeKeys.length;
    if (requiredTotal === 0) {
      return 100;
    }
    const attributes = this.asRecord(product.attributes);
    const filledAttributes = requiredAttributeKeys.filter((key) => !this.isEmpty(attributes[key])).length;
    return Math.round(((filledCore + filledAttributes) / requiredTotal) * 100);
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private isEmpty(value: unknown): boolean {
    return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
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
