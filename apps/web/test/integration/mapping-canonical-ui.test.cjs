#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PRODUCT_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "page.tsx");
const MAPPINGS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "channels", "mappings", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const productSource = fs.readFileSync(PRODUCT_PAGE, "utf8");
  const mappingsSource = fs.readFileSync(MAPPINGS_PAGE, "utf8");

  assert(
    productSource.includes("Lifecycle mapping manager is the canonical edit path for this connector."),
    "Product detail must direct sellers to the canonical lifecycle mapping manager.",
  );
  assert(
    productSource.includes("Legacy template inventory (transition only)"),
    "Product detail must demote legacy templates to transition-only inventory.",
  );
  assert(
    mappingsSource.includes("Legacy Template Compatibility (Transition Only)"),
    "Mappings page must clearly label legacy templates as transitional.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "canonical_mapping_manager_promoted",
          "legacy_template_flow_marked_transition_only",
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
  console.error("Mapping canonical UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
