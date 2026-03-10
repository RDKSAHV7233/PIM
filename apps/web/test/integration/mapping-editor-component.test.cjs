#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const FILE = path.join(REPO_ROOT, "apps", "web", "src", "components", "channel", "mapping-editor.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(FILE, "utf8");
  assert(source.includes("export function ResolvedMappingSnapshotCard"), "Mapping editor module must export the resolved mapping snapshot card.");
  assert(source.includes("export function MappingEditorCard"), "Mapping editor module must export the structured mapping editor card.");
  assert(source.includes("export function PublishReadinessCard"), "Mapping editor module must export the publish readiness card.");
  assert(source.includes("export function LegacyTemplateCompatibilityCard"), "Mapping editor module must export the legacy compatibility card.");
  assert(source.includes("createConnectorMappingVersionAction"), "Mapping editor module must own the mapping draft action wiring.");
  console.log(JSON.stringify({ status: "ok", validated: ["mapping_editor_module_exports_isolated_cards"] }, null, 2));
}

try {
  run();
} catch (error) {
  console.error("Mapping editor component test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
