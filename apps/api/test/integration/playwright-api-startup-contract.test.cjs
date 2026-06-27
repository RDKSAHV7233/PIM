#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_START_SCRIPT = path.join(REPO_ROOT, "apps", "api", "scripts", "start-built-api.cjs");
const PLAYWRIGHT_START_SCRIPT = path.join(REPO_ROOT, "scripts", "start-playwright-api.cjs");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const apiStartSource = fs.readFileSync(API_START_SCRIPT, "utf8");
  const playwrightStartSource = fs.readFileSync(PLAYWRIGHT_START_SCRIPT, "utf8");

  assert(
    apiStartSource.includes('const entry = path.join(apiRoot, "dist", "main.js");'),
    "Built API startup must resolve the deployed dist/main.js entrypoint.",
  );
  assert(
    !apiStartSource.includes("dist-feature"),
    "Built API startup must not fall back to dist-feature artifacts.",
  );
  assert(
    playwrightStartSource.includes('const apiBuildEntryPath = path.join(root, "apps", "api", "dist", "main.js");'),
    "Playwright API startup must only treat dist/main.js as the reusable built artifact.",
  );
  assert(
    !playwrightStartSource.includes("apiBuildEntryCandidates"),
    "Playwright API startup must not accept multiple build artifact candidates.",
  );
  assert(
    !playwrightStartSource.includes("dist-feature"),
    "Playwright API startup must not skip rebuilds because dist-feature exists.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "start_built_api_uses_dist_main_only",
          "playwright_startup_rebuild_gate_uses_dist_main_only",
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
  console.error("Playwright API startup contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
