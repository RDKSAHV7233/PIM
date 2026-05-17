#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CONNECTORS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "connectors", "page.tsx");
const SETUP_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "connectors", "setup", "page.tsx");
const ACTIONS_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "actions.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const pageSource = fs.readFileSync(CONNECTORS_PAGE, "utf8");
  const setupSource = fs.readFileSync(SETUP_PAGE, "utf8");
  const actionsSource = fs.readFileSync(ACTIONS_FILE, "utf8");

  assert(
    setupSource.includes('if (slug === "flipkart")') &&
      setupSource.includes("Client ID") &&
      setupSource.includes("Client Secret") &&
      setupSource.includes("Refresh Token"),
    "Connector setup page must render Flipkart-specific credential fields inside the dedicated setup workspace.",
  );
  assert(
    setupSource.includes('if (slug === "amazon-in")') &&
      setupSource.includes("Amazon India live install needs seller ID plus validated LWA") &&
      setupSource.includes("Enter Amazon seller ID") &&
      setupSource.includes("Enter Amazon SP-API refresh token"),
    "Connector setup page must render Amazon-specific seller ID and credential guidance inside the dedicated setup workspace.",
  );
  assert(
    setupSource.includes('if (slug === "shopify")') &&
      setupSource.includes("Shopify uses managed install.") &&
      setupSource.includes("demo-store.myshopify.com") &&
      setupSource.includes("managed-install lanes continue in the provider callback"),
    "Connector setup page must explain the Shopify managed-install domain handoff inside the dedicated setup workspace.",
  );
  assert(
    setupSource.includes("encrypted on save and never shown again"),
    "Connector setup forms must explain secret handling truthfully.",
  );
  assert(
    setupSource.includes("installErrorMessage") &&
      setupSource.includes("FLIPKART_CREDENTIALS_INVALID") &&
      setupSource.includes("AMAZON_CREDENTIALS_INVALID") &&
      setupSource.includes("SHOPIFY_SHOP_DOMAIN_INVALID"),
    "Connector setup flow must surface install-time validation failures back to the user.",
  );
  assert(
    setupSource.includes("InlineAlert") &&
      setupSource.includes('<InlineAlert tone="success" message={actionStatusMessage} />') &&
      setupSource.includes('<InlineAlert tone="error" message={installErrorMessage} />'),
    "Connector setup page must use the shared inline alert pattern for install success and error feedback.",
  );
  assert(
    pageSource.includes("Action rail") &&
      pageSource.includes('title="Connections"') &&
      pageSource.includes("Channel catalog") &&
      pageSource.includes("Connected accounts") &&
      pageSource.includes("Search connections"),
    "Connectors page must render the operator-facing workspace anchors for the marketplace hub.",
  );
  assert(
    pageSource.includes("function isDisabledInstallation") &&
      pageSource.includes("!isDisabledInstallation(installation) && isInstallationAttentionStatus") &&
      pageSource.includes("formatInstallFootprint(installedForDefinition)") &&
      pageSource.includes("0 active accounts"),
    "Connectors page must not treat disabled historical installations as unhealthy active connector footprint.",
  );
  assert(
    pageSource.includes('href="/channels/connectors/setup"') &&
      pageSource.includes('href={`/channels/connectors/setup?slug=${encodeURIComponent(definition.slug)}`}') &&
      pageSource.includes('id="connector-catalog"') &&
      setupSource.includes("Back to connection portfolio") &&
      setupSource.includes("Setup flow") &&
      setupSource.includes("Focused setup lane") &&
      setupSource.includes("Connection readiness checklist"),
    "Connectors hub must route install work into the dedicated setup page instead of embedding credential forms inline.",
  );
  assert(
    actionsSource.includes("clientId: clientId || undefined") &&
      actionsSource.includes("clientSecret: clientSecret || undefined") &&
      actionsSource.includes("refreshToken: refreshToken || undefined"),
    "installConnectorAction must forward Flipkart credentials to the connector install endpoint.",
  );
  assert(
    actionsSource.includes("externalAccountRef: externalAccountRef || undefined"),
    "installConnectorAction must forward connector account references such as the Shopify store domain to the install endpoint.",
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
          "connector_workspace_excludes_disabled_history_from_attention_state",
          "connector_workspace_routes_setup_to_dedicated_page",
          "flipkart_install_form_collects_credentials",
          "amazon_install_form_collects_seller_credentials",
          "shopify_install_form_collects_store_domain_handoff",
          "connector_install_form_explains_secret_handling",
          "connector_setup_page_uses_shared_inline_alerts",
          "connector_setup_page_includes_readiness_checklist",
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
