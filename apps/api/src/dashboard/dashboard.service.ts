import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma, RecordStatus } from "@prisma/client";
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
  pendingApprovals: number;
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
const STALE_CACHE_TTL_SECONDS = 6 * 60 * 60;
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

const DASHBOARD_SNAPSHOT_SELECT = {
  capturedAt: true,
  totalSkus: true,
  completeSkus: true,
  incompleteSkus: true,
  publishReadyByConnector: true,
  blockedByConnector: true,
  rejectionRiskHigh: true,
  openIssuesBlocking: true,
  openIssuesWarning: true,
} satisfies Prisma.DashboardSnapshotSelect;

type DashboardSnapshotRow = Prisma.DashboardSnapshotGetPayload<{
  select: typeof DASHBOARD_SNAPSHOT_SELECT;
}>;

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
  private readonly catalogHealthRefreshes = new Map<string, Promise<void>>();
  private readonly dashboardHealthRefreshes = new Map<string, Promise<void>>();
  private readonly allowInMemoryFallbackCache = true;
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
    const cacheKey = `dashboard:catalog-health:v2:${tenantKey}`;
    return this.getCatalogHealthCached(tenantKey, cacheKey);
  }

  async getHealth(): Promise<DashboardHealthResponse> {
    const tenantKey = normalizeTenantKey(getTenantKeyFromContext());
    const cacheKey = `dashboard:health:v3:${tenantKey}`;
    return this.getOrSetCache(cacheKey, async () => this.computeDashboardHealth(tenantKey, cacheKey));
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

  private async getCatalogHealthCached(
    tenantKey: string,
    cacheKey: string,
  ): Promise<CatalogHealthResponse> {
    const cached = await this.readCache<CatalogHealthResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    const staleCacheKey = `${cacheKey}:stale`;
    const stale = await this.readStaleCache<CatalogHealthResponse>(staleCacheKey);
    if (stale) {
      this.scheduleCatalogHealthRefresh(tenantKey, cacheKey, staleCacheKey);
      return stale;
    }

    const value = await this.computeCatalogHealth(tenantKey);
    await Promise.all([
      this.writeCache(cacheKey, value),
      this.writeStaleCache(staleCacheKey, value),
    ]);
    return value;
  }

  private async readCache<T>(key: string): Promise<T | null> {
    return this.readCacheValue<T>(key, CACHE_TTL_SECONDS);
  }

  private async writeCache<T>(key: string, value: T): Promise<void> {
    await this.writeCacheValue(key, value, CACHE_TTL_SECONDS);
  }

  private async deleteCache(key: string): Promise<void> {
    if (this.allowInMemoryFallbackCache) {
      this.fallbackCache.delete(key);
    }
    if (!(await this.ensureRedisAvailable()) || !this.redisClient) {
      return;
    }
    try {
      await this.redisClient.del(key);
    } catch {
      this.markRedisUnavailable();
    }
  }

  private async readStaleCache<T>(key: string): Promise<T | null> {
    return this.readCacheValue<T>(key, STALE_CACHE_TTL_SECONDS);
  }

  private async writeStaleCache<T>(key: string, value: T): Promise<void> {
    await this.writeCacheValue(key, value, STALE_CACHE_TTL_SECONDS);
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
    ttlSeconds = CACHE_TTL_SECONDS,
  ): void {
    this.fallbackCache.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  private async readCacheValue<T>(key: string, ttlSeconds: number): Promise<T | null> {
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
      const parsed = JSON.parse(String(raw)) as T;
      if (this.allowInMemoryFallbackCache) {
        this.writeFallbackCache(key, parsed as DashboardCachedValue, ttlSeconds);
      }
      return parsed;
    } catch {
      this.markRedisUnavailable();
      return null;
    }
  }

  private async writeCacheValue<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (this.allowInMemoryFallbackCache) {
      this.writeFallbackCache(key, value as DashboardCachedValue, ttlSeconds);
    }
    if (!(await this.ensureRedisAvailable()) || !this.redisClient) {
      return;
    }
    try {
      await this.redisClient.setEx(key, ttlSeconds, JSON.stringify(value));
    } catch {
      this.markRedisUnavailable();
    }
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
    this.catalogHealthRefreshes.clear();
    this.dashboardHealthRefreshes.clear();
    if (this.redisClient) {
      await this.redisClient.quit().catch(() => undefined);
      this.redisClient = null;
    }
    this.redisAvailable = false;
  }

  private async computeReadiness(tenantKey: string): Promise<ReadinessResponse> {
    const [definitions, installations] = await Promise.all([
      this.prisma.tenant(tenantKey).connectorDefinition.findMany({
        where: { isActive: true },
        orderBy: [{ displayName: "asc" }],
        take: 50, // defensive cap — no tenant has > ~20 marketplace connectors
        select: {
          id: true,
          slug: true,
          displayName: true,
        },
      }),
      this.prisma.tenant(tenantKey).connectorInstallation.findMany({
        where: {
          status: { not: "DISABLED" },
        },
        take: 200, // defensive cap — installations are bounded by definitions × stores
        select: {
          id: true,
          connectorId: true,
        },
      }),
    ]);

    const installationIds = installations.map((installation) => installation.id);
    const submissions = installationIds.length === 0
      ? []
      : await this.prisma.tenant(tenantKey).connectorSubmission.findMany({
          where: {
            installationId: { in: installationIds },
          },
          take: 10_000, // defensive cap — one submission per product-installation pair
          select: {
            installationId: true,
            status: true,
          },
        });

    const installationsByConnector = new Map<string, string[]>();
    for (const installation of installations) {
      const rows = installationsByConnector.get(installation.connectorId) ?? [];
      rows.push(installation.id);
      installationsByConnector.set(installation.connectorId, rows);
    }

    const submissionCountsByInstallation = new Map<string, { ready: number; blocked: number; pending: number }>();
    for (const submission of submissions) {
      const status = String(submission.status ?? "").trim().toUpperCase();
      const counts = submissionCountsByInstallation.get(submission.installationId) ?? {
        ready: 0,
        blocked: 0,
        pending: 0,
      };
      if (status === "SUCCESS") {
        counts.ready += 1;
      } else if (status === "PENDING") {
        counts.pending += 1;
      } else if (status === "REJECTED" || status === "SUPPRESSED" || status === "ERROR") {
        counts.blocked += 1;
      }
      submissionCountsByInstallation.set(submission.installationId, counts);
    }

    const results: ReadinessConnector[] = definitions.map((definition) => {
      const connectorInstallationIds = installationsByConnector.get(definition.id) ?? [];
      if (connectorInstallationIds.length === 0) {
        return {
          slug: definition.slug,
          displayName: definition.displayName,
          ready: 0,
          blocked: 0,
          pending: 0,
          notConnected: true,
        };
      }

      const connectorCounts = connectorInstallationIds.reduce(
        (totals, installationId) => {
          const counts = submissionCountsByInstallation.get(installationId);
          if (!counts) {
            return totals;
          }
          totals.ready += counts.ready;
          totals.blocked += counts.blocked;
          totals.pending += counts.pending;
          return totals;
        },
        { ready: 0, blocked: 0, pending: 0 },
      );

      return {
        slug: definition.slug,
        displayName: definition.displayName,
        ready: connectorCounts.ready,
        blocked: connectorCounts.blocked,
        pending: connectorCounts.pending,
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
    const [requiredAttributes, products, mediaProducts] = await Promise.all([
      this.prisma.tenant(tenantKey).attributeDefinition.findMany({
        where: {
          required: true,
          appliesTo: "product",
        },
        take: 1_000, // defensive cap — attribute definitions are admin-configured
        select: {
          categoryId: true,
          key: true,
        },
      }),
      this.prisma.tenant(tenantKey).product.findMany({
        where: {
          deletedAt: null,
        },
        // NOTE: catalog-health metrics are sampled above 50k products.
        // For accurate full-catalog scoring at scale, replace with aggregated DB queries.
        take: 50_000,
        select: {
          id: true,
          title: true,
          brand: true,
          description: true,
          hsnCode: true,
          gstRate: true,
          attributes: true,
          categoryId: true,
        },
      }),
      this.prisma.tenant(tenantKey).mediaAsset.findMany({
        where: {
          productId: { not: null },
        },
        distinct: ["productId"],
        take: 50_000, // defensive cap — one distinct productId per product
        select: {
          productId: true,
        },
      }),
    ]);

    const requiredKeysByCategory = new Map<string, string[]>();
    for (const attribute of requiredAttributes) {
      const keys = requiredKeysByCategory.get(attribute.categoryId) ?? [];
      keys.push(attribute.key);
      requiredKeysByCategory.set(attribute.categoryId, keys);
    }

    const mediaProductIds = new Set(
      mediaProducts
        .map((row) => row.productId)
        .filter((productId): productId is string => typeof productId === "string" && productId.length > 0),
    );

    const distributionCounts = new Map<string, number>(
      DISTRIBUTION_BUCKETS.map((bucket) => [bucket, 0]),
    );
    let scoreTotal = 0;
    let belowThreshold = 0;
    let completeSkus = 0;
    let incompleteSkus = 0;
    let missingMainImage = 0;
    let missingRequiredAttrs = 0;

    for (const product of products) {
      const attributes = this.asJsonRecord(product.attributes);
      const requiredKeys = requiredKeysByCategory.get(product.categoryId) ?? [];
      const coreFilled = [
        product.title,
        product.brand,
        product.description,
        product.hsnCode,
      ].filter((value) => this.hasFilledValue(value)).length + (product.gstRate !== null ? 1 : 0);
      const filledRequiredAttrs = requiredKeys.filter((key) => this.hasFilledValue(attributes[key])).length;
      const score = this.computeCompletenessScore(coreFilled, requiredKeys.length, filledRequiredAttrs);
      const bucket = this.resolveCompletenessBucket(score);

      scoreTotal += score;
      distributionCounts.set(bucket, (distributionCounts.get(bucket) ?? 0) + 1);
      if (score < 50) {
        belowThreshold += 1;
      }
      if (score >= 100) {
        completeSkus += 1;
      } else {
        incompleteSkus += 1;
      }
      if (!mediaProductIds.has(product.id)) {
        missingMainImage += 1;
      }
      if (requiredKeys.length > filledRequiredAttrs) {
        missingRequiredAttrs += 1;
      }
    }

    const averageCompleteness = products.length === 0
      ? 0
      : Number((scoreTotal / products.length).toFixed(2));

    return {
      averageCompleteness,
      belowThreshold,
      completeSkus,
      incompleteSkus,
      missingMainImage,
      missingRequiredAttrs,
      distribution: DISTRIBUTION_BUCKETS.map((bucket) => ({
        bucket,
        count: distributionCounts.get(bucket) ?? 0,
      })),
      asOf: new Date().toISOString(),
    };
  }

  private async computeOperationsSummary(tenantKey: string): Promise<DashboardOperationsSummaryResponse> {
    const stubSlugs = resolveStubConnectorSlugs();
    const [definitions, installations, submissions, deadLetterJobs, importJobs] = await Promise.all([
      this.prisma.tenant(tenantKey).connectorDefinition.findMany({
        take: 50, // defensive cap — marketplace connectors are few per tenant
        select: {
          id: true,
          slug: true,
        },
      }),
      this.prisma.tenant(tenantKey).connectorInstallation.findMany({
        take: 200, // defensive cap — installations bounded by definitions × store accounts
        select: {
          connectorId: true,
          status: true,
        },
      }),
      this.prisma.tenant(tenantKey).connectorSubmission.findMany({
        orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
        take: 50,
        select: {
          status: true,
        },
      }),
      this.prisma.tenant(tenantKey).marketplaceExportJob.findMany({
        where: {
          status: "dead_letter",
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 50,
        select: {
          id: true,
        },
      }),
      this.prisma.tenant(tenantKey).bulkImportJob.findMany({
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 50,
        select: {
          status: true,
        },
      }),
    ]);

    const hiddenStubSlugs = new Set(stubSlugs.map((slug) => slug.toLowerCase()));
    const connectorSlugById = new Map(definitions.map((definition) => [definition.id, definition.slug]));
    const visibleInstallations = installations.filter((installation) => {
      const slug = connectorSlugById.get(installation.connectorId) ?? "";
      return !hiddenStubSlugs.has(slug.toLowerCase());
    });

    const activeConnectors = visibleInstallations.filter((installation) => installation.status === "ACTIVE").length;
    const installedConnectors = visibleInstallations.length;
    const failedSubmissionJobs = submissions.filter((submission) => {
      const status = String(submission.status ?? "").trim().toUpperCase();
      return status === "REJECTED" || status === "ERROR";
    }).length;
    const deadLetterJobsCount = deadLetterJobs.length;
    const failedImportJobs = importJobs.filter((job) => job.status === "failed" || job.status === "dead_letter").length;

    return {
      activeConnectors,
      installedConnectors,
      failedImportJobs,
      failedSubmissionJobs,
      deadLetterJobs: deadLetterJobsCount,
      jobsNeedingRetry: failedSubmissionJobs + deadLetterJobsCount,
      asOf: new Date().toISOString(),
    };
  }

  private async computeDashboardHealth(
    tenantKey: string,
    cacheKey: string,
  ): Promise<DashboardHealthResponse> {
    const [latestSnapshot, pendingApprovals] = await Promise.all([
      this.getLatestSnapshotRow(tenantKey),
      this.prisma.tenant(tenantKey).product.count({
        where: {
          status: RecordStatus.in_review,
        },
      }),
    ]);
    const latestSnapshotAgeMs = latestSnapshot
      ? Date.now() - new Date(latestSnapshot.capturedAt).getTime()
      : Number.POSITIVE_INFINITY;
    const shouldRefresh = latestSnapshotAgeMs >= SNAPSHOT_REFRESH_MS;

    let snapshot: DashboardHealthSnapshot;
    if (!latestSnapshot) {
      snapshot = await this.captureSnapshot(tenantKey);
    } else {
      snapshot = this.mapSnapshotRow(latestSnapshot);
      if (shouldRefresh) {
        this.scheduleDashboardHealthRefresh(tenantKey, cacheKey);
      }
    }

    const trendRows = await this.prisma.tenant(tenantKey).dashboardSnapshot.findMany({
      where: {
        capturedAt: {
          gte: new Date(Date.now() - SNAPSHOT_TREND_DAYS * 24 * 60 * 60 * 1000),
        },
      },
      orderBy: [{ capturedAt: "asc" }],
      select: DASHBOARD_SNAPSHOT_SELECT,
    });

    const trend = trendRows.map((row) => this.mapSnapshotRow(row));

    if (trend.length === 0) {
      trend.push(snapshot);
    }

    return {
      snapshot,
      trend,
      asOf: snapshot.capturedAt,
      pendingApprovals: Number(pendingApprovals ?? 0),
    };
  }

  private scheduleCatalogHealthRefresh(
    tenantKey: string,
    cacheKey: string,
    staleCacheKey: string,
  ): void {
    if (this.catalogHealthRefreshes.has(tenantKey)) {
      return;
    }

    const refresh = (async () => {
      try {
        const value = await this.computeCatalogHealth(tenantKey);
        await Promise.all([
          this.writeCache(cacheKey, value),
          this.writeStaleCache(staleCacheKey, value),
        ]);
      } catch {
        // Best-effort refresh: keep serving the last catalog-health value if refresh fails.
      } finally {
        this.catalogHealthRefreshes.delete(tenantKey);
      }
    })();

    this.catalogHealthRefreshes.set(tenantKey, refresh);
  }

  private scheduleDashboardHealthRefresh(tenantKey: string, cacheKey: string): void {
    if (this.dashboardHealthRefreshes.has(tenantKey)) {
      return;
    }

    const refresh = (async () => {
      try {
        await this.captureSnapshot(tenantKey);
        await this.deleteCache(cacheKey);
      } catch {
        // Best-effort refresh: keep serving the last snapshot if background refresh fails.
      } finally {
        this.dashboardHealthRefreshes.delete(tenantKey);
      }
    })();

    this.dashboardHealthRefreshes.set(tenantKey, refresh);
  }

  private async captureSnapshot(tenantKey: string): Promise<DashboardHealthSnapshot> {
    const [readiness, catalogHealth, totalSkus, openIssuesBlocking, openIssuesWarning] = await Promise.all([
      this.computeReadiness(tenantKey),
      this.computeCatalogHealth(tenantKey),
      this.prisma.tenant(tenantKey).product.count(),
      this.prisma.tenant(tenantKey).validationIssue.count({
        where: {
          severity: "error",
          status: "open",
        },
      }),
      this.prisma.tenant(tenantKey).validationIssue.count({
        where: {
          severity: "warning",
          status: "open",
        },
      }),
    ]);

    const publishReadyByConnector: Record<string, number> = {};
    const blockedByConnector: Record<string, number> = {};
    for (const connector of readiness.connectors) {
      publishReadyByConnector[connector.slug] = connector.ready;
      blockedByConnector[connector.slug] = connector.blocked;
    }

    const snapshot: DashboardHealthSnapshot = {
      capturedAt: new Date().toISOString(),
      totalSkus,
      completeSkus: catalogHealth.completeSkus,
      incompleteSkus: catalogHealth.incompleteSkus,
      publishReadyByConnector,
      blockedByConnector,
      rejectionRiskHigh: 0,
      openIssuesBlocking,
      openIssuesWarning,
    };

    await this.prisma.tenant(tenantKey).dashboardSnapshot.create({
      data: {
        id: randomUUID(),
        capturedAt: new Date(snapshot.capturedAt),
        totalSkus: snapshot.totalSkus,
        completeSkus: snapshot.completeSkus,
        incompleteSkus: snapshot.incompleteSkus,
        publishReadyByConnector: snapshot.publishReadyByConnector,
        blockedByConnector: snapshot.blockedByConnector,
        rejectionRiskHigh: snapshot.rejectionRiskHigh,
        openIssuesBlocking: snapshot.openIssuesBlocking,
        openIssuesWarning: snapshot.openIssuesWarning,
      },
    });

    return snapshot;
  }

  private async getLatestSnapshotRow(tenantKey: string) {
    return this.prisma.tenant(tenantKey).dashboardSnapshot.findFirst({
      orderBy: [{ capturedAt: "desc" }],
      select: DASHBOARD_SNAPSHOT_SELECT,
    });
  }

  private mapSnapshotRow(row: DashboardSnapshotRow): DashboardHealthSnapshot {
    return {
      capturedAt: row.capturedAt.toISOString(),
      totalSkus: row.totalSkus,
      completeSkus: row.completeSkus,
      incompleteSkus: row.incompleteSkus,
      publishReadyByConnector: this.asNumberRecord(row.publishReadyByConnector),
      blockedByConnector: this.asNumberRecord(row.blockedByConnector),
      rejectionRiskHigh: row.rejectionRiskHigh,
      openIssuesBlocking: row.openIssuesBlocking,
      openIssuesWarning: row.openIssuesWarning,
    };
  }

  private asJsonRecord(value: Prisma.JsonValue): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  }

  private hasFilledValue(value: unknown): boolean {
    if (value === null || value === undefined) {
      return false;
    }
    if (typeof value === "string") {
      return value.trim().length > 0;
    }
    return true;
  }

  private computeCompletenessScore(
    coreFilled: number,
    requiredCount: number,
    filledRequiredAttrs: number,
  ): number {
    const denominator = 5 + requiredCount;
    if (denominator === 0) {
      return 100;
    }
    return Math.round(((coreFilled + filledRequiredAttrs) * 100) / denominator);
  }

  private resolveCompletenessBucket(score: number): string {
    if (score < 10) {
      return "0-10";
    }
    if (score < 20) {
      return "10-20";
    }
    if (score < 30) {
      return "20-30";
    }
    if (score < 40) {
      return "30-40";
    }
    if (score < 50) {
      return "40-50";
    }
    if (score < 60) {
      return "50-60";
    }
    if (score < 70) {
      return "60-70";
    }
    if (score < 80) {
      return "70-80";
    }
    if (score < 90) {
      return "80-90";
    }
    return "90-100";
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
