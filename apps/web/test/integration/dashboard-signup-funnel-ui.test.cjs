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
    "Dashboard API client must expose getKpiTrends for dashboard KPI visibility.",
  );
  assert(
    dashboardPageSource.includes('actorRole === "admin"') &&
      dashboardPageSource.includes('getKpiTrends({ days: 30 }, { role: actorRole, authHeader })'),
    "Dashboard must load signup KPIs for admins from the metrics trends API.",
  );
  assert(
    dashboardPageSource.includes("Signup Funnel") &&
      dashboardPageSource.includes('label="Workspace Signups"') &&
      dashboardPageSource.includes('label="Verified Workspaces"') &&
      dashboardPageSource.includes('label="Verification Rate"') &&
      dashboardPageSource.includes('label="Median Verify Time"'),
    "Dashboard must render the signup funnel KPI labels.",
  );
  assert(
    dashboardPageSource.includes("resolveSignupHealthAlert") &&
      dashboardPageSource.includes("Signup verification needs attention") &&
      dashboardPageSource.includes("Signup verification is slowing down") &&
      dashboardPageSource.includes("Signup conversion looks healthy") &&
      dashboardPageSource.includes("const signupDrilldownHref = signupTrends") &&
      dashboardPageSource.includes("Open signup trends"),
    "Dashboard must expose a signup health alert and a drill-down link to the admin signup trends view.",
  );
  assert(
    dashboardPageSource.includes("Signup Trend Snapshot") &&
      dashboardPageSource.includes("dashboard signups") &&
      dashboardPageSource.includes("dashboard verified workspaces"),
    "Dashboard must expose a compact signup trend snapshot for admins.",
  );
  assert(
    dashboardPageSource.includes('href={signupDrilldownHref}') &&
      dashboardPageSource.includes('label="Workspace Signups"') &&
      dashboardPageSource.includes('label="Verified Workspaces"') &&
      dashboardPageSource.includes('label="Verification Rate"') &&
      dashboardPageSource.includes('label="Median Verify Time"'),
    "Dashboard signup KPI cards must drill into the admin signup conversion view.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "dashboard_api_exposes_signup_kpi_trends",
          "dashboard_loads_signup_kpis_for_admins",
          "dashboard_renders_signup_funnel_cards",
          "dashboard_exposes_signup_health_alert_and_admin_link",
          "dashboard_exposes_signup_trend_snapshot",
          "dashboard_signup_cards_drill_into_admin_conversion_view",
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

