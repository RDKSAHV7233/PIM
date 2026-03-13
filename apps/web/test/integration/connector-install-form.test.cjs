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
    pageSource.includes('definition.slug === "flipkart"') &&
      pageSource.includes("Client ID") &&
      pageSource.includes("Client Secret") &&
      pageSource.includes("Refresh Token"),
    "Connectors page must render Flipkart-specific credential fields inside the install form.",
  );
  assert(
    pageSource.includes("encrypted on save and never shown again"),
    "Flipkart install form must explain secret handling truthfully.",
  );
  assert(
    pageSource.includes("installErrorMessage") &&
      pageSource.includes("FLIPKART_CREDENTIALS_INVALID"),
    "Connectors page must surface install-time validation failures back to the user.",
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
          "flipkart_install_form_collects_credentials",
          "flipkart_install_form_explains_secret_handling",
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
