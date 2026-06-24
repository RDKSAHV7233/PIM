#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "search", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PAGE, "utf8");

  assert(
    source.includes('title="Search"') &&
      source.includes('searchCatalogProducts({ q: query, limit: 20 }, { authHeader })'),
    "Search route must remain backed by the tenant-scoped product search API.",
  );
  assert(
    source.includes("Results are product-only in this release.") &&
      source.includes("Category, attribute, and connector discovery stay in their dedicated workspaces.") &&
      !source.includes("ENTITY_TABS"),
    "Search route must explicitly describe the product-only IA and remove residual multi-entity tab claims.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "search_route_uses_product_search_api",
          "search_route_declares_product_only_information_architecture",
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
  console.error("Search route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
