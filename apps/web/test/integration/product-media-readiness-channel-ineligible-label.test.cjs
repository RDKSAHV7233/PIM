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
 *
 * PIM#774 extension: PR #770 (which fixed #755) introduced a new divergence for
 * MULTI-image products — `channelIneligibleCount` counted every image asset on the
 * product, but the backend export gate (evaluateMediaExportReadiness /
 * resolveConnectorImageUrl) only ever evaluates/exports ONE asset (the
 * governance.isMain-flagged asset, or else the most-recently-created one), and skips
 * the Media Library entirely when a usable https:// Main Image URL is set. Part 2
 * below extracts the real `selectExportedImageAsset` / `countChannelIneligibleExportBlockers`
 * helpers (apps/web/.../product-detail-shared.tsx) via the TypeScript compiler and
 * EXECUTES them against representative multi-asset fixtures, so this test would have
 * caught #774 the same way #770's single-asset-only fixtures could not.
 */
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

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
const SHARED_FILE = path.join(
  REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "_components", "product-detail-shared.tsx",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Extracts a top-level `export function fnName(...) { ... }` declaration, including
 * generic type parameters (`<T extends {...}>`) that themselves contain braces —
 * naive whole-declaration brace-matching from the function keyword would stop at the
 * generic constraint's own closing brace, well before the real function body. This
 * locates the parameter list's matching `)` first, then brace-matches only the body
 * that follows.
 */
function extractFunction(source, fnName) {
  const startPattern = new RegExp(`export function ${fnName}[<(]`);
  const match = source.match(startPattern);
  assert(match, `Could not locate export function ${fnName} in source.`);
  const startIndex = match.index;
  const parenOpenIndex = source.indexOf("(", startIndex);
  assert(parenOpenIndex !== -1, `Could not find parameter list for ${fnName}.`);
  let parenDepth = 0;
  let paramsEndIndex = -1;
  for (let i = parenOpenIndex; i < source.length; i++) {
    if (source[i] === "(") parenDepth++;
    else if (source[i] === ")") {
      parenDepth--;
      if (parenDepth === 0) {
        paramsEndIndex = i;
        break;
      }
    }
  }
  assert(paramsEndIndex !== -1, `Could not find end of parameter list for ${fnName}.`);
  const bodyStartIndex = source.indexOf("{", paramsEndIndex);
  assert(bodyStartIndex !== -1, `Could not find body start for ${fnName}.`);
  let depth = 0;
  for (let i = bodyStartIndex; i < source.length; i++) {
    if (source[i] === "{") {
      depth++;
    } else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(startIndex, i + 1);
      }
    }
  }
  throw new Error(`Could not find closing brace for ${fnName}.`);
}

/**
 * Loads the real `selectExportedImageAsset` and `countChannelIneligibleExportBlockers`
 * implementations out of the actual source file (not a reimplementation) by
 * transpiling just those functions through the TypeScript compiler and evaluating
 * them, so this test exercises the exact logic that ships.
 */
