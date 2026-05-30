#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CONNECTORS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "connectors", "page.tsx");
const SETUP_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "connectors", "setup", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(CONNECTORS_PAGE, "utf8");
  const setupSource = fs.readFileSync(SETUP_PAGE, "utf8");
  const staleShopifyCatalogCopy = [
    "Visible in the channel catalog as a guided",
    "Shopify connector.",
  ].join(" ");
  assert(
    setupSource.includes('item.definition.launchStage === "live"') &&
      setupSource.includes("Shopify uses managed install. Create the Vexa connector account with store-domain context here;") &&
      setupSource.includes('name="shopDomain"') &&
      setupSource.includes("Create Shopify connector"),
    "Connector setup page must surface Shopify as a live Vexa setup lane with a store-domain install contract.",
  );
  assert(
    source.includes("definition.launchNote") &&
      source.includes("Review operationally limited and roadmap-only connectors before promising coverage."),
    "Connectors page must explain why non-live connectors are not installable.",
  );
  assert(
    source.includes("Live publish") &&
      source.includes("Export/manual") &&
      source.includes("Experimental") &&
      source.includes("Maturity labels distinguish live publish lanes from export/manual and experimental connectors."),
    "Connectors page must distinguish live publish connectors from export/manual and experimental lanes.",
  );
  assert(
    !source.includes("function isCatalogPilotConnector(") &&
      !source.includes(staleShopifyCatalogCopy) &&
      source.includes("Review live connector lanes first so operators can install, map, and manage each Vexa connector"),
    "Shopify must use the live channel catalog path instead of manual rollout presentation.",
  );
  assert(
    source.includes("function connectorStatusNote(") &&
      source.includes("Credential validation and publish are not yet available for this connector.") &&
      // Meesho copy updated 2026-05-28 (Phase M-1 shipped): category-specific Excel export is
      // now available. Copy updated to accurately describe the export-only model and remove the
      // stale "not yet available" claim. Credential validation is honestly disclosed as pending
      // RD-MEESHO-1. The no-direct-publish guarantee is retained.
      source.includes("Meesho is an export-only connector.") &&
      source.includes("category-specific Excel file"),
    "Connectors page must render implementation-status notes for stub and partial connectors with honest export-only disclosure for Meesho.",
  );
  assert(
    !source.includes("You can install it to prepare your mapping"),
    "Stub connector copy must not claim self-serve install is possible when the install form is hidden.",
  );
  assert(
    source.includes("installation.launchStage") && source.includes("installation.launchNote"),
    "Installed connectors table must surface launch-stage honesty messaging.",
  );
  assert(
    source.includes('label: "CONNECTED (limited)"') &&
      source.includes('implementationStatus === "stub"'),
    "Installed stub connectors must show CONNECTED (limited) instead of ACTIVE.",
  );
  assert(
    setupSource.includes("This setup workspace only exposes Live publish connectors.") &&
      setupSource.includes("Supported operations"),
    "Connector setup page must describe the live-publish setup boundary and show supported operations in plain language.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "connector_setup_page_hides_non_live_install_forms",
          "connector_maturity_labels_are_explicit",
          "connector_page_surfaces_launch_honesty_notes",
          "installed_connector_rows_show_launch_stage",
          "connector_page_surfaces_implementation_status_notes",
          "installed_stub_connectors_show_connected_limited",
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
  console.error("Connector launch honesty UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
