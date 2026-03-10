#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const KPI_CARD = path.join(REPO_ROOT, "apps", "web", "src", "components", "ui", "kpi-card.tsx");
const REFRESH_COMPONENT = path.join(REPO_ROOT, "apps", "web", "src", "components", "ui", "refresh-on-interval.tsx");
const DASHBOARD_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "dashboard", "page.tsx");
const JOBS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "operations", "jobs", "page.tsx");
const IMPORTS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "operations", "imports", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const kpiSource = fs.readFileSync(KPI_CARD, "utf8");
  const refreshSource = fs.readFileSync(REFRESH_COMPONENT, "utf8");
  const dashboardSource = fs.readFileSync(DASHBOARD_PAGE, "utf8");
  const jobsSource = fs.readFileSync(JOBS_PAGE, "utf8");
  const importsSource = fs.readFileSync(IMPORTS_PAGE, "utf8");

  assert(
    kpiSource.includes("bg-red-50/80") &&
      kpiSource.includes("bg-amber-50/80") &&
      kpiSource.includes("bg-emerald-50/70"),
    "KpiCard urgency tones must use tinted backgrounds instead of border-only treatment.",
  );
  assert(
    refreshSource.includes("router.refresh()") &&
      refreshSource.includes("setInterval") &&
      refreshSource.includes("30_000"),
    "RefreshOnInterval must use a mounted interval that refreshes the current route.",
  );
  assert(
    dashboardSource.includes("RefreshOnInterval") &&
      jobsSource.includes("RefreshOnInterval") &&
      importsSource.includes("RefreshOnInterval"),
    "Dashboard, Jobs, and Imports must mount RefreshOnInterval for continuous operational refresh.",
  );
  assert(
    importsSource.includes("<KpiCard") &&
      importsSource.includes('label="Needs Attention"') &&
      importsSource.includes('label="Completed"'),
    "Imports overview must use KpiCard so urgency tinting applies to the operational cockpit.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "kpi_card_uses_tinted_urgency_states",
          "dashboard_jobs_and_imports_mount_refresh_on_interval",
          "imports_overview_uses_kpi_card_for_operational_states",
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
  console.error("Ops cockpit UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
