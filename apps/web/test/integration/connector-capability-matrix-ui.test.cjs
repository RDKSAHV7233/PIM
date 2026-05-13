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
    source.includes("function capabilityMatrixValue(") &&
      source.includes("Connector capability matrix") &&
      source.includes("Compare live connector lanes by install footprint, maturity label, and shipped operator capabilities before promising channel coverage."),
    "Connectors page must expose a portfolio-level capability matrix helper and explainer copy.",
  );
  assert(
    source.includes("CONNECTOR_CAPABILITY_BADGES.map((badge) => (") &&
      source.includes("key={`matrix-head-${badge.capability}`}") &&
      source.includes("key={`matrix-row-${item.definition.id}`}"),
    "Connectors capability matrix must render one comparison row per live connector lane with shared capability columns.",
  );
  assert(
    source.includes('label={capabilityMatrixValue(item.definition.capabilities, badge.capability) ? "Yes" : "No"}') &&
      source.includes("key={`matrix-mobile-${item.definition.id}-${badge.capability}`}") &&
      source.includes('label={`${badge.label} ${capabilityMatrixValue(item.definition.capabilities, badge.capability) ? "Yes" : "No"}`}'),
    "Connectors capability matrix must preserve a mobile-safe fallback alongside the desktop comparison table.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "connectors_page_exposes_capability_matrix_helper_and_copy",
          "connectors_page_renders_live_lane_comparison_rows",
          "connectors_page_preserves_mobile_capability_matrix_fallback",
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
  console.error("Connector capability matrix UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
