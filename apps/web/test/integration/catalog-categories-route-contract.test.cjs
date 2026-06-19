#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "catalog", "categories", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PAGE, "utf8");

  assert(
    source.includes("getCategoryTree({ all: true }, { role: actorRole, authHeader, revalidateSeconds: 60 })") &&
      source.includes("getCategoryCounts({ role: actorRole, authHeader })"),
    "Catalog categories must load both the taxonomy tree and the backend category-count summary.",
  );
  assert(
    source.includes("const countsByCategoryId = new Map(categoryCounts.map((count) => [count.categoryId, count]));") &&
      source.includes("countsByCategoryId.get(category.id)?.childCount ?? 0") &&
      source.includes("countsByCategoryId.get(category.id)?.productCount ?? 0"),
    "Catalog categories must render child and product counts from the backend summary instead of inferring them from a partial product list.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "catalog_categories_route_fetches_backend_count_summary",
          "catalog_categories_route_uses_backend_counts_for_grid_and_delete_guards",
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
  console.error("Catalog categories route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
