#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PRODUCT_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "page.tsx");
const CONTENT_TAB = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "products",
  "[id]",
  "_components",
  "content-tab.tsx",
);
const DIRTY_GUARD = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "products",
  "[id]",
  "_components",
  "product-dirty-navigation-guard.tsx",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const pageSource = fs.readFileSync(PRODUCT_PAGE, "utf8");
  const contentSource = fs.readFileSync(CONTENT_TAB, "utf8");
  const guardSource = fs.readFileSync(DIRTY_GUARD, "utf8");

  assert(
    pageSource.includes("ProductDirtyNavigationGuard") &&
      pageSource.includes('data-product-tab-link="true"'),
    "Product detail route must mount the dirty-state guard and mark tab navigation links.",
  );
  assert(
    contentSource.includes('data-product-dirty-form="true"') &&
      contentSource.includes('id="product-edit-form"'),
    "Product content form must opt into dirty-state tracking.",
  );
  assert(
    guardSource.includes('"input", markDirty, true') &&
      guardSource.includes('"change", markDirty, true') &&
      guardSource.includes("form[data-product-dirty-form='true']"),
    "Dirty-state guard must track edits from text, select, textarea, and checkbox inputs.",
  );
  assert(
    guardSource.includes("a[data-product-tab-link='true']") &&
      guardSource.includes("event.preventDefault()") &&
      guardSource.includes("setPendingHref(href)"),
    "Dirty-state guard must intercept product tab navigation while edits are unsaved.",
  );
  assert(
    guardSource.includes('"beforeunload"') &&
      guardSource.includes("event.returnValue =") &&
      guardSource.includes('"submit", clearOnSubmit, true'),
    "Dirty-state guard must warn on browser unload and clear dirty state for intentional saves.",
  );
  assert(
    guardSource.includes("Stay on this tab") &&
      guardSource.includes("Leave without saving") &&
      guardSource.includes("window.location.assign(href)"),
    "Dirty-state guard must provide cancel and confirm paths for tab navigation.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "product_edit_form_opts_into_dirty_tracking",
          "product_detail_tabs_are_guarded",
          "dirty_guard_warns_on_tab_and_browser_navigation",
          "dirty_guard_has_cancel_and_confirm_paths",
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
  console.error("Product dirty-state UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
