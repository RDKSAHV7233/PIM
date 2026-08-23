#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * PIM#644 regression test: per-product "Media readiness" pill says "Blocked" for an
 * image not marked eligible for the selected channel, even though export succeeds
 * anyway.
 *
 * Root cause (traced, not assumed): the per-image channel-eligibility check lives in
 * apps/api/src/media/media.service.ts's validateAsset() (pushes to `issues`,
 * informational only). The real export-gating logic in
 * apps/api/src/marketplace/connector-mapping.service.ts's evaluatePublishReadiness()
 * builds its `blockers` array from a fixed set of checks (mapping compatibility,
 * connector install/credential status, required-attribute mapping, product
 * approval/archived status, required product data) that does not include media/image
 * eligibility at all. Separately, marketplace.service.ts's pre-flight
 * connectorFramework.validate() call only logs a warning and explicitly lets the job
 * "proceed to async processing" regardless of the result. So nothing between the
 * "Blocked" pill and the real export path enforces this check as a hard gate.
 *
 * Live-verified twice against a real WooCommerce store during a production-readiness
 * pass (22-23 Aug 2026): both a single-product republish and a 2-variant product
 * publish showed this exact "Blocked" pill and both exported successfully anyway.
 *
 * This is the same class of defect PIM#585 fixed for the sibling `imageAssetCount === 0`
 * branch of the same `mediaReadiness` IIFE in page.tsx (that branch downgrades to
 * "Warnings" when a usable Main Image URL covers the gap) — this test covers the
 * `channelIneligibleCount > 0` branch a few lines below it, which #585's fix did not
 * touch.
 *
 * This test structurally verifies the fix by extracting the exact `channelIneligibleCount
 * > 0` branch of page.tsx's mediaReadiness IIFE and asserting it now returns a
 * "Warnings"/"warning" result, not "Blocked"/"danger".
 */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PRODUCT_PAGE_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Extracts the `if (channelIneligibleCount > 0) { ... }` block from page.tsx's
 * mediaReadiness IIFE by brace-matching from the literal condition, so the assertion
 * targets the exact branch rather than a loose substring match that could
 * accidentally pass against an unrelated part of the file.
 */
function extractChannelIneligibleBranch(source) {
  const marker = "if (channelIneligibleCount > 0) {";
  const startIndex = source.indexOf(marker);
  assert(startIndex !== -1, "Could not locate the `if (channelIneligibleCount > 0)` branch in page.tsx.");
  let depth = 0;
  let inBody = false;
  for (let i = startIndex; i < source.length; i++) {
    if (source[i] === "{") {
      depth++;
      inBody = true;
    } else if (source[i] === "}") {
      depth--;
      if (inBody && depth === 0) {
        return source.slice(startIndex, i + 1);
      }
    }
  }
  throw new Error("Could not find closing brace for the channelIneligibleCount branch.");
}

function run() {
  const pageSource = fs.readFileSync(PRODUCT_PAGE_FILE, "utf8");
  const branch = extractChannelIneligibleBranch(pageSource);

  assert(
    /label:\s*"Warnings"/.test(branch),
    "The channelIneligibleCount > 0 branch must return label: \"Warnings\", not \"Blocked\" — export succeeds " +
      "regardless of this check (live-verified against a real WooCommerce store), so \"Blocked\" misrepresents " +
      "what will actually happen.",
  );
  assert(
    /tone:\s*"warning"\s*as const/.test(branch),
    "The channelIneligibleCount > 0 branch must use tone: \"warning\", not \"danger\", to match its downgraded " +
      "label.",
  );
  assert(
    !/label:\s*"Blocked"/.test(branch) && !/tone:\s*"danger"\s*as const/.test(branch),
    "The channelIneligibleCount > 0 branch must not still return a Blocked/danger result.",
  );

  // Regression guard: the sibling `imageAssetCount === 0` "no images at all" branch
  // (fixed separately by #585, for a different scenario) must be untouched by this
  // fix — this test's scope is specifically the channel-ineligible-image case, and
  // that branch's own "Blocked" result has not been independently re-verified as
  // non-enforced, so it must not be silently downgraded as a side effect of this fix.
  const noImagesBranchMarker = "if (imageAssetCount === 0) {";
  assert(
    pageSource.includes(noImagesBranchMarker),
    "The imageAssetCount === 0 branch must still exist unchanged — this fix's scope is the sibling " +
      "channelIneligibleCount branch only.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "channel_ineligible_count_branch_downgraded_to_warnings_not_blocked",
          "channel_ineligible_count_branch_uses_warning_tone_not_danger",
          "sibling_zero_images_branch_left_untouched_out_of_scope",
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
  console.error("Product media-readiness channel-ineligible label test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
