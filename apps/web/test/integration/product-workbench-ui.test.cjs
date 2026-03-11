#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PRODUCTS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "catalog", "products", "page.tsx");
const PRODUCTS_TAB = path.join(REPO_ROOT, "apps", "web", "src", "components", "product", "products-tab.tsx");
const CREATE_PRODUCT_FORM = path.join(REPO_ROOT, "apps", "web", "src", "components", "product", "CreateProductForm.tsx");
const ACTIONS_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "actions.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const productsPageSource = fs.readFileSync(PRODUCTS_PAGE, "utf8");
  const productsTabSource = fs.readFileSync(PRODUCTS_TAB, "utf8");
  const createProductFormSource = fs.readFileSync(CREATE_PRODUCT_FORM, "utf8");
  const actionsSource = fs.readFileSync(ACTIONS_FILE, "utf8");

  assert(
    productsPageSource.includes("/channels/mappings?channel=") &&
      !productsPageSource.includes("/connectors/${encodeURIComponent(firstActiveConnector.id)}/mapping"),
    "Product workbench must route mapping actions directly to the lifecycle mappings workspace.",
  );
  assert(
    productsTabSource.includes("Open Issue Inbox") &&
      productsTabSource.includes("Open channel mappings") &&
      !productsTabSource.includes("Workbench Actions"),
    "Products tab must keep primary actions inside the compact toolbar instead of a standalone workbench card.",
  );
  assert(
    productsPageSource.includes("search?: string") &&
      productsTabSource.includes('placeholder="Search products by title or SKU"') &&
      productsTabSource.includes("No products match your search") &&
      productsTabSource.includes("window.history.replaceState"),
    "Products tab must expose query-backed SKU/title search with search-aware empty-state copy.",
  );
  assert(
    productsTabSource.includes("Last Updated"),
    "Products table must expose last-updated context for merchandiser work prioritization.",
  );
  assert(
    !productsTabSource.includes(">HSN<") && !productsTabSource.includes(">GST %<"),
    "Products workbench should not prioritize compliance-field columns over core workbench signals.",
  );
  assert(
    createProductFormSource.includes("const [submitError, setSubmitError] = useState<string>(\"\")") &&
      createProductFormSource.includes("isRedirectErrorLike") &&
      createProductFormSource.includes("await createProductAction(formData);") &&
      createProductFormSource.includes("setSubmitError(message);") &&
      createProductFormSource.includes("text-red-700"),
    "Create product form must catch non-redirect submit failures and render a usable inline error instead of crashing the runtime.",
  );
  assert(
    actionsSource.includes('revalidatePath("/catalog/products");'),
    "Successful product creation must revalidate the catalog products route so the new product appears without a stale refresh.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "product_workbench_uses_canonical_mapping_route",
          "products_tab_uses_compact_toolbar_actions",
          "products_table_prioritizes_catalog_workbench_signals",
          "create_product_form_handles_submit_failures_inline",
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
  console.error("Product workbench UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
