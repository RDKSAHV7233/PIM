#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PLAN_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "plan", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PLAN_PAGE, "utf8");

  assert(
    source.includes("const signupTrendDays = resolveSignupTrendDays(query.days);") &&
      source.includes('role === "admin"') &&
      source.includes("getKpiTrends({ days: signupTrendDays }, { role, authHeader })"),
    "Plan page must load signup KPI trends for admins using the selected window.",
  );
  assert(
    source.includes("Self-Serve Signup Conversion") &&
      source.includes("Workspace Signups") &&
      source.includes("Verified Workspaces") &&
      source.includes("Verification Rate") &&
      source.includes("Median Verify Time"),
    "Plan page must render the signup conversion section and KPI labels.",
  );
  assert(
    source.includes("SIGNUP_TREND_WINDOWS = [7, 30, 90]") &&
      source.includes("href={`/admin/plan?days=${days}`}") &&
      source.includes("No signup activity recorded for this window yet.") &&
      source.includes("<th className=\"px-3 py-2\">Date</th>"),
    "Plan page must expose trend-window links and the signup trend table.",
  );
  assert(
    source.includes("Daily Trend At A Glance") &&
      source.includes("No signup activity to chart yet.") &&
      source.includes('aria-label={`${row.date} signups`}') &&
      source.includes('aria-label={`${row.date} verified workspaces`}'),
    "Plan page must expose a quick visual chart for signup and verification activity.",
  );
  assert(
    source.includes("Strongest Signup Day") &&
      source.includes("Best Verification Day") &&
      source.includes("Slowest Verification Day"),
    "Plan page must expose signup trend highlight summaries.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "plan_page_loads_signup_kpi_trends_for_admins",
          "plan_page_renders_signup_conversion_kpis",
          "plan_page_exposes_signup_trend_windows_and_table",
          "plan_page_exposes_signup_activity_chart",
          "plan_page_exposes_signup_trend_highlights",
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
  console.error("Admin plan signup conversion UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
