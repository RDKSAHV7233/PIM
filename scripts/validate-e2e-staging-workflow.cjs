#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const WORKFLOW_PATH = path.resolve(__dirname, "..", ".github", "workflows", "e2e-staging.yml");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function requireStep(steps, name) {
  const step = steps.find((entry) => String(entry?.name ?? "").trim() === name);
  assert(step, `Missing workflow step: ${name}`);
  return step;
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
  const workflow = YAML.parse(fs.readFileSync(WORKFLOW_PATH, "utf8"));

  assert(workflow && typeof workflow === "object", "e2e-staging workflow YAML did not parse to an object");
  assert(String(workflow.name ?? "").trim() === "E2E - Staging User Journey", "Unexpected workflow name");

  const triggers = workflow.on ?? {};
  assert(
    triggers && typeof triggers === "object" && Object.prototype.hasOwnProperty.call(triggers, "workflow_dispatch"),
    "e2e-staging workflow must support workflow_dispatch",
  );
  assert(
    triggers && typeof triggers === "object" && Array.isArray(triggers.schedule) && triggers.schedule.length > 0,
    "e2e-staging workflow must include a schedule trigger",
  );

  assert(workflow.concurrency && typeof workflow.concurrency === "object", "e2e-staging workflow must define concurrency");
  assert(String(workflow.concurrency.group ?? "").trim() === "e2e-staging", "e2e-staging concurrency group must be e2e-staging");

  const job = workflow.jobs?.e2e;
  assert(job && typeof job === "object", "Missing e2e job");
  assert(String(job.environment ?? "").trim() === "staging", "e2e job must target environment=staging");

  const steps = Array.isArray(job.steps) ? job.steps : [];
  assert(steps.length > 0, "e2e job has no steps");

  requireStep(steps, "Checkout");
  requireStep(steps, "Set up Node ${{ env.NODE_VERSION }}");
  requireStep(steps, "Install dependencies");
  requireStep(steps, "Install Railway CLI");

  const resolveApiUrlStep = requireStep(steps, "Resolve staging API URL");
  assert(String(resolveApiUrlStep?.id ?? "").trim() === "resolve_staging_api_url", "Resolve staging API URL step must expose id=resolve_staging_api_url");
  requireAnyEnvVar(resolveApiUrlStep, ["RAILWAY_TOKEN", "RAILWAY_API_TOKEN"], "Resolve staging API URL");
  requireEnvVar(resolveApiUrlStep, "RAILWAY_PROJECT_ID", "Resolve staging API URL");
  requireAnyEnvVar(resolveApiUrlStep, ["RAILWAY_SERVICE", "RAILWAY_SERVICE_ID"], "Resolve staging API URL");
  requireEnvVar(resolveApiUrlStep, "RAILWAY_ENVIRONMENT_ID", "Resolve staging API URL");
  requireEnvVar(resolveApiUrlStep, "RAILWAY_ENVIRONMENT_NAME", "Resolve staging API URL");
  requireEnvVar(resolveApiUrlStep, "FALLBACK_STAGING_API_URL", "Resolve staging API URL");
  requireRunContains(resolveApiUrlStep, "node scripts/resolve-railway-service-url.cjs", "Resolve staging API URL");
  requireRunContains(resolveApiUrlStep, 'echo "api_url=${resolved_api_url}" >> "$GITHUB_OUTPUT"', "Resolve staging API URL");

  const resolveWebUrlStep = requireStep(steps, "Resolve staging web URL");
  assert(String(resolveWebUrlStep?.id ?? "").trim() === "resolve_staging_web_url", "Resolve staging web URL step must expose id=resolve_staging_web_url");
  requireAnyEnvVar(resolveWebUrlStep, ["RAILWAY_TOKEN", "RAILWAY_API_TOKEN"], "Resolve staging web URL");
  requireEnvVar(resolveWebUrlStep, "RAILWAY_PROJECT_ID", "Resolve staging web URL");
  requireAnyEnvVar(resolveWebUrlStep, ["RAILWAY_WEB_SERVICE", "RAILWAY_WEB_SERVICE_ID"], "Resolve staging web URL");
  requireEnvVar(resolveWebUrlStep, "RAILWAY_ENVIRONMENT_ID", "Resolve staging web URL");
  requireEnvVar(resolveWebUrlStep, "RAILWAY_ENVIRONMENT_NAME", "Resolve staging web URL");
  requireEnvVar(resolveWebUrlStep, "FALLBACK_STAGING_WEB_URL", "Resolve staging web URL");
  requireRunContains(resolveWebUrlStep, "node scripts/resolve-railway-service-url.cjs", "Resolve staging web URL");
  requireRunContains(resolveWebUrlStep, 'echo "web_url=${resolved_web_url}" >> "$GITHUB_OUTPUT"', "Resolve staging web URL");

  const signupStep = requireStep(steps, "Public signup smoke check");
  requireEnvVar(signupStep, "STAGING_BASE_URL", "Public signup smoke check");
  requireEnvVar(signupStep, "STAGING_WEB_URL", "Public signup smoke check");
  assert(
    String(signupStep.env?.STAGING_BASE_URL ?? "").trim() === "${{ steps.resolve_staging_api_url.outputs.api_url }}",
    "Public signup smoke check must use the resolved staging API URL output",
  );
  assert(
    String(signupStep.env?.STAGING_WEB_URL ?? "").trim() === "${{ steps.resolve_staging_web_url.outputs.web_url }}",
    "Public signup smoke check must use the resolved staging web URL output",
  );
  requireRunContains(signupStep, "node scripts/staging-public-signup-check.cjs", "Public signup smoke check");

  const e2eStep = requireStep(steps, "Run E2E suite");
  requireEnvVar(e2eStep, "STAGING_BASE_URL", "Run E2E suite");
  requireEnvVar(e2eStep, "STAGING_WEB_URL", "Run E2E suite");
  assert(
    String(e2eStep.env?.STAGING_BASE_URL ?? "").trim() === "${{ steps.resolve_staging_api_url.outputs.api_url }}",
    "Run E2E suite must use the resolved staging API URL output",
  );
  assert(
    String(e2eStep.env?.STAGING_WEB_URL ?? "").trim() === "${{ steps.resolve_staging_web_url.outputs.web_url }}",
    "Run E2E suite must use the resolved staging web URL output",
  );
  requireRunContains(e2eStep, "node scripts/e2e-user-journey.cjs", "Run E2E suite");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        workflow: ".github/workflows/e2e-staging.yml",
        validated: [
          "workflow_dispatch_trigger_present",
          "schedule_trigger_present",
          "staging_environment_present",
          "railway_cli_installed_before_resolution",
          "staging_api_url_is_resolved_with_fallback",
          "staging_web_url_is_resolved_with_fallback",
          "signup_smoke_targets_resolved_urls",
          "e2e_suite_targets_resolved_urls",
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
