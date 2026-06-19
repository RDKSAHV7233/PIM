#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const FILE = path.join(REPO_ROOT, "apps", "web", "src", "components", "channel", "taxonomy-search.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(FILE, "utf8");
  assert(source.includes("export function MappingsFilterCard"), "Taxonomy search module must export the filter card.");
  assert(source.includes("export function TaxonomyAlignmentCard"), "Taxonomy search module must export the alignment card.");
  assert(source.includes("Publish category search"), "Taxonomy search module must render the publish-category search input label.");
  assert(source.includes("Use this category"), "Taxonomy search module must render a direct taxonomy selection action.");
  assert(source.includes("Current scope"), "Taxonomy search module must summarize the selected scope before continuing.");
  console.log(JSON.stringify({ status: "ok", validated: ["taxonomy_search_module_exports_isolated_cards"] }, null, 2));
}

try {
  run();
} catch (error) {
  console.error("Taxonomy search component test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
