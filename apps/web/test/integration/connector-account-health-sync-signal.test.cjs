#!/usr/bin/env node
/* eslint-disable no-console */
//
// Regression test for PIM#584: the connector detail page's "Account Health" KPI card
// showed "No sync recorded yet" (and no other evidence) even when the account had 100
// recorded submissions, the 5 most recent all SUCCESS. Root cause: the card was driven
// solely by installation.lastSyncAt (connector_installations.last_sync_at), a column no
// sync/publish code path in this repo ever writes — it only reflects a full account/catalog
// sync (e.g. the Shopify Store Configuration import), which is a distinct concept from
// individual product submissions.
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

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function run() {
  const { pickLatestSuccessfulSubmission, resolveAccountHealthSyncState } = require(UTILS_MODULE);

  // ── pickLatestSuccessfulSubmission ────────────────────────────────────────

  // Mirrors the reported scenario: 100 submissions, 5 most recent all SUCCESS, most recent
  // resolved 3 days ago, mixed with older errors/pending noise.
  const now = Date.now();
  const daysAgo = (n) => new Date(now - n * 24 * 60 * 60 * 1000).toISOString();
  const manySubmissions = [
    { status: "ERROR", submittedAt: daysAgo(40) },
    { status: "SUCCESS", submittedAt: daysAgo(10) },
    { status: "PENDING", submittedAt: daysAgo(4) },
    { status: "SUCCESS", submittedAt: daysAgo(3) }, // most recent success
    { status: "SUCCESS", submittedAt: daysAgo(20) },
    { status: "REJECTED", submittedAt: daysAgo(1) }, // more recent than any success, but not SUCCESS
  ];
  const latest = pickLatestSuccessfulSubmission(manySubmissions);
  assert(latest !== null, "Expected a successful submission to be found among mixed-status submissions.");
  assert(
    latest.submittedAt === daysAgo(3),
    `Expected the most recent SUCCESS submission (3 days ago) to win, got ${latest && latest.submittedAt}.`,
  );

  // Order-independence: function must not rely on array being pre-sorted.
  const shuffled = [manySubmissions[3], manySubmissions[0], manySubmissions[4], manySubmissions[1], manySubmissions[5], manySubmissions[2]];
  const latestShuffled = pickLatestSuccessfulSubmission(shuffled);
  assert(
    latestShuffled && latestShuffled.submittedAt === daysAgo(3),
    "pickLatestSuccessfulSubmission must find the most recent SUCCESS regardless of input array order.",
  );

  // No successes at all -> null, not a thrown error or an unrelated status's timestamp.
  const noSuccesses = pickLatestSuccessfulSubmission([
    { status: "ERROR", submittedAt: daysAgo(5) },
    { status: "PENDING", submittedAt: daysAgo(1) },
  ]);
  assert(noSuccesses === null, "Expected null when no submission has status SUCCESS.");

  // Empty list -> null.
  assert(pickLatestSuccessfulSubmission([]) === null, "Expected null for an empty submission list.");

  // ── resolveAccountHealthSyncState ─────────────────────────────────────────

  // The exact bug scenario: lastSyncAt is null (full catalog sync never ran) but there IS a
  // recent successful submission. Must NOT resolve to "none" — that's the misleading state that
  // produced "Healthy" + "No sync recorded yet" side by side in the reported issue.
  const bugScenario = resolveAccountHealthSyncState(null, { status: "SUCCESS", submittedAt: daysAgo(3) });
  assert(
    deepEqual(bugScenario, { kind: "submissions_only", latestSuccessfulSubmissionAt: daysAgo(3) }),
    `Expected submissions_only fallback for null lastSyncAt with a recent success, got ${JSON.stringify(bugScenario)}.`,
  );

  // A real full-catalog sync timestamp always wins over submission-derived fallback.
  const fullSyncScenario = resolveAccountHealthSyncState(daysAgo(1), { status: "SUCCESS", submittedAt: daysAgo(3) });
  assert(
    deepEqual(fullSyncScenario, { kind: "full_sync", lastSyncAt: daysAgo(1) }),
    `Expected full_sync to take priority when lastSyncAt is present, got ${JSON.stringify(fullSyncScenario)}.`,
  );

  // Genuinely nothing recorded (new install, zero submissions) -> "none", the only case where
  // that label is honest.
  const genuinelyNone = resolveAccountHealthSyncState(null, null);
  assert(
    deepEqual(genuinelyNone, { kind: "none" }),
    `Expected "none" only when there is no lastSyncAt and no successful submission, got ${JSON.stringify(genuinelyNone)}.`,
  );

  // Empty-string lastSyncAt should be treated as falsy/absent, not as a valid timestamp.
  const emptyStringScenario = resolveAccountHealthSyncState("", { status: "SUCCESS", submittedAt: daysAgo(7) });
  assert(
    emptyStringScenario.kind === "submissions_only",
    "Expected an empty-string lastSyncAt to fall through to the submission-based state, not be treated as a real sync timestamp.",
  );

  // ── Wiring check: the connector detail page must actually use the fixed helpers ──────────
  // (Guards against someone reintroducing the old bare `installation.lastSyncAt ? ... : "No
  // sync recorded yet"` pattern that caused PIM#584 without also reverting the import.)
  const detailSource = fs.readFileSync(DETAIL_PAGE, "utf8");
  assert(
    detailSource.includes('from "@/lib/connector-utils"') &&
      detailSource.includes("pickLatestSuccessfulSubmission") &&
      detailSource.includes("resolveAccountHealthSyncState"),
    "Connector detail page must derive Account Health sync state via the shared connector-utils helpers, not installation.lastSyncAt alone.",
  );
  assert(
    detailSource.includes('accountHealthSyncState.kind === "submissions_only"') &&
      detailSource.includes("last successful submission"),
    "Account Health KPI card must surface the latest successful submission when no full catalog sync has run.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "pick_latest_successful_submission_ignores_non_success_and_array_order",
          "pick_latest_successful_submission_returns_null_when_none_or_empty",
          "resolve_account_health_sync_state_falls_back_to_submission_when_lastSyncAt_null",
          "resolve_account_health_sync_state_prefers_full_sync_timestamp_when_present",
          "resolve_account_health_sync_state_reports_none_only_when_truly_empty",
          "connector_detail_page_wires_up_the_fallback_helpers",
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
  console.error("Connector account health sync-signal test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
