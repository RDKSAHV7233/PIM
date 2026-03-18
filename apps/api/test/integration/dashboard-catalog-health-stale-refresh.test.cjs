#!/usr/bin/env node
/* eslint-disable no-console */
const assert = require("node:assert/strict");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const { DashboardService } = require(path.join(
  REPO_ROOT,
  "apps",
  "api",
  "dist",
  "dashboard",
  "dashboard.service.js",
));

async function run() {
  const prisma = {
    tenant() {
      return {
        $queryRawUnsafe: async () => [],
      };
    },
  };
  const metricsService = {
    emit: async () => undefined,
  };

  const service = new DashboardService(prisma, metricsService);

  const staleCatalogHealth = {
    averageCompleteness: 82.4,
    belowThreshold: 2,
    completeSkus: 11,
    incompleteSkus: 4,
    missingMainImage: 1,
    missingRequiredAttrs: 3,
    distribution: [{ bucket: "80-90", count: 7 }],
    asOf: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
  };

  service.readCache = async () => null;
  service.readStaleCache = async () => staleCatalogHealth;

  const freshWrites = [];
  const staleWrites = [];
  service.writeCache = async (key, value) => {
    freshWrites.push({ key, value });
  };
  service.writeStaleCache = async (key, value) => {
    staleWrites.push({ key, value });
  };

  let refreshResolve;
  let computeCalls = 0;
  service.computeCatalogHealth = async () => {
    computeCalls += 1;
    await new Promise((resolve) => {
      refreshResolve = resolve;
    });
    return {
      averageCompleteness: 88.1,
      belowThreshold: 1,
      completeSkus: 14,
      incompleteSkus: 3,
      missingMainImage: 0,
      missingRequiredAttrs: 1,
      distribution: [{ bucket: "90-100", count: 9 }],
      asOf: new Date().toISOString(),
    };
  };

  const startedAt = Date.now();
  const response = await service.getCatalogHealthCached(
    "tenant-catalog-stale",
    "dashboard:catalog-health:v2:tenant-catalog-stale",
  );
  const elapsedMs = Date.now() - startedAt;

  assert.equal(
    computeCalls,
    1,
    "stale catalog-health should schedule one background refresh",
  );
  assert(
    elapsedMs < 250,
    `stale catalog-health response should not block on refresh, took ${elapsedMs}ms`,
  );
  assert.equal(
    response.asOf,
    staleCatalogHealth.asOf,
    "stale catalog-health should be returned immediately while refresh runs in background",
  );

  const refreshPromise = service.catalogHealthRefreshes.get("tenant-catalog-stale");
  assert(refreshPromise, "background catalog-health refresh promise should be tracked");
  refreshResolve();
  await refreshPromise;

  assert.equal(freshWrites.length, 1, "background refresh should write the fresh cache once");
  assert.equal(staleWrites.length, 1, "background refresh should rewrite the stale cache once");
  assert.equal(
    freshWrites[0].key,
    "dashboard:catalog-health:v2:tenant-catalog-stale",
    "fresh cache key should be written after background refresh",
  );
  assert.equal(
    staleWrites[0].key,
    "dashboard:catalog-health:v2:tenant-catalog-stale:stale",
    "stale cache key should be refreshed after background refresh",
  );
  assert.equal(
    service.catalogHealthRefreshes.has("tenant-catalog-stale"),
    false,
    "background catalog-health refresh should clean up in-flight tracking",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "catalog_health_stale_value_returns_immediately",
          "catalog_health_background_refresh_rewrites_fresh_and_stale_cache",
        ],
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error("Dashboard catalog-health stale refresh integration test failed:");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
