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
    source.includes("definition.launchStage === \"live\" && definition.actions?.install.allowed"),
    "Connectors page must only show self-serve install when the connector launch stage is live.",
  );
  assert(
    source.includes("definition.launchNote") && source.includes("Seller self-serve install is intentionally hidden"),
    "Connectors page must explain why non-live connectors are not installable.",
  );
  assert(
    source.includes("installation.launchStage") && source.includes("installation.launchNote"),
    "Installed connectors table must surface launch-stage honesty messaging.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "connector_page_hides_non_live_install_forms",
          "connector_page_surfaces_launch_honesty_notes",
          "installed_connector_rows_show_launch_stage",
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
  console.error("Connector launch honesty UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
