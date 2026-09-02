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
      setupSource.includes("this step captures the store domain and managed-install context before token exchange continues") &&
      setupSource.includes("Create Shopify connector") &&
      setupSource.includes("managed install in connector detail"),
    "Setup page must expose Shopify as a live setup lane that captures store context before managed install continues.",
  );

  assert(
    detailSource.includes("CardTitle>Managed Install Handoff<") &&
      detailSource.includes("Start managed install handoff") &&
      detailSource.includes("Complete managed install and token exchange") &&
      detailSource.includes("Confirm shop identity and publish controls"),
    "Shopify connector detail page must show a managed-install handoff ladder for operators.",
  );

  assert(
    detailSource.includes("Shopify is live for this workspace.") &&
      detailSource.includes("Refresh credential state"),
    "Shopify handoff copy must stay honest about live launch stage and give operators a concrete refresh action.",
  );
  assert(
    detailSource.includes("Complete Shopify authorization before configuring publication channels.") &&
      detailSource.includes("Complete Shopify authorization before refreshing channels."),
    "Shopify handoff must keep publication controls in guidance mode until managed install finishes.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "setup_page_surfaces_shopify_managed_install_handoff",
          "detail_page_surfaces_shopify_install_status_ladder",
          "shopify_handoff_copy_stays_launch_honest",
          "shopify_handoff_keeps_publication_controls_in_pre_auth_guidance_mode",
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
