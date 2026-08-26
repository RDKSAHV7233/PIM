#!/usr/bin/env node
/* eslint-disable no-console */
// PIM#579: the SKUs meter is correct (counts variants, matching plan-limit enforcement —
// see the corresponding apps/api test), but showed a bare "2 / 100,000" with no
// indication that it counts variants rather than the 21,493 products visible one page
// over. Pins the clarifying description so it can't be silently dropped.
//
// PIM#593: the PO + Pricing council decided the commercial unit of measure is
// "SKU = one sellable product variant" (Option B). Extends this test to the two other
// customer/admin-facing surfaces that show a SKU count or limit with no clarification at
// all: the plan-limit-reached modal (the actual blocking moment for a user) and the plan
// comparison/upgrade card. Pins the same canonical sentence across all three so no surface
// drifts into using "product", "SKU", and "variant" interchangeably.
//
// PIM#593 refinement (2026-08-26): the original wording ("A SKU is one sellable
// product variant — parent product records aren't counted separately") answered
// what a variant IS but not the question customers actually ask first: "what
// happens to a normal product that doesn't have variants?" Refined to state the
// simple-product case explicitly rather than leaving it implicit.
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const USAGE_METERS = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "plan", "_components", "usage-meters.tsx");
const PLAN_LIMIT_MODAL = path.join(REPO_ROOT, "apps", "web", "src", "components", "ui", "plan-limit-modal.tsx");
const PLAN_COMPARISON = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "plan", "_components", "plan-comparison.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// Collapses runs of whitespace (including newlines from JSX line-wrapping) to
// single spaces before matching — a content check must not be brittle to how
// a long sentence happens to wrap across source lines.
function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ");
}

function run() {
  const usageMetersSource = normalizeWhitespace(fs.readFileSync(USAGE_METERS, "utf8"));
  const planLimitModalSource = normalizeWhitespace(fs.readFileSync(PLAN_LIMIT_MODAL, "utf8"));
  const planComparisonSource = normalizeWhitespace(fs.readFileSync(PLAN_COMPARISON, "utf8"));

  assert(
    usageMetersSource.includes("description?: string") && usageMetersSource.includes("{description ? <p"),
    "Meter component must support an optional description line for clarifying what a count actually measures.",
  );
  assert(
    /label="SKUs"[\s\S]{0,300}description="[^"]*simple product counts as 1 SKU/i.test(usageMetersSource),
    "The SKUs Meter must carry the canonical PIM#593 description, explicitly stating the simple-product case " +
      "(\"A simple product counts as 1 SKU...\") — otherwise a low SKU count next to a large product catalog reads as a billing bug.",
  );

  assert(
    /isSkuLimit[\s\S]{0,500}simple product counts as 1 SKU/i.test(planLimitModalSource),
    "The plan-limit-reached modal must clarify what a SKU is specifically when the blocked resource is SKUs — this is the actual moment a user hits the limit and needs the clarification most.",
  );

  assert(
    /simple product counts as 1 SKU/i.test(planComparisonSource),
    "The plan comparison/upgrade card must clarify what a SKU is — this is the surface a prospect reads before ever seeing their own usage numbers.",
  );

  // The refined wording must explicitly answer the simple-product case in all
  // three surfaces, not just restate the variant-counting rule — this is
  // exactly the gap the 2026-08-26 refinement exists to close.
  for (const [name, source] of [
    ["usage-meters.tsx", usageMetersSource],
    ["plan-limit-modal.tsx", planLimitModalSource],
    ["plan-comparison.tsx", planComparisonSource],
  ]) {
    assert(
      /multiple variants counts once per sellable variant/i.test(source),
      `${name} must also state the variant-counting rule alongside the simple-product case, not just the simple-product case alone.`,
    );
    assert(
      /draft, archived, deleted, and parent-only product records don.t count/i.test(source),
      `${name} must explicitly exclude draft/archived/deleted/parent-only records, not leave that implicit.`,
    );
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "sku_meter_clarifies_it_counts_variants",
          "plan_limit_modal_clarifies_sku_definition",
          "plan_comparison_clarifies_sku_definition",
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
  console.error("Plan usage SKU meter copy test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
