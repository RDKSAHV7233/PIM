#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "media", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PAGE, "utf8");

  assert(
    source.includes('type SharedReadState = "available" | "restricted" | "unavailable";') &&
      source.includes("async function loadSharedRead<T>(promise: Promise<T>): Promise<SharedReadResult<T>>") &&
      source.includes("loadSharedRead(getProductList({ slim: true }, { role: actorRole, authHeader }))") &&
      source.includes("loadSharedRead(getMediaAssets(productId || undefined, variantId || undefined, { role: actorRole, authHeader }))") &&
      source.includes("loadSharedRead(getMediaAssetValidation(assetId, channel, { role: actorRole, authHeader }))"),
    "Media route must wrap product, asset, and asset-validation reads so restricted and unavailable states stay explicit.",
  );
  assert(
    source.includes("Media asset feed is restricted") &&
      source.includes("Media asset feed is temporarily unavailable") &&
      source.includes("false empty library") &&
      source.includes("Media asset details are restricted for your role.") &&
      source.includes("Media asset details are temporarily unavailable."),
    "Media route must distinguish restricted and unavailable asset feed states instead of rendering a fake empty media library.",
  );
  assert(
    source.includes("Product filter options are limited for your role.") &&
      source.includes("Product filter options are temporarily unavailable.") &&
      source.includes("Product assignment options are limited for your role.") &&
      source.includes("Validation details are restricted for your role.") &&
      source.includes("Validation details are temporarily unavailable."),
    "Media route must surface honest degraded-state copy for product selectors and channel validation reads.",
  );
  assert(
    source.includes('title="No media assets found"') &&
      source.includes('description="Upload assets or widen the current filter scope to review media governance."') &&
      source.includes('assetsResult.state === "available" ? ('),
    "Media route must preserve the empty-state copy only when the asset feed loaded successfully.",
  );
  assert(
    source.includes('if (error instanceof ApiHttpError && error.status === 401)') &&
      source.includes('redirect(buildLoginRedirect("/media", error));'),
    "Media route must redirect only expired sessions while preserving restricted shared-read states in-page.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "media_route_wraps_product_asset_and_validation_reads",
          "media_route_distinguishes_restricted_and_unavailable_asset_feed_truth",
          "media_route_surfaces_honest_selector_and_validation_degraded_states",
          "media_route_preserves_empty_state_only_for_successful_empty_feeds",
          "media_route_redirects_only_expired_sessions",
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
  console.error("Media route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
