#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const MEDIA_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "media", "page.tsx");
const PRODUCT_MEDIA_TAB = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "products",
  "[id]",
  "_components",
  "media-tab.tsx",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const mediaSource = fs.readFileSync(MEDIA_PAGE, "utf8");
  const productMediaSource = fs.readFileSync(PRODUCT_MEDIA_TAB, "utf8");

  assert(
    mediaSource.includes("Alt Text") &&
      mediaSource.includes("Mark as main image") &&
      mediaSource.includes("Gallery Order") &&
      mediaSource.includes("Eligible channels") &&
      mediaSource.includes("Save governance"),
    "Media workspace must expose alt text, main-image, sort-order, channel-eligibility, and governance save controls.",
  );
  assert(
    mediaSource.includes("asset.assetHealthStatus") &&
      mediaSource.includes("Last checked:") &&
      mediaSource.includes("Usage count:"),
    "Media workspace must expose asset health, last-checked status, and usage count in the asset grid.",
  );
  assert(
    productMediaSource.includes("alt text, main image selection, gallery ordering, and channel eligibility"),
    "Product media tab must direct operators to the new governance controls, not just generic uploads.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "media_workspace_exposes_governance_controls",
          "media_workspace_exposes_health_and_usage_status",
          "product_media_tab_links_governance_controls",
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
  console.error("Media governance UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
