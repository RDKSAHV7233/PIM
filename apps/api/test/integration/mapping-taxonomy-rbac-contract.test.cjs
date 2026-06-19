#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CONTROLLER_FILE = path.join(REPO_ROOT, "apps", "api", "src", "marketplace", "marketplace.controller.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(CONTROLLER_FILE, "utf8");

  assert(
    source.includes('@Roles("admin", "editor", "channel_manager")\n  searchConnectorTaxonomy') ||
      source.includes('@Roles("admin", "editor", "channel_manager")\r\n  searchConnectorTaxonomy'),
    "Connector taxonomy search route must allow channel_manager for the mapping wizard scope step.",
  );
  assert(
    source.includes('@Roles("admin", "editor", "channel_manager")\n  listUnmappedConnectorTaxonomy') ||
      source.includes('@Roles("admin", "editor", "channel_manager")\r\n  listUnmappedConnectorTaxonomy'),
    "Unmapped connector taxonomy route must allow channel_manager for the mapping wizard scope step.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "mapping_taxonomy_search_allows_channel_manager",
          "mapping_unmapped_taxonomy_allows_channel_manager",
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
  console.error("Mapping taxonomy RBAC contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