function loadRealHelpers() {
  const source = fs.readFileSync(SHARED_FILE, "utf8");
  const selectFnSource = extractFunction(source, "selectExportedImageAsset").replace(/^export /, "");
  const countFnSource = extractFunction(source, "countChannelIneligibleExportBlockers").replace(/^export /, "");
  const transpiled = ts.transpileModule(`${selectFnSource}\n${countFnSource}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const factory = new Function(
    `${transpiled}\nreturn { selectExportedImageAsset, countChannelIneligibleExportBlockers };`,
  );
  return factory();
}

function makeAsset(overrides) {
  return {
    id: "asset-default",
    isMain: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    channelEligibility: [],
    ...overrides,
  };
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

  // ── Part 2 (PIM#774): page.tsx must compute channelIneligibleCount via the real,
  // backend-mirroring helper — not by filtering the full imageAssets list itself.
  assert(
    pageSource.includes("countChannelIneligibleExportBlockers(") &&
      /const channelIneligibleCount = countChannelIneligibleExportBlockers\(/.test(pageSource),
    "page.tsx must compute channelIneligibleCount via countChannelIneligibleExportBlockers, scoped to the single " +
      "exported asset, not by filtering every image asset on the product (PIM#774).",
  );
  assert(
    !/const channelIneligibleCount = imageAssets\.filter/.test(pageSource),
    "page.tsx must no longer compute channelIneligibleCount as a filter over the full imageAssets list — that is " +
      "exactly the #774 regression (counts assets the export pipeline never sends).",
  );

  // ── Part 3 (PIM#774): execute the real selection/counting helpers against
  // representative multi-asset fixtures — the four scenarios named in the issue.
  const { selectExportedImageAsset, countChannelIneligibleExportBlockers } = loadRealHelpers();

  // Scenario 1 (the #774 regression itself): multi-image product, the exported
  // (main) asset IS eligible, but a DIFFERENT, non-exported asset is ineligible.
  // Must NOT count as blocked — export will actually succeed with the main asset.
  {
    const mainAsset = makeAsset({ id: "asset-main", isMain: true, createdAt: "2026-02-01T00:00:00.000Z", channelEligibility: ["shopify", "woocommerce"] });
    const otherIneligibleAsset = makeAsset({ id: "asset-other", isMain: false, createdAt: "2026-01-15T00:00:00.000Z", channelEligibility: ["amazon"] });
    const imageAssets = [otherIneligibleAsset, mainAsset];
    const selected = selectExportedImageAsset(imageAssets);
    assert(selected && selected.id === "asset-main", `Scenario 1: expected main-flagged asset to be selected, got ${selected && selected.id}`);
    const count = countChannelIneligibleExportBlockers(imageAssets, false, "shopify");
    assert(count === 0, `Scenario 1 (PIM#774 regression case): expected channelIneligibleCount 0 (main asset is eligible), got ${count}`);
  }

  // Scenario 2: multi-image product, the main asset itself is ineligible. Must still
  // show Blocked (unchanged correct behavior) even though other assets ARE eligible.
  {
    const mainAsset = makeAsset({ id: "asset-main", isMain: true, createdAt: "2026-02-01T00:00:00.000Z", channelEligibility: ["amazon"] });
    const otherEligibleAsset = makeAsset({ id: "asset-other", isMain: false, createdAt: "2026-01-15T00:00:00.000Z", channelEligibility: ["shopify"] });
    const imageAssets = [otherEligibleAsset, mainAsset];
    const count = countChannelIneligibleExportBlockers(imageAssets, false, "shopify");
    assert(count === 1, `Scenario 2: expected channelIneligibleCount 1 (main asset itself is ineligible), got ${count}`);
  }

  // Scenario 3 (original #755/#770 case): single-image product, that image is
  // ineligible. Must not regress — still Blocked.
  {
    const onlyAsset = makeAsset({ id: "asset-only", isMain: false, createdAt: "2026-01-01T00:00:00.000Z", channelEligibility: ["amazon"] });
    const count = countChannelIneligibleExportBlockers([onlyAsset], false, "shopify");
    assert(count === 1, `Scenario 3 (original #755/#770 case): expected channelIneligibleCount 1, got ${count}`);
  }

  // Scenario 4: usable https:// Main Image URL fallback is present — the backend
  // skips the Media Library entirely and exports that URL instead, so this must read
  // as NOT blocked regardless of any Media Library asset's eligibility.
  {
    const ineligibleMainAsset = makeAsset({ id: "asset-main", isMain: true, createdAt: "2026-02-01T00:00:00.000Z", channelEligibility: ["amazon"] });
    const count = countChannelIneligibleExportBlockers([ineligibleMainAsset], true, "shopify");
    assert(count === 0, `Scenario 4 (HTTPS Main Image URL fallback): expected channelIneligibleCount 0 regardless of Media Library eligibility, got ${count}`);
  }

  // No-main-flag fallback: selection falls back to the most-recently-created asset.
  {
    const older = makeAsset({ id: "asset-older", createdAt: "2026-01-01T00:00:00.000Z", channelEligibility: ["shopify"] });
    const newer = makeAsset({ id: "asset-newer", createdAt: "2026-02-01T00:00:00.000Z", channelEligibility: ["amazon"] });
    const selected = selectExportedImageAsset([older, newer]);
    assert(selected && selected.id === "asset-newer", `Fallback selection: expected most-recently-created asset, got ${selected && selected.id}`);
  }

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
          "page_uses_backend_mirroring_helper_not_full_list_filter",
          "scenario1_multi_image_main_eligible_other_ineligible_not_blocked_PIM774_fix",
          "scenario2_multi_image_main_itself_ineligible_still_blocked",
          "scenario3_single_image_ineligible_still_blocked_PIM755_PIM770_no_regression",
          "scenario4_https_main_image_url_fallback_short_circuits_to_not_blocked",
          "fallback_selection_uses_most_recently_created_asset_when_none_main_flagged",
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
