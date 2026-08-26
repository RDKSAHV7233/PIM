#!/usr/bin/env node
/* eslint-disable no-console */

const assert = require("node:assert/strict");
const { buildReport, SELLABLE_STATUSES, ALL_LIFECYCLE_STATUSES } = require("./sellable-sku-variantless-audit-report.cjs");

assert.deepEqual(SELLABLE_STATUSES, ["approved", "active"]);
assert.deepEqual(ALL_LIFECYCLE_STATUSES, ["draft", "in_review", "approved", "rejected", "active", "archived"]);

// Fixture: 100 total products, 40 sellable (approved/active), 5 of those sellable
// with zero variants, 60 billable SKUs currently counted from variants. Of the
// broader (any-status, non-deleted) variant-less population, 5 are approved
// (matching sellableVariantlessProducts), plus 2 draft and 1 rejected that aren't
// billable yet but are tomorrow's exposure. 3 more variant-less products are
// soft-deleted and can never become billable regardless of status. Of the 5
// sellable-variant-less products, 2 have already been published to a channel.
const counts = {
  totalProducts: 100,
  sellableProducts: 40,
  sellableVariantlessProducts: 5,
  billableSkusFromVariants: 60,
  lifecycleDistributionNonDeleted: {
    draft: 2,
    in_review: 0,
    approved: 5,
    rejected: 1,
    active: 0,
    archived: 0,
  },
  deletedVariantlessProducts: 3,
  channelLinkedSellableVariantlessCount: 2,
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

// Lifecycle distribution must cover every status with a fixed shape (never sparse),
// separately from the soft-deleted count — a deleted variant-less product can never
// become billable regardless of its own status, so it's reported on its own.
assert.deepEqual(report.lifecycleDistribution.nonDeleted, {
  draft: 2,
  in_review: 0,
  approved: 5,
  rejected: 1,
  active: 0,
  archived: 0,
});
assert.equal(report.lifecycleDistribution.deletedVariantlessProducts, 3);

// A published-but-uncounted product is the sharpest version of the #663 defect —
// it's provably live and selling, and still invisible to billing. Both halves must
// sum back to the same sellableVariantlessProducts total.
assert.equal(report.channelLinked.sellableVariantlessPublished, 2);
assert.equal(report.channelLinked.sellableVariantlessNotPublished, 3);
assert.equal(
  report.channelLinked.sellableVariantlessPublished + report.channelLinked.sellableVariantlessNotPublished,
  report.totals.sellableVariantlessProducts,
);

// Tenant distribution must now be the FULL population passed in, not a capped
// sample — the field name itself no longer says "sample" for this reason.
assert.deepEqual(report.variantlessProductsByTenant, { acme: 2, globex: 1 });
assert.deepEqual(report.sampleVariantlessProductIds, ["prod_1", "prod_2", "prod_3"]);

// rowFetchTruncated must default to false when the caller never set it (the
// common, untruncated case) and reflect a truthy counts value otherwise.
assert.equal(report.rowFetchTruncated, false);
assert.equal(buildReport({ ...counts, rowFetchTruncated: true }, sampleRows, {}).rowFetchTruncated, true);

// If sellableVariantlessProducts and channelLinkedSellableVariantlessCount are
// ever inconsistent (e.g. two non-atomic reads of a live table disagreeing),
// the "not published" half must clamp to 0, never render a negative count in
// a report a commercial decision depends on.
const inconsistentReport = buildReport(
  { ...counts, sellableVariantlessProducts: 2, channelLinkedSellableVariantlessCount: 5 },
  sampleRows,
  {},
);
assert.equal(inconsistentReport.channelLinked.sellableVariantlessNotPublished, 0);

// Zero-billable-SKU edge case must not divide by zero / produce Infinity or NaN.
const zeroReport = buildReport(
  {
    totalProducts: 10,
    sellableProducts: 3,
    sellableVariantlessProducts: 3,
    billableSkusFromVariants: 0,
    lifecycleDistributionNonDeleted: {
      draft: 0,
      in_review: 0,
      approved: 3,
      rejected: 0,
      active: 0,
      archived: 0,
    },
    deletedVariantlessProducts: 0,
    channelLinkedSellableVariantlessCount: 0,
  },
  [],
  {},
);
assert.equal(zeroReport.impactIfBackfilled.percentOfCurrentBillableSkus, null);
assert.equal(zeroReport.targetEnvironment, "(unspecified)");
assert.deepEqual(zeroReport.sampleVariantlessProductIds, []);
assert.equal(zeroReport.channelLinked.sellableVariantlessPublished, 0);
assert.equal(zeroReport.channelLinked.sellableVariantlessNotPublished, 3);

console.log(
  JSON.stringify(
    {
      status: "ok",
      suite: "sellable-sku-variantless-audit-report.test",
      validated: [
        "sellable_statuses_pinned",
        "lifecycle_statuses_pinned",
        "totals_derive_with_variants_count_not_a_separate_query",
        "backfill_impact_computed_from_variantless_count",
        "zero_billable_skus_does_not_divide_by_zero",
        "lifecycle_distribution_fixed_shape_not_sparse",
        "deleted_variantless_reported_separately_from_lifecycle",
        "channel_linked_split_sums_to_sellable_variantless_total",
        "tenant_distribution_is_full_population_not_a_sample",
        "row_fetch_truncated_flag_defaults_false_and_reflects_input",
        "channel_linked_not_published_never_goes_negative",
      ],
      checkedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
