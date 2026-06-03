#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PLAN_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "plan", "page.tsx");
const SIGNUP_COMPONENT = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "plan", "_components", "signup-conversion.tsx");
const PLAN_MGMT_COMPONENT = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "plan", "_components", "plan-management.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PLAN_PAGE, "utf8");
  const signupSource = fs.existsSync(SIGNUP_COMPONENT) ? fs.readFileSync(SIGNUP_COMPONENT, "utf8") : "";
  const planMgmtSource = fs.existsSync(PLAN_MGMT_COMPONENT) ? fs.readFileSync(PLAN_MGMT_COMPONENT, "utf8") : "";

  assert(
    source.includes('import { PageHeader } from "@/components/ui/page-header";') &&
      source.includes("<PageHeader") &&
      source.includes('title="Plan & Usage"') &&
      source.includes('Link href="/dashboard"') &&
      source.includes('Link href="/admin"'),
    "Plan page must use the shared admin page-header pattern with linked breadcrumbs.",
  );
  assert(
    source.includes("const signupTrendDays = resolveSignupTrendDays(query.days);") &&
      source.includes('role === "admin"') &&
      source.includes("getKpiTrends({ days: signupTrendDays }, { role, authHeader })"),
    "Plan page must load signup KPI trends for admins using the selected window.",
  );
  const combined = source + signupSource + planMgmtSource;
  assert(
    combined.includes("Self-Serve Signup Conversion") &&
      combined.includes("Workspace Signups") &&
      combined.includes("Verified Workspaces") &&
      combined.includes("Verification Rate") &&
      combined.includes("Median Verify Time"),
    "Plan page must render the signup conversion section and KPI labels.",
  );
  assert(
    combined.includes("SIGNUP_TREND_WINDOWS = [7, 30, 90]") &&
      combined.includes("href={`/admin/plan?days=${days}`}") &&
      combined.includes("No signup activity recorded for this window yet.") &&
      combined.includes('header: "Date"') &&
      combined.includes('header: "Pending"') &&
      combined.includes("pendingBacklog"),
    "Plan page must expose trend-window links and the signup trend table, including daily pending backlog.",
  );
  assert(
    combined.includes("Daily Trend At A Glance") &&
      combined.includes("No signup activity to chart yet.") &&
      combined.includes('aria-label={`${row.date} signups`}') &&
      combined.includes('aria-label={`${row.date} verified workspaces`}'),
    "Plan page must expose a quick visual chart for signup and verification activity.",
  );
  assert(
    combined.includes("Strongest Signup Day") &&
      combined.includes("Highest Backlog Day") &&
      combined.includes("Best Verification Day") &&
      combined.includes("Slowest Verification Day"),
    "Plan page must expose signup trend highlight summaries.",
  );
  assert(
    combined.includes("Pending Verification Backlog") &&
      combined.includes("still need email verification.") &&
      combined.includes("Every signup request in the last"),
    "Plan page must expose a window-scoped pending verification backlog summary.",
  );
  assert(
    source.includes('role !== "admin"') &&
      source.includes("Commercial controls are admin-only.") &&
      source.includes("You can still review current usage and status above."),
    "Plan page must explain the read-only fallback for non-admin roles instead of silently hiding commercial controls.",
  );
  assert(
    combined.includes("Plan changes are managed by Vexa commercial ops.") &&
      combined.includes("Admins can review plan usage") &&
      combined.includes("paid-plan changes are applied through") &&
      combined.includes("updateBillingContactAction") &&
      combined.includes("Billing contact email") &&
      combined.includes("Save billing contact") &&
      combined.includes("Use admin fallback") &&
      combined.includes("getBillingUpgradeRequest") &&
      combined.includes("requestPlanUpgradeAction") &&
      combined.includes("Upgrade request pending") &&
      combined.includes("Request notes") &&
      combined.includes("resolveCommercialContactTarget") &&
      combined.includes("commercialContact.label") &&
      !combined.includes("setPlanTierAction") &&
      !combined.includes("Update plan"),
    "Plan page must be read-only for customer admins and route plan changes into a tracked Vexa commercial workflow.",
  );
  assert(
      source.includes("resolveCommercialStatusAlert") &&
      source.includes("Workspace access is suspended") &&
      source.includes("Billing needs attention") &&
      source.includes("Trial is active") &&
      source.includes("description={`Plan: ${usage.planTier} | Billing: ${formatCommercialStatus(usage.billingStatus)} | Access: ${formatAccessStatus(usage.accessStatus)} | Billing month: ${usage.month} | Resets on ${new Date(usage.billingCycleResetAt).toLocaleDateString(") &&
      combined.includes('Billing notices: {usage.profile.billingContactEmail ?? "active workspace admins"}') &&
      source.includes("formatAccessStatus"),
    "Plan page must expose commercial status and warning states for billing/access transitions.",
  );
  assert(
    combined.includes("resolveSignupHealthAlert") &&
      combined.includes("Verification rate needs attention") &&
      combined.includes("Verification is slowing down") &&
      combined.includes("Signup conversion looks healthy"),
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
