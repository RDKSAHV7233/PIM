#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const REPO_ROOT = path.resolve(__dirname, "..");
const WORKFLOW_PATH = path.join(REPO_ROOT, ".github", "workflows", "e2e-staging.yml");

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

function requireAnyEnvVar(step, names, label) {
  const env = step?.env ?? {};
  const hasAny = names.some((name) => Object.prototype.hasOwnProperty.call(env, name));
  assert(hasAny, `${label} missing one of env vars: ${names.join(", ")}`);
}

function requireRunContains(step, fragment, label) {
  const run = String(step?.run ?? "");
  assert(run.includes(fragment), `${label} missing required fragment: ${fragment}`);
}

function main() {
  assert(fs.existsSync(WORKFLOW_PATH), `Workflow file not found: ${WORKFLOW_PATH}`);
  const text = fs.readFileSync(WORKFLOW_PATH, "utf8");
  const workflow = YAML.parse(text);

  assert(workflow && typeof workflow === "object", "e2e-staging workflow YAML did not parse to an object");
  assert(String(workflow.name ?? "").trim() === "E2E - Staging User Journey", "Unexpected workflow name");

  const triggers = workflow.on ?? {};
  assert(
    triggers && typeof triggers === "object" && Object.prototype.hasOwnProperty.call(triggers, "workflow_dispatch"),
    "e2e-staging workflow must support workflow_dispatch",
  );
  assert(
    Object.prototype.hasOwnProperty.call(triggers, "schedule"),
    "e2e-staging workflow must have a schedule trigger",
  );

  assert(workflow.concurrency && typeof workflow.concurrency === "object", "e2e-staging workflow must define concurrency");
  assert(String(workflow.concurrency.group ?? "").trim() === "e2e-staging", "e2e-staging concurrency group must be e2e-staging");

  const jobs = workflow.jobs ?? {};
  const job = jobs["e2e"];
  assert(job && typeof job === "object", "Missing e2e job");
  assert(job.environment === "staging", "e2e job must target environment=staging");

  const steps = Array.isArray(job.steps) ? job.steps : [];
  assert(steps.length > 0, "e2e job has no steps");

  requireStep(steps, "Checkout");
  requireStep(steps, "Install dependencies");
  requireStep(steps, "Install Railway CLI");

  const resolveApiStep = requireStep(steps, "Resolve staging API URL");
  assert(String(resolveApiStep?.id ?? "").trim() === "resolve_staging_api_url", "Resolve staging API URL step must expose id=resolve_staging_api_url");
  requireAnyEnvVar(resolveApiStep, ["RAILWAY_TOKEN", "RAILWAY_API_TOKEN"], "Resolve staging API URL");
  requireEnvVar(resolveApiStep, "RAILWAY_PROJECT_ID", "Resolve staging API URL");
  requireEnvVar(resolveApiStep, "RAILWAY_ENVIRONMENT_NAME", "Resolve staging API URL");
  requireEnvVar(resolveApiStep, "FALLBACK_STAGING_API_URL", "Resolve staging API URL");
  requireRunContains(resolveApiStep, "node scripts/resolve-railway-service-url.cjs", "Resolve staging API URL");
  requireRunContains(resolveApiStep, 'echo "api_url=${resolved_api_url}" >> "$GITHUB_OUTPUT"', "Resolve staging API URL");

  const resolveWebStep = requireStep(steps, "Resolve staging web URL");
  assert(String(resolveWebStep?.id ?? "").trim() === "resolve_staging_web_url", "Resolve staging web URL step must expose id=resolve_staging_web_url");
  requireAnyEnvVar(resolveWebStep, ["RAILWAY_TOKEN", "RAILWAY_API_TOKEN"], "Resolve staging web URL");
  requireEnvVar(resolveWebStep, "RAILWAY_PROJECT_ID", "Resolve staging web URL");
  requireEnvVar(resolveWebStep, "RAILWAY_ENVIRONMENT_NAME", "Resolve staging web URL");
  requireEnvVar(resolveWebStep, "FALLBACK_STAGING_WEB_URL", "Resolve staging web URL");
  requireRunContains(resolveWebStep, "node scripts/resolve-railway-service-url.cjs", "Resolve staging web URL");
  requireRunContains(resolveWebStep, 'echo "web_url=${resolved_web_url}" >> "$GITHUB_OUTPUT"', "Resolve staging web URL");

  requireStepOrder(steps, "Install Railway CLI", "Resolve staging API URL");
  requireStepOrder(steps, "Resolve staging API URL", "Resolve staging web URL");

  const signupStep = requireStep(steps, "Public signup smoke check");
  requireEnvVar(signupStep, "STAGING_BASE_URL", "Public signup smoke check");
  requireEnvVar(signupStep, "STAGING_WEB_URL", "Public signup smoke check");
  requireEnvVar(signupStep, "STAGING_EXPECTED_ENV", "Public signup smoke check");
  requireRunContains(signupStep, "node scripts/staging-public-signup-check.cjs", "Public signup smoke check");

  const e2eStep = requireStep(steps, "Run E2E suite");
  requireEnvVar(e2eStep, "STAGING_BASE_URL", "Run E2E suite");
  requireEnvVar(e2eStep, "STAGING_WEB_URL", "Run E2E suite");
  requireEnvVar(e2eStep, "STAGING_SMOKE_WORKSPACE", "Run E2E suite");
  requireEnvVar(e2eStep, "STAGING_SMOKE_USER", "Run E2E suite");
  requireEnvVar(e2eStep, "STAGING_SMOKE_PASSWORD", "Run E2E suite");
  requireRunContains(e2eStep, "node scripts/e2e-user-journey.cjs", "Run E2E suite");
  requireRunContains(e2eStep, "set -o pipefail", "Run E2E suite");

  requireStepOrder(steps, "Resolve staging web URL", "Run E2E suite");

  requireStep(steps, "Upload E2E artifacts");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        workflow: ".github/workflows/e2e-staging.yml",
        validated: [
          "workflow_dispatch_trigger_present",
          "schedule_trigger_present",
          "concurrency_group_defined",
          "staging_environment_protection_enabled",
          "railway_url_resolution_before_e2e",
          "public_signup_smoke_check_present",
          "e2e_suite_uses_pipefail_and_logging",
          "artifact_upload_step_present",
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
