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
    source.includes("definition.actions?.install.allowed"),
    "Connectors page must gate install action using server-provided action matrix.",
  );
  assert(
    source.includes("installation.actions?.reconnect.allowed"),
    "Connectors page must gate reconnect action using server-provided action matrix.",
  );
  assert(
    source.includes("installation.actions?.uninstall.allowed"),
    "Connectors page must gate uninstall action using server-provided action matrix.",
  );
  assert(
    !source.includes("const canAdmin ="),
    "Connectors page must not rely on canAdmin-only gating for connector actions.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: ["connector_page_uses_backend_action_matrix"],
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
  console.error("Connector action matrix UI gating test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
