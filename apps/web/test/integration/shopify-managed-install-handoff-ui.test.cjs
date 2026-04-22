#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SETUP_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "connectors", "setup", "page.tsx");
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
  const setupSource = fs.readFileSync(SETUP_PAGE, "utf8");
  const detailSource = fs.readFileSync(DETAIL_PAGE, "utf8");

  assert(
    setupSource.includes("plannedShopifyDefinition") &&
      setupSource.includes("Shopify managed-install pilot") &&
      setupSource.includes("excluded from self-serve setup") &&
      setupSource.includes("Request Shopify pilot activation with Vexa ops") &&
      setupSource.includes("Open Shopify account detail"),
    "Setup page must provide a dedicated Shopify managed-install pilot handoff instead of exposing self-serve install.",
  );

  assert(
    detailSource.includes("CardTitle>Managed Install Handoff<") &&
      detailSource.includes("Start pilot install handoff") &&
      detailSource.includes("Complete managed install and token exchange") &&
      detailSource.includes("Confirm shop identity and publish controls"),
    "Shopify connector detail page must show a managed-install handoff ladder for operators.",
  );

  assert(
    detailSource.includes("Seller self-serve stays locked until launch stage moves beyond planned.") &&
      detailSource.includes("Refresh credential state"),
    "Shopify handoff copy must stay honest about launch stage and give operators a concrete refresh action.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "setup_page_surfaces_shopify_managed_install_handoff",
          "detail_page_surfaces_shopify_install_status_ladder",
          "shopify_handoff_copy_stays_launch_honest",
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
  console.error("Shopify managed install handoff UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
