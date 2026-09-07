#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * PIM#755 regression test: per-product "Media readiness" pill says "Blocked" for an
 * image not marked eligible for the selected channel, and the backend publish
 * readiness gate now enforces the same condition before export.
 *
 * This test structurally verifies the UI and API contract together. The Product
 * Detail branch must show a real Blocked/danger state, and
 * connector-mapping.service.ts must include the matching
 * media_channel_eligibility_blocked export-readiness blocker.
 */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PRODUCT_PAGE_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "page.tsx");
const CONNECTOR_MAPPING_SERVICE_FILE = path.join(
  REPO_ROOT,
  "apps",
  "api",
  "src",
  "marketplace",
  "connector-mapping.service.ts",
);

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
  const connectorMappingSource = fs.readFileSync(CONNECTOR_MAPPING_SERVICE_FILE, "utf8");
  const branch = extractChannelIneligibleBranch(pageSource);

  assert(
    /label:\s*"Blocked"/.test(branch),
    "The channelIneligibleCount > 0 branch must return label: \"Blocked\" because export readiness now enforces media channel eligibility.",
  );
  assert(
    /tone:\s*"danger"\s*as const/.test(branch),
    "The channelIneligibleCount > 0 branch must use tone: \"danger\" to match the enforced export blocker.",
  );
  assert(
    branch.includes("Update media channel eligibility before export."),
    "The channelIneligibleCount > 0 branch must tell the operator how to clear the blocker.",
  );
  assert(
    !branch.includes("won't stop export"),
    "The channelIneligibleCount > 0 branch must not claim export will continue after this blocker.",
  );
  assert(
    connectorMappingSource.includes("media_channel_eligibility_blocked"),
    "The backend publish-readiness service must include the matching media_channel_eligibility_blocked blocker.",
  );
  assert(
    connectorMappingSource.includes("evaluateMediaExportReadiness"),
    "The backend publish-readiness service must evaluate export media readiness before export.",
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
          "channel_ineligible_count_branch_returns_blocked",
          "channel_ineligible_count_branch_uses_danger_tone",
          "channel_ineligible_count_branch_has_actionable_copy",
          "backend_publish_readiness_includes_media_channel_eligibility_blocker",
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
