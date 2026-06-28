#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SUMMARY_BAR = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "components",
  "channel",
  "product-readiness-summary-bar.tsx",
);
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
  const summaryBarSource = fs.readFileSync(SUMMARY_BAR, "utf8");
  const readinessBatchRouteSource = fs.readFileSync(READINESS_BATCH_ROUTE, "utf8");

  assert(
    summaryBarSource.includes("/api/marketplace/readiness/batch") &&
      summaryBarSource.includes("productIds") &&
      summaryBarSource.includes("READINESS_CHANNELS"),
    "ProductReadinessSummaryBar must request channel readiness through the batched readiness route, not individual per-channel GETs.",
  );

  assert(
    !summaryBarSource.includes("/api/marketplace/readiness?") &&
      !summaryBarSource.includes("Promise.allSettled"),
    "ProductReadinessSummaryBar must not use per-channel GET readiness requests or Promise.allSettled fan-out.",
  );

  assert(
    !summaryBarSource.includes("summarizeSimulation"),
    "ProductReadinessSummaryBar must not call summarizeSimulation — summarization is delegated to the API batch endpoint.",
  );

  assert(
    summaryBarSource.includes("ProductReadinessBatchResponse"),
    "ProductReadinessSummaryBar must type the batch response as ProductReadinessBatchResponse.",
  );

  assert(
    readinessBatchRouteSource.includes("/marketplace/readiness/batch") &&
      readinessBatchRouteSource.includes("unknownBatch") &&
      readinessBatchRouteSource.includes("productIds is required.") &&
      readinessBatchRouteSource.includes("ApiHttpError") &&
      readinessBatchRouteSource.includes("status: 502"),
    "Web readiness batch route must proxy the backend batch contract and preserve upstream failure semantics.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "product_detail_summary_bar_uses_batched_readiness_route",
          "product_detail_summary_bar_no_per_channel_fan_out",
          "product_detail_summary_bar_no_local_summarize_simulation",
          "product_detail_summary_bar_types_batch_response",
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
  console.error("Product detail readiness batch test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
