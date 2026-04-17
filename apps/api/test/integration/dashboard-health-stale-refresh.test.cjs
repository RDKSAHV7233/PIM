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
  const staleCapturedAt = new Date(Date.now() - 7 * 60 * 60 * 1000);
  const staleRow = {
    capturedAt: staleCapturedAt,
    totalSkus: 7,
    completeSkus: 5,
    incompleteSkus: 2,
    publishReadyByConnector: { flipkart: 3 },
    blockedByConnector: { flipkart: 1 },
    rejectionRiskHigh: 0,
    openIssuesBlocking: 4,
    openIssuesWarning: 2,
  };

  const prisma = {
    tenant() {
      return {
        product: {
          count: async () => 2,
        },
        dashboardSnapshot: {
          findMany: async () => [staleRow],
        },
      };
    },
  };
  const metricsService = {
    emit: async () => undefined,
  };

  const service = new DashboardService(prisma, metricsService);
  service.readCache = async () => null;
  service.writeCache = async () => undefined;

  let captureResolve;
  let captureCalls = 0;
  service.getLatestSnapshotRow = async () => staleRow;
  service.captureSnapshot = async () => {
    captureCalls += 1;
    await new Promise((resolve) => {
      captureResolve = resolve;
    });
    return {
      capturedAt: new Date().toISOString(),
      totalSkus: 9,
      completeSkus: 6,
      incompleteSkus: 3,
      publishReadyByConnector: { flipkart: 4 },
      blockedByConnector: { flipkart: 1 },
      rejectionRiskHigh: 0,
      openIssuesBlocking: 1,
      openIssuesWarning: 1,
    };
  };

  const deletedKeys = [];
  service.deleteCache = async (key) => {
    deletedKeys.push(key);
  };

  const startedAt = Date.now();
  const response = await service.computeDashboardHealth(
    "tenant-stale",
    "dashboard:health:v3:tenant-stale",
  );
  const elapsedMs = Date.now() - startedAt;

  assert.equal(captureCalls, 1, "stale snapshot should schedule one background refresh");
  assert(elapsedMs < 250, `stale snapshot response should not block on refresh, took ${elapsedMs}ms`);
  assert.equal(response.pendingApprovals, 2, "pending approvals should still be returned");
  assert.equal(
    response.snapshot.capturedAt,
    staleCapturedAt.toISOString(),
    "stale snapshot should be returned immediately while refresh runs in background",
  );
  assert.equal(response.trend.length, 1, "trend should still be populated from existing snapshot rows");
  assert.equal(
    response.trend[0].capturedAt,
    staleCapturedAt.toISOString(),
    "trend should include the latest stored snapshot while refresh is pending",
  );

  const refreshPromise = service.dashboardHealthRefreshes.get("tenant-stale");
  assert(refreshPromise, "background refresh promise should be tracked");
  captureResolve();
  await refreshPromise;

  assert.deepEqual(
    deletedKeys,
    ["dashboard:health:v3:tenant-stale"],
    "successful background refresh should invalidate the cached stale response",
  );
  assert.equal(
    service.dashboardHealthRefreshes.has("tenant-stale"),
    false,
    "background refresh should clean up in-flight tracking",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "dashboard_health_stale_snapshot_returns_immediately",
          "dashboard_health_background_refresh_invalidates_cache",
        ],
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error("Dashboard stale refresh integration test failed:");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
