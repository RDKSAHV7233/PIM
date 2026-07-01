#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readWorkflow(relativePath) {
  const fullPath = path.resolve(__dirname, "..", relativePath);
  return YAML.parse(fs.readFileSync(fullPath, "utf8"));
}

function requireStep(job, name) {
  const step = (job.steps || []).find((entry) => String(entry.name || "").trim() === name);
  assert(step, `Missing workflow step: ${name}`);
  return step;
}

function requireRunContains(step, text, label) {
  assert(String(step.run || "").includes(text), `${label} must include "${text}"`);
}

function requireEnvVar(step, name, label) {
  const env = step.env || {};
  assert(Object.prototype.hasOwnProperty.call(env, name), `${label} must declare env.${name}`);
}

function requireAnyEnvVar(step, names, label) {
  const env = step.env || {};
  const hasAny = names.some((name) => Object.prototype.hasOwnProperty.call(env, name));
  assert(hasAny, `${label} must declare one of env.${names.join(", env.")}`);
}

function main() {
  const dailyWorkflow = readWorkflow(".github/workflows/capture-daily-rollout-evidence.yml");
  const deployWorkflow = readWorkflow(".github/workflows/deploy-staging.yml");

  const dailyTriggers = dailyWorkflow.on;
  assert(
    dailyTriggers && typeof dailyTriggers === "object" && Object.prototype.hasOwnProperty.call(dailyTriggers, "workflow_dispatch"),
    "capture-daily-rollout-evidence workflow must support workflow_dispatch",
  );
  assert(
    dailyTriggers && typeof dailyTriggers === "object" && Array.isArray(dailyTriggers.schedule) && dailyTriggers.schedule.length > 0,
    "capture-daily-rollout-evidence workflow must include a schedule trigger",
  );

  const dailyJob = dailyWorkflow.jobs?.["capture-daily-rollout-evidence"];
  assert(dailyJob, "capture-daily-rollout-evidence job is missing");
  assert(String(dailyJob.environment || "").trim() === "staging", "daily rollout workflow must target environment=staging");
  assert(String(dailyJob.permissions?.contents || "").trim() === "read", "daily rollout workflow must request contents: read");

  requireStep(dailyJob, "Checkout");
  requireStep(dailyJob, "Setup Node");
  requireStep(dailyJob, "Install Railway CLI");

  const recordStep = requireStep(dailyJob, "Record daily rollout gate artifact");
  requireRunContains(recordStep, "node scripts/record-gate-signoff.cjs", "Record daily rollout gate artifact");
  requireRunContains(recordStep, "STAGING_BROAD_ROLLOUT_DAILY", "Record daily rollout gate artifact");

  const resolveApiUrlStep = requireStep(dailyJob, "Resolve staging API URL");
  assert(String(resolveApiUrlStep.id || "").trim() === "resolve_staging_api_url", "Resolve staging API URL must expose id=resolve_staging_api_url");
  requireAnyEnvVar(resolveApiUrlStep, ["RAILWAY_TOKEN", "RAILWAY_API_TOKEN"], "Resolve staging API URL");
  requireEnvVar(resolveApiUrlStep, "RAILWAY_PROJECT_ID", "Resolve staging API URL");
  requireAnyEnvVar(resolveApiUrlStep, ["RAILWAY_SERVICE", "RAILWAY_SERVICE_ID"], "Resolve staging API URL");
  requireEnvVar(resolveApiUrlStep, "RAILWAY_ENVIRONMENT_ID", "Resolve staging API URL");
  requireEnvVar(resolveApiUrlStep, "RAILWAY_ENVIRONMENT_NAME", "Resolve staging API URL");
  requireEnvVar(resolveApiUrlStep, "FALLBACK_STAGING_API_URL", "Resolve staging API URL");
  requireRunContains(resolveApiUrlStep, "node scripts/resolve-railway-service-url.cjs", "Resolve staging API URL");
  requireRunContains(resolveApiUrlStep, 'echo "api_url=${resolved_api_url}" >> "$GITHUB_OUTPUT"', "Resolve staging API URL");

  const snapshotStep = requireStep(dailyJob, "Capture daily rollout snapshot");
  requireEnvVar(snapshotStep, "STAGING_BASE_URL", "Capture daily rollout snapshot");
  assert(
    String(snapshotStep.env?.STAGING_BASE_URL || "").trim() === "${{ steps.resolve_staging_api_url.outputs.api_url }}",
    "Capture daily rollout snapshot must use the resolved staging API URL output",
  );
  requireEnvVar(snapshotStep, "STAGING_SMOKE_TENANT_ID", "Capture daily rollout snapshot");
  requireEnvVar(snapshotStep, "STAGING_SMOKE_WORKSPACE", "Capture daily rollout snapshot");
  requireEnvVar(snapshotStep, "STAGING_SMOKE_USER", "Capture daily rollout snapshot");
  requireEnvVar(snapshotStep, "STAGING_SMOKE_PASSWORD", "Capture daily rollout snapshot");
  requireRunContains(snapshotStep, "node scripts/capture-controlled-rollout-snapshot.cjs", "Capture daily rollout snapshot");
  requireRunContains(snapshotStep, '--apiBase "${STAGING_BASE_URL}/api/v1"', "Capture daily rollout snapshot");
  requireRunContains(snapshotStep, "--diagnosticOutputPath \".run-logs/queue-failure-diagnostics-${GITHUB_RUN_ID}.json\"", "Capture daily rollout snapshot");

  const uploadStep = requireStep(dailyJob, "Upload daily rollout artifacts");
  assert(
    /^actions\/upload-artifact@v\d+$/.test(String(uploadStep.uses || "").trim()),
    "Upload daily rollout artifacts must use actions/upload-artifact",
  );
  assert(String(uploadStep.with?.path || "").includes(".run-logs/queue-failure-diagnostics-*.json"), "Daily rollout artifact upload must include queue failure diagnostics");

  const deployTriggers = deployWorkflow.on?.push;
  const pathsIgnore = Array.isArray(deployTriggers?.["paths-ignore"]) ? deployTriggers["paths-ignore"] : [];
  assert(pathsIgnore.includes("docs/execution/gates/**"), "deploy-staging push trigger must ignore docs/execution/gates/**");
  assert(pathsIgnore.includes("docs/execution/rollout/**"), "deploy-staging push trigger must ignore docs/execution/rollout/**");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        checks: [
          "daily_workflow_dispatch_present",
          "daily_schedule_present",
          "daily_staging_environment_present",
          "daily_installs_railway_cli",
          "daily_record_step_present",
          "daily_resolves_live_staging_api_url",
          "daily_snapshot_step_present",
          "daily_upload_step_present",
          "deploy_staging_paths_ignore_present",
        ],
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
