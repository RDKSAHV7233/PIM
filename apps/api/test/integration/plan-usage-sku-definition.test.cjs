#!/usr/bin/env node
/* eslint-disable no-console */
// PIM#579: the Plan & Usage page showed "SKUs: 2 / 100,000" on a tenant with 21,493
// Product rows, which read as a billing/usage-tracking bug. Investigation (not a blind
// fix — see the audit's own instruction not to "fix" the display to match the product
// count until the authoritative definition was established) found the meter is correct
// by its own definition: it counts Variant rows, not Product rows, and that is exactly
// what plan-limit enforcement (assertResourceAvailable's "skus" branch) also uses — the
// display and the enforcement agree. The tenant simply has very few variants recorded
// against a large product catalog, which is a data-quality fact, not a counting bug.
//
// PIM#614: the *unfiltered* `variant.count()` from #579 turned out to be too broad —
// draft/in_review/rejected/archived variants, and variants of unpublished or
// soft-deleted parent products, were all counted as "sellable" too. The PO/CTO/Pricing
// decision narrowed the definition to variant.status IN (approved, active) AND parent
// product.status IN (approved, active) AND parent product.deletedAt IS NULL — still a
// variant-based count, never a product-based one, just no longer unconditional.
//
// This test pins that definition so a future change can't silently start counting
// products instead of variants (or vice versa), or silently drop the #614 lifecycle
// filter back to unconditional, without deliberately updating this file — see the
// usage-meters.tsx test for the corresponding UI-clarity fix, and
// plan-usage-sellable-sku-lifecycle.spec.ts for the full behavioral matrix.
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PLAN_USAGE_SERVICE = path.join(REPO_ROOT, "apps", "api", "src", "billing", "plan-usage.service.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PLAN_USAGE_SERVICE, "utf8");

  const recomputeUsageBody = source.slice(
    source.indexOf("async recomputeUsage("),
    source.indexOf("async recomputeUsage(") + 2000,
  );
  assert(
    /\.variant\.count\(/.test(recomputeUsageBody) && !recomputeUsageBody.includes(".product.count("),
    "recomputeUsage() must derive skuCount from variant.count(...), not product.count(...) — a SKU here means a sellable variant, not a catalog product record. If this is a deliberate redefinition, update this test and the 'SKUs' meter description in usage-meters.tsx together.",
  );
  assert(
    recomputeUsageBody.includes("SELLABLE_VARIANT_WHERE"),
    "recomputeUsage()'s variant.count() must filter through the PIM#614 SELLABLE_VARIANT_WHERE predicate — an unconditional variant.count() (the pre-#614 shape) counts draft/archived variants and variants of unpublished or soft-deleted products as billable, which the PO/CTO/Pricing decision explicitly excluded.",
  );

  assert(
    source.includes("const SELLABLE_VARIANT_STATUSES") && /approved.*active|active.*approved/s.test(source.slice(source.indexOf("SELLABLE_VARIANT_STATUSES"), source.indexOf("SELLABLE_VARIANT_STATUSES") + 200)),
    "The sellable-variant predicate must be built from RecordStatus.approved and RecordStatus.active — see PIM#614's PO/CTO/Pricing decision.",
  );
  assert(
    /product:\s*\{[^}]*deletedAt:\s*null/s.test(source),
    "The sellable-variant predicate must exclude variants whose parent product is soft-deleted (product.deletedAt must be required null) — see PIM#614.",
  );

  const skuLimitCheckBody = source.slice(
    source.indexOf('if (resource === "skus")'),
    source.indexOf('if (resource === "skus")') + 300,
  );
  assert(
    skuLimitCheckBody.includes("usage.skuCount"),
    "The 'skus' plan-limit check must enforce against usage.skuCount (the same variant-count-derived figure the Plan & Usage page displays) — display and enforcement must never read from two different counts.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "sku_usage_counts_variants_not_products",
          "sku_usage_filters_through_sellable_variant_predicate",
          "sellable_predicate_uses_approved_and_active_statuses",
          "sellable_predicate_excludes_soft_deleted_parent_products",
          "sku_limit_enforcement_matches_displayed_usage",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

try {
  run();
} catch (error) {
  console.error("Plan usage SKU-definition test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
