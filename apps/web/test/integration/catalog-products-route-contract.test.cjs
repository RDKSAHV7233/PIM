#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PRODUCTS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "catalog", "products", "page.tsx");
const PRODUCTS_TAB = path.join(REPO_ROOT, "apps", "web", "src", "components", "product", "products-tab.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PRODUCTS_PAGE, "utf8");
  const tabSource = fs.readFileSync(PRODUCTS_TAB, "utf8");

  assert(
    source.includes('if (!normalized) {') &&
      source.includes("return true;") &&
      source.includes('normalized === "false" || normalized === "0" || normalized === "off"'),
    "Catalog products route must default hideTestData to true and only opt out on explicit false/0/off values.",
  );
  assert(
    source.includes('if (normalized === "needs_attention" || normalized === "ready")') &&
      source.includes('return "all";'),
    "Catalog products route must normalize the view query to all/needs_attention/ready only.",
  );
  assert(
    source.includes('return String(value ?? "").trim().slice(0, 80);'),
    "Catalog products route must trim and length-cap the search query before handing it to the workbench.",
  );
  assert(
      source.includes("await getServerSession();") &&
      source.includes('type SharedReadState = "available" | "restricted" | "unavailable";') &&
      source.includes("async function loadSharedRead<T>(promise: Promise<T>): Promise<SharedReadResult<T>>") &&
      source.includes("Promise.all([") &&
      source.includes("loadSharedRead(getStats({ role: actorRole, authHeader }))") &&
      source.includes("loadSharedRead(getCategoryTree({ all: true }, { role: actorRole, authHeader, revalidateSeconds: 60 }))") &&
      source.includes("loadSharedRead(") &&
      source.includes("loadVisibleProducts(page, limit, hideTestData, { role: actorRole, authHeader })") &&
      source.includes("getProductListPage(") &&
      source.includes("loadSharedRead(getInstalledConnectors({ role: actorRole, authHeader }))"),
    "Catalog products route must fetch stats, categories, paginated products, and connectors in parallel using shared-read wrappers and the shared server auth context.",
  );
  assert(
    source.includes("const requestedOffset = (page - 1) * limit;") &&
      source.includes("visibleProducts.push(...filteredBatch.slice(startIndex, startIndex + remaining));") &&
      !source.includes("filteredProducts.slice((page - 1) * limit, page * limit)"),
    "Catalog products route must page through the slim product API instead of fetching the full catalog and slicing locally.",
  );
  assert(
    source.includes("productFeedState={productWindowResult.state}") &&
      source.includes("categoryFeedState={categoriesResult.state}") &&
      source.includes("statsFeedState={statsResult.state}") &&
      source.includes("connectorFeedState={installedConnectorsResult.state}") &&
      source.includes("installedConnectorCount={installedConnectorCount}"),
    "Catalog products route must pass explicit product, category, stats, and connector truth states into the workbench UI.",
  );
  assert(
    source.includes('redirect(buildLoginRedirect("/catalog/products", error));'),
    "Catalog products route must redirect unauthorized users through the centralized login redirect helper.",
  );
  assert(
    source.includes("if (error instanceof ApiHttpError && error.status === 401)") &&
      tabSource.includes("Catalog totals are limited for your role.") &&
      tabSource.includes("Product workbench access is restricted") &&
      tabSource.includes("Product workbench is temporarily unavailable") &&
      tabSource.includes("Connector context restricted") &&
      tabSource.includes("Connector context unavailable"),
    "Catalog products route must preserve restricted and unavailable truth in-page instead of redirecting read-only users or implying empty catalog/channel state.",
  );
  assert(
    source.includes('import { mapConnectorSlugToMarketplaceChannel } from "@/lib/marketplace-channels";') &&
      source.includes("item.status === \"ACTIVE\" && mapConnectorSlugToMarketplaceChannel(item.slug)") &&
      source.includes("mapConnectorSlugToMarketplaceChannel(firstActiveConnector.slug)"),
    "Catalog products route must normalize installed connector slugs to supported channel filters before deep-linking mappings.",
  );
  assert(
    source.includes('`/channels/mappings?channel=${encodeURIComponent(firstActiveChannel)}&categoryId=${encodeURIComponent(firstProduct.categoryId)}&productId=${encodeURIComponent(firstProduct.id)}`'),
    "Catalog products route must deep-link mapping fixes into the canonical lifecycle mappings workspace with channel, category, and product context.",
  );
  assert(
    source.includes("categories:") &&
      source.includes("filteredCategories.length") &&
      source.includes("products: productWindow.totals?.products ?? statsResult.value.products,") &&
      source.includes("variants: productWindow.totals?.variants ?? statsResult.value.variants,"),
    "Catalog products route must recompute top-line catalog stats from the filtered product/category set when test data is hidden.",
  );
  assert(
    source.includes("hideTestData={hideTestData}") &&
      source.includes("mappingManagerHref={mappingManagerHref}") &&
      source.includes("initialView={initialView}") &&
      source.includes("initialSearch={initialSearch}"),
    "Catalog products route must pass normalized route state and canonical mapping context into the Products workbench component.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "catalog_products_route_normalizes_query_state",
          "catalog_products_route_fetches_core_workbench_data_in_parallel",
          "catalog_products_route_passes_explicit_shared_read_states_into_workbench",
          "catalog_products_route_redirects_unauthorized_requests_via_login_helper",
          "catalog_products_route_preserves_restricted_and_unavailable_truth",
          "catalog_products_route_uses_canonical_mapping_deep_link",
          "catalog_products_route_recomputes_filtered_topline_stats",
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
  console.error("Catalog products route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
