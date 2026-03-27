#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE_PATH = path.join(REPO_ROOT, "apps", "web", "src", "app", "internal", "developer", "page.tsx");
const ACTIONS_PATH = path.join(REPO_ROOT, "apps", "web", "src", "app", "internal", "developer", "actions.ts");
const EXPORT_ROUTE_PATH = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "api",
  "internal",
  "commercial-requests",
  "export",
  "route.ts",
);
const TENANT_EXPORT_ROUTE_PATH = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "api",
  "internal",
  "commercial-tenants",
  "export",
  "route.ts",
);
const API_PATH = path.join(REPO_ROOT, "apps", "web", "src", "lib", "api", "internal-billing.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const pageSource = fs.readFileSync(PAGE_PATH, "utf8");
  const actionsSource = fs.readFileSync(ACTIONS_PATH, "utf8");
  const exportRouteSource = fs.readFileSync(EXPORT_ROUTE_PATH, "utf8");
  const tenantExportRouteSource = fs.readFileSync(TENANT_EXPORT_ROUTE_PATH, "utf8");
  const apiSource = fs.readFileSync(API_PATH, "utf8");

  assert(
    pageSource.includes("notFound();") &&
      pageSource.includes('actorRole !== "admin"') &&
      pageSource.includes('process.env.APP_ENV === "production"'),
    "Internal commercial ops page must stay gated to admin non-production access.",
  );
  assert(
    pageSource.includes("Tenants") &&
      pageSource.includes("Trial") &&
      pageSource.includes("Paid") &&
      pageSource.includes("Past due") &&
      pageSource.includes("Suspended") &&
      pageSource.includes("Active queue") &&
      pageSource.includes("Workspace activity:") &&
      pageSource.includes("Request queue:") &&
      pageSource.includes("Last 7 days:") &&
      pageSource.includes("Open queue") &&
      pageSource.includes("Acknowledged") &&
      pageSource.includes("Resolved") &&
      pageSource.includes("Cancelled") &&
      pageSource.includes("Export tenants CSV") &&
      pageSource.includes("/api/internal/commercial-tenants/export") &&
      pageSource.includes("Export CSV") &&
      pageSource.includes("/api/internal/commercial-requests/export"),
    "Internal commercial ops page must surface the overview metrics, queue summary, quick queue links, and both CSV exports.",
  );
  assert(
    pageSource.includes("Selected tenant snapshot") &&
      pageSource.includes("Trial ends:") &&
      pageSource.includes("Paid through:") &&
      pageSource.includes("Grace ends:") &&
      pageSource.includes("Suspended at:") &&
      pageSource.includes("Admin recipients") &&
      pageSource.includes("Tenant audit trail"),
    "Internal commercial ops page must expose selected-tenant commercial snapshot details.",
  );
  assert(
    pageSource.includes("Commercial ops request queue") &&
      pageSource.includes("Search workspaces") &&
      pageSource.includes("Request filter") &&
      pageSource.includes("View requests") &&
      pageSource.includes("No commercial requests found for this filter."),
    "Internal commercial ops page must expose search and queue controls.",
  );
  assert(
      pageSource.includes("Acknowledge") &&
      pageSource.includes("Resolve") &&
      pageSource.includes("Cancel") &&
      pageSource.includes("Re-open") &&
      pageSource.includes("Audit trail") &&
      pageSource.includes("Needs follow-up") &&
      pageSource.includes("updateUpgradeRequestStatusAction"),
    "Internal commercial ops page must expose request lifecycle actions, follow-up links, and queue age signals.",
  );
  assert(
    actionsSource.includes('redirect("/internal/developer?actionStatus=forbidden")') &&
      actionsSource.includes("updateInternalUpgradeRequestStatus") &&
      actionsSource.includes('returnTo.searchParams.set("actionStatus", status)'),
    "Internal commercial ops actions must route status updates and preserve operator feedback.",
  );
  assert(
    exportRouteSource.includes("getServerActorRole") &&
      exportRouteSource.includes("getServerSessionClaims") &&
      exportRouteSource.includes("/billing/internal/upgrade-requests/export") &&
      exportRouteSource.includes('"x-pim-commercial-ops-token"') &&
      exportRouteSource.includes('"Content-Disposition"'),
    "Internal commercial export route must enforce admin session context and proxy the hidden CSV endpoint.",
  );
  assert(
    tenantExportRouteSource.includes("getServerActorRole") &&
      tenantExportRouteSource.includes("getServerSessionClaims") &&
      tenantExportRouteSource.includes("/billing/internal/tenants/export") &&
      tenantExportRouteSource.includes('"x-pim-commercial-ops-token"') &&
      tenantExportRouteSource.includes('"Content-Disposition"'),
    "Internal commercial tenant export route must enforce admin session context and proxy the hidden CSV endpoint.",
  );
  assert(
    apiSource.includes("/billing/internal/overview") &&
      apiSource.includes("CommercialOverviewResponse") &&
      apiSource.includes("getCommercialOverviewInternal"),
    "Internal billing API helper must expose the commercial overview endpoint.",
  );
  assert(
    apiSource.includes("/billing/internal/upgrade-requests") &&
      apiSource.includes("/billing/internal/tenants/search") &&
      apiSource.includes("/billing/internal/upgrade-requests/status") &&
      apiSource.includes("x-pim-commercial-ops-token") &&
      apiSource.includes("getCommercialOpsRequestOptions"),
    "Internal billing API helper must target the hidden commercial ops endpoints with the required headers.",
  );

  console.log(
    JSON.stringify(
        {
          status: "ok",
          validated: [
            "internal_commercial_ops_page_stays_gated",
            "internal_commercial_ops_page_surfaces_overview_metrics",
            "internal_commercial_ops_page_surfaces_selected_tenant_snapshot",
            "internal_commercial_ops_page_exposes_search_and_queue_controls",
            "internal_commercial_ops_page_exposes_request_lifecycle_actions",
            "internal_commercial_ops_actions_preserve_feedback_state",
            "internal_commercial_export_route_proxies_hidden_csv_endpoint",
            "internal_commercial_tenant_export_route_proxies_hidden_csv_endpoint",
            "internal_billing_api_helper_exposes_commercial_overview_endpoint",
            "internal_billing_api_helper_targets_hidden_ops_endpoints",
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
  console.error("Internal commercial ops UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
