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
    source.includes('type SharedReadState = "available" | "restricted" | "unavailable";') &&
      source.includes("async function loadSharedRead<T>(promise: Promise<T>): Promise<SharedReadResult<T>>") &&
      source.includes("const [healthResult, usageResult, operationsSummaryResult, productsResult, signupTrendsResult, pricingCoverageResult] = await Promise.all([") &&
      source.includes("loadSharedRead(getDashboardHealth({ role: actorRole, authHeader") &&
      source.includes("loadSharedRead(getBillingUsage({ role: actorRole, authHeader") &&
      source.includes("loadSharedRead(getDashboardOperationsSummary({ role: actorRole, authHeader") &&
      source.includes("loadSharedRead(getProductList({ slim: true }, { role: actorRole, authHeader }))") &&
      source.includes("loadSharedRead(getKpiTrends({ days: 30 }, { role: actorRole, authHeader") &&
      source.includes("loadSharedRead(getPricingCoverage({ role: actorRole, authHeader"),
    "Dashboard must load health, billing usage, operations data, product work queue, signup trends, and pricing through explicit shared-read wrappers.",
  );
  assert(
    source.includes("const healthData =") &&
      source.includes("const blockedListings = Object.values(healthResult.value.snapshot.blockedByConnector).reduce(") &&
      source.includes("const readinessTotal = Object.values(healthResult.value.snapshot.publishReadyByConnector).reduce(") &&
      source.includes("blockedListingsTotal") &&
      source.includes("readinessGrandTotal") &&
      source.includes("approvalQueueRedacted") &&
      source.includes("const failedImportJobs = operationsSummary?.failedImportJobs ?? null;") &&
      source.includes("const jobsNeedingRetry = operationsSummary?.jobsNeedingRetry ?? null;"),
    "Dashboard must derive top-line catalog, publish, redaction-aware, and operations KPIs from live backend snapshots.",
  );
  assert(
    source.includes("function DashboardSharedReadNotice({ states }: { states: SharedReadState[] })") &&
      source.includes("Some dashboard data is temporarily unavailable") &&
      source.includes("Some dashboard data is restricted") &&
      source.includes("Unavailable cards are held back instead of defaulting to healthy values.") &&
      source.includes("DashboardSharedReadNotice"),
    "Dashboard must surface a shared-read notice when restricted or unavailable dashboard feeds are present.",
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
      source.includes('href={operationsSummaryResult.state === "available" ? "/channels/connectors" : undefined}'),
    "Dashboard must surface channel readiness and publish-health drilldowns.",
  );
  assert(
    source.includes("Pricing coverage is limited for your role.") &&
      source.includes("Pricing coverage is temporarily unavailable.") &&
      source.includes("No price lists configured yet") &&
      source.includes('value={') &&
      source.includes('pricingState === "not_configured"') &&
      source.includes('pricingState === "restricted"') &&
      source.includes('pricingState === "unavailable"'),
    "Dashboard must distinguish restricted, unavailable, and not-configured pricing coverage states.",
  );
  assert(
    source.includes("resolveSignupHealthAlert") &&
      source.includes("buildSignupSparklineRows") &&
      source.includes("Signup Funnel") &&
      source.includes("Pending Verification Backlog") &&
      source.includes("Signup Trend Snapshot") &&
      source.includes("Open signup trends") &&
      source.includes('const signupDrilldownHref = signupTrendsData') &&
      source.includes('href={signupDrilldownHref}'),
    "Dashboard must expose the admin-only signup funnel, backlog, and drilldown contract.",
  );
  assert(
    source.includes("const priorityProducts = products") &&
      source.includes('priorityReason =') &&
      source.includes("Top products to fix now") &&
      source.includes("No products need immediate attention.") &&
      source.includes("Product work queue visibility is limited for your role.") &&
      source.includes("Product work queue is temporarily unavailable.") &&
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
      source.includes("Operational job counts are temporarily unavailable.") &&
      source.includes('Plan and billing usage are limited to editor and admin roles.') &&
      source.includes("Plan and billing usage are temporarily unavailable.") &&
      source.includes("Approval queue visibility requires reviewer, editor, or admin access.") &&
      source.includes("Aggregate blocked counts are visible. Channel-level breakdown requires editor or admin access.") &&
      source.includes("StatusChip label={usage.planTier}") &&
      source.includes("StatusChip label={`${usage.skus.current}/${usage.skus.limit}`}") &&
      source.includes('href={operationsSummaryResult.state === "available" ? "/channels/connectors" : undefined}') &&
      source.includes('StatusChip label={operationsSummaryResult.state === "restricted" ? "Restricted" : "Unavailable"}'),
    "Dashboard must surface catalog backlog plus role-aware operations, usage, and redaction-aware drilldowns without exposing restricted data to read-only roles.",
  );
  assert(
    source.includes('if (error instanceof ApiHttpError && error.status === 401)') &&
      source.includes('redirect(buildLoginRedirect("/dashboard", error));'),
    "Dashboard must redirect only expired sessions while preserving restricted dashboard reads in-page.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "dashboard_route_uses_shared_server_auth_context",
          "dashboard_route_fetches_health_usage_operations_products_and_admin_trends_with_explicit_shared_read_states",
          "dashboard_route_derives_live_catalog_publish_and_ops_kpis",
          "dashboard_route_surfaces_dashboard_shared_read_notice",
          "dashboard_route_preserves_refresh_and_primary_actions",
          "dashboard_route_surfaces_catalog_health_kpis",
          "dashboard_route_surfaces_publish_health_drilldowns",
          "dashboard_route_distinguishes_pricing_restricted_unavailable_and_not_configured_states",
          "dashboard_route_exposes_admin_signup_funnel_and_drilldown",
          "dashboard_route_derives_priority_product_queue",
          "dashboard_route_preserves_next_best_action_links",
          "dashboard_route_exposes_polished_onboarding_checklist",
          "dashboard_route_surfaces_catalog_and_usage_follow_up_panels",
          "dashboard_route_redirects_only_expired_sessions",
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
