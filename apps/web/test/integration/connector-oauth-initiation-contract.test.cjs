#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const ACTIONS_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "actions.ts");
const CONNECTORS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "connectors", "page.tsx");
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
  const actions = fs.readFileSync(ACTIONS_FILE, "utf8");
  const connectors = fs.readFileSync(CONNECTORS_PAGE, "utf8");
  const detail = fs.readFileSync(DETAIL_PAGE, "utf8");

  // ─── initiateOAuthAction server action ────────────────────────────────────

  assert(
    actions.includes("export async function initiateOAuthAction") &&
      actions.includes("/oauth/initiate"),
    "Server action initiateOAuthAction must exist and call POST /connectors/:id/oauth/initiate.",
  );

  assert(
    actions.includes("canManageConnectors") &&
      actions.includes("initiateOAuthAction") &&
      /initiateOAuthAction[\s\S]*?canManageConnectors/.test(actions),
    "initiateOAuthAction must gate on canManageConnectors before calling the API.",
  );

  assert(
    actions.includes("redirect(authorizationUrl)"),
    "initiateOAuthAction must redirect the browser to the backend-provided authorizationUrl on success.",
  );

  assert(
    actions.includes("oauth_initiate_failed") &&
      actions.includes("oauth_not_supported") &&
      /initiateOAuthAction[\s\S]*?oauth_initiate_failed/.test(actions),
    "initiateOAuthAction must redirect to oauth_initiate_failed or oauth_not_supported on API failure.",
  );

  // ─── Connectors list page — Authorize Shopify CTA visibility ──────────────

  assert(
    connectors.includes("initiateOAuthAction") &&
      connectors.includes("Authorize Shopify"),
    "Connectors list page must import initiateOAuthAction and render an Authorize Shopify button.",
  );

  assert(
    connectors.includes('readMetadataValue(installation.metadata, "connectionStage") === "awaiting_managed_install"') &&
      connectors.includes("shopifyAwaitingOAuth"),
    "Authorize Shopify button must only appear when connectionStage is awaiting_managed_install.",
  );

  assert(
    connectors.includes("shopifyAwaitingOAuth ?") &&
      connectors.includes("initiateOAuthAction") &&
      connectors.includes('idleLabel="Authorize Shopify"'),
    "Authorize Shopify CTA must be gated by shopifyAwaitingOAuth flag and use PendingSubmitButton.",
  );

  // ─── Connectors list page — OAuth status messages ─────────────────────────

  assert(
    connectors.includes('"oauth_complete"') &&
      connectors.includes('"oauth_error"') &&
      connectors.includes('"oauth_initiate_failed"') &&
      connectors.includes('"oauth_not_supported"'),
    "Connectors list page must handle oauth_complete, oauth_error, oauth_initiate_failed, and oauth_not_supported status messages.",
  );

  assert(
    connectors.includes("actionIsError") &&
      connectors.includes("border-rose-200"),
    "OAuth error statuses must render with error (rose) tone, not success (emerald) tone.",
  );

  // ─── Detail page — Authorize Shopify in overview + credentials ────────────

  assert(
    detail.includes("initiateOAuthAction") &&
      detail.includes("Authorize Shopify"),
    "Connector detail page must import initiateOAuthAction and render an Authorize Shopify button.",
  );

  assert(
    detail.includes("shopifyAwaitingManagedInstall ?") &&
      /selectedTab === "overview"[\s\S]*?shopifyAwaitingManagedInstall[\s\S]*?Authorize Shopify/.test(detail),
    "Connector detail overview tab must render Authorize Shopify when shopifyAwaitingManagedInstall is true.",
  );

  assert(
    /selectedTab === "credentials"[\s\S]*?shopifyAwaitingManagedInstall[\s\S]*?Authorize Shopify/.test(detail),
    "Connector detail credentials tab must render Authorize Shopify when shopifyAwaitingManagedInstall is true.",
  );

  assert(
    detail.includes('metadataConnectionStage === "awaiting_managed_install"') &&
      detail.includes("shopifyAwaitingManagedInstall"),
    "Detail page Authorize Shopify button must be gated by awaiting_managed_install connection stage.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "initiate_oauth_action_exists_and_calls_oauth_initiate",
          "initiate_oauth_action_gates_on_connector_management_role",
          "initiate_oauth_action_redirects_to_authorization_url_on_success",
          "initiate_oauth_action_redirects_to_error_status_on_failure",
          "connectors_list_renders_authorize_shopify_for_awaiting_managed_install",
          "connectors_list_gates_authorize_button_on_shopify_awaiting_oauth_flag",
          "connectors_list_handles_oauth_status_messages",
          "connectors_list_renders_error_statuses_with_rose_tone",
          "detail_page_renders_authorize_shopify_button",
          "detail_overview_tab_renders_authorize_shopify_when_awaiting",
          "detail_credentials_tab_renders_authorize_shopify_when_awaiting",
          "detail_page_gates_authorize_button_on_awaiting_managed_install",
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
  console.error("Connector OAuth initiation contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
