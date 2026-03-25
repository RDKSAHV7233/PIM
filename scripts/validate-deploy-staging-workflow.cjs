#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const REPO_ROOT = path.resolve(__dirname, "..");
const WORKFLOW_PATH = path.join(REPO_ROOT, ".github", "workflows", "deploy-staging.yml");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function requireStep(steps, name) {
  const step = steps.find((item) => String(item?.name ?? "").trim() === name);
  assert(step, `Missing workflow step: ${name}`);
  return step;
}

function requireStepOrder(steps, firstName, secondName) {
  const firstIndex = steps.findIndex((item) => String(item?.name ?? "").trim() === firstName);
  const secondIndex = steps.findIndex((item) => String(item?.name ?? "").trim() === secondName);
  assert(firstIndex !== -1, `Missing workflow step: ${firstName}`);
  assert(secondIndex !== -1, `Missing workflow step: ${secondName}`);
  assert(firstIndex < secondIndex, `${firstName} must appear before ${secondName}`);
}

function requireRunContains(step, fragment, label) {
  const run = String(step?.run ?? "");
  assert(run.includes(fragment), `${label} missing required fragment: ${fragment}`);
}

function requireRunMatches(step, pattern, label, description) {
  const run = String(step?.run ?? "");
  assert(pattern.test(run), `${label} missing required pattern: ${description}`);
}

function requireEnvVar(step, name, label) {
  const env = step?.env ?? {};
  assert(Object.prototype.hasOwnProperty.call(env, name), `${label} missing env var: ${name}`);
}

