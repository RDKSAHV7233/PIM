#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const FILE = path.join(REPO_ROOT, "apps", "web", "src", "components", "channel", "version-manager.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(FILE, "utf8");
  assert(source.includes("export function VersionManagerCard"), "Version manager module must export the version history card.");
  assert(source.includes("validateConnectorMappingVersionAction"), "Version manager module must own mapping validation action wiring.");
  assert(source.includes("Publish"), "Version manager module must expose publish controls.");
  assert(source.includes("Rollback"), "Version manager module must expose rollback controls.");
  assert(
    source.includes("Active promoted version") &&
      source.includes("No active promoted version yet") &&
      source.includes("currently live for this mapping scope"),
    "Version manager must surface an explicit active-promoted banner so operators can tell which mapping version is live.",
  );
  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "version_manager_module_exports_isolated_cards",
          "version_manager_surfaces_active_promoted_version_banner",
        ],
      },
      null,
      2,
    ),
  );
}

try {
  run();
} catch (error) {
  console.error("Version manager component test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
