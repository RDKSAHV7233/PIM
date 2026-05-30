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
const ACTIONS_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "actions.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const detailSource = fs.readFileSync(DETAIL_PAGE, "utf8");
  const actionsSource = fs.readFileSync(ACTIONS_FILE, "utf8");

  assert(
    detailSource.includes('installation.slug === "shopify"') &&
      detailSource.includes("Account Connection") &&
      detailSource.includes("Shop domain") &&
      detailSource.includes("Publication Targets"),
    "Connector detail page must render a Shopify-specific connection and publication-target section.",
  );
  assert(
    detailSource.includes("getConnectorPublications") &&
      detailSource.includes("shopifyPublicationState") &&
      detailSource.includes("Save publication targets"),
    "Connector detail page must fetch available Shopify publication targets and surface a save action.",
  );
  assert(
    detailSource.includes('metadataConnectionStage === "awaiting_managed_install"') &&
      detailSource.includes("shopifyAwaitingManagedInstall") &&
      detailSource.includes('selectedTab === "credentials" && installation.slug === "shopify" && !shopifyAwaitingManagedInstall'),
    "Connector detail page must skip Shopify publication loading while managed install is still awaiting OAuth completion.",
  );
  assert(
    detailSource.includes("Complete Shopify authorization before configuring publication channels.") &&
      detailSource.includes("Complete Shopify authorization before refreshing channels."),
    "Connector detail page must show pre-auth Shopify publication guidance instead of treating the empty state like a live store fetch.",
  );
  assert(
    detailSource.includes('name="publicationId"') &&
      detailSource.includes('name="returnTo"') &&
      detailSource.includes('name="tenantKey"'),
    "Shopify publication-target form must submit selected target ids with redirect and tenant context.",
  );
  assert(
    actionsSource.includes("updateConnectorPublicationTargetsAction") &&
      actionsSource.includes("/publication-targets") &&
      actionsSource.includes("publication-targets-saved"),
    "Server action must persist publication targets and redirect with a success status.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "shopify_connector_detail_surfaces_connection_context",
          "shopify_connector_detail_fetches_publication_targets",
          "shopify_connector_detail_skips_publication_fetch_during_managed_install_handoff",
          "shopify_connector_detail_surfaces_pre_auth_publication_guidance",
          "shopify_publication_target_form_posts_selected_ids",
          "shopify_publication_target_action_redirects_with_status",
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
  console.error("Shopify connector detail UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
