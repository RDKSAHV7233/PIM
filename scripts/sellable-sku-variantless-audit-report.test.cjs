#!/usr/bin/env node
/* eslint-disable no-console */

const assert = require("node:assert/strict");
const { buildReport, SELLABLE_STATUSES } = require("./sellable-sku-variantless-audit-report.cjs");

assert.deepEqual(SELLABLE_STATUSES, ["approved", "active"]);

// Fixture: 100 total products, 40 sellable (approved/active), 5 of those sellable
// with zero variants, 60 billable SKUs currently counted from variants.
const counts = {
  totalProducts: 100,
  sellableProducts: 40,
  sellableVariantlessProducts: 5,
  billableSkusFromVariants: 60,
};
const sampleRows = [
  { id: "prod_1", tenantKey: "acme" },
  { id: "prod_2", tenantKey: "acme" },
  { id: "prod_3", tenantKey: "globex" },
];

const report = buildReport(counts, sampleRows, { targetEnvironment: "production", appEnv: "production" });

assert.equal(report.status, "ok");
assert.equal(report.mode, "read_only");
assert.equal(report.safety.databaseMutations, false);
assert.equal(report.safety.storageMutations, false);
assert.equal(report.targetEnvironment, "production");

assert.equal(report.totals.totalProducts, 100);
assert.equal(report.totals.sellableProducts, 40);
assert.equal(report.totals.sellableVariantlessProducts, 5);
// sellableProductsWithVariants must be derived (sellable - variantless), never a
// separately-queried count that could silently drift out of sync with the other two.
assert.equal(report.totals.sellableProductsWithVariants, 35);
assert.equal(report.totals.billableSkusFromVariants, 60);

// This is the number a backfill decision actually needs: how many NEW billable SKUs
// would appear if Option A (retroactive canonical-variant backfill) were chosen.
assert.equal(report.impactIfBackfilled.newBillableSkusAdded, 5);
assert.equal(report.impactIfBackfilled.percentOfCurrentBillableSkus, 8.33);

assert.deepEqual(report.sampleVariantlessProductsByTenant, { acme: 2, globex: 1 });
assert.deepEqual(report.sampleVariantlessProductIds, ["prod_1", "prod_2", "prod_3"]);

// Zero-billable-SKU edge case must not divide by zero / produce Infinity or NaN.
const zeroReport = buildReport(
  { totalProducts: 10, sellableProducts: 3, sellableVariantlessProducts: 3, billableSkusFromVariants: 0 },
  [],
  {},
);
assert.equal(zeroReport.impactIfBackfilled.percentOfCurrentBillableSkus, null);
assert.equal(zeroReport.targetEnvironment, "(unspecified)");
assert.deepEqual(zeroReport.sampleVariantlessProductIds, []);

console.log(
  JSON.stringify(
    {
      status: "ok",
      suite: "sellable-sku-variantless-audit-report.test",
      validated: [
        "sellable_statuses_pinned",
        "totals_derive_with_variants_count_not_a_separate_query",
        "backfill_impact_computed_from_variantless_count",
        "zero_billable_skus_does_not_divide_by_zero",
        "sample_grouped_by_tenant",
      ],
      checkedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
