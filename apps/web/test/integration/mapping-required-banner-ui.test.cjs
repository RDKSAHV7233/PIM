#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regression coverage for DEF-02 (2026-09-29 browser review): Step 2 showed the amber
 * "Required fields still missing" notice and the green "All required fields are mapped" notice
 * together when nothing was missing. The amber notice must live inside the missing-fields branch,
 * and the green notice in the else branch, so exactly one of them can render.
 */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const EDITOR_FILE = path.join(REPO_ROOT, "apps", "web", "src", "components", "channel", "mapping-editor.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(EDITOR_FILE, "utf8");

  const branchStart = source.indexOf("missingRequiredRows.length > 0 ? (");
  const amber = source.indexOf("Required fields still missing");
  const elseBranch = source.indexOf(") : (", branchStart);
  const green = source.indexOf("All required fields are mapped. Save the draft, then validate it in version history.");

  assert(branchStart !== -1 && amber !== -1 && elseBranch !== -1 && green !== -1, "Editor must keep the missing-fields branch, the amber notice, and the all-mapped notice.");
  assert(
    amber > branchStart && amber < elseBranch,
    "The amber 'Required fields still missing' notice must render only inside the missing-fields branch (DEF-02: it was unconditional).",
  );
  assert(
    green > elseBranch,
    "The green 'All required fields are mapped' notice must render only in the else branch, never alongside the amber notice.",
  );
  assert(
    source.split("Required fields still missing").length === 2,
    "There must be exactly one 'Required fields still missing' notice in the editor.",
  );

  console.log(JSON.stringify({ status: "ok", validated: ["required_banner_only_when_fields_missing", "all_mapped_notice_only_when_complete"] }, null, 2));
}

try {
  run();
} catch (error) {
  console.error("Mapping required-fields banner test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
