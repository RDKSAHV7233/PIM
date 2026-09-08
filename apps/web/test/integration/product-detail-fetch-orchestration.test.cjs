#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PAGE_FILE, "utf8");

  assert(
    source.includes("const variantsPromise = getProductVariants(") &&
      source.includes("const channelsPromise = getMarketplaceChannels(") &&
      source.includes("const installedConnectorsPromise = getInstalledConnectors(") &&
      source.includes("const exportJobsPromise =") &&
      source.includes("getMarketplaceExportJobs("),
    "Product detail must start independent variant, channel, connector, and export job fetches before loading the product record.",
  );
  assert(
    source.includes("product = await getProduct("),
    "Product detail must still await the primary product fetch.",
  );
  assert(
    source.includes("variantsPromise") &&
      source.includes("const [channels, installedConnectors] = await Promise.all([") &&
      source.includes("channelsPromise") &&
      source.includes("installedConnectorsPromise") &&
      source.includes("const [variants, exportJobs, readiness, mediaAssets] = await Promise.all([") &&
      source.includes("exportJobsPromise"),
    "Independent fetch promises must be consumed after product resolution without serializing the slow reads unnecessarily.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "product_detail_starts_independent_fetches_before_primary_product_call",
          "product_detail_consumes_prefetched_promises_after_product_resolution",
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
  console.error("Product detail fetch orchestration test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
