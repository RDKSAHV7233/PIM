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
    source.includes("function isDashboardApiUnavailable(error: unknown)") &&
      source.includes('message.includes("fetch failed")') &&
      source.includes('causeDetails.includes("econnrefused")') &&
      source.includes("error.status === 502 || error.status === 503 || error.status === 504"),
    "Dashboard must recognize upstream API outages from both HTTP gateway failures and fetch transport errors.",
  );
  assert(
    source.includes("function DashboardUnavailableState()") &&
      source.includes("Dashboard data is temporarily unavailable") &&
      source.includes("We could not reach the staging API for live dashboard data.") &&
      source.includes('href="/dashboard"') &&
      source.includes('href="/quality/issues"'),
    "Dashboard must render a recovery state with retry and operator drilldown actions when the API is unavailable.",
  );
  assert(
    source.includes("if (isDashboardApiUnavailable(error)) {") &&
      source.includes("return <DashboardUnavailableState />;"),
    "Dashboard must return the recovery state instead of rethrowing upstream outage errors.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "dashboard_detects_api_gateway_and_fetch_outages",
          "dashboard_renders_recovery_ui_for_api_outages",
          "dashboard_returns_recovery_state_instead_of_throwing_on_api_outages",
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
  console.error("Dashboard API fallback UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
