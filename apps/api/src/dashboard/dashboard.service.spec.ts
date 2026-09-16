// Coverage for DashboardService — zero test coverage before, despite being
// the aggregation layer behind every dashboard/health widget in the app.
// Focused on the riskiest, previously-unverified properties:
//   (a) the Redis + in-memory fallback cache: a Redis connection failure
//       must never throw or break a dashboard response, and disabling Redis
//       entirely must mean it's never even attempted;
//   (b) computeConnectorInstallationsHealth()'s aggregation: a connector's
//       rolled-up ready/blocked/pending must equal the sum of its own
//       installations' counts (same count-integrity risk class as PIM#661/
//       #844), a connector with zero installations must read as
//       "not connected" rather than "0 activity", and lastSubmittedAt must
//       be a true max across submissions, not just the last one iterated;
//   (c) computeCatalogHealth()'s completeness bucketing at the exact
//       threshold boundaries (score===50 must land in "50-60", not "40-50",
//       since the service's own bucket function uses `score < N`);
//   (d) computeOperationsSummary()'s CONNECTOR_STUB_SLUGS hiding — a stub
//       connector's installation must not count toward active/installed
//       totals;
//   (e) computeDashboardHealth()'s snapshot-or-capture fallback and the
//       trend-defaults-to-current-snapshot behavior when no history exists.
//
// Real crypto/DB are out of scope here (this is aggregation/caching logic,
// not persistence-boundary code); Prisma and the `redis` package are mocked,
// but the mocks are deliberately shaped to expose real behavior (a fallback
// Map for the in-memory cache, a rejecting connect() for the Redis-down
// case) rather than just recording calls.

jest.mock("redis");

import { RecordStatus } from "@prisma/client";
import { createClient } from "redis";
import { DashboardService } from "./dashboard.service";
import * as tenantContext from "../common/tenant/tenant-context";

jest.spyOn(tenantContext, "getTenantKeyFromContext").mockReturnValue("acme");

function makePrismaStub() {
  const connectorDefinitionFindMany = jest.fn().mockResolvedValue([]);
  const connectorInstallationFindMany = jest.fn().mockResolvedValue([]);
  const connectorSubmissionFindMany = jest.fn().mockResolvedValue([]);
  const attributeDefinitionFindMany = jest.fn().mockResolvedValue([]);
  const productFindMany = jest.fn().mockResolvedValue([]);
  const productCount = jest.fn().mockResolvedValue(0);
  const mediaAssetFindMany = jest.fn().mockResolvedValue([]);
  const marketplaceExportJobFindMany = jest.fn().mockResolvedValue([]);
  const bulkImportJobFindMany = jest.fn().mockResolvedValue([]);
  const validationIssueCount = jest.fn().mockResolvedValue(0);
  const dashboardSnapshotFindFirst = jest.fn().mockResolvedValue(null);
  const dashboardSnapshotFindMany = jest.fn().mockResolvedValue([]);
  const dashboardSnapshotCreate = jest.fn().mockResolvedValue(undefined);

  const tenantClient = {
    connectorDefinition: { findMany: connectorDefinitionFindMany },
    connectorInstallation: { findMany: connectorInstallationFindMany },
    connectorSubmission: { findMany: connectorSubmissionFindMany },
    attributeDefinition: { findMany: attributeDefinitionFindMany },
    product: { findMany: productFindMany, count: productCount },
    mediaAsset: { findMany: mediaAssetFindMany },
    marketplaceExportJob: { findMany: marketplaceExportJobFindMany },
    bulkImportJob: { findMany: bulkImportJobFindMany },
    validationIssue: { count: validationIssueCount },
    dashboardSnapshot: {
      findFirst: dashboardSnapshotFindFirst,
      findMany: dashboardSnapshotFindMany,
      create: dashboardSnapshotCreate,
    },
  };

  return {
    prisma: { tenant: jest.fn().mockReturnValue(tenantClient) },
    mocks: {
      connectorDefinitionFindMany,
      connectorInstallationFindMany,
      connectorSubmissionFindMany,
      attributeDefinitionFindMany,
      productFindMany,
      productCount,
      mediaAssetFindMany,
      marketplaceExportJobFindMany,
      bulkImportJobFindMany,
      validationIssueCount,
      dashboardSnapshotFindFirst,
      dashboardSnapshotFindMany,
      dashboardSnapshotCreate,
    },
  };
}

