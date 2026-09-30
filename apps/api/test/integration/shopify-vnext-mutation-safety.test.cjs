#!/usr/bin/env node
/* eslint-disable no-console */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const command = process.platform === "win32" ? "cmd.exe" : "npm";
const args = process.platform === "win32"
  ? ["/d", "/s", "/c", "npm run test:integration:vnext-mutation-gating"]
  : ["run", "test:integration:vnext-mutation-gating"];

const result = spawnSync(command, args, {
  cwd: REPO_ROOT,
  stdio: "inherit",
  env: {
    ...process.env,
    CI: process.env.CI || "true",
  },
});

if (result.status !== 0) {
  const reason = result.error ? `: ${result.error.message}` : "";
  throw new Error(`vNext mutation safety suite failed with exit code ${result.status}${reason}`);
}

console.log(JSON.stringify({
  scenario: "shopify_vnext_mutation_safety_suite",
  status: "passed",
}));
