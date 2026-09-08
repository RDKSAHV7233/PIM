#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const FILE = path.join(REPO_ROOT, "apps", "web", "src", "components", "channel", "mapping-editor.tsx");
const ROW_FILE = path.join(REPO_ROOT, "apps", "web", "src", "components", "channel", "mapping-field-row.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(FILE, "utf8");
  const rowSource = fs.readFileSync(ROW_FILE, "utf8");
  assert(source.includes("export function ResolvedMappingSnapshotCard"), "Mapping editor module must export the resolved mapping snapshot card.");
  assert(source.includes("export function MappingEditorCard"), "Mapping editor module must export the structured mapping editor card.");
  assert(source.includes("export function PublishReadinessCard"), "Mapping editor module must export the publish readiness card.");
  assert(source.includes("export function LegacyTemplateCompatibilityCard"), "Mapping editor module must export the legacy compatibility card.");
  assert(source.includes("createConnectorMappingVersionAction"), "Mapping editor module must own the mapping draft action wiring.");
  assert(
    source.includes("Sample product value") &&
      rowSource.includes("Select a PIM field to preview sample value.") &&
      source.includes("Sample source values come from the selected product:") &&
      source.includes("Sample source values use a category example product:"),
    "Mapping editor must surface sample source values so operators can verify PIM field choices semantically.",
  );
  assert(
    source.includes("Blocked-state recovery") &&
      source.includes("Open connector health") &&
      source.includes("Open payload preview"),
    "Publish readiness must expose connector-health and payload-preview recovery links while blocked.",
  );
  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "mapping_editor_module_exports_isolated_cards",
          "mapping_editor_surfaces_sample_source_value_preview",
          "mapping_editor_surfaces_blocked_state_recovery_links",
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
  console.error("Mapping editor component test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
