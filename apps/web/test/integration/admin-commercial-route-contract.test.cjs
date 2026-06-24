#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "commercial", "page.tsx");

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
      page.includes("hasCommercialOpsAccess") &&
      page.includes('redirect("/admin")'),
    "Commercial ops page must derive shared server auth context and gate access to system_admin/super_admin roles.",
  );

  assert(
    page.includes("isOpsTokenConfigured()") &&
      page.includes("Not configured") &&
      page.includes("PIM_COMMERCIAL_OPS_TOKEN"),
    "Commercial ops page must detect missing ops token and show an explicit not-configured state with the env var name.",
  );

  assert(
    page.includes("getCommercialOverview") &&
      page.includes("listUpgradeRequests") &&
      page.includes("searchCommercialTenants"),
    "Commercial ops page must load the canonical tenant overview, open upgrade requests, and tenant search.",
  );

  assert(
    page.includes("Commercial data unavailable") &&
      !page.includes("error instanceof Error ? error.message"),
    "Commercial ops page must not leak raw error messages into the UI; it must use a generic unavailable message instead.",
  );

  assert(
    page.includes("resolveSignupHealthAlert") &&
      page.includes("signupVerificationRate") &&
      page.includes("medianVerifyHours"),
    "Commercial ops page must surface signup funnel health alerts based on verification rate and median time.",
  );

  assert(
    page.includes("changePlanTierAction") &&
      page.includes("resolveUpgradeRequestAction"),
    "Commercial ops page must wire plan-tier mutation and upgrade-request resolution server actions.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "admin_commercial_route_gates_to_system_admin_or_super_admin",
          "admin_commercial_route_surfaces_not_configured_state_for_missing_ops_token",
          "admin_commercial_route_loads_canonical_tenant_and_upgrade_data",
          "admin_commercial_route_does_not_leak_raw_error_messages",
          "admin_commercial_route_surfaces_signup_funnel_health_alerts",
          "admin_commercial_route_wires_plan_and_upgrade_server_actions",
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
  console.error("Admin commercial route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
