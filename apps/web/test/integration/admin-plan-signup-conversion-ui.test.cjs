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
      source.includes("<th className=\"px-3 py-2\">Date</th>") &&
      source.includes("<th className=\"px-3 py-2\">Pending</th>") &&
      source.includes("pendingBacklog"),
    "Plan page must expose trend-window links and the signup trend table, including daily pending backlog.",
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
      source.includes("Highest Backlog Day") &&
      source.includes("Best Verification Day") &&
      source.includes("Slowest Verification Day"),
    "Plan page must expose signup trend highlight summaries.",
  );
  assert(
    source.includes("Pending Verification Backlog") &&
      source.includes("Use the chart and table below to spot the slowest days.") &&
      source.includes("Every signup request in the last"),
    "Plan page must expose a window-scoped pending verification backlog summary.",
  );
  assert(
    source.includes('role !== "admin"') &&
      source.includes("<CardTitle>Commercial Controls</CardTitle>") &&
      source.includes("Workspace admins can manage billing contacts, request plan changes, and review signup conversion") &&
      source.includes("You can still review current usage and commercial status above."),
    "Plan page must explain the read-only fallback for non-admin roles instead of silently hiding commercial controls.",
  );
  assert(
    source.includes("Plan changes are managed by TEJ commercial ops.") &&
      source.includes("Customer admins can review plan usage") &&
      source.includes("paid-plan changes are applied through") &&
      source.includes("updateBillingContactAction") &&
      source.includes("Billing contact email") &&
      source.includes("Save billing contact") &&
      source.includes("Use admin fallback") &&
      source.includes("getBillingUpgradeRequest") &&
      source.includes("requestPlanUpgradeAction") &&
      source.includes("Upgrade request pending") &&
      source.includes("Request notes") &&
      source.includes("resolveCommercialContactTarget") &&
      source.includes("commercialContact.label") &&
      !source.includes("setPlanTierAction") &&
      !source.includes("Update plan"),
    "Plan page must be read-only for customer admins and route plan changes into a tracked TEJ commercial workflow.",
  );
  assert(
      source.includes("resolveCommercialStatusAlert") &&
      source.includes("Workspace access is suspended") &&
      source.includes("Billing needs attention") &&
      source.includes("Trial is active") &&
      source.includes("Billing: {formatCommercialStatus(usage.billingStatus)}") &&
      source.includes('Billing notices: {usage.profile.billingContactEmail ?? "active workspace admins"}') &&
      source.includes("Access:") &&
      source.includes("formatAccessStatus"),
    "Plan page must expose commercial status and warning states for billing/access transitions.",
  );
  assert(
    source.includes("resolveSignupHealthAlert") &&
      source.includes("Verification rate needs attention") &&
      source.includes("Verification is slowing down") &&
      source.includes("Signup conversion looks healthy"),
    "Plan page must expose a signup health alert state for admins.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "plan_page_loads_signup_kpi_trends_for_admins",
          "plan_page_renders_signup_conversion_kpis",
          "plan_page_exposes_signup_trend_windows_and_table",
          "plan_page_exposes_daily_pending_backlog_in_trend_table",
          "plan_page_exposes_signup_activity_chart",
          "plan_page_exposes_signup_trend_highlights",
          "plan_page_exposes_pending_verification_backlog_summary",
          "plan_page_exposes_read_only_commercial_upgrade_flow",
          "plan_page_exposes_commercial_status_warning_states",
          "plan_page_exposes_signup_health_alert",
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
