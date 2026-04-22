#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
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
  const detailSource = fs.readFileSync(DETAIL_PAGE, "utf8");

  assert(
    detailSource.includes("CardTitle>Shopify Readiness<") &&
      detailSource.includes("Managed install token exchanged") &&
      detailSource.includes("Store identity recorded") &&
      detailSource.includes("Publication targets selected") &&
      detailSource.includes("Pilot publish ready"),
    "Shopify connector detail page must render the readiness ladder for pilot publish.",
  );

  assert(
    detailSource.includes('readMetadataValue(installation.metadata, "shopId")') &&
      detailSource.includes('readMetadataValue(installation.metadata, "tokenMode")') &&
      detailSource.includes('readMetadataValue(installation.metadata, "authMode")'),
    "Shopify readiness must derive state from stored install and shop metadata.",
  );

  assert(
    detailSource.includes("completedShopifyReadinessSteps") &&
      detailSource.includes("pilot publish ready") &&
      detailSource.includes("setup still required"),
    "Shopify readiness panel must summarize whether the account is pilot-ready or still needs setup.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "shopify_detail_page_renders_readiness_ladder",
          "shopify_readiness_uses_metadata_backed_state",
          "shopify_readiness_summarizes_pilot_publish_state",
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
  console.error("Shopify readiness panel UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
