#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "plan", "page.tsx");

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
      page.includes("getBillingUsage") &&
      page.includes("getBillingPlans") &&
      page.includes('redirect(buildLoginRedirect("/admin/plan"'),
    "Plan page must derive shared server auth context, load billing usage and plans, and redirect expired sessions.",
  );

  assert(
    page.includes("resolveCommercialStatusAlert") &&
      page.includes('"suspended"') &&
      page.includes('"past_due"') &&
      page.includes('"trial"'),
    "Plan page must surface explicit billing status states (suspended, past_due, trial) via resolveCommercialStatusAlert.",
  );

  assert(
    page.includes("Plan data unavailable") &&
      page.includes("Billing and usage information could not be loaded"),
    "Plan page must show an explicit unavailable state on non-auth backend failures instead of throwing a 500.",
  );

  assert(
    page.includes("role === \"admin\"") &&
      page.includes("Commercial controls are admin-only") &&
      page.includes("PlanManagementSection"),
    "Plan page must gate commercial controls to admin role and explain the restriction to non-admin viewers.",
  );

  assert(
    page.includes("upgradeRequest") &&
      page.includes("resolveUpgradeRequestStatusAlert") &&
      page.includes("PlanComparisonWrapper"),
    "Plan page must surface open upgrade request state and the plan comparison card.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "admin_plan_route_uses_shared_server_auth_context",
          "admin_plan_route_surfaces_explicit_billing_status_states",
          "admin_plan_route_renders_unavailable_state_on_backend_failure",
          "admin_plan_route_gates_commercial_controls_to_admin",
          "admin_plan_route_surfaces_upgrade_request_and_plan_comparison",
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
  console.error("Admin plan route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
