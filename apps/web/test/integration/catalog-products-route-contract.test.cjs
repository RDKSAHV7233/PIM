#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PRODUCTS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "catalog", "products", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PRODUCTS_PAGE, "utf8");

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
    source.includes("const authHeader = await getServerAuthHeader();") &&
      source.includes("const actorRole = await getServerActorRole();") &&
      source.includes("Promise.all([") &&
      source.includes("getStats({ role: actorRole, authHeader })") &&
      source.includes("getCategoryTree({ all: true }, { role: actorRole, authHeader })") &&
      source.includes("getProducts({ role: actorRole, authHeader })") &&
      source.includes("getInstalledConnectors({ role: actorRole, authHeader })"),
    "Catalog products route must fetch stats, categories, products, and connectors in parallel using the shared server auth context.",
  );
  assert(
    source.includes('redirect(buildLoginRedirect("/catalog/products", error));'),
    "Catalog products route must redirect unauthorized users through the centralized login redirect helper.",
  );
  assert(
    source.includes('if (slug === "amazon-in") {') &&
      source.includes('return "amazon";') &&
      source.includes('if (slug === "flipkart" || slug === "meesho") {'),
    "Catalog products route must normalize installed connector slugs to supported channel filters before deep-linking mappings.",
  );
  assert(
    source.includes('`/channels/mappings?channel=${encodeURIComponent(firstActiveChannel)}&categoryId=${encodeURIComponent(firstProduct.categoryId)}&productId=${encodeURIComponent(firstProduct.id)}`'),
    "Catalog products route must deep-link mapping fixes into the canonical lifecycle mappings workspace with channel, category, and product context.",
  );
  assert(
    source.includes("categories: filteredCategories.length,") &&
      source.includes("products: filteredProducts.length,") &&
      source.includes("variants: filteredProducts.reduce("),
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
          "catalog_products_route_redirects_unauthorized_requests_via_login_helper",
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
