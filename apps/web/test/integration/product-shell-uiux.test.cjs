#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const LAYOUT = path.join(REPO_ROOT, "apps", "web", "src", "app", "layout.tsx");
const SIDEBAR = path.join(REPO_ROOT, "apps", "web", "src", "components", "nav", "app-sidebar.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const layout = fs.readFileSync(LAYOUT, "utf8");
  const sidebar = fs.readFileSync(SIDEBAR, "utf8");

  assert(layout.includes("<GlobalSearch />"), "Authenticated shell must expose global search in the top bar.");
  assert(layout.includes("<NotificationCenter />"), "Authenticated shell must expose notification center in the top bar.");
  assert(layout.includes("<RoleBadge role={actorRole} />"), "Authenticated shell must expose the current role badge.");
  assert(
    sidebar.includes('badgeKey: "quality"') && sidebar.includes('badgeKey: "operations"'),
    "Sidebar must expose live quality and operations badges.",
  );
  for (const title of ["Dashboard", "Products", "Catalog", "Channels", "Quality", "Operations", "Settings"]) {
    assert(sidebar.includes(`title: "${title}"`), `Sidebar must include ${title} section.`);
  }
  assert(
    sidebar.includes('{ label: "API Keys", href: "/admin/api-keys", icon: "key" }') &&
      sidebar.includes('{ label: "Outbound Webhooks", href: "/admin/webhooks", icon: "webhook" }'),
    "Settings navigation must expose API Keys and Outbound Webhooks as first-class admin tools.",
  );
  assert(
    sidebar.includes("function SidebarIcon(") && sidebar.includes("<SidebarIcon name={item.icon} />"),
    "Sidebar must use the current inline icon system for navigation items.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "authenticated_shell_exposes_global_search_notifications_and_role_badge",
          "sidebar_uses_icons_and_live_badges",
          "settings_navigation_includes_api_keys_and_outbound_webhooks",
          "sidebar_sections_match_current_pim1_information_architecture",
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
  console.error("Product shell UI/UX test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