function makeMetricsStub() {
  return { emit: jest.fn().mockResolvedValue(undefined) };
}

function createService(env: Record<string, string> = {}) {
  const originalEnv = process.env;
  process.env = { ...originalEnv, DASHBOARD_CACHE_REDIS_DISABLED: "true", ...env };
  const { prisma, mocks } = makePrismaStub();
  const metrics = makeMetricsStub();
  const service = new DashboardService(prisma as never, metrics as never);
  process.env = originalEnv;
  return { service, mocks, metrics };
}

describe("DashboardService — cache layer", () => {
  afterEach(() => jest.clearAllMocks());

  it("never even attempts Redis when DASHBOARD_CACHE_REDIS_DISABLED=true, and still serves via the in-memory fallback", async () => {
    const { service, mocks } = createService();
    mocks.connectorDefinitionFindMany.mockResolvedValue([]);

    const first = await service.getReadiness();
    const second = await service.getReadiness();

    expect(createClient).not.toHaveBeenCalled();
    // Second call within TTL is served from the in-memory fallback cache,
    // not recomputed — connectorDefinition.findMany only called once overall.
    expect(mocks.connectorDefinitionFindMany).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("falls back to the in-memory cache without throwing when Redis fails to connect", async () => {
    (createClient as jest.Mock).mockReturnValue({
      on: jest.fn(),
      connect: jest.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      get: jest.fn(),
      setEx: jest.fn(),
      del: jest.fn(),
      quit: jest.fn().mockResolvedValue(undefined),
    });
    // Redis enabled (not disabled) this time, so ensureRedisAvailable() actually tries to connect.
    const { service, mocks } = createService({ DASHBOARD_CACHE_REDIS_DISABLED: "false" });

    await expect(service.getReadiness()).resolves.toBeDefined();
    const second = await service.getReadiness();

    expect(createClient).toHaveBeenCalledTimes(1);
    // Still only computed once — the in-memory fallback served the second call
    // even though every Redis operation is failing.
    expect(mocks.connectorDefinitionFindMany).toHaveBeenCalledTimes(1);
    expect(second).toBeDefined();
  });
});

describe("DashboardService — computeConnectorInstallationsHealth", () => {
  afterEach(() => jest.clearAllMocks());

  it("marks a connector with zero installations as notConnected, not zero-activity", async () => {
    const { service, mocks } = createService();
    mocks.connectorDefinitionFindMany.mockResolvedValue([
      { id: "def-1", slug: "amazon_india", displayName: "Amazon India" },
    ]);
    mocks.connectorInstallationFindMany.mockResolvedValue([]);

    const result = await service.getConnectorInstallationsHealth();

    expect(result.connectors).toEqual([
      expect.objectContaining({ slug: "amazon_india", notConnected: true, ready: 0, blocked: 0, pending: 0 }),
    ]);
  });

  it("rolls up a connector's ready/blocked/pending as the true sum of its own installations, not another connector's", async () => {
    const { service, mocks } = createService();
    mocks.connectorDefinitionFindMany.mockResolvedValue([
      { id: "def-shopify", slug: "shopify", displayName: "Shopify" },
      { id: "def-woo", slug: "woocommerce", displayName: "WooCommerce" },
    ]);
    mocks.connectorInstallationFindMany.mockResolvedValue([
      { id: "inst-shopify-1", connectorId: "def-shopify", accountAlias: "main", externalAccountRef: null, status: "ACTIVE" },
      { id: "inst-woo-1", connectorId: "def-woo", accountAlias: "main", externalAccountRef: null, status: "ACTIVE" },
    ]);
    mocks.connectorSubmissionFindMany.mockResolvedValue([
      { installationId: "inst-shopify-1", status: "SUCCESS", submittedAt: new Date("2026-01-01T00:00:00Z") },
      { installationId: "inst-shopify-1", status: "SUCCESS", submittedAt: new Date("2026-01-02T00:00:00Z") },
      { installationId: "inst-woo-1", status: "ERROR", submittedAt: new Date("2026-01-01T00:00:00Z") },
    ]);

    const result = await service.getConnectorInstallationsHealth();

    const shopify = result.connectors.find((c) => c.slug === "shopify")!;
    const woo = result.connectors.find((c) => c.slug === "woocommerce")!;
    expect(shopify).toEqual(expect.objectContaining({ ready: 2, blocked: 0, pending: 0 }));
    expect(woo).toEqual(expect.objectContaining({ ready: 0, blocked: 1, pending: 0 }));
    // Cross-check: total across connectors equals total across raw submissions (3).
    const totalAcrossConnectors = result.connectors.reduce((s, c) => s + c.ready + c.blocked + c.pending, 0);
    expect(totalAcrossConnectors).toBe(3);
  });

  it("buckets every real submission status correctly: SUCCESS->ready, PENDING->pending, REJECTED/SUPPRESSED/ERROR->blocked", async () => {
    const { service, mocks } = createService();
    mocks.connectorDefinitionFindMany.mockResolvedValue([{ id: "def-1", slug: "shopify", displayName: "Shopify" }]);
    mocks.connectorInstallationFindMany.mockResolvedValue([
      { id: "inst-1", connectorId: "def-1", accountAlias: "main", externalAccountRef: null, status: "ACTIVE" },
    ]);
    mocks.connectorSubmissionFindMany.mockResolvedValue([
      { installationId: "inst-1", status: "SUCCESS", submittedAt: null },
      { installationId: "inst-1", status: "PENDING", submittedAt: null },
      { installationId: "inst-1", status: "REJECTED", submittedAt: null },
      { installationId: "inst-1", status: "SUPPRESSED", submittedAt: null },
      { installationId: "inst-1", status: "ERROR", submittedAt: null },
    ]);

    const result = await service.getConnectorInstallationsHealth();

    expect(result.installations[0]).toEqual(
      expect.objectContaining({ ready: 1, pending: 1, blocked: 3 }),
    );
  });

  it("takes the true max submittedAt across a connector's submissions, not just the last one iterated", async () => {
    const { service, mocks } = createService();
    mocks.connectorDefinitionFindMany.mockResolvedValue([{ id: "def-1", slug: "shopify", displayName: "Shopify" }]);
    mocks.connectorInstallationFindMany.mockResolvedValue([
      { id: "inst-1", connectorId: "def-1", accountAlias: "main", externalAccountRef: null, status: "ACTIVE" },
    ]);
    // Deliberately out of order: the latest timestamp is NOT the last row.
    mocks.connectorSubmissionFindMany.mockResolvedValue([
      { installationId: "inst-1", status: "SUCCESS", submittedAt: new Date("2026-03-01T00:00:00Z") },
      { installationId: "inst-1", status: "SUCCESS", submittedAt: new Date("2026-01-01T00:00:00Z") },
    ]);

    const result = await service.getConnectorInstallationsHealth();

    expect(result.installations[0].lastSubmittedAt).toBe("2026-03-01T00:00:00.000Z");
  });
});

describe("DashboardService — computeCatalogHealth completeness scoring", () => {
  afterEach(() => jest.clearAllMocks());

  it("returns 0 average completeness for an empty catalog instead of dividing by zero", async () => {
    const { service, mocks } = createService();
    mocks.productFindMany.mockResolvedValue([]);

    const result = await service.getCatalogHealth();

    expect(result.averageCompleteness).toBe(0);
  });

  it("scores a fully-filled product with no required attributes at exactly 100 and buckets it as 90-100", async () => {
    const { service, mocks } = createService();
    mocks.attributeDefinitionFindMany.mockResolvedValue([]);
    mocks.productFindMany.mockResolvedValue([
      {
        id: "p1",
        title: "T-Shirt",
        brand: "Vexa",
        description: "A shirt",
        hsnCode: "6109",
        gstRate: 12,
        attributes: {},
        categoryId: "cat-1",
      },
    ]);
    mocks.mediaAssetFindMany.mockResolvedValue([{ productId: "p1" }]);

    const result = await service.getCatalogHealth();

    expect(result.averageCompleteness).toBe(100);
    expect(result.completeSkus).toBe(1);
    expect(result.incompleteSkus).toBe(0);
    expect(result.distribution.find((d) => d.bucket === "90-100")?.count).toBe(1);
  });

  it("buckets a score of exactly 50 as 50-60, not 40-50 (boundary is score < N, not <=)", async () => {
    const { service, mocks } = createService();
    // 1 required attribute, filled: denominator = 5 + 1 = 6. Need round((core+1)*100/6) === 50
    // -> core*100/6 + 100/6 ~= 50 -> core ~= 2. With 2 of 4 core fields filled + gstRate null: coreFilled=2.
    mocks.attributeDefinitionFindMany.mockResolvedValue([{ categoryId: "cat-1", key: "color" }]);
    mocks.productFindMany.mockResolvedValue([
      {
        id: "p1",
        title: "T-Shirt",
        brand: "Vexa",
        description: null,
        hsnCode: null,
        gstRate: null,
        attributes: { color: "red" },
        categoryId: "cat-1",
      },
    ]);
    mocks.mediaAssetFindMany.mockResolvedValue([]);

    const result = await service.getCatalogHealth();

    // coreFilled=2 (title,brand) + filledRequiredAttrs=1 = 3; denominator=6; score=round(300/6)=50.
    expect(result.averageCompleteness).toBe(50);
    expect(result.distribution.find((d) => d.bucket === "50-60")?.count).toBe(1);
    expect(result.distribution.find((d) => d.bucket === "40-50")?.count).toBe(0);
  });

  it("counts missingMainImage and missingRequiredAttrs independently of the completeness score", async () => {
    const { service, mocks } = createService();
    mocks.attributeDefinitionFindMany.mockResolvedValue([{ categoryId: "cat-1", key: "color" }]);
    mocks.productFindMany.mockResolvedValue([
      {
        id: "p1",
        title: "T-Shirt",
        brand: "Vexa",
        description: "desc",
        hsnCode: "6109",
        gstRate: 12,
        attributes: {}, // missing the required "color" attribute
        categoryId: "cat-1",
      },
    ]);
    mocks.mediaAssetFindMany.mockResolvedValue([]); // no media at all -> missing main image

    const result = await service.getCatalogHealth();

    expect(result.missingMainImage).toBe(1);
    expect(result.missingRequiredAttrs).toBe(1);
  });
});

describe("DashboardService — computeOperationsSummary CONNECTOR_STUB_SLUGS hiding", () => {
  afterEach(() => jest.clearAllMocks());

  it("excludes a stub-slug connector's installation from active/installed totals", async () => {
    // CONNECTOR_STUB_SLUGS is read per-call inside computeOperationsSummary(),
    // not cached at construction time like DASHBOARD_CACHE_REDIS_DISABLED is -
    // so it must be set around the call itself, not just around `new DashboardService()`.
    const { service, mocks } = createService();
    mocks.connectorDefinitionFindMany.mockResolvedValue([
      { id: "def-real", slug: "shopify" },
      { id: "def-stub", slug: "internal_test_connector" },
    ]);
    mocks.connectorInstallationFindMany.mockResolvedValue([
      { connectorId: "def-real", status: "ACTIVE" },
      { connectorId: "def-stub", status: "ACTIVE" },
    ]);

    const originalEnv = process.env;
    process.env = { ...originalEnv, CONNECTOR_STUB_SLUGS: "internal_test_connector" };
    let result;
    try {
      result = await service.getOperationsSummary();
    } finally {
      process.env = originalEnv;
    }

    expect(result.activeConnectors).toBe(1);
    expect(result.installedConnectors).toBe(1);
  });

  it("sums jobsNeedingRetry as failedSubmissionJobs + deadLetterJobs", async () => {
    const { service, mocks } = createService();
    mocks.connectorSubmissionFindMany.mockResolvedValue([
      { status: "ERROR" },
      { status: "REJECTED" },
      { status: "SUCCESS" },
    ]);
    mocks.marketplaceExportJobFindMany.mockResolvedValue([{ id: "j1" }, { id: "j2" }]);

    const result = await service.getOperationsSummary();

    expect(result.failedSubmissionJobs).toBe(2);
    expect(result.deadLetterJobs).toBe(2);
    expect(result.jobsNeedingRetry).toBe(4);
  });
});

describe("DashboardService — computeDashboardHealth snapshot/trend fallback", () => {
  afterEach(() => jest.clearAllMocks());

  it("captures a fresh snapshot when none exists yet, and defaults trend to just that snapshot", async () => {
    const { service, mocks } = createService();
    mocks.dashboardSnapshotFindFirst.mockResolvedValue(null);
    mocks.dashboardSnapshotFindMany.mockResolvedValue([]);
    mocks.productCount.mockResolvedValue(10);

    const result = await service.getHealth();

    expect(mocks.dashboardSnapshotCreate).toHaveBeenCalledTimes(1);
    expect(result.trend).toEqual([result.snapshot]);
    expect(result.snapshot.totalSkus).toBe(10);
  });

  it("serves the existing snapshot directly (no re-capture) when one already exists and isn't stale", async () => {
    const { service, mocks } = createService();
    const recent = new Date().toISOString();
    mocks.dashboardSnapshotFindFirst.mockResolvedValue({
      capturedAt: new Date(recent),
      totalSkus: 5,
      completeSkus: 5,
      incompleteSkus: 0,
      publishReadyByConnector: {},
      blockedByConnector: {},
      rejectionRiskHigh: 0,
      openIssuesBlocking: 0,
      openIssuesWarning: 0,
    });
    mocks.dashboardSnapshotFindMany.mockResolvedValue([]);

    const result = await service.getHealth();

    expect(mocks.dashboardSnapshotCreate).not.toHaveBeenCalled();
    expect(result.snapshot.totalSkus).toBe(5);
  });
});

// PIM#817-outage-proof follow-up: quit() on an already-established client can
// hang indefinitely if Redis becomes unreachable mid-shutdown (half-open
// socket, no QUIT response), blocking process exit. Bounded with the same
// 300ms Promise.race pattern auth.service.ts's onModuleDestroy() already uses.
describe("DashboardService.onModuleDestroy — bounded quit() so shutdown can't hang", () => {
  it("resolves within the timeout bound even when quit() never settles, and still clears the client", async () => {
    const { service } = createService();
    const quit = jest.fn(() => new Promise(() => {}));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- seeding private connection state for the test
    const svc = service as any;
    svc.redisClient = { quit };
    svc.redisAvailable = true;

    const start = Date.now();
    await service.onModuleDestroy();
    const elapsedMs = Date.now() - start;

    expect(quit).toHaveBeenCalledTimes(1);
    expect(elapsedMs).toBeLessThan(5_000);
    expect(svc.redisClient).toBeNull();
    expect(svc.redisAvailable).toBe(false);
  });

  it("still quits normally (no hang, no error) when quit() resolves quickly", async () => {
    const { service } = createService();
    const quit = jest.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- seeding private connection state for the test
    const svc = service as any;
    svc.redisClient = { quit };

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();

    expect(quit).toHaveBeenCalledTimes(1);
  });
});
