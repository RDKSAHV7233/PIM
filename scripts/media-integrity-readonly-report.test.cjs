#!/usr/bin/env node
/* eslint-disable no-console */

const assert = require("node:assert/strict");
const {
  buildSafeSummary,
  classifyStoragePath,
  createS3ClientFromEnv,
  isLocalPath,
} = require("./media-integrity-readonly-report.cjs");

function row(overrides) {
  return {
    id: overrides.id,
    tenantKey: overrides.tenantKey ?? "admin",
    productId: overrides.productId ?? null,
    variantId: overrides.variantId ?? null,
    storagePath: overrides.storagePath,
    createdAt: overrides.createdAt ?? new Date("2026-06-26T10:00:00.000Z"),
    product: overrides.product ?? null,
  };
}

assert.equal(classifyStoragePath("media/admin/asset.jpg"), "object_key");
assert.equal(classifyStoragePath("/app/storage/media/admin/asset.jpg"), "local_path");
assert.equal(classifyStoragePath("C:\\app\\storage\\media\\admin\\asset.jpg"), "local_path");
assert.equal(classifyStoragePath("https://cdn.example.test/media/admin/asset.jpg"), "external_url");
assert.equal(classifyStoragePath(""), "empty");
assert.equal(isLocalPath("/app/storage/media/admin/asset.jpg"), true);

const noR2 = createS3ClientFromEnv({});
assert.equal(noR2.available, false);
assert.equal(noR2.bucketConfigured, false);

const rows = [
  row({
    id: "asset_1",
    tenantKey: "admin",
    productId: "product_1",
    storagePath: "media/admin/asset_1.jpg",
    product: { status: "approved", deletedAt: null },
  }),
  row({
    id: "asset_2",
    tenantKey: "admin",
    productId: "product_2",
    storagePath: "/app/storage/media/admin/asset_2.jpg",
    createdAt: new Date("2026-06-28T12:00:00.000Z"),
    product: { status: "draft", deletedAt: null },
  }),
  row({
    id: "asset_3",
    tenantKey: "vbs",
    storagePath: "https://cdn.example.test/asset_3.jpg",
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
  }),
];

const probeResults = new Map([
  ["asset_1", { status: "exists" }],
  ["asset_2", { status: "missing" }],
  ["asset_3", { status: "unverifiable" }],
]);

const report = buildSafeSummary(rows, probeResults, {
  targetEnvironment: "production",
  appEnv: "production",
  storageBackend: "local",
  mediaStorageMode: "filesystem",
  r2Configured: false,
  localFileProbeEnabled: true,
});

assert.equal(report.status, "ok");
assert.equal(report.mode, "read_only");
assert.equal(report.safety.databaseMutations, false);
assert.equal(report.safety.storageMutations, false);
assert.equal(report.safety.storagePathsIncluded, false);
assert.equal(report.totals.rowsExamined, 3);
assert.equal(report.totals.exists, 1);
assert.equal(report.totals.missing, 1);
assert.equal(report.totals.unverifiable, 1);
assert.equal(report.totals.missingReferencedByProduct, 1);
assert.equal(report.totals.referencedByActiveProduct, 1);
assert.deepEqual(report.affectedTenants, ["admin"]);
assert.equal(report.byStorageKind.object_key, 1);
assert.equal(report.byStorageKind.local_path, 1);
assert.equal(report.byStorageKind.external_url, 1);
assert.equal(report.storageExistence.local_path.missing, 1);
assert.equal(report.productionClassification, "PRODUCTION_CONFIRMED");

const serialized = JSON.stringify(report);
assert(!serialized.includes("/app/storage/media/admin/asset_2.jpg"), "report must not include raw storage paths");
assert(!serialized.includes("asset_1.jpg"), "report must not include file names");

console.log(
  JSON.stringify(
    {
      status: "ok",
      suite: "media-integrity-readonly-report-contract",
      assertions: [
        "storage_path_classification",
        "no_r2_config_reports_unavailable",
        "safe_counts_only_summary",
        "production_classification",
        "raw_storage_paths_not_serialized",
      ],
    },
    null,
    2,
  ),
);
