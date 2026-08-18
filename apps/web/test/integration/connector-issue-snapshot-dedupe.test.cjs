#!/usr/bin/env node
/* eslint-disable no-console */
//
// Regression test for PIM#587: the connector detail page's "Issue Snapshot" card (a 5-slot
// at-a-glance list of problem products) showed the same product twice — e.g.
// "LittleSprout A-Line Midi Dress Beige VX0109915" appeared in two of the five rows, both
// with the identical message ("A primary HTTPS image is required for Shopify sync.") and
// near-identical timestamps. Root cause: the card was built directly from `failedSubmissions`,
// which has one row per submission *attempt*, not one row per product. When a product has more
// than one failed/rejected submission attempt open, each attempt surfaced as its own row,
// wasting one of the card's five slots and making one problem product read as two.
//
// This test exercises the *real* fix module (apps/web/src/lib/connector-utils.ts) directly —
// Node's native TypeScript support lets a plain .cjs script require() the .ts source without a
// build step — rather than regex-matching page source text, so it actually runs the logic that
// ships in the connector detail page.
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const UTILS_MODULE = path.join(REPO_ROOT, "apps", "web", "src", "lib", "connector-utils.ts");
const DETAIL_PAGE = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "channels",
  "connectors",
  "[installationId]",
  "page.tsx",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const { dedupeSubmissionsByLatestPerProduct } = require(UTILS_MODULE);

  // ── dedupeSubmissionsByLatestPerProduct ───────────────────────────────────

  // Mirrors the reported scenario: the same product ("dress") has two failed submission
  // attempts, 40 minutes apart, both with the same HTTPS-image validation error. Only the
  // more recent attempt should survive.
  const now = Date.now();
  const minutesAgo = (n) => new Date(now - n * 60 * 1000).toISOString();
  const reportedScenario = [
    { id: "sub-1", productId: "dress", status: "ERROR", submittedAt: minutesAgo(45) },
    { id: "sub-2", productId: "dress", status: "ERROR", submittedAt: minutesAgo(5) }, // most recent attempt for "dress"
    { id: "sub-3", productId: "shoes", status: "REJECTED", submittedAt: minutesAgo(20) },
  ];
  const deduped = dedupeSubmissionsByLatestPerProduct(reportedScenario);
  assert(
    deduped.length === 2,
    `Expected 2 rows after dedupe (one per distinct productId), got ${deduped.length}.`,
  );
  const dressRows = deduped.filter((s) => s.productId === "dress");
  assert(dressRows.length === 1, `Expected exactly one surviving row for "dress", got ${dressRows.length}.`);
  assert(
    dressRows[0].id === "sub-2",
    `Expected the most recent attempt (sub-2, 5 minutes ago) to win for "dress", got ${dressRows[0].id}.`,
  );

  // Result must be sorted most-recent-first so a `.slice(0, 5)` on the card picks the freshest
  // problems, not an arbitrary subset.
  assert(
    deduped[0].productId === "dress" && deduped[1].productId === "shoes",
    `Expected dedupe output sorted by submittedAt desc (dress, then shoes), got ${JSON.stringify(deduped.map((s) => s.productId))}.`,
  );

  // Order-independence: function must not rely on array being pre-sorted.
  const shuffled = [reportedScenario[2], reportedScenario[0], reportedScenario[1]];
  const dedupedShuffled = dedupeSubmissionsByLatestPerProduct(shuffled);
  assert(
    dedupedShuffled.length === 2 &&
      dedupedShuffled.find((s) => s.productId === "dress").id === "sub-2",
    "dedupeSubmissionsByLatestPerProduct must find the most recent attempt per product regardless of input array order.",
  );

  // No duplicates at all -> output is unchanged in content (still one row per product).
  const noDupes = [
    { id: "a", productId: "p1", status: "ERROR", submittedAt: minutesAgo(10) },
    { id: "b", productId: "p2", status: "ERROR", submittedAt: minutesAgo(5) },
  ];
  const dedupedNoDupes = dedupeSubmissionsByLatestPerProduct(noDupes);
  assert(dedupedNoDupes.length === 2, "Expected no rows dropped when every product already appears once.");

  // Empty list -> empty list, not a thrown error.
  assert(
    Array.isArray(dedupeSubmissionsByLatestPerProduct([])) && dedupeSubmissionsByLatestPerProduct([]).length === 0,
    "Expected an empty array for an empty submission list.",
  );

  // Three attempts against the same product -> collapses to exactly one, the most recent.
  const tripleAttempt = [
    { id: "x1", productId: "dress", status: "ERROR", submittedAt: minutesAgo(100) },
    { id: "x2", productId: "dress", status: "REJECTED", submittedAt: minutesAgo(2) },
    { id: "x3", productId: "dress", status: "ERROR", submittedAt: minutesAgo(50) },
  ];
  const dedupedTriple = dedupeSubmissionsByLatestPerProduct(tripleAttempt);
  assert(
    dedupedTriple.length === 1 && dedupedTriple[0].id === "x2",
    `Expected exactly 1 row (id x2, most recent) from 3 attempts against the same product, got ${JSON.stringify(dedupedTriple)}.`,
  );

  // ── Wiring check: the connector detail page must actually use the fixed helper for the
  // Issue Snapshot card, keyed off the deduped list rather than the raw failedSubmissions list.
  const detailSource = fs.readFileSync(DETAIL_PAGE, "utf8");
  assert(
    detailSource.includes('from "@/lib/connector-utils"') &&
      detailSource.includes("dedupeSubmissionsByLatestPerProduct"),
    "Connector detail page must derive the Issue Snapshot list via the shared dedupeSubmissionsByLatestPerProduct helper.",
  );
  assert(
    detailSource.includes("issueSnapshotSubmissions.slice(0, 5)"),
    'Issue Snapshot card must render from the deduped `issueSnapshotSubmissions` list, not raw `failedSubmissions`.',
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "dedupe_collapses_repeat_failed_attempts_against_same_product_to_most_recent",
          "dedupe_output_sorted_most_recent_first",
          "dedupe_is_order_independent",
          "dedupe_is_noop_when_no_duplicates",
          "dedupe_handles_empty_list",
          "dedupe_collapses_three_attempts_to_one",
          "connector_detail_page_wires_up_dedupe_for_issue_snapshot_card",
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
  console.error("Connector Issue Snapshot dedupe test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
