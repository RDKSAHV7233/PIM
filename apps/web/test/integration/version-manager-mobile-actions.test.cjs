#!/usr/bin/env node
/* eslint-disable no-console */
//
// Regression test for PIM#622: below a 640px viewport, the Channel Mapping wizard's
// "Step 3: Validate and publish" panel had zero action buttons — no Validate, Publish,
// Archive, or Rollback.
//
// Root cause: VersionManagerCard wrapped its <DataGrid> (whose "actions" column carries the
// Validate/Publish/Archive/Rollback forms) in `hidden sm:block`, then substituted a separate,
// hand-written `sm:hidden` mobile block below 640px that only rendered read-only fields
// (version, status chips, scope, updated date, history) — omitting every action. DataGrid
// already renders responsively on its own (desktop table >=768px, its own mobile card list
// below that, actions column included in both), so the fix removes the redundant outer split
// and renders DataGrid unconditionally.
//
// This test asserts against the real source file directly (not a reimplementation): that the
// old broken split is gone, that DataGrid renders exactly once and unconditionally, and that
// the "actions" column (which the fix depends on DataGrid rendering at every width) is still
// wired into that single DataGrid call.
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const VERSION_MANAGER_FILE = path.join(REPO_ROOT, "apps", "web", "src", "components", "channel", "version-manager.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(VERSION_MANAGER_FILE, "utf8");

  // The exact pre-fix defect shape: DataGrid gated behind `hidden sm:block`.
  assert(
    !/hidden\s+sm:block/.test(source),
    'PIM#622: found "hidden sm:block" still gating a section of VersionManagerCard — this is ' +
      "the exact pre-fix pattern that hid the DataGrid (and its Validate/Publish/Archive/Rollback " +
      "actions) below 640px viewport width.",
  );

  // The redundant, actions-free hand-written mobile fallback must be gone.
  assert(
    !/sm:hidden/.test(source),
    'PIM#622: found "sm:hidden" still present — this marked the separate, hand-written mobile ' +
      "block that duplicated (and under-implemented, omitting every action) DataGrid's own " +
      "already-correct responsive rendering.",
  );
  assert(
    !source.includes("Mobile stacked version list"),
    "PIM#622: the redundant hand-written mobile version list block must be removed entirely, " +
      "not just hidden — DataGrid's own internal responsive rendering replaces it.",
  );

  // DataGrid must render exactly once, and unconditionally (not re-gated behind some other
  // width-based className on its wrapping element).
  const dataGridOccurrences = (source.match(/<DataGrid\b/g) ?? []).length;
  assert(
    dataGridOccurrences === 1,
    `PIM#622: VersionManagerCard must render exactly one <DataGrid> for the version list — found ${dataGridOccurrences}. ` +
      "A second instance would reintroduce a duplicate (and possibly narrower-only) rendering path.",
  );

  // The single DataGrid call must still be wired to the real columns array (which carries the
  // "actions" column with Validate/Publish/Archive/Rollback) and the real versions data.
  assert(
    /<DataGrid[\s\S]{0,200}columns=\{columns\}[\s\S]{0,200}rows=\{versions\}/.test(source),
    "PIM#622: the single <DataGrid> must be wired to columns={columns} and rows={versions} — " +
      "the fix's whole premise is that DataGrid's own responsive rendering (which includes the " +
      "actions column) now handles every viewport width.",
  );

  // The actions column itself (Validate/Publish/Archive) must still exist in the columns array
  // — the fix removes the redundant wrapper, not the actions.
  assert(
    source.includes('key: "actions"') &&
      source.includes("validateConnectorMappingVersionAction") &&
      source.includes("publishConnectorMappingVersionAction") &&
      source.includes("archiveConnectorMappingVersionAction"),
    "PIM#622: the actions column (Validate/Publish/Archive forms) must still be defined in " +
      "the columns array passed to DataGrid.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "no_hidden_sm_block_gate_remains",
          "no_sm_hidden_mobile_fallback_remains",
          "redundant_mobile_block_removed",
          "data_grid_renders_exactly_once_unconditionally",
          "data_grid_wired_to_real_columns_and_versions",
          "actions_column_with_validate_publish_archive_still_present",
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
  console.error("Version manager mobile-actions test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
