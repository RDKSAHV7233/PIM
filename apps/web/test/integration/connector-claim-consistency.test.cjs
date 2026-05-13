#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CONNECTORS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "connectors", "page.tsx");
const LAUNCH_MEMO = path.join(REPO_ROOT, "docs", "review", "VEXA_PIM_CTO_PO_LAUNCH_MEMO_2026-05-04.md");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const connectorsSource = fs.readFileSync(CONNECTORS_PAGE, "utf8");
  const launchMemoSource = fs.readFileSync(LAUNCH_MEMO, "utf8");

  assert(
    connectorsSource.includes("Meesho uses Excel export only.") &&
      connectorsSource.includes("Direct publish is not supported by Meesho."),
    "Connector UI must keep Meesho clearly limited to manual/export-only workflows.",
  );
  assert(
    connectorsSource.includes('"Live publish"') &&
      connectorsSource.includes('"Export/manual"') &&
      connectorsSource.includes('"Experimental"'),
    "Connector UI must keep live, export/manual, and experimental maturity labels explicit.",
  );
  assert(
    launchMemoSource.includes("WooCommerce support is not implemented in this repo.") &&
      launchMemoSource.includes("Avoid implying WooCommerce exists."),
    "Launch-facing review docs must explicitly prevent WooCommerce from being presented as a shipped connector.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "meesho_claims_stay_manual_only",
          "connector_maturity_labels_stay_explicit",
          "woocommerce_docs_are_marked_not_implemented",
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
  console.error("Connector claim consistency test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
