#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const ACTIONS_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "actions.ts");
const PRODUCTS_TAB = path.join(REPO_ROOT, "apps", "web", "src", "components", "product", "products-tab.tsx");
const PRODUCT_OVERVIEW_TAB = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "products",
  "[id]",
  "_components",
  "overview-tab.tsx",
);
const CATEGORIES_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "catalog", "categories", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const actionsSource = fs.readFileSync(ACTIONS_FILE, "utf8");
  const productsTabSource = fs.readFileSync(PRODUCTS_TAB, "utf8");
  const productOverviewSource = fs.readFileSync(PRODUCT_OVERVIEW_TAB, "utf8");
  const categoriesSource = fs.readFileSync(CATEGORIES_PAGE, "utf8");

  assert(
    actionsSource.includes("deleteProductAction") &&
      actionsSource.includes("purgeProductAction") &&
      actionsSource.includes("deleteCategoryAction"),
    "Actions must include delete product, purge product, and delete category handlers.",
  );
  assert(
    productsTabSource.includes("deleteProductAction") &&
      productsTabSource.includes("Archive product") &&
      productsTabSource.includes("confirmDelete"),
    "Products table must expose a soft-delete action with confirmation intent.",
  );
  assert(
      productOverviewSource.includes("ArchiveProductButton") &&
      productOverviewSource.includes("purgeProductAction") &&
      productOverviewSource.includes("Archive (soft delete)") &&
      productOverviewSource.includes("Confirm permanent delete") &&
      productOverviewSource.includes("Permanently delete"),
    "Product detail must expose soft delete and admin hard delete controls.",
  );
  assert(
    categoriesSource.includes("CategoryDeleteButton") &&
      categoriesSource.includes("Category delete failed"),
    "Categories page must include delete wiring and inline error surfacing.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "product_delete_actions_present",
          "product_delete_ui_in_table_and_detail",
          "category_delete_ui_and_error_surface",
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
  console.error("Catalog delete UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
