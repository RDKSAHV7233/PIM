#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PRODUCTS_TAB = path.join(REPO_ROOT, "apps", "web", "src", "components", "product", "products-tab.tsx");
const READINESS_CELL = path.join(REPO_ROOT, "apps", "web", "src", "components", "channel", "product-channel-readiness-cell.tsx");
const READINESS_BATCH_ROUTE = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "api",
  "marketplace",
  "readiness",
  "batch",
  "route.ts",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const productsTabSource = fs.readFileSync(PRODUCTS_TAB, "utf8");
  const readinessCellSource = fs.readFileSync(READINESS_CELL, "utf8");
  const readinessBatchRouteSource = fs.readFileSync(READINESS_BATCH_ROUTE, "utf8");

  assert(
    productsTabSource.includes('/api/marketplace/readiness/batch') &&
      productsTabSource.includes("productIds,") &&
      productsTabSource.includes("READINESS_CHANNELS"),
    "Products Workbench must request channel readiness through the batched readiness route.",
  );
  assert(
    !readinessCellSource.includes("fetch(") &&
      !readinessCellSource.includes("/api/marketplace/readiness?productId=") &&
      !readinessCellSource.includes("MAX_CONCURRENT_REQUESTS"),
    "ProductChannelReadinessCell must be presentational and must not perform per-row readiness fetches.",
  );
  assert(
    readinessBatchRouteSource.includes('/marketplace/readiness/batch') &&
      readinessBatchRouteSource.includes("unknownBatch") &&
      readinessBatchRouteSource.includes("productIds is required."),
    "Web readiness batch route must proxy the backend batch contract and provide unknown-state fallback.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "product_workbench_uses_batched_readiness_route",
          "readiness_cell_is_presentational_only",
          "web_batch_proxy_uses_backend_contract_with_fallback",
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
  console.error("Product workbench readiness batch test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
