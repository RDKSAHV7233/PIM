#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "dashboard", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PAGE, "utf8");

  assert(
      source.includes("await getServerSession();") &&
      source.includes("const canViewOperationsSummary = canEditWorkspace(actorRole);") &&
      source.includes("const canViewBillingUsage = canViewOperationsSummary;"),
    "Dashboard must derive shared server auth/session context before loading catalog and reporting data.",
  );
  assert(
    source.includes("const [health, usage, operationsSummary, products, signupTrends, pricingCoverage] = await Promise.all([") &&
      source.includes("getDashboardHealth({ role: actorRole, authHeader })") &&
      source.includes("canViewBillingUsage ? getBillingUsage({ role: actorRole, authHeader }) : Promise.resolve(null)") &&
      source.includes("canViewOperationsSummary") &&
      source.includes("? getDashboardOperationsSummary({ role: actorRole, authHeader })") &&
      source.includes(": Promise.resolve(null)") &&
      source.includes("getProductList({ slim: true }, { role: actorRole, authHeader })") &&
      source.includes("canViewSignupAnalytics") &&
      source.includes("getKpiTrends({ days: 30 }, { role: actorRole, authHeader })") &&
      source.includes("getPricingCoverage({ role: actorRole, authHeader })"),
    "Dashboard must load health, scoped billing usage, scoped operations data, product priority data, admin-only signup trends, and pricing coverage in one shared server pass.",
  );
  assert(
    source.includes("const blockedListings = Object.values(health.snapshot.blockedByConnector).reduce(") &&
      source.includes("const readinessTotal = Object.values(health.snapshot.publishReadyByConnector).reduce(") &&
      source.includes("const blockedListingsTotal =") &&
      source.includes("const readinessGrandTotal =") &&
      source.includes("const completeness =") &&
      source.includes("const pendingApprovals = Number(health.pendingApprovals ?? 0);") &&
      source.includes('const connectorBreakdownRedacted = health.redactedSections?.includes("connector_breakdown") ?? false;') &&
      source.includes('const approvalQueueRedacted = health.redactedSections?.includes("approval_queue") ?? false;') &&
      source.includes("const failedImportJobs = operationsSummary?.failedImportJobs ?? null;") &&
      source.includes("const jobsNeedingRetry = operationsSummary?.jobsNeedingRetry ?? null;"),
    "Dashboard must derive top-line catalog, publish, redaction-aware, and operations KPIs from live backend snapshots.",
  );
  assert(
    source.includes("<RefreshOnInterval intervalMs={30_000} />") &&
      source.includes('title="Dashboard"') &&
      source.includes('href="/catalog/products"') &&
      source.includes('href="/quality/issues"') &&
      source.includes('href="/operations/imports"'),
    "Dashboard must keep the live-refresh contract and expose the primary operator actions from the page header.",
  );
  assert(
    source.includes("Catalog Health") &&
      source.includes('label="Products Needing Enrichment"') &&
      source.includes('label="Blocking Issues"') &&
      source.includes('label="Pending Approvals"') &&
      source.includes('label="Ready to Publish"'),
    "Dashboard must surface the core catalog-health KPI section.",
  );
  assert(
    source.includes("Publishing Health") &&
      source.includes('label="Blocked Listings"') &&
      source.includes('label="Active Channels"') &&
      source.includes('label="Warnings to Review"') &&
      source.includes('href="/channels/health"') &&
      source.includes('href={operationsSummary ? "/channels/connectors" : undefined}'),
    "Dashboard must surface channel readiness and publish-health drilldowns.",
  );
  assert(
    source.includes("resolveSignupHealthAlert") &&
      source.includes("buildSignupSparklineRows") &&
      source.includes("Signup Funnel") &&
      source.includes("Pending Verification Backlog") &&
      source.includes("Signup Trend Snapshot") &&
      source.includes("Open signup trends") &&
      source.includes('const signupDrilldownHref = signupTrends') &&
      source.includes('href={signupDrilldownHref}'),
    "Dashboard must expose the admin-only signup funnel, backlog, and drilldown contract.",
  );
  assert(
    source.includes("const priorityProducts = products") &&
      source.includes('priorityReason =') &&
      source.includes("Top products to fix now") &&
      source.includes("No products need immediate attention.") &&
      source.includes('href={`/products/${encodeURIComponent(product.id)}`}'),
    "Dashboard must derive and surface the priority product work queue from live product state.",
  );
  assert(
    source.includes("Next best actions") &&
      source.includes('href="/catalog/products?view=needs_attention"') &&
      source.includes('href="/quality/issues"') &&
      source.includes('href="/quality/approvals"') &&
      source.includes('href="/channels/mappings"'),
    "Dashboard must preserve the next-best-actions navigation contract across catalog, quality, and channels follow-up.",
  );
  assert(
    source.includes("Get started - 3 steps to your first export") &&
      source.includes("Use this onboarding checklist to move from an empty catalog to a channel-ready first publish.") &&
      source.includes('StatusChip label="Onboarding checklist" tone="info"') &&
      source.includes("to build your starting catalog.") &&
      source.includes("and configure attribute mapping before you publish.") &&
      source.includes("to make products publish-ready before the first export."),
    "Dashboard must expose a polished onboarding checklist for empty catalog workspaces.",
  );
  assert(
    source.includes("Catalog Work Queue") &&
      source.includes("Operations &amp; Usage") &&
      source.includes("Operational job counts are limited to editor and admin roles.") &&
      source.includes('Plan and billing usage are limited to editor and admin roles.') &&
      source.includes("Approval queue visibility requires reviewer, editor, or admin access.") &&
      source.includes("Aggregate blocked counts are visible. Channel-level breakdown requires editor or admin access.") &&
      source.includes("StatusChip label={usage.planTier}") &&
      source.includes("StatusChip label={`${usage.skus.current}/${usage.skus.limit}`}") &&
      source.includes("canViewBillingUsage ? getBillingUsage({ role: actorRole, authHeader }) : Promise.resolve(null)") &&
      source.includes('href={operationsSummary ? "/channels/connectors" : undefined}'),
    "Dashboard must surface catalog backlog plus role-aware operations, usage, and redaction-aware drilldowns without exposing restricted data to read-only roles.",
  );
  assert(
    source.includes('redirect(buildLoginRedirect("/dashboard", error));'),
    "Dashboard must redirect expired or forbidden sessions through the shared login helper.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "dashboard_route_uses_shared_server_auth_context",
          "dashboard_route_fetches_health_usage_operations_products_and_admin_trends_in_parallel",
          "dashboard_route_derives_live_catalog_publish_and_ops_kpis",
          "dashboard_route_preserves_refresh_and_primary_actions",
          "dashboard_route_surfaces_catalog_health_kpis",
          "dashboard_route_surfaces_publish_health_drilldowns",
          "dashboard_route_exposes_admin_signup_funnel_and_drilldown",
          "dashboard_route_derives_priority_product_queue",
          "dashboard_route_preserves_next_best_action_links",
          "dashboard_route_exposes_polished_onboarding_checklist",
          "dashboard_route_surfaces_catalog_and_usage_follow_up_panels",
          "dashboard_route_redirects_auth_failures",
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
  console.error("Dashboard route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
