#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const { optionalEnv } = require("./validate-staging-deploy-config.cjs");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function main(env = process.env) {
  const repoRoot = path.resolve(__dirname, "..");
  const runId = optionalEnv("GITHUB_RUN_ID", env) || "local";
  const outputPath = path.resolve(
    repoRoot,
    optionalEnv("STAGING_DEPLOY_SUMMARY_PATH", env) || path.join(".run-logs", `staging-deploy-summary-${runId}.json`),
  );
  ensureDir(path.dirname(outputPath));

  const summary = {
    status: "ok",
    environment: optionalEnv("APP_ENV", env) || "staging",
    nodeVersion: optionalEnv("NODE_VERSION", env) || process.version.replace(/^v/, ""),
    runId,
    runUrl: optionalEnv("GITHUB_SERVER_URL", env) && optionalEnv("GITHUB_REPOSITORY", env)
      ? `${optionalEnv("GITHUB_SERVER_URL", env)}/${optionalEnv("GITHUB_REPOSITORY", env)}/actions/runs/${runId}`
      : null,
    gitSha: optionalEnv("GITHUB_SHA", env) || null,
    deployTargets: optionalEnv("RAILWAY_DEPLOY_TARGETS", env) || "auto",
    projectId: optionalEnv("RAILWAY_PROJECT_ID", env) || null,
    apiService: optionalEnv("RAILWAY_API_SERVICE", env) || null,
    apiServiceId: optionalEnv("RAILWAY_API_SERVICE_ID", env) || null,
    webService: optionalEnv("RAILWAY_WEB_SERVICE", env) || null,
    webServiceId: optionalEnv("RAILWAY_WEB_SERVICE_ID", env) || null,
    stagingBaseUrl: optionalEnv("STAGING_BASE_URL", env) || null,
    stagingWebUrl: optionalEnv("STAGING_WEB_URL", env) || null,
    expectedPublicSignupEnabled: optionalEnv("STAGING_EXPECT_PUBLIC_SIGNUP_ENABLED", env) || "false",
    verificationLayers: ["health", "auth", "public-signup", "e2e-smoke", "gate-artifact", "rollout-snapshot"],
    artifactContract: {
      packageManagerInstallMode: "npm ci",
      runtimeNodeMajor: "20",
      migrationExecution: "workflow-only",
    },
    rollbackPointer: optionalEnv("GITHUB_SHA", env) || null,
    generatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: "ok", outputPath: path.relative(repoRoot, outputPath) }, null, 2));
}

if (require.main === module) {
  try {
    main(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = { main };
