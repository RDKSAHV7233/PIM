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
  assert(
    setupSource.includes("isGuidedSetupConnector") &&
      setupSource.includes('definition.slug === "shopify" && definition.launchStage === "manual"') &&
      setupSource.includes("Shopify guided setup creates the Vexa connector account first.") &&
      setupSource.includes('name="shopDomain"') &&
      setupSource.includes("Create guided connector"),
    "Connector setup page must surface Shopify as a guided Vexa setup lane with a store-domain install contract.",
  );
  assert(
    source.includes("definition.launchNote") &&
      source.includes("Review operationally limited and roadmap-only connectors before promising coverage."),
    "Connectors page must explain why non-live connectors are not installable.",
  );
  assert(
    source.includes("function isCatalogPilotConnector(") &&
      source.includes("guided setup") &&
      source.includes("Visible in the channel catalog as a guided Shopify connector.") &&
      source.includes("install and manage it like the other Vexa connectors"),
    "Shopify guided connectors must stay in the channel catalog and use the normal Vexa setup lane.",
  );
  assert(
    source.includes("function connectorStatusNote(") &&
      source.includes("Credential validation and publish are not yet available for this connector.") &&
      source.includes("Meesho uses Excel export only."),
    "Connectors page must render implementation-status notes for stub and partial connectors.",
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

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "connector_setup_page_hides_non_live_install_forms",
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
