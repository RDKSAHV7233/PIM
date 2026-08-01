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
  assert(source.includes("Publish category filter"), "Taxonomy search module must render submit-driven category filter copy.");
  assert(
    source.includes("Filter target category path...") &&
      source.includes("Apply the category path filter, then use a result below"),
    "Taxonomy search copy must match the apply-scope submit behavior instead of promising live search.",
  );
  assert(source.includes("Use this category"), "Taxonomy search module must render a direct taxonomy selection action.");
  assert(source.includes("Current scope"), "Taxonomy search module must summarize the selected scope before continuing.");
  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "taxonomy_search_module_exports_isolated_cards",
          "taxonomy_filter_copy_matches_apply_scope_submit_behavior",
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
  console.error("Taxonomy search component test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
