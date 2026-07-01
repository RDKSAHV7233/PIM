#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const REPO_ROOT = path.resolve(__dirname, "..");
const WORKFLOW_PATH = path.join(REPO_ROOT, ".github", "workflows", "promote-stage2.yml");

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

  assert(workflow && typeof workflow === "object", "promote-stage2 workflow YAML did not parse to an object");
  assert(String(workflow.name ?? "").trim() === "Promote Stage 2", "Unexpected workflow name");

  const triggers = workflow.on ?? {};
  assert(
    triggers && typeof triggers === "object" && Object.prototype.hasOwnProperty.call(triggers, "workflow_dispatch"),
    "promote-stage2 workflow must support workflow_dispatch",
  );

  const jobs = workflow.jobs ?? {};
  const job = jobs["promote-stage2"];
  assert(job && typeof job === "object", "Missing promote-stage2 job");
  assert(String(job?.env?.APP_ENV ?? "").trim() === "staging", "promote-stage2 job must set APP_ENV=staging");

  const steps = Array.isArray(job.steps) ? job.steps : [];
  assert(steps.length > 0, "promote-stage2 job has no steps");

  requireStep(steps, "Checkout");
  requireStep(steps, "Setup Node");
  requireStep(steps, "Install dependencies");

  const validateStep = requireStep(steps, "Validate Stage 2 deploy contract");
  requireEnvVar(validateStep, "APP_ENV", "Validate Stage 2 deploy contract");
  requireEnvVar(validateStep, "STAGING_BASE_URL", "Validate Stage 2 deploy contract");
  requireEnvVar(validateStep, "STAGING_WEB_URL", "Validate Stage 2 deploy contract");
  requireRunContains(validateStep, "node scripts/validate-staging-deploy-config.cjs", "Validate Stage 2 deploy contract");

  const healthStep = requireStep(steps, "Health probe");
  requireEnvVar(healthStep, "STAGING_URL", "Health probe");
  requireRunContains(healthStep, "/api/v1/health", "Health probe");
  requireRunContains(healthStep, "workerEnabled", "Health probe");

  const postDeployStep = requireStep(steps, "Post-deploy auth + trust boundary check");
  requireEnvVar(postDeployStep, "STAGING_BASE_URL", "Post-deploy auth + trust boundary check");
  requireEnvVar(postDeployStep, "STAGING_WEB_URL", "Post-deploy auth + trust boundary check");
  requireEnvVar(postDeployStep, "STAGING_SMOKE_WORKSPACE", "Post-deploy auth + trust boundary check");
  requireEnvVar(postDeployStep, "STAGING_SMOKE_USER", "Post-deploy auth + trust boundary check");
  requireEnvVar(postDeployStep, "STAGING_SMOKE_PASSWORD", "Post-deploy auth + trust boundary check");
  requireEnvVar(postDeployStep, "STAGING_EXPECTED_ENV", "Post-deploy auth + trust boundary check");
  requireEnvVar(postDeployStep, "STAGING_VALIDATE_NON_ADMIN", "Post-deploy auth + trust boundary check");
  requireRunContains(postDeployStep, "node scripts/staging-postdeploy-check.cjs", "Post-deploy auth + trust boundary check");

  const signupStep = requireStep(steps, "Public signup smoke check");
  requireEnvVar(signupStep, "STAGING_BASE_URL", "Public signup smoke check");
  requireEnvVar(signupStep, "STAGING_WEB_URL", "Public signup smoke check");
  requireEnvVar(signupStep, "STAGING_EXPECTED_ENV", "Public signup smoke check");
  requireRunContains(signupStep, "node scripts/staging-public-signup-check.cjs", "Public signup smoke check");

  requireStepOrder(steps, "Validate Stage 2 deploy contract", "Health probe");
  requireStepOrder(steps, "Health probe", "Post-deploy auth + trust boundary check");
  requireStepOrder(steps, "Post-deploy auth + trust boundary check", "Public signup smoke check");
  requireStepOrder(steps, "Public signup smoke check", "Pre-investor checklist summary");

  requireStep(steps, "Pre-investor checklist summary");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        workflow: ".github/workflows/promote-stage2.yml",
        validated: [
          "workflow_dispatch_trigger_present",
          "deploy_contract_validated_before_health_probe",
          "health_probe_checks_worker_enabled",
          "postdeploy_auth_trust_boundary_check_present",
          "public_signup_smoke_check_present",
          "step_ordering_correct",
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
