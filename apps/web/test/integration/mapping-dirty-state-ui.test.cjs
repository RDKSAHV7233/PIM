#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "channels", "mappings", "page.tsx");
const EDITOR_FILE = path.join(REPO_ROOT, "apps", "web", "src", "components", "channel", "mapping-editor.tsx");
const GUARD_FILE = path.join(REPO_ROOT, "apps", "web", "src", "components", "channel", "mapping-dirty-navigation-guard.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const pageSource = fs.readFileSync(PAGE_FILE, "utf8");
  const editorSource = fs.readFileSync(EDITOR_FILE, "utf8");
  const guardSource = fs.readFileSync(GUARD_FILE, "utf8");

  assert(
    pageSource.includes("MappingDirtyNavigationGuard") &&
      (pageSource.includes("data-mapping-nav={") || editorSource.includes('data-mapping-nav="true"')),
    "Mappings page must mount the dirty-state guard and mark wizard navigation links.",
  );
  assert(
    editorSource.includes('data-mapping-dirty-form="true"') &&
      editorSource.includes('id="mapping-edit-form"'),
    "Mapping editor must opt into dirty-state tracking.",
  );
  assert(
    guardSource.includes("form[data-mapping-dirty-form='true']") &&
      guardSource.includes('"input", markDirty, true') &&
      guardSource.includes('"change", markDirty, true'),
    "Mapping dirty-state guard must track edits from mapping form inputs.",
  );
  assert(
    guardSource.includes("a[data-mapping-nav='true']") &&
      guardSource.includes("setPendingHref(href)") &&
      guardSource.includes("event.preventDefault()"),
    "Mapping dirty-state guard must intercept wizard step navigation while edits are unsaved.",
  );
  assert(
    guardSource.includes('"beforeunload"') &&
      guardSource.includes("event.returnValue =") &&
      guardSource.includes('"submit", clearOnSubmit, true'),
    "Mapping dirty-state guard must warn on browser unload and clear dirty state on save.",
  );
  assert(
    guardSource.includes("Stay on this step") &&
      guardSource.includes("Leave without saving") &&
      guardSource.includes("window.location.assign(href)"),
    "Mapping dirty-state guard must provide explicit stay and leave paths for unsaved edits.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "mapping_page_mounts_dirty_navigation_guard",
          "mapping_editor_opts_into_dirty_tracking",
          "mapping_dirty_guard_warns_on_step_and_browser_navigation",
          "mapping_dirty_guard_has_cancel_and_confirm_paths",
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
  console.error("Mapping dirty-state UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
