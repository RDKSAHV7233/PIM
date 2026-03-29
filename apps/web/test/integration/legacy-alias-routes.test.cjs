#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const REPORTS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "reports", "page.tsx");
const SETTINGS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "settings", "page.tsx");
const SETTINGS_CONNECTORS_PAGE = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "settings",
  "connectors",
  "page.tsx",
);
const SETTINGS_PLAN_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "settings", "plan", "page.tsx");
const SETTINGS_PRIVACY_PAGE = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "settings",
  "privacy",
  "page.tsx",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function assertLegacyRedirect(source, target, label) {
  assert(
    source.includes('import { redirect } from "next/navigation";') &&
      source.includes('export const dynamic = "force-dynamic";') &&
      source.includes(`redirect("${target}");`) &&
      !source.includes("getServerAuthHeader") &&
      !source.includes("Promise.all(["),
    `${label} must stay an honest force-dynamic alias redirect to ${target} without introducing duplicate data loading.`,
  );
}

function run() {
  const reportsSource = read(REPORTS_PAGE);
  const settingsSource = read(SETTINGS_PAGE);
  const settingsConnectorsSource = read(SETTINGS_CONNECTORS_PAGE);
  const settingsPlanSource = read(SETTINGS_PLAN_PAGE);
  const settingsPrivacySource = read(SETTINGS_PRIVACY_PAGE);

  assertLegacyRedirect(reportsSource, "/dashboard", "Legacy reports route");
  assertLegacyRedirect(settingsSource, "/admin", "Legacy settings index");
  assertLegacyRedirect(settingsConnectorsSource, "/admin/connectors", "Legacy settings connectors route");
  assertLegacyRedirect(settingsPlanSource, "/admin/plan", "Legacy settings plan route");
  assertLegacyRedirect(settingsPrivacySource, "/admin/privacy", "Legacy settings privacy route");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "legacy_reports_route_redirects_to_dashboard",
          "legacy_settings_index_redirects_to_admin",
          "legacy_settings_connectors_redirects_to_admin_connectors",
          "legacy_settings_plan_redirects_to_admin_plan",
          "legacy_settings_privacy_redirects_to_admin_privacy",
          "legacy_alias_routes_stay_lightweight_redirects",
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
  console.error("Legacy alias routes test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
