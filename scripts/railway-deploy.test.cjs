#!/usr/bin/env node
/* eslint-disable no-console */

const assert = require("node:assert/strict");
const path = require("node:path");

const {
  buildRailwayExecutionEnv,
  buildDeployCommands,
  classifyDeployTargets,
  findOverlappingServiceTargets,
  isRetryableRailwayDeployError,
  normalizeServiceTarget,
  resolveConfig,
} = require("./railway-deploy.cjs");

function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const config = resolveConfig(
    {
      RAILWAY_TOKEN: "token_123",
      RAILWAY_PROJECT_ID: "proj_123",
      RAILWAY_API_SERVICE: "Vexa API",
      RAILWAY_WEB_SERVICE: "App Vexa",
      RAILWAY_API_SERVICE_ID: "svc_api",
      RAILWAY_WEB_SERVICE_ID: "svc_web",
      RAILWAY_ENVIRONMENT_NAME: "staging",
      RAILWAY_API_SOURCE_PATH: ".tmp/railway-api-service",
      RAILWAY_WEB_SOURCE_PATH: ".tmp/railway-web-service",
      RAILWAY_CLI_BIN: "railway",
    },
    repoRoot,
  );

  assert.equal(config.projectId, "proj_123");
  assert.deepEqual(config.apiServiceTargets, ["Vexa API", "svc_api"]);
  assert.deepEqual(config.webServiceTargets, ["App Vexa", "svc_web"]);
  assert.equal(config.environmentName, "staging");
  assert.equal(path.relative(repoRoot, config.apiSourcePath), path.join(".tmp", "railway-api-service"));
  assert.equal(path.relative(repoRoot, config.webSourcePath), path.join(".tmp", "railway-web-service"));
  assert.equal(config.deployRetries, 3);
  assert.equal(config.deployRetryDelayMs, 5000);
  assert.equal(normalizeServiceTarget(" App Vexa "), "app vexa");
  assert.deepEqual(
    findOverlappingServiceTargets(
      ["Vexa API", "0ffdffda-6a11-45c1-9075-e125bdd48ad8"],
      ["App Vexa", "cd011ea5-2de8-4d46-a35f-ffc27cd193ff"],
    ),
    [],
    "Distinct API and web targets should not overlap.",
  );

  assert.deepEqual(
    buildRailwayExecutionEnv({
      RAILWAY_TOKEN: "project_token",
      RAILWAY_API_TOKEN: "workspace_token",
      OTHER_ENV: "preserved",
    }),
    {
      RAILWAY_TOKEN: "workspace_token",
      RAILWAY_API_TOKEN: "workspace_token",
      OTHER_ENV: "preserved",
    },
    "Railway CLI should prefer the workspace token when both token types are present.",
  );
  assert.deepEqual(
    buildRailwayExecutionEnv({
      RAILWAY_TOKEN: "project_token",
      OTHER_ENV: "preserved",
    }),
    {
      RAILWAY_TOKEN: "project_token",
      OTHER_ENV: "preserved",
    },
    "Railway CLI should keep using the project token when no workspace token is available.",
  );

  const commands = buildDeployCommands(config);
  assert.equal(commands.length, 2, "Expected API and Web deploy commands");
  assert.deepEqual(commands[0], {
    label: "API",
    pathArg: path.join(".tmp", "railway-api-service"),
    serviceTargets: ["Vexa API", "svc_api"],
  });
  assert.deepEqual(commands[1], {
    label: "Web",
    pathArg: path.join(".tmp", "railway-web-service"),
    serviceTargets: ["App Vexa", "svc_web"],
  });

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
      stderr: "Build Failed: build daemon returned an error < failed to solve: Canceled: context canceled >",
    }),
    true,
    "Railpack context-canceled build failures should be retryable",
  );
  assert.equal(
    isRetryableRailwayDeployError({
      message: "Railway API deploy failed with exit code 1",
      stderr: "Unauthorized. Please check that your RAILWAY_TOKEN is valid.",
    }),
    false,
    "Non-timeout Railway failures should not be retried",
  );

  const legacyConfig = resolveConfig(
    {
      RAILWAY_TOKEN: "token_legacy",
      RAILWAY_PROJECT_ID: "proj_legacy",
      RAILWAY_API_SERVICE_ID: "svc_api_legacy",
      RAILWAY_WEB_SERVICE_ID: "svc_web_legacy",
    },
    repoRoot,
  );
  assert.deepEqual(legacyConfig.apiServiceTargets, ["svc_api_legacy"]);
  assert.deepEqual(legacyConfig.webServiceTargets, ["svc_web_legacy"]);

  assert.throws(
    () =>
      resolveConfig(
        {
          RAILWAY_TOKEN: "token_overlap",
          RAILWAY_PROJECT_ID: "proj_overlap",
          RAILWAY_API_SERVICE: "Vexa API",
          RAILWAY_WEB_SERVICE: "App Vexa",
          RAILWAY_API_SERVICE_ID: "0ffdffda-6a11-45c1-9075-e125bdd48ad8",
          RAILWAY_WEB_SERVICE_ID: "0ffdffda-6a11-45c1-9075-e125bdd48ad8",
        },
        repoRoot,
      ),
    /service targets overlap/i,
    "Deploy config must fail fast when API and web Railway targets point to the same service.",
  );

  assert.deepEqual(
    classifyDeployTargets([
      "apps/web/src/app/dashboard/page.tsx",
      "apps/web/test/integration/dashboard-api-fallback-ui.test.cjs",
    ]),
    { deployApi: false, deployWeb: true },
    "Web-only changes should not force an API deploy.",
  );
  assert.deepEqual(
    classifyDeployTargets(["apps/api/src/app.controller.ts"]),
    { deployApi: true, deployWeb: false },
    "API-only changes should not force a web deploy.",
  );
  assert.deepEqual(
    classifyDeployTargets(["scripts/railway-deploy.cjs"]),
    { deployApi: true, deployWeb: true },
    "Shared release tooling changes must deploy both services.",
  );

  console.log("railway-deploy.test.cjs: PASS");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
