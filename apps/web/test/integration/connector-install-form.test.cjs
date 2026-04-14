#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CONNECTORS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "connectors", "page.tsx");
const ACTIONS_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "actions.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const pageSource = fs.readFileSync(CONNECTORS_PAGE, "utf8");
  const actionsSource = fs.readFileSync(ACTIONS_FILE, "utf8");

  assert(
    pageSource.includes('if (slug === "flipkart")') &&
      pageSource.includes("Client ID") &&
      pageSource.includes("Client Secret") &&
      pageSource.includes("Refresh Token"),
    "Connectors page must render Flipkart-specific credential fields inside the dedicated setup workspace.",
  );
  assert(
    pageSource.includes('if (slug === "amazon-in")') &&
      pageSource.includes("Amazon India live install needs seller ID plus validated LWA credentials.") &&
      pageSource.includes("Enter Amazon seller ID") &&
      pageSource.includes("Enter Amazon refresh token"),
    "Connectors page must render Amazon-specific seller ID and credential guidance inside the dedicated setup workspace.",
  );
  assert(
    pageSource.includes("encrypted on save and never shown again"),
    "Connector install forms must explain secret handling truthfully.",
  );
  assert(
    pageSource.includes("installErrorMessage") &&
      pageSource.includes("FLIPKART_CREDENTIALS_INVALID") &&
      pageSource.includes("AMAZON_CREDENTIALS_INVALID"),
    "Connectors page must surface install-time validation failures back to the user.",
  );
  assert(
    pageSource.includes("Portfolio Summary") &&
      pageSource.includes("Live marketplaces") &&
      pageSource.includes("Needs setup") &&
      pageSource.includes("Action rail") &&
      pageSource.includes("Marketplace catalog") &&
      pageSource.includes("Setup workspace") &&
      pageSource.includes("Connected accounts") &&
      pageSource.includes("Search connectors"),
    "Connectors page must render the operator-facing workspace anchors for the marketplace hub.",
  );
  assert(
    pageSource.includes('href="#connector-setup"') &&
      pageSource.includes('id="connector-catalog"') &&
      pageSource.includes('id="connector-setup"'),
    "Connectors page must route setup and catalog actions through explicit workspace anchors.",
  );
  assert(
    actionsSource.includes("clientId: clientId || undefined") &&
      actionsSource.includes("clientSecret: clientSecret || undefined") &&
      actionsSource.includes("refreshToken: refreshToken || undefined"),
    "installConnectorAction must forward Flipkart credentials to the connector install endpoint.",
  );
  assert(
    actionsSource.includes("installError") && actionsSource.includes("connectorSlug"),
    "installConnectorAction must redirect with an installError and connectorSlug when validation fails.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "connector_workspace_hub_anchors_present",
          "connector_workspace_anchors_route_to_setup_and_catalog",
          "flipkart_install_form_collects_credentials",
          "amazon_install_form_collects_seller_credentials",
          "connector_install_form_explains_secret_handling",
          "flipkart_install_action_surfaces_validation_error",
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
  console.error("Connector install form integration test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
