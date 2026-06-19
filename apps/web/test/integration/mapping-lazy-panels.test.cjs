#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "channels", "mappings", "page.tsx");
const EDITOR_FILE = path.join(REPO_ROOT, "apps", "web", "src", "components", "channel", "mapping-editor.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PAGE_FILE, "utf8");
  const editorSource = fs.readFileSync(EDITOR_FILE, "utf8");

  assert(
    source.includes("parseMappingWizardState(query)") &&
      source.includes("resolveRequestedWizardStep") &&
      source.includes("buildMappingRoute"),
    "Mappings page must normalize incoming query state into the wizard contract instead of relying on the old lazy-panel flags.",
  );
  assert(
    source.includes("showAdvanced") &&
      source.includes("advancedPanel") &&
      source.includes("step: \"scope\"") &&
      source.includes("step: \"map\"") &&
      source.includes("step: \"review\""),
    "Mappings page must derive wizard navigation and advanced-surface state from explicit normalized params.",
  );
  assert(
    source.includes("continueToMapHref") &&
      source.includes("Change scope") &&
      editorSource.includes("Open review step"),
    "Mappings page must expose explicit wizard actions instead of on-demand lazy-panel loaders.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "mappings_page_normalizes_query_state_into_wizard_contract",
          "mappings_page_exposes_explicit_step_navigation_actions",
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
  console.error("Mapping lazy panels test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
