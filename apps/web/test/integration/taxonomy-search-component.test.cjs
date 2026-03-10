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
  assert(source.includes("Taxonomy search"), "Taxonomy search module must render the taxonomy search input label.");
  assert(source.includes("Show taxonomy search results"), "Taxonomy search module must render taxonomy result disclosure.");
  console.log(JSON.stringify({ status: "ok", validated: ["taxonomy_search_module_exports_isolated_cards"] }, null, 2));
}

try {
  run();
} catch (error) {
  console.error("Taxonomy search component test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
