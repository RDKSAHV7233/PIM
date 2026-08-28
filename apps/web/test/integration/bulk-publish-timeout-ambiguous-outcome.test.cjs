#!/usr/bin/env node
/* eslint-disable no-console */
// PIM#693: live QA against app.vexapim.com found that a 31-item WooCommerce bulk-publish
// batch (under the 50-item ceiling) exceeded the web tier's 20s fetch timeout, redirected
// with "Bulk publish timed out before completing. Nothing was queued...", and yet the
// submissions log showed dozens of real ConnectorSubmission rows created in that exact
// window, mostly resolved to genuine terminal SUCCESS. The claim was false: Node.js does not
// cancel in-flight server-side work just because the client stopped waiting for a response
// (apps/api/src/marketplace/marketplace.service.ts's triggerBulkPublish/
// bulkPublishViaQueuedExportJobs loop has no check for client disconnection anywhere), so
// real durable mutations (MarketplaceExportJob rows, then ConnectorSubmission rows written by
// the async worker) continue and often complete after the client has already given up.
//
// This pins the fix: a client-side timeout on this specific call must never assert "nothing
// was queued" — that claim is only true for the pre-admission rejections (batch_too_large,
// no_eligible_products), which fail before any per-product work starts. The timeout case is
// now rendered as a genuinely ambiguous outcome pointing at the one place that reflects real
// server state (the Jobs workspace), not an assertion the client cannot make.
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const BULK_PUBLISH_STATUS_LIB = path.join(REPO_ROOT, "apps", "web", "src", "lib", "bulk-publish-status.ts");
const CONNECTOR_DETAIL_PAGE = path.join(
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
const ACTIONS_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "actions.ts");
const CORE_API_LIB = path.join(REPO_ROOT, "apps", "web", "src", "lib", "api", "core.ts");
const MARKETPLACE_SERVICE = path.join(REPO_ROOT, "apps", "api", "src", "marketplace", "marketplace.service.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// Extracts just the `message: "..."` (or template-literal) string literal from a branch —
// deliberately narrower than the whole branch body so a check like "must not say X" can never
// accidentally match an explanatory comment quoting the anti-pattern it's guarding against.
function extractMessageLiteral(branchSource) {
  const match = branchSource.match(/message:\s*(`[^`]*`|"[^"]*")/);
  assert(match, "Could not find a message: literal in this branch.");
  return match[1].slice(1, -1);
}

// Extracts the body of the `if (normalized === "<status>") { ... }` block for one
// resolveBulkPublishStatusMessage branch, tolerant of either file's exact formatting.
function extractStatusBranch(source, status) {
  const marker = `normalized === "${status}"`;
  const startIndex = source.indexOf(marker);
  assert(startIndex !== -1, `Could not find a branch for status "${status}".`);
  const braceStart = source.indexOf("{", startIndex);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(startIndex, i + 1);
    }
  }
  throw new Error(`Could not find closing brace for status "${status}".`);
}

function run() {
  const statusLibSource = fs.readFileSync(BULK_PUBLISH_STATUS_LIB, "utf8");
  const connectorDetailSource = fs.readFileSync(CONNECTOR_DETAIL_PAGE, "utf8");
  const actionsSource = fs.readFileSync(ACTIONS_FILE, "utf8");
  const coreApiSource = fs.readFileSync(CORE_API_LIB, "utf8");
  const marketplaceServiceSource = fs.readFileSync(MARKETPLACE_SERVICE, "utf8");

  const validated = [];

  // ── 1. Confirmed pre-processing rejections may still say zero queued ──────────────────
  // batch_too_large and no_eligible_products fail BEFORE any per-product work starts (the
  // ceiling check and the eligibility gate both run ahead of bulkPublishViaQueuedExportJobs),
  // so "nothing was queued" remains a true claim for these two branches specifically.
  for (const lib of [statusLibSource, connectorDetailSource]) {
    const noneEligibleMessage = extractMessageLiteral(extractStatusBranch(lib, "bulk-publish-none-eligible"));
    assert(
      /nothing was queued/i.test(noneEligibleMessage),
      "bulk-publish-none-eligible's rendered message must still say nothing was queued — this rejection genuinely happens before any per-product work starts.",
    );
  }
  validated.push("confirmed_pre_processing_rejection_still_says_zero_queued");

  // ── 2. Timeout after a side-effecting request must never say zero queued ──────────────
  // Checked against the rendered message literal specifically, not the whole branch — a
  // surrounding comment explaining *why* the old claim is wrong is expected to quote it.
  for (const [name, lib] of [["bulk-publish-status.ts", statusLibSource], ["connector detail page", connectorDetailSource]]) {
    const timeoutMessage = extractMessageLiteral(extractStatusBranch(lib, "bulk-publish-timeout"));
    assert(
      !/nothing was queued/i.test(timeoutMessage),
      `${name}'s bulk-publish-timeout rendered message must never assert "nothing was queued" — the client cannot know that; ` +
        `server-side work can and does continue past the client's own timeout.`,
    );
    validated.push(`timeout_never_claims_zero_queued__${name.replace(/[^a-z0-9]+/gi, "_")}`);
  }

  // ── 3. Timeout must point the operator at Jobs before retrying, not tell them to just retry ──
  for (const [name, lib] of [["bulk-publish-status.ts", statusLibSource], ["connector detail page", connectorDetailSource]]) {
    const timeoutMessage = extractMessageLiteral(extractStatusBranch(lib, "bulk-publish-timeout"));
    assert(
      /jobs workspace/i.test(timeoutMessage) && /before retrying/i.test(timeoutMessage),
      `${name}'s bulk-publish-timeout rendered message must direct the operator to check the Jobs workspace before retrying, ` +
        `not just invite an unconditional retry.`,
    );
    // The old unconditional "split into a smaller batch and retry, or try again in a moment"
    // language (with no Jobs-check step first) must be gone from the rendered text, not just
    // supplemented by it.
    assert(
      !/split into a smaller batch and retry, or try again in a moment/i.test(timeoutMessage),
      `${name}'s bulk-publish-timeout rendered message must not retain the old unconditional retry invitation alongside the new guidance.`,
    );
  }
  validated.push("timeout_directs_to_jobs_workspace_before_retry");

  // ── 4. Normal success still renders queuedCount/excludedCount ─────────────────────────
  const queuedBranch = extractStatusBranch(statusLibSource, "bulk-publish-queued");
  assert(
    queuedBranch.includes("counts?.queuedCount") && queuedBranch.includes("counts?.excludedCount"),
    "bulk-publish-queued must still render the real queuedCount/excludedCount split — untouched by this fix.",
  );
  validated.push("success_path_still_renders_queued_and_excluded_counts");

  // ── 5. Shopify (and every other non-native-BULK_PUBLISH connector) does not regress ───
  // The fix lives entirely in the shared, connector-agnostic message resolver — no
  // connector-specific branching was introduced, so every connector routed through
  // bulkPublishViaQueuedExportJobs (Shopify, WooCommerce, ...) gets identical, correct
  // treatment; only the API-side connector loop itself decides how long processing takes.
  assert(
    !/connectorSlug|connector\.slug|shopify|woocommerce/i.test(
      extractStatusBranch(statusLibSource, "bulk-publish-timeout"),
    ),
    "The bulk-publish-timeout message must remain connector-agnostic — no connector-specific special-casing.",
  );
  assert(
    marketplaceServiceSource.includes("bulkPublishViaQueuedExportJobs") &&
      marketplaceServiceSource.includes('installation.capabilities.includes("BULK_PUBLISH")'),
    "Bulk-publish must still route every non-native-BULK_PUBLISH connector (Shopify, WooCommerce, ...) through the " +
      "same shared queued-export-jobs path this fix's message applies to.",
  );
  validated.push("fix_is_connector_agnostic_shopify_unaffected");

  // ── 6. Ordinary non-bulk API timeout behavior is unchanged ────────────────────────────
  // This fix must stay scoped to the bulk-publish redirect message only — it must not touch
  // the shared fetch timeout value (which every other action still relies on) or leak a
  // bulk-publish-specific carve-out into the generic fetch/error-handling layer.
  assert(
    coreApiSource.includes("const FETCH_TIMEOUT_MS = 20_000;"),
    "This fix must not change the shared FETCH_TIMEOUT_MS default — that's explicitly out of scope " +
      "(raising it would only change when the underlying race occurs, not fix the false claim).",
  );
  assert(
    !coreApiSource.includes("bulk-publish"),
    "The shared fetch/core API layer (apps/web/src/lib/api/core.ts) must stay completely unaware of bulk-publish " +
      "specifics — this fix belongs entirely in the bulk-publish action/message layer, not the generic fetch layer.",
  );
  // The DOMException handling stays local to each action's own try/catch — confirm it's not
  // been hoisted into some shared helper that every action would pick up unreviewed. PIM#696
  // deliberately added a second, reviewed instance (bulkAssociateMediaCsvAction) for the same
  // defect class as #693 — any further broadening beyond these two still needs its own review.
  const timeoutCatchMatches = actionsSource.match(/error\.name === "TimeoutError" \|\| error\.name === "AbortError"/g) || [];
  assert(
    timeoutCatchMatches.length === 2,
    `Expected exactly two DOMException TimeoutError/AbortError handlers in actions.ts ` +
      `(triggerBulkPublishAction's #693 fix + bulkAssociateMediaCsvAction's #696 fix) ` +
      `— found ${timeoutCatchMatches.length}. Any further broadening needs separate review.`,
  );
  validated.push("non_bulk_timeout_handling_and_shared_fetch_layer_untouched");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        suite: "bulk-publish-timeout-ambiguous-outcome",
        validated,
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
  console.error("Bulk-publish timeout ambiguous-outcome test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
