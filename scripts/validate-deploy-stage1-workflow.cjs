#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const REPO_ROOT = path.resolve(__dirname, "..");
const WORKFLOW_PATH = path.join(REPO_ROOT, ".github", "workflows", "deploy-stage1.yml");

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

function requireEnvVar(step, name, label) {
  const env = step?.env ?? {};
  assert(Object.prototype.hasOwnProperty.call(env, name), `${label} missing env var: ${name}`);
}

function requireRunContains(step, fragment, label) {
  const run = String(step?.run ?? "");
  assert(run.includes(fragment), `${label} missing required fragment: ${fragment}`);
}

function main() {
  assert(fs.existsSync(WORKFLOW_PATH), `Workflow file not found: ${WORKFLOW_PATH}`);
  const text = fs.readFileSync(WORKFLOW_PATH, "utf8");
  const workflow = YAML.parse(text);

  assert(workflow && typeof workflow === "object", "deploy-stage1 workflow YAML did not parse to an object");
  assert(String(workflow.name ?? "").trim() === "Deploy Stage 1", "Unexpected workflow name");

  const triggers = workflow.on ?? {};
  assert(
    triggers && typeof triggers === "object" && Object.prototype.hasOwnProperty.call(triggers, "workflow_dispatch"),
    "deploy-stage1 workflow must support workflow_dispatch",
  );

  const jobs = workflow.jobs ?? {};
  const job = jobs["deploy-stage1"];
  assert(job && typeof job === "object", "Missing deploy-stage1 job");
  assert(String(job?.env?.APP_ENV ?? "").trim() === "staging", "deploy-stage1 job must set APP_ENV=staging");

  const steps = Array.isArray(job.steps) ? job.steps : [];
  assert(steps.length > 0, "deploy-stage1 job has no steps");

  requireStep(steps, "Checkout");
  requireStep(steps, "Setup Node");
  requireStep(steps, "Install dependencies");
  requireStep(steps, "Generate Prisma client");

  const validateStep = requireStep(steps, "Validate Stage 1 deploy contract");
  requireEnvVar(validateStep, "APP_ENV", "Validate Stage 1 deploy contract");
  requireEnvVar(validateStep, "STAGING_BASE_URL", "Validate Stage 1 deploy contract");
  requireEnvVar(validateStep, "STAGING_WEB_URL", "Validate Stage 1 deploy contract");
  requireRunContains(validateStep, "node scripts/validate-staging-deploy-config.cjs", "Validate Stage 1 deploy contract");

  const migrationsStep = requireStep(steps, "Apply migrations");
  requireEnvVar(migrationsStep, "DATABASE_URL_DIRECT", "Apply migrations");
  requireEnvVar(migrationsStep, "DATABASE_URL", "Apply migrations");
  requireRunContains(migrationsStep, "npm run prisma:migrate:deploy", "Apply migrations");

  requireStepOrder(steps, "Validate Stage 1 deploy contract", "Apply migrations");

  const healthStep = requireStep(steps, "Staging health smoke test");
  requireEnvVar(healthStep, "STAGING_URL", "Staging health smoke test");
  requireRunContains(healthStep, "/api/v1/health", "Staging health smoke test");

  const postDeployStep = requireStep(steps, "Post-deploy verification");
  requireEnvVar(postDeployStep, "STAGING_BASE_URL", "Post-deploy verification");
  requireEnvVar(postDeployStep, "STAGING_WEB_URL", "Post-deploy verification");
  requireEnvVar(postDeployStep, "STAGING_SMOKE_WORKSPACE", "Post-deploy verification");
  requireEnvVar(postDeployStep, "STAGING_SMOKE_USER", "Post-deploy verification");
  requireEnvVar(postDeployStep, "STAGING_SMOKE_PASSWORD", "Post-deploy verification");
  requireEnvVar(postDeployStep, "STAGING_EXPECTED_ENV", "Post-deploy verification");
  requireEnvVar(postDeployStep, "STAGING_VALIDATE_NON_ADMIN", "Post-deploy verification");
  requireRunContains(postDeployStep, "node scripts/staging-postdeploy-check.cjs", "Post-deploy verification");

  requireStepOrder(steps, "Staging health smoke test", "Post-deploy verification");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        workflow: ".github/workflows/deploy-stage1.yml",
        validated: [
          "workflow_dispatch_trigger_present",
          "deploy_contract_validated_before_migrations",
          "migrations_have_database_secret_guard",
          "health_probe_checks_api_health",
          "postdeploy_verification_runs_auth_trust_boundary_check",
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
