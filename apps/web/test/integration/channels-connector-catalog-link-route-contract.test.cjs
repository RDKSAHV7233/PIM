#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "channels",
  "connectors",
  "[installationId]",
  "catalog-link",
  "page.tsx",
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function run() {
  const page = read(PAGE);

  assert(
    page.includes("await getServerSession()") &&
      page.includes("getInstalledConnectors") &&
      page.includes("getProductLinks") &&
      page.includes("scanCatalogLinks") &&
      page.includes("buildLoginRedirect"),
    "Catalog link page must derive shared server auth context, load installations, existing links, and scan results, and redirect expired sessions.",
  );

  assert(
    page.includes('redirect(`/channels/connectors`)') ||
      page.includes("redirect('/channels/connectors')") ||
      page.includes('redirect("/channels/connectors")'),
    "Catalog link page must redirect to the connectors list when the installation is not found.",
  );

  assert(
    page.includes("Catalog link unavailable") &&
      page.includes("Shopify catalog link data could not be loaded"),
    "Catalog link page must show an explicit unavailable state on non-auth backend failures instead of throwing a 500.",
  );

  assert(
    page.includes("ConfirmLinksButton") &&
      page.includes("scanResult.matched") &&
      page.includes("matchedBy"),
    "Catalog link page must render matched scan results with a confirm-links action and show the match method.",
  );

  assert(
    page.includes("confirmedCount") &&
      page.includes("confirmedAt"),
    "Catalog link page must show confirmed link counts and track when each link was confirmed.",
  );

  assert(
    page.includes("scan === \"1\"") || page.includes('scan === "1"'),
    "Catalog link page must only invoke the scan API when the scan query param is set to avoid unintended API calls on load.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "catalog_link_route_uses_shared_server_auth_context",
          "catalog_link_route_redirects_for_unknown_installation",
          "catalog_link_route_renders_unavailable_state_on_backend_failure",
          "catalog_link_route_renders_matched_results_with_confirm_action",
          "catalog_link_route_tracks_confirmed_link_counts",
          "catalog_link_route_gate_scans_on_query_param",
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
  console.error("Catalog link route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
