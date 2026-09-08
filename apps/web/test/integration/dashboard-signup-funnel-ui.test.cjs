#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const DASHBOARD_API = path.join(REPO_ROOT, "apps", "web", "src", "lib", "api", "dashboard.ts");
const DASHBOARD_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "dashboard", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const dashboardApiSource = fs.readFileSync(DASHBOARD_API, "utf8");
  const dashboardPageSource = fs.readFileSync(DASHBOARD_PAGE, "utf8");

  assert(
    dashboardApiSource.includes("export async function getKpiTrends"),
    "Dashboard API client must expose getKpiTrends for internal KPI visibility.",
  );
  assert(
    dashboardPageSource.includes("hasSignupAnalyticsAccess") &&
      dashboardPageSource.includes('adminBoundaryRoles.includes("system_admin")') &&
      dashboardPageSource.includes('adminBoundaryRoles.includes("super_admin")') &&
      dashboardPageSource.includes("canViewSignupAnalytics") &&
      dashboardPageSource.includes("getKpiTrends({ days: 30 }, { role: actorRole, authHeader"),
    "Dashboard must load signup KPIs only for system/super admin boundary roles.",
  );
  assert(
    dashboardPageSource.includes("Signup Funnel") &&
      dashboardPageSource.includes('label="Workspace Signups"') &&
      dashboardPageSource.includes('label="Verified Workspaces"') &&
      dashboardPageSource.includes('label="Verification Rate"') &&
      dashboardPageSource.includes('label="Median Verify Time"'),
    "Dashboard must preserve the signup funnel KPI labels for internal operators.",
  );
  assert(
    dashboardPageSource.includes("resolveSignupHealthAlert") &&
      dashboardPageSource.includes("Signup verification needs attention") &&
      dashboardPageSource.includes("Signup verification is slowing down") &&
      dashboardPageSource.includes("Signup conversion looks healthy") &&
      dashboardPageSource.includes("/admin/commercial?days=${signupTrends.rangeDays}#signup-conversion") &&
      dashboardPageSource.includes("Open signup trends"),
    "Dashboard must drill signup analytics into Commercial Ops, not tenant Plan & Usage.",
  );
  assert(
    dashboardPageSource.includes("Signup Trend Snapshot") &&
      dashboardPageSource.includes("dashboard signups") &&
      dashboardPageSource.includes("dashboard verified workspaces") &&
      dashboardPageSource.includes("Pending Verification Backlog"),
    "Dashboard must preserve compact signup trend and backlog signals for internal operators.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "dashboard_api_exposes_signup_kpi_trends",
          "dashboard_loads_signup_kpis_for_boundary_admins",
          "dashboard_renders_signup_funnel_cards",
          "dashboard_drills_into_commercial_ops",
          "dashboard_exposes_signup_trend_snapshot",
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
  console.error("Dashboard signup funnel UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
