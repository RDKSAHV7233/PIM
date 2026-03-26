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
    source.includes('role === "admin" ? getKpiTrends({ days: 30 }, { role, authHeader }) : Promise.resolve(null)'),
    "Plan page must load signup KPI trends for admins.",
  );
  assert(
    source.includes("Self-Serve Signup Conversion") &&
      source.includes("Workspace Signups") &&
      source.includes("Verified Workspaces") &&
      source.includes("Verification Rate") &&
      source.includes("Median Verify Time"),
    "Plan page must render the signup conversion section and KPI labels.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "plan_page_loads_signup_kpi_trends_for_admins",
          "plan_page_renders_signup_conversion_kpis",
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
