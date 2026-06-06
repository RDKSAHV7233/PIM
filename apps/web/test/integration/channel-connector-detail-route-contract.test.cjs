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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(DETAIL_PAGE, "utf8");

  assert(
    source.includes("const { installationId } = await params;") &&
      source.includes("const query = await searchParams;") &&
      source.includes("await getServerSession();"),
    "Channel connector detail must derive route params, tab state, and shared server auth/session context.",
  );

  assert(
    source.includes("const installations = await getInstalledConnectors({ role: actorRole, authHeader });") &&
      source.includes("const installation = installations.find((item) => item.id === installationId);") &&
      source.includes("if (!installation) {") &&
      source.includes("notFound();"),
    "Channel connector detail must resolve the selected installation from the shared installation list and 404 missing records.",
  );

  assert(
    source.includes("const [permissions, submissionsRaw, products, shopifyPublicationState] = await Promise.all([") &&
      source.includes("getConnectorPermissions(installation.slug, { role: actorRole, authHeader })") &&
      source.includes("getSubmissions({ installationId: installation.id, limit: 100 }, { role: actorRole, authHeader })") &&
      source.includes("getProductList({ slim: true }, { role: actorRole, authHeader })"),
    "Channel connector detail must fetch permissions, installation-scoped submissions, and product lookup data together.",
  );
  assert(
      source.includes("getConnectorPublications(installation.id, { role: actorRole, authHeader })") &&
      source.includes("updateConnectorPublicationTargetsAction") &&
      source.includes('name="publicationId"') &&
      source.includes("Save publication targets") &&
      source.includes("Shopify Readiness") &&
      source.includes("Managed Install Handoff"),
    "Channel connector detail must surface live publication target management and Shopify managed-install guidance.",
  );

  assert(
    source.includes('const DETAIL_TABS: Array<{ id: DetailTab; label: string }> = [') &&
      source.includes('{ id: "overview", label: "Overview" }') &&
      source.includes('{ id: "credentials", label: "Credentials" }') &&
      source.includes('{ id: "catalog", label: "Catalog" }') &&
      source.includes('{ id: "mappings", label: "Mappings" }') &&
      source.includes('{ id: "issues", label: "Issues" }') &&
      source.includes('{ id: "logs", label: "Logs" }') &&
      source.includes('{ id: "access", label: "Access" }'),
    "Channel connector detail must expose the PIM-oriented detail tabs instead of generic iPaaS modules.",
  );

  assert(
    source.includes("const latestSubmissionByProductId = new Map<") &&
      source.includes("const catalogEntries = Array.from(latestSubmissionByProductId.entries())") &&
      source.includes("const focusCatalogEntry = catalogEntries[0] ?? null;") &&
      source.includes("Promise.allSettled([") &&
      source.includes("Catalog Module Framework") &&
      source.includes("Catalog Modules") &&
      source.includes("Focused Product Modules") &&
      source.includes("Payload Preview Snapshot") &&
      source.includes("Readiness Queue") &&
      source.includes("Mapping Scope") &&
      source.includes("Recovery Playbook") &&
      source.includes("Issue Queue"),
    "Channel connector detail must build catalog modules, payload preview, mapping context, readiness, and recovery views from current Vexa data.",
  );

  assert(
    source.includes('label="Account health"') &&
      source.includes('label="Submissions"') &&
      source.includes('label="Errors / Rejections"') &&
      source.includes('label="Access rules"'),
    "Channel connector detail must keep the account health, submission, failure, and access KPIs visible.",
  );

  assert(
      source.includes('href={`/connectors/${encodeURIComponent(installation.id)}/mapping`}') &&
      source.includes('href="/admin/connectors"') &&
      source.includes("Open catalog mapping") &&
      source.includes("issueLaneLabel") &&
      source.includes("catalogReadinessLabel") &&
      source.includes("Credential Safety") &&
      source.includes("Connection Recovery Checklist") &&
      source.includes("Publication Targets") &&
      source.includes("Category and taxonomy") &&
      source.includes("publicationTargetSummary") &&
      source.includes("Why Mappings Stay Shared") &&
      source.includes("No connector-specific permission overrides. Workspace defaults are currently in effect.") &&
      source.includes("No submissions recorded for this account yet.") &&
      source.includes("summarizeSubmissionOutcome") &&
      source.includes("nextOperatorStep"),
    "Channel connector detail must link into mapping/access workflows and keep operator-friendly outcome guidance.",
  );

  assert(
    source.includes("installation.installedAt") &&
      source.includes("installation.lastSyncAt") &&
      source.includes("submission.submittedAt") &&
      (source.includes("formatDateTime") || source.includes("fmtDT")),
    "Channel connector detail must surface installation and submission timing data from backend timestamps.",
  );

  assert(
    source.includes("const detailReturnPath = buildDetailHref(installationId, selectedTab);") &&
      source.includes("redirect(buildLoginRedirect(detailReturnPath, error));"),
    "Channel connector detail must preserve the selected tab when redirecting auth failures through the shared login helper.",
  );

  assert(
    // Phase M-1 (2026-05-28): Meesho export panel wired into the overview tab.
    // The panel is rendered when installation.slug === "meesho" and provides the
    // "Download Excel" trigger + 4-step Supplier Panel upload walkthrough.
    source.includes('installation.slug === "meesho"') &&
      source.includes("MeeshoExportPanel") &&
      source.includes("Meesho Excel Export"),
    "Channel connector detail must render the MeeshoExportPanel card in the overview tab when the connector slug is meesho.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "channel_connector_detail_route_uses_params_and_shared_server_auth_context",
          "channel_connector_detail_route_resolves_installation_and_404s_missing_records",
          "channel_connector_detail_route_fetches_permissions_and_submissions_in_parallel",
          "channel_connector_detail_route_surfaces_publication_target_management",
          "channel_connector_detail_route_exposes_pim_focused_detail_tabs",
          "channel_connector_detail_route_builds_catalog_and_issue_views_from_submission_history",
          "channel_connector_detail_route_preserves_installation_and_access_kpis",
          "channel_connector_detail_route_links_to_mapping_and_access_workflows",
          "channel_connector_detail_route_surfaces_timestamp_fields",
          "channel_connector_detail_route_redirects_auth_failures_with_tab_context",
          "channel_connector_detail_route_surfaces_meesho_export_panel",
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
  console.error("Channel connector detail route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
