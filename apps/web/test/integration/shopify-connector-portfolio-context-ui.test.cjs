#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CONNECTORS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "connectors", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(CONNECTORS_PAGE, "utf8");

  assert(
    source.includes("function resolveShopifyPortfolioContext(") &&
      source.includes('if (installation.slug !== "shopify")') &&
      source.includes('readMetadataValue(installation.metadata, "shopDomain")') &&
      source.includes('readMetadataValue(installation.metadata, "shopId")'),
    "Connectors portfolio must derive Shopify context from installation metadata.",
  );

  assert(
    source.includes("Shopify connection context") &&
      source.includes("Store domain:") &&
      source.includes("Store identity"),
    "Installed Shopify cards must show store identity and domain context.",
  );

  assert(
    source.includes("Publication targets") &&
      source.includes("Selected targets will be used during Shopify publish.") &&
      source.includes("Set publication targets"),
    "Installed Shopify cards must summarize publication target readiness and guide operators to the detail page when targets are missing.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "shopify_portfolio_card_reads_installation_metadata",
          "shopify_portfolio_card_surfaces_shop_identity",
          "shopify_portfolio_card_summarizes_publication_targets",
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
  console.error("Shopify connector portfolio context UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
