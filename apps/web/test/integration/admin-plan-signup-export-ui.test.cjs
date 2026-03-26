#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PLAN_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "plan", "page.tsx");
const EXPORT_ROUTE = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "api",
  "admin",
  "plan",
  "signup-trends",
  "export",
  "route.ts",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const planSource = fs.readFileSync(PLAN_PAGE, "utf8");
  const routeSource = fs.readFileSync(EXPORT_ROUTE, "utf8");

  assert(
    planSource.includes("const signupExportHref = `/api/admin/plan/signup-trends/export?days=${signupTrendDays}`;") &&
      planSource.includes("Export CSV"),
    "Plan page must expose the signup trends CSV export link.",
  );
  assert(
    routeSource.includes('if (role !== "admin")') &&
      routeSource.includes('return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });'),
    "Signup trend export route must require admin role.",
  );
  assert(
    routeSource.includes("date,signups,verified,verification_rate,median_verify_hours") &&
      routeSource.includes('attachment; filename="tej-pim-signup-trends-${days}d.csv"'),
    "Signup trend export route must emit CSV output with the TEJ PIM filename.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "plan_page_links_signup_trend_csv_export",
          "signup_trend_export_route_is_admin_guarded",
          "signup_trend_export_route_emits_expected_csv_shape",
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
  console.error("Admin plan signup export UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
