#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "channels", "mappings", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PAGE_FILE, "utf8");

  assert(
    source.includes("const showContext = isEnabled(query.showContext);") &&
      source.includes("const showResolved = isEnabled(query.showResolved) || showContext;") &&
      source.includes("const showTaxonomy = isEnabled(query.showTaxonomy)") &&
      source.includes("const showHistory = isEnabled(query.showHistory)"),
    "Mappings page must gate secondary panel fetches behind explicit lazy-load flags.",
  );
  assert(
    source.includes("showHistory") &&
      source.includes("showResolved") &&
      source.includes("showTaxonomy") &&
      source.includes("showContext"),
    "Mappings page must conditionally fetch history, resolved snapshot, taxonomy, and product context data.",
  );
  assert(
    source.includes("Open version history") &&
      source.includes("Open product context") &&
      source.includes("Open taxonomy alignment") &&
      source.includes("Review resolved snapshot"),
    "Mappings page must expose on-demand load actions for deferred secondary panels.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "mappings_page_defers_secondary_panels_with_explicit_flags",
          "mappings_page_exposes_load_actions_for_deferred_panels",
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
