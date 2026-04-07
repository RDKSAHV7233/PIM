#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SIDEBAR_FILE = path.join(REPO_ROOT, "apps", "web", "src", "components", "nav", "app-sidebar.tsx");
const DASHBOARD_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "dashboard", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const sidebarSource = fs.readFileSync(SIDEBAR_FILE, "utf8");
  const dashboardSource = fs.readFileSync(DASHBOARD_PAGE, "utf8");

  assert(
    sidebarSource.includes('title: "Products"') &&
      sidebarSource.indexOf('title: "Products"') < sidebarSource.indexOf('title: "Catalog"'),
    "Sidebar must promote Products ahead of Catalog in the primary work hierarchy.",
  );
  assert(
    sidebarSource.includes('title: "Settings"') && !sidebarSource.includes('title: "Admin"'),
    "Sidebar must use seller-facing Settings language instead of Admin in the main navigation.",
  );
  assert(
    sidebarSource.includes('{ label: "API Keys", href: "/admin/api-keys", icon: "key" }') &&
      sidebarSource.includes('{ label: "Outbound Webhooks", href: "/admin/webhooks", icon: "webhook" }'),
    "Settings navigation must keep integration governance tools visible alongside core admin controls.",
  );
  assert(
    sidebarSource.indexOf('title: "Quality"') < sidebarSource.indexOf('title: "Operations"'),
    "Sidebar must place Quality before Operations in the merchandiser workflow.",
  );
  assert(
    sidebarSource.includes('badgeKey: "quality"') &&
      sidebarSource.includes('badgeKey: "operations"') &&
      sidebarSource.includes("/api/navigation/summary"),
    "Sidebar must expose quality and operations urgency badges from the navigation summary feed.",
  );
  assert(
    sidebarSource.includes("function SidebarIcon") &&
      sidebarSource.includes('"aria-hidden": true') &&
      sidebarSource.includes("icon: \"box\""),
    "Sidebar must use a consistent inline icon system instead of text-only item links.",
  );
  assert(
    dashboardSource.includes("Catalog Health") &&
      dashboardSource.includes("Publishing Health") &&
      dashboardSource.includes("Operations &amp; Usage"),
    "Dashboard must be grouped into catalog-first, publishing, and operations sections.",
  );
  assert(
    (dashboardSource.match(/Publishing Health/g) || []).length === 1,
    "Dashboard must not duplicate Publishing Health sections once the workbench home is introduced.",
  );
  assert(
    dashboardSource.includes("Products Needing Enrichment") &&
      dashboardSource.includes("Ready to Publish"),
    "Dashboard top metrics must prioritize catalog work and publish readiness over raw ops counters.",
  );
  assert(
    dashboardSource.includes('href="/quality/issues?severity=BLOCKING"') &&
      dashboardSource.includes('href="/catalog/products?view=ready"'),
    "Dashboard KPI cards must link directly to filtered drill-down views.",
  );
  assert(
    dashboardSource.includes("Top products to fix now") &&
      dashboardSource.includes("Next best actions"),
    "Dashboard must surface task-first workbench sections instead of only status summaries.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "sidebar_promotes_catalog_first_hierarchy",
          "settings_navigation_keeps_integration_governance_tools_visible",
          "dashboard_groups_catalog_publishing_and_operations",
          "dashboard_and_sidebar_expose_task_drilldowns",
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
  console.error("Catalog-first shell test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
