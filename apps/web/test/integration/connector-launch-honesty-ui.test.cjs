#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CONNECTORS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "connectors", "page.tsx");
const SETUP_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "connectors", "setup", "page.tsx");
const CREDENTIAL_FIELDS = path.join(REPO_ROOT, "apps", "web", "src", "components", "connectors", "connector-credential-fields.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(CONNECTORS_PAGE, "utf8");
  const setupSource = fs.readFileSync(SETUP_PAGE, "utf8");
  const credentialFieldsSource = fs.readFileSync(CREDENTIAL_FIELDS, "utf8");
  const staleShopifyCatalogCopy = [
    "Visible in the channel catalog as a guided",
    "Shopify connector.",
  ].join(" ");

  assert(
    setupSource.includes("isSetupLaneStage(definition.launchStage)") &&
      credentialFieldsSource.includes("Shopify uses managed install. Create the Vexa connector account with store-domain context here;") &&
      credentialFieldsSource.includes('name="shopDomain"') &&
      setupSource.includes("Create Shopify connector"),
    "Connector setup page must surface Shopify as a live Vexa setup lane with a store-domain install contract.",
  );

  assert(
    setupSource.includes("This setup workspace exposes live and early-access setup lanes.") &&
      setupSource.includes("Supported operations"),
    "Connector setup page must describe the setup-lane boundary and show supported operations in plain language.",
  );

  // The connectors workspace (/channels/connectors) is an operator surface. Per owner
  // decision, it must NOT expose connector development / lifecycle status: no maturity
  // labels, no implementation-status notes, no launch-hold banners, no "CONNECTED
  // (limited)". Operators see account health and shipped capabilities only. The setup
  // page (/channels/connectors/setup) still gates install lanes and keeps its own
  // honesty copy — asserted above and unchanged by this policy.

  assert(
    !source.includes("connectorLaunchLabel(") &&
      !source.includes("connectorLaunchTone(") &&
      !source.includes("Live publish") &&
      !source.includes("P1 blocker hold") &&
      !source.includes("Maturity labels distinguish live publish lanes from export/manual and experimental connectors."),
    "Connectors workspace must not render connector maturity / launch-stage labels.",
  );

  assert(
    !source.includes("function connectorStatusNote(") &&
      !source.includes("This connector has limited functionality. Check the channel guide for details.") &&
      !source.includes("Credential validation and publish are not yet available for this connector."),
    "Connectors workspace must not render implementation-status notes for stub / partial connectors.",
  );

  assert(
    !source.includes("CONNECTED (limited)"),
    "Connectors workspace must show the plain installation status, never a 'CONNECTED (limited)' variant.",
  );

  assert(
    !source.includes("definition.launchNote") &&
      !source.includes("installation.launchNote"),
    "Connectors workspace must not render connector launchNote / launch-hold banners.",
  );

  assert(
    !source.includes("Review operationally limited and roadmap-only connectors before promising coverage.") &&
      !source.includes("<CardTitle>Export / manual</CardTitle>"),
    "Connectors workspace must not carry the Export / manual roadmap section.",
  );

  // ── Still-true positives: the live catalog framing and no pilot special-casing ─

  assert(
    !source.includes("function isCatalogPilotConnector(") &&
      !source.includes(staleShopifyCatalogCopy) &&
      source.includes("Review live connector lanes first so operators can install, map, and manage each Vexa connector"),
    "Shopify must use the live channel catalog path instead of manual rollout presentation.",
  );

  assert(
    !source.includes("You can install it to prepare your mapping"),
    "Stub connector copy must not claim self-serve install is possible when the install form is hidden.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "connector_setup_page_hides_non_live_install_forms",
          "connector_setup_page_describes_setup_lane_boundary",
          "connectors_workspace_hides_maturity_labels",
          "connectors_workspace_hides_implementation_status_notes",
          "connectors_workspace_hides_connected_limited_variant",
          "connectors_workspace_hides_launch_notes",
          "connectors_workspace_has_no_export_manual_section",
          "connectors_workspace_uses_live_catalog_path",
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