function main() {
  assert(fs.existsSync(WORKFLOW_PATH), `Workflow file not found: ${WORKFLOW_PATH}`);
  const text = fs.readFileSync(WORKFLOW_PATH, "utf8");
  const workflow = YAML.parse(text);

  assert(workflow && typeof workflow === "object", "deploy-staging workflow YAML did not parse to an object");
  assert(String(workflow.name ?? "").trim() === "Deploy Staging", "Unexpected workflow name");
  const triggers = workflow.on ?? {};
  assert(
    triggers && typeof triggers === "object" && Object.prototype.hasOwnProperty.call(triggers, "workflow_dispatch"),
    "deploy-staging workflow must support workflow_dispatch for manual staging evidence runs",
  );

  const jobs = workflow.jobs ?? {};
  const job = jobs["deploy-staging"];
  assert(job && typeof job === "object", "Missing deploy-staging job");
  assert(job.environment === "staging", "deploy-staging job must target environment=staging");
  assert(job.concurrency && typeof job.concurrency === "object", "deploy-staging job must define concurrency");
  assert(String(job.concurrency.group ?? "").trim() === "deploy-staging", "deploy-staging concurrency group must be deploy-staging");
  assert(job.concurrency["cancel-in-progress"] === false, "deploy-staging concurrency must not cancel in-progress deploys");

  const steps = Array.isArray(job.steps) ? job.steps : [];
  assert(steps.length > 0, "deploy-staging job has no steps");

  requireStep(steps, "Checkout");
  requireStep(steps, "Setup Node");
  requireStep(steps, "Install dependencies");
  requireStep(steps, "Generate Prisma client");
  const migrationsStep = requireStep(steps, "Apply migrations");
  requireEnvVar(migrationsStep, "DATABASE_URL_DIRECT", "Apply migrations");
  requireEnvVar(migrationsStep, "DATABASE_URL", "Apply migrations");
  requireRunContains(
    migrationsStep,
    "Missing STAGING_DATABASE_URL_DIRECT or STAGING_DATABASE_URL secret for migrations.",
    "Apply migrations",
  );
  requireRunContains(migrationsStep, "npm run prisma:migrate:deploy", "Apply migrations");
  requireStep(steps, "Build API");
  requireStep(steps, "Build Web");
  requireStep(steps, "Install Railway CLI");
  requireStepOrder(steps, "Install Railway CLI", "Deploy to staging");

  const deployStep = requireStep(steps, "Deploy to staging");
  requireEnvVar(deployStep, "RAILWAY_TOKEN", "Deploy to staging");
  requireEnvVar(deployStep, "RAILWAY_PROJECT_ID", "Deploy to staging");
  requireEnvVar(deployStep, "RAILWAY_API_SERVICE_ID", "Deploy to staging");
  requireEnvVar(deployStep, "RAILWAY_WEB_SERVICE_ID", "Deploy to staging");
  requireEnvVar(deployStep, "RAILWAY_ENVIRONMENT_NAME", "Deploy to staging");
  requireRunContains(deployStep, "node scripts/railway-deploy.cjs", "Deploy to staging");
  assert(!String(deployStep.run ?? "").includes("eval"), "Deploy to staging must not use eval");

  const smokeStep = requireStep(steps, "Staging smoke test");
  requireEnvVar(smokeStep, "STAGING_BASE_URL", "Staging smoke test");
  requireRunContains(smokeStep, "/api/v1/health", "Staging smoke test");
  requireRunMatches(smokeStep, /status.{0,8}ok/i, "Staging smoke test", 'health status ok assertion');
  requireRunMatches(smokeStep, /env.{0,12}staging/i, "Staging smoke test", 'health env staging assertion');

  const postDeployStep = requireStep(steps, "Staging post-deploy verification (auth + trust boundary)");
  requireEnvVar(postDeployStep, "STAGING_BASE_URL", "Post-deploy verification");
  requireEnvVar(postDeployStep, "STAGING_SMOKE_WORKSPACE", "Post-deploy verification");
  requireEnvVar(postDeployStep, "STAGING_SMOKE_USER", "Post-deploy verification");
  requireEnvVar(postDeployStep, "STAGING_SMOKE_PASSWORD", "Post-deploy verification");
  requireEnvVar(postDeployStep, "STAGING_EXPECTED_ENV", "Post-deploy verification");
  requireRunContains(postDeployStep, "node scripts/staging-postdeploy-check.cjs", "Post-deploy verification");

  const publicSignupStep = requireStep(steps, "Public signup smoke check");
  requireEnvVar(publicSignupStep, "STAGING_BASE_URL", "Public signup smoke check");
  requireEnvVar(publicSignupStep, "STAGING_WEB_URL", "Public signup smoke check");
  requireEnvVar(publicSignupStep, "STAGING_EXPECT_PUBLIC_SIGNUP_ENABLED", "Public signup smoke check");
  requireEnvVar(publicSignupStep, "STAGING_EXPECTED_ENV", "Public signup smoke check");
  requireRunContains(publicSignupStep, "node scripts/staging-public-signup-check.cjs", "Public signup smoke check");
  requireStepOrder(steps, "Staging post-deploy verification (auth + trust boundary)", "Public signup smoke check");
  requireStepOrder(steps, "Public signup smoke check", "E2E smoke - post-deploy verification");

  const e2eSmokeStep = requireStep(steps, "E2E smoke - post-deploy verification");
  requireEnvVar(e2eSmokeStep, "STAGING_BASE_URL", "E2E smoke - post-deploy verification");
  requireEnvVar(e2eSmokeStep, "STAGING_SMOKE_WORKSPACE", "E2E smoke - post-deploy verification");
  requireEnvVar(e2eSmokeStep, "STAGING_SMOKE_USER", "E2E smoke - post-deploy verification");
  requireEnvVar(e2eSmokeStep, "STAGING_SMOKE_PASSWORD", "E2E smoke - post-deploy verification");
  requireEnvVar(e2eSmokeStep, "STAGING_SMOKE_TENANT_ID", "E2E smoke - post-deploy verification");
  requireRunContains(
    e2eSmokeStep,
    "node scripts/e2e-user-journey.cjs --smoke",
    "E2E smoke - post-deploy verification",
  );
  requireRunContains(e2eSmokeStep, "set -o pipefail", "E2E smoke - post-deploy verification");
  requireRunContains(e2eSmokeStep, ".run-logs/e2e-smoke-${GITHUB_RUN_ID}.log", "E2E smoke - post-deploy verification");
  requireStepOrder(steps, "Staging post-deploy verification (auth + trust boundary)", "E2E smoke - post-deploy verification");
  requireStepOrder(steps, "E2E smoke - post-deploy verification", "Record staging gate artifact");

  const gateStep = requireStep(steps, "Record staging gate artifact");
  requireEnvVar(gateStep, "STAGING_SMOKE_TENANT_ID", "Record staging gate artifact");
  requireRunContains(gateStep, "node scripts/record-gate-signoff.cjs", "Record staging gate artifact");
  requireRunContains(gateStep, "--suite STAGING_DEPLOY_POSTCHECK", "Record staging gate artifact");
  requireRunContains(gateStep, "https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}", "Record staging gate artifact");

  const snapshotStep = requireStep(steps, "Capture controlled rollout snapshot");
  requireEnvVar(snapshotStep, "STAGING_BASE_URL", "Capture controlled rollout snapshot");
  requireEnvVar(snapshotStep, "STAGING_SMOKE_TENANT_ID", "Capture controlled rollout snapshot");
  requireRunContains(snapshotStep, "node scripts/capture-controlled-rollout-snapshot.cjs", "Capture controlled rollout snapshot");
  requireRunContains(snapshotStep, "--environment staging", "Capture controlled rollout snapshot");
  requireRunContains(snapshotStep, "--apiBase \"${STAGING_BASE_URL}/api/v1\"", "Capture controlled rollout snapshot");

  const uploadStep = requireStep(steps, "Upload gate + rollout + smoke artifacts");
  assert(
    /^actions\/upload-artifact@v\d+$/.test(String(uploadStep.uses ?? "").trim()),
    "Upload step must use actions/upload-artifact",
  );
  const uploadWith = uploadStep.with ?? {};
  const uploadPath = String(uploadWith.path ?? "");
  assert(uploadPath.includes("docs/execution/gates/*.json"), "Upload step missing gate artifact path");
  assert(uploadPath.includes("docs/execution/rollout/*CONTROLLED_ROLLOUT_SNAPSHOT.json"), "Upload step missing rollout snapshot path");
  assert(uploadPath.includes(".run-logs/e2e-smoke-*.log"), "Upload step missing E2E smoke log path");
  assert(uploadPath.includes(".run-logs/e2e-result-*.json"), "Upload step missing E2E smoke result path");
  assert(uploadWith["include-hidden-files"] === true, "Upload step must include hidden files");
  assert(String(uploadWith["if-no-files-found"] ?? "").trim() === "error", "Upload step must fail when artifacts are missing");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        workflow: ".github/workflows/deploy-staging.yml",
        validated: [
          "workflow_dispatch_trigger_present",
          "deploy_job_serialized_with_environment_protection",
          "migration_step_has_database_secret_guard",
          "railway_cli_install_step_present_before_deploy",
          "deploy_step_uses_checked_in_railway_script",
          "staging_smoke_checks_health_and_env",
          "postdeploy_verification_runs_workspace_scoped_trust_boundary_check",
          "public_signup_smoke_check_runs_after_postdeploy_verification",
          "postdeploy_e2e_smoke_runs_before_gate_recording",
          "gate_artifact_step_records_staging_postcheck_suite",
          "rollout_snapshot_step_targets_live_staging_api",
          "artifact_upload_step_persists_gate_rollout_and_smoke_outputs",
        ],
        checkedAt: new Date().toISOString(),
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
