#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const MAPPINGS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "channels", "mappings", "page.tsx");
const FALLBACK_CONFIG_FILE = path.join(REPO_ROOT, "apps", "web", "src", "components", "channel", "mapping-fallback-config.tsx");
const ACTIONS_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "actions.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const mappingsSource = fs.readFileSync(MAPPINGS_PAGE, "utf8");
  const fallbackConfigSource = fs.readFileSync(FALLBACK_CONFIG_FILE, "utf8");
  const actionsSource = fs.readFileSync(ACTIONS_FILE, "utf8");

  assert(
    mappingsSource.includes("Required mapping groups") &&
      mappingsSource.includes("Map the required channel fields first."),
    "Mappings page must present a structured attribute mapping editor.",
  );
  assert(
    mappingsSource.includes("mapTarget::") &&
      (mappingsSource.includes("Advanced JSON overrides") || mappingsSource.includes("JSON overrides") || mappingsSource.includes("Advanced tools")) &&
      (mappingsSource.includes("Fallback behavior") || mappingsSource.includes("fallback behavior") || fallbackConfigSource.includes("Fallback behavior") || fallbackConfigSource.includes("fallback behavior")),
    "Mappings page must use structured field inputs with JSON only in an advanced override section.",
  );
  assert(
    mappingsSource.includes("mappingRulesPlaceholder: viewModel.mappingDraftRulesDefault") &&
      !mappingsSource.includes("defaultValue={mappingDraftRulesDefault}"),
    "JSON mapping rules must not remain the default authoring surface.",
  );
  assert(
    actionsSource.includes("parseStructuredConnectorMappingRules") &&
      actionsSource.includes("parseStructuredConnectorFallbackPolicy") &&
      actionsSource.includes("key.startsWith(\"mapTarget::\")"),
    "Server actions must translate structured mapping editor inputs into the existing backend contract.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "structured_mapping_editor_present",
          "advanced_json_demoted_from_primary_authoring",
          "server_actions_serialize_structured_mapping_inputs",
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
  console.error("Structured mapping editor test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
