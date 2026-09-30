#!/usr/bin/env node
/* eslint-disable no-console */

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildRailwayExecutionEnv,
  buildDeployCommands,
  classifyDeployTargets,
  findOverlappingServiceTargets,
  formatRailwayVariablePairs,
  isRetryableRailwayCliResult,
  isRetryableRailwayDeployError,
  normalizeRailwayVariablesPayload,
  normalizeServiceTarget,
  prepareRailwayDeployRoot,
  resolveApiDatabaseVariables,
  resolveConfig,
  resolveDeploymentReleaseVariables,
  resolveErrorAuthorityServiceVariables,
  resolveWebSessionAuthVariables,
  setRailwayVariablesAcrossServiceTargets,
  syncWebSessionAuthVariables,
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
  assert.equal(config.deployTimeoutMs, 900000);
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
      RAILWAY_TOKEN: "project_token",
      RAILWAY_API_TOKEN: "workspace_token",
      OTHER_ENV: "preserved",
    },
    "Railway CLI should prefer the project token when both token types are present.",
  );

  const environmentIdConfig = resolveConfig(
    {
      RAILWAY_TOKEN: "token_env_id",
      RAILWAY_PROJECT_ID: "proj_env_id",
      RAILWAY_ENVIRONMENT_ID: "8d8ba5bc-f90a-463d-bcb6-e90703d2874c",
      RAILWAY_API_SERVICE_ID: "svc_api_env_id",
      RAILWAY_WEB_SERVICE_ID: "svc_web_env_id",
    },
    repoRoot,
  );
  assert.equal(environmentIdConfig.environmentName, "8d8ba5bc-f90a-463d-bcb6-e90703d2874c");
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
    cwd: path.join(repoRoot, ".tmp", "railway-api-service"),
    pathArg: "",
    serviceTargets: ["Vexa API", "svc_api"],
  });
  assert.deepEqual(commands[1], {
    label: "Web",
    cwd: path.join(repoRoot, ".tmp", "railway-web-service"),
    pathArg: "",
    serviceTargets: ["App Vexa", "svc_web"],
  });

  // prepareRailwayDeployRoot copies from the source paths — create them first.
  fs.mkdirSync(config.apiSourcePath, { recursive: true });
  fs.mkdirSync(config.webSourcePath, { recursive: true });
  const deployRootInfo = prepareRailwayDeployRoot(config);
  try {
    assert.equal(path.relative(repoRoot, deployRootInfo.deployRoot), "");
    assert.equal(path.relative(repoRoot, deployRootInfo.apiTargetPath), "railway-api-service");
    assert.equal(path.relative(repoRoot, deployRootInfo.webTargetPath), "railway-web-service");
    const stagedConfig = {
      ...config,
      apiSourcePath: deployRootInfo.apiTargetPath,
      webSourcePath: deployRootInfo.webTargetPath,
    };
    const stagedCommands = buildDeployCommands(stagedConfig);
    assert.deepEqual(stagedCommands[0], {
      label: "API",
      cwd: deployRootInfo.apiTargetPath,
      pathArg: "",
      serviceTargets: ["Vexa API", "svc_api"],
    });
    assert.deepEqual(stagedCommands[1], {
      label: "Web",
      cwd: deployRootInfo.webTargetPath,
      pathArg: "",
      serviceTargets: ["App Vexa", "svc_web"],
    });
  } finally {
    fs.rmSync(config.apiSourcePath, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    fs.rmSync(config.webSourcePath, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    fs.rmSync(deployRootInfo.apiTargetPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    fs.rmSync(deployRootInfo.webTargetPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }

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
      message: "spawnSync railway ETIMEDOUT",
      code: "ETIMEDOUT",
    }),
    true,
    "Subprocess timeouts should be retryable",
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
  assert.equal(
    isRetryableRailwayCliResult({
      status: 1,
      stderr: "Failed to fetch: error decoding response body\nCaused by:\n    expected value at line 1 column 1",
    }),
    true,
    "Railway CLI response decoding failures should be retryable for variable operations.",
  );
  assert.equal(
    isRetryableRailwayCliResult({
      status: 1,
      stderr: "Unauthorized. Please check that your RAILWAY_TOKEN is valid.",
    }),
    false,
    "Railway auth failures should not be retried for variable operations.",
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

  const nameFallbackConfig = resolveConfig(
    {
      RAILWAY_TOKEN: "token_name_fallback",
      RAILWAY_PROJECT_ID: "proj_name_fallback",
      RAILWAY_API_SERVICE: "API",
      RAILWAY_WEB_SERVICE: "PIM1",
    },
    repoRoot,
  );
  assert.deepEqual(nameFallbackConfig.apiServiceTargets, ["API"]);
  assert.deepEqual(nameFallbackConfig.webServiceTargets, ["PIM1"]);

  assert.deepEqual(
    resolveApiDatabaseVariables({
      DATABASE_URL_DIRECT: "postgresql://direct:pass@localhost:5432/db",
      DATABASE_URL_POOLED: "postgresql://pool:pass@localhost:5432/db",
    }),
    [
      ["DATABASE_URL_POOLED", "postgresql://pool:pass@localhost:5432/db"],
      ["DATABASE_URL_DIRECT", "postgresql://direct:pass@localhost:5432/db"],
    ],
  );
  assert.deepEqual(
    resolveApiDatabaseVariables({ DATABASE_URL: "postgresql://fallback:pass@localhost:5432/db" }),
    [
      ["DATABASE_URL_POOLED", "postgresql://fallback:pass@localhost:5432/db"],
      ["DATABASE_URL_DIRECT", "postgresql://fallback:pass@localhost:5432/db"],
    ],
  );
  assert.deepEqual(
    resolveErrorAuthorityServiceVariables({
      GITHUB_SHA: "260a89cc3475152d27821ae2334389ae88084f67",
      ERROR_AUTHORITY_INGEST_TOKEN: "error-authority-ingest-token-minimum-32",
    }),
    [
      ["ERROR_AUTHORITY_RELEASE", "260a89cc3475152d27821ae2334389ae88084f67"],
      ["ERROR_AUTHORITY_INGEST_TOKEN", "error-authority-ingest-token-minimum-32"],
    ],
    "Railway deploy should derive Error Authority release from the immutable GitHub SHA and include the server-only ingest token when configured.",
  );
  assert.deepEqual(
    resolveDeploymentReleaseVariables({
      GITHUB_SHA: "260a89cc3475152d27821ae2334389ae88084f67",
    }),
    [["RAILWAY_GIT_COMMIT_SHA", "260a89cc3475152d27821ae2334389ae88084f67"]],
    "Railway deploy should sync RAILWAY_GIT_COMMIT_SHA from the immutable GitHub SHA, since `railway up` CLI deploys never auto-populate it (unlike Railway's native GitHub-integration deploys) and the vNext controlled-mutation release-identity gate depends on it.",
  );
  assert.deepEqual(
    resolveDeploymentReleaseVariables({}),
    [],
    "Railway deploy should not emit a RAILWAY_GIT_COMMIT_SHA pair when GITHUB_SHA is absent from the deploy environment.",
  );
  assert.deepEqual(
    formatRailwayVariablePairs([
      ["ERROR_AUTHORITY_RELEASE", "260a89cc3475152d27821ae2334389ae88084f67"],
      ["ERROR_AUTHORITY_INGEST_TOKEN", "error-authority-ingest-token-minimum-32"],
    ]),
    [
      "ERROR_AUTHORITY_RELEASE=260a89cc3475152d27821ae2334389ae88084f67",
      "ERROR_AUTHORITY_INGEST_TOKEN=error-authority-ingest-token-minimum-32",
    ],
    "Railway variable set arguments must use KEY=VALUE format.",
  );

  const originalSpawnSync = childProcess.spawnSync;
  const variableSetCalls = [];
  childProcess.spawnSync = (command, args, options) => {
    variableSetCalls.push({ command, args, cwd: options.cwd });
    const serviceTarget = args[args.indexOf("--service") + 1];
    if (serviceTarget === "stale-service-name") {
      return {
        status: 1,
        stdout: "",
        stderr: "Service 'stale-service-name' not found",
        error: null,
      };
    }
    return {
      status: 0,
      stdout: "Variables set successfully\n",
      stderr: "",
      error: null,
    };
  };
  try {
    assert.equal(
      setRailwayVariablesAcrossServiceTargets(config, { RAILWAY_TOKEN: "token_123" }, {
        label: "API Error Authority env vars",
        serviceTargets: ["stale-service-name", "vexa-api-slug"],
        pairs: [
          ["ERROR_AUTHORITY_RELEASE", "260a89cc3475152d27821ae2334389ae88084f67"],
          ["ERROR_AUTHORITY_INGEST_TOKEN", "error-authority-ingest-token-minimum-32"],
        ],
        safeDisplayPairs: ["ERROR_AUTHORITY_RELEASE", "ERROR_AUTHORITY_INGEST_TOKEN"],
        failureMessage: "manual fallback required",
        successMessage: "fallback sync succeeded",
      }),
      true,
      "Railway variable sync should try fallback service targets after Service '<target>' not found.",
    );
  } finally {
    childProcess.spawnSync = originalSpawnSync;
  }
  assert.equal(variableSetCalls.length, 2);
  assert.equal(variableSetCalls[0].args[variableSetCalls[0].args.indexOf("--service") + 1], "stale-service-name");
  assert.equal(variableSetCalls[1].args[variableSetCalls[1].args.indexOf("--service") + 1], "vexa-api-slug");
  assert.deepEqual(
    variableSetCalls[1].args.slice(0, 5),
    [
      "variables",
      "set",
      "ERROR_AUTHORITY_RELEASE=260a89cc3475152d27821ae2334389ae88084f67",
      "ERROR_AUTHORITY_INGEST_TOKEN=error-authority-ingest-token-minimum-32",
      "--service",
    ],
  );

  const originalSpawnSyncForTransientVariableSet = childProcess.spawnSync;
  let transientVariableSetCalls = 0;
  childProcess.spawnSync = () => {
    transientVariableSetCalls += 1;
    if (transientVariableSetCalls === 1) {
      return {
        status: 1,
        stdout: "",
        stderr: "Failed to fetch: error decoding response body\nCaused by:\n    expected value at line 1 column 1",
        error: null,
      };
    }
    return {
      status: 0,
      stdout: "Variables set successfully\n",
      stderr: "",
      error: null,
    };
  };
  try {
    assert.equal(
      setRailwayVariablesAcrossServiceTargets(
        { ...config, deployRetries: 2, deployRetryDelayMs: 0 },
        { RAILWAY_TOKEN: "token_123" },
        {
          label: "web service env vars",
          serviceTargets: ["app-vexa"],
          pairs: [["PIM_API_BASE_URL", "https://api.example.test/api/v1"]],
          safeDisplayPairs: ["PIM_API_BASE_URL=https://api.example.test/api/v1"],
          failureMessage: "manual fallback required",
          successMessage: "transient retry sync succeeded",
        },
      ),
      true,
      "Railway variable sync should retry transient CLI fetch/JSON decode failures.",
    );
  } finally {
    childProcess.spawnSync = originalSpawnSyncForTransientVariableSet;
  }
  assert.equal(transientVariableSetCalls, 2);

  assert.deepEqual(
    resolveErrorAuthorityServiceVariables({
      ERROR_AUTHORITY_RELEASE: "explicit-release-sha",
      GITHUB_SHA: "260a89cc3475152d27821ae2334389ae88084f67",
    }),
    [["ERROR_AUTHORITY_RELEASE", "explicit-release-sha"]],
    "Explicit ERROR_AUTHORITY_RELEASE should take precedence over GITHUB_SHA for controlled rollback/redeploy cases.",
  );

  assert.deepEqual(
    normalizeRailwayVariablesPayload([
      { name: "JWT_SECRET", value: "shared-jwt-secret-minimum-32-characters" },
      { key: "PIM_DEFAULT_WORKSPACE_SLUG", value: "admin" },
    ]),
    {
      JWT_SECRET: "shared-jwt-secret-minimum-32-characters",
      PIM_DEFAULT_WORKSPACE_SLUG: "admin",
    },
    "Railway variable JSON arrays should normalize to a key/value object.",
  );
  assert.deepEqual(
    resolveWebSessionAuthVariables({
      JWT_SECRET: "shared-jwt-secret-minimum-32-characters",
      AUTH_MODE: "db",
      PIM_AUTH_IDENTITIES_JSON: "",
      PIM_AUTH_WORKSPACES_JSON: "",
      PIM_DEFAULT_TENANT_KEY: "pim1",
      PIM_DEFAULT_WORKSPACE_SLUG: "admin",
      PIM_DEFAULT_ROLE: "viewer",
      DATABASE_URL: "postgresql://must-not-be-copied",
      ERROR_AUTHORITY_INGEST_TOKEN: "must-not-be-copied",
    }),
    [
      ["JWT_SECRET", "shared-jwt-secret-minimum-32-characters"],
      ["AUTH_MODE", "db"],
      ["PIM_AUTH_IDENTITIES_JSON", ""],
      ["PIM_AUTH_WORKSPACES_JSON", ""],
      ["PIM_DEFAULT_TENANT_KEY", "pim1"],
      ["PIM_DEFAULT_WORKSPACE_SLUG", "admin"],
      ["PIM_DEFAULT_ROLE", "viewer"],
    ],
    "Web session auth sync must copy only JWT/fingerprint inputs required for SSR cookie verification.",
  );
  assert.deepEqual(
    resolveWebSessionAuthVariables({ AUTH_MODE: "db", PIM_DEFAULT_WORKSPACE_SLUG: "admin" }),
    [],
    "Web session auth sync must not run without a JWT secret.",
  );

  const originalSpawnSyncForSessionAuth = childProcess.spawnSync;
  const sessionAuthCalls = [];
  childProcess.spawnSync = (command, args, options) => {
    sessionAuthCalls.push({ command, args, cwd: options.cwd });
    const serviceTarget = args[args.indexOf("--service") + 1];
    const isRead = args.includes("--json") && !args.includes("set");
    if (isRead && serviceTarget === "stale-api-service") {
      return { status: 1, stdout: "", stderr: "Service 'stale-api-service' not found", error: null };
    }
    if (isRead && serviceTarget === "api-fallback-service") {
      return {
        status: 0,
        stdout: JSON.stringify({
          JWT_SECRET: "shared-jwt-secret-minimum-32-characters",
          AUTH_MODE: "db",
          PIM_AUTH_IDENTITIES_JSON: "",
          PIM_AUTH_WORKSPACES_JSON: "",
          PIM_DEFAULT_TENANT_KEY: "pim1",
          PIM_DEFAULT_WORKSPACE_SLUG: "admin",
          PIM_DEFAULT_ROLE: "viewer",
          DATABASE_URL: "postgresql://must-not-be-copied",
        }),
        stderr: "",
        error: null,
      };
    }
    if (args.includes("set") && serviceTarget === "stale-web-service") {
      return { status: 1, stdout: "", stderr: "Service 'stale-web-service' not found", error: null };
    }
    if (args.includes("set") && serviceTarget === "web-fallback-service") {
      return { status: 0, stdout: "Variables set successfully\n", stderr: "", error: null };
    }
    return { status: 1, stdout: "", stderr: `Unexpected service target ${serviceTarget}`, error: null };
  };
  try {
    syncWebSessionAuthVariables(
      {
        ...config,
        apiServiceTargets: ["stale-api-service", "api-fallback-service"],
        webServiceTargets: ["stale-web-service", "web-fallback-service"],
      },
      { RAILWAY_TOKEN: "token_123" },
    );
  } finally {
    childProcess.spawnSync = originalSpawnSyncForSessionAuth;
  }
  assert.equal(sessionAuthCalls.length, 4);
  const webSessionSetCall = sessionAuthCalls[3];
  assert.equal(webSessionSetCall.args[webSessionSetCall.args.indexOf("--service") + 1], "web-fallback-service");
  assert(webSessionSetCall.args.includes("JWT_SECRET=shared-jwt-secret-minimum-32-characters"));
  assert(webSessionSetCall.args.includes("PIM_DEFAULT_WORKSPACE_SLUG=admin"));
  assert(!webSessionSetCall.args.some((arg) => arg.startsWith("DATABASE_URL=")));

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
