#!/usr/bin/env node
/* eslint-disable no-console */

const assert = require("node:assert/strict");
const path = require("node:path");

const {
  buildDeployCommands,
  isRetryableRailwayDeployError,
  resolveConfig,
} = require("./railway-deploy.cjs");

function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const config = resolveConfig(
    {
      RAILWAY_PROJECT_ID: "proj_123",
      RAILWAY_API_SERVICE_ID: "svc_api",
      RAILWAY_WEB_SERVICE_ID: "svc_web",
      RAILWAY_ENVIRONMENT_NAME: "staging",
      RAILWAY_API_SOURCE_PATH: ".tmp/railway-api-service",
      RAILWAY_WEB_SOURCE_PATH: ".",
      RAILWAY_CLI_BIN: "railway",
    },
    repoRoot,
  );

  assert.equal(config.projectId, "proj_123");
  assert.equal(config.apiServiceId, "svc_api");
  assert.equal(config.webServiceId, "svc_web");
  assert.equal(config.environmentName, "staging");
  assert.equal(path.relative(repoRoot, config.apiSourcePath), path.join(".tmp", "railway-api-service"));
  assert.equal(path.relative(repoRoot, config.webSourcePath), "");
  assert.equal(config.deployRetries, 3);
  assert.equal(config.deployRetryDelayMs, 5000);

  const commands = buildDeployCommands(config);
  assert.equal(commands.length, 2, "Expected API and Web deploy commands");
  assert.deepEqual(commands[0].args, [
    "up",
    path.join(".tmp", "railway-api-service"),
    "--service",
    "svc_api",
    "--project",
    "proj_123",
    "--environment",
    "staging",
    "--path-as-root",
    "--ci",
  ]);
  assert.deepEqual(commands[1].args, [
    "up",
    ".",
    "--service",
    "svc_web",
    "--project",
    "proj_123",
    "--environment",
    "staging",
    "--path-as-root",
    "--ci",
  ]);

  assert.equal(
    isRetryableRailwayDeployError({
      message: "Railway API deploy failed with exit code 1",
      stderr: "error sending request for url\nCaused by:\n    operation timed out",
    }),
    true,
    "Timeout upload failures should be retryable",
  );
  assert.equal(
    isRetryableRailwayDeployError({
      message: "Railway API deploy failed with exit code 1",
      stderr: "Unauthorized. Please check that your RAILWAY_TOKEN is valid.",
    }),
    false,
    "Non-timeout Railway failures should not be retried",
  );

  console.log("railway-deploy.test.cjs: PASS");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
