#!/usr/bin/env node
/* eslint-disable no-console */

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "migrate-legacy-auth-password-hashes.cjs");

function main() {
  const managedEnvResult = spawnSync(process.execPath, [SCRIPT], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      APP_ENV: "staging",
      DATABASE_URL: "postgresql://example.invalid:5432/pim1",
      PIM_AUTH_PASSWORD: "staging-shared-password",
    },
  });
  assert.notEqual(managedEnvResult.status, 0, "managed environments must refuse unscoped auth backfill runs");
  assert.match(
    `${managedEnvResult.stdout}\n${managedEnvResult.stderr}`,
    /without --tenant outside local\/test environments/i,
  );

  const localEnvResult = spawnSync(process.execPath, [SCRIPT], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      APP_ENV: "development",
      DATABASE_URL: "",
      DATABASE_URL_POOLED: "",
      DATABASE_URL_DIRECT: "",
      PIM_AUTH_PASSWORD: "",
    },
  });
  assert.notEqual(localEnvResult.status, 0, "local runs without a database should still reach database validation after tenant-scope validation");
  assert.doesNotMatch(
    `${localEnvResult.stdout}\n${localEnvResult.stderr}`,
    /without --tenant outside local\/test environments/i,
  );

  console.log("migrate-legacy-auth-password-hashes.test.cjs: PASS");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
