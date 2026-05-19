#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const REPO_ROOT = path.resolve(__dirname, "..");
const WORKFLOW_PATH = path.join(REPO_ROOT, ".github", "workflows", "promote-stage3.yml");

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

  assert(workflow && typeof workflow === "object", "promote-stage3 workflow YAML did not parse to an object");
  assert(String(workflow.name ?? "").trim() === "Promote Stage 3", "Unexpected workflow name");

  const triggers = workflow.on ?? {};
  assert(
    triggers && typeof triggers === "object" && Object.prototype.hasOwnProperty.call(triggers, "workflow_dispatch"),
    "promote-stage3 workflow must support workflow_dispatch",
  );

  const jobs = workflow.jobs ?? {};
  const job = jobs["promote-stage3"];
  assert(job && typeof job === "object", "Missing promote-stage3 job");
  assert(job.environment === "production", "promote-stage3 job must target environment=production");
  assert(job.concurrency && typeof job.concurrency === "object", "promote-stage3 job must define concurrency");
  assert(String(job.concurrency.group ?? "").trim() === "promote-stage3", "promote-stage3 concurrency group must be promote-stage3");
  assert(job.concurrency["cancel-in-progress"] === false, "promote-stage3 concurrency must not cancel in-progress deploys");
  assert(String(job?.env?.NODE_VERSION ?? "").trim() === "20", "promote-stage3 job must pin NODE_VERSION=20");
  assert(String(job?.env?.APP_ENV ?? "").trim() === "production", "promote-stage3 job must set APP_ENV=production");

  const steps = Array.isArray(job.steps) ? job.steps : [];
  assert(steps.length > 0, "promote-stage3 job has no steps");

  requireStep(steps, "Checkout");
  requireStep(steps, "Setup Node");
  requireStep(steps, "Install dependencies");
  requireStep(steps, "Generate Prisma client");

  const validateStep = requireStep(steps, "Validate production deploy contract");
  requireAnyEnvVar(validateStep, ["RAILWAY_TOKEN", "RAILWAY_API_TOKEN"], "Validate production deploy contract");
  requireEnvVar(validateStep, "RAILWAY_PROJECT_ID", "Validate production deploy contract");
  requireAnyEnvVar(validateStep, ["RAILWAY_API_SERVICE", "RAILWAY_API_SERVICE_ID"], "Validate production deploy contract");
  requireAnyEnvVar(validateStep, ["RAILWAY_WEB_SERVICE", "RAILWAY_WEB_SERVICE_ID"], "Validate production deploy contract");
  requireEnvVar(validateStep, "RAILWAY_ENVIRONMENT_NAME", "Validate production deploy contract");
  requireEnvVar(validateStep, "STAGING_BASE_URL", "Validate production deploy contract");
  requireEnvVar(validateStep, "STAGING_WEB_URL", "Validate production deploy contract");
  requireRunContains(validateStep, "node scripts/validate-staging-deploy-config.cjs", "Validate production deploy contract");

  const migrationsStep = requireStep(steps, "Apply migrations");
  requireEnvVar(migrationsStep, "DATABASE_URL_DIRECT", "Apply migrations");
  requireEnvVar(migrationsStep, "DATABASE_URL", "Apply migrations");
  requireRunContains(migrationsStep, "npm run prisma:migrate:deploy", "Apply migrations");

  requireStep(steps, "Build API");
  requireStep(steps, "Build Web");
  requireStep(steps, "Install Railway CLI");
  requireStepOrder(steps, "Install Railway CLI", "Deploy to production");

  const deployStep = requireStep(steps, "Deploy to production");
  requireAnyEnvVar(deployStep, ["RAILWAY_TOKEN", "RAILWAY_API_TOKEN"], "Deploy to production");
  requireEnvVar(deployStep, "RAILWAY_PROJECT_ID", "Deploy to production");
  requireAnyEnvVar(deployStep, ["RAILWAY_API_SERVICE", "RAILWAY_API_SERVICE_ID"], "Deploy to production");
  requireAnyEnvVar(deployStep, ["RAILWAY_WEB_SERVICE", "RAILWAY_WEB_SERVICE_ID"], "Deploy to production");
  requireEnvVar(deployStep, "RAILWAY_ENVIRONMENT_NAME", "Deploy to production");
  requireEnvVar(deployStep, "STAGING_BASE_URL", "Deploy to production");
  requireEnvVar(deployStep, "STAGING_WEB_URL", "Deploy to production");
  requireRunContains(deployStep, "node scripts/railway-deploy.cjs", "Deploy to production");

  const resolveWebUrlStep = requireStep(steps, "Resolve production web URL");
  assert(String(resolveWebUrlStep?.id ?? "").trim() === "resolve_production_web_url", "Resolve production web URL step must expose id=resolve_production_web_url");
  requireAnyEnvVar(resolveWebUrlStep, ["RAILWAY_TOKEN", "RAILWAY_API_TOKEN"], "Resolve production web URL");
  requireEnvVar(resolveWebUrlStep, "RAILWAY_PROJECT_ID", "Resolve production web URL");
  requireAnyEnvVar(resolveWebUrlStep, ["RAILWAY_WEB_SERVICE", "RAILWAY_WEB_SERVICE_ID"], "Resolve production web URL");
  requireEnvVar(resolveWebUrlStep, "RAILWAY_ENVIRONMENT_NAME", "Resolve production web URL");
  requireEnvVar(resolveWebUrlStep, "FALLBACK_STAGING_WEB_URL", "Resolve production web URL");
  requireRunContains(resolveWebUrlStep, "node scripts/resolve-railway-service-url.cjs", "Resolve production web URL");
  requireRunContains(resolveWebUrlStep, 'echo "web_url=${resolved_web_url}" >> "$GITHUB_OUTPUT"', "Resolve production web URL");

  const healthStep = requireStep(steps, "Health probe");
  requireEnvVar(healthStep, "STAGING_URL", "Health probe");
  requireRunContains(healthStep, "/api/v1/health", "Health probe");

  const postDeployStep = requireStep(steps, "Post-deploy auth + trust boundary check");
  requireEnvVar(postDeployStep, "STAGING_BASE_URL", "Post-deploy auth + trust boundary check");
  requireEnvVar(postDeployStep, "STAGING_WEB_URL", "Post-deploy auth + trust boundary check");
  requireEnvVar(postDeployStep, "STAGING_SMOKE_WORKSPACE", "Post-deploy auth + trust boundary check");
  requireEnvVar(postDeployStep, "STAGING_SMOKE_USER", "Post-deploy auth + trust boundary check");
  requireEnvVar(postDeployStep, "STAGING_SMOKE_PASSWORD", "Post-deploy auth + trust boundary check");
  requireEnvVar(postDeployStep, "STAGING_EXPECTED_ENV", "Post-deploy auth + trust boundary check");
  requireEnvVar(postDeployStep, "STAGING_VALIDATE_NON_ADMIN", "Post-deploy auth + trust boundary check");
  requireRunContains(postDeployStep, "node scripts/staging-postdeploy-check.cjs", "Post-deploy auth + trust boundary check");

  const publicSignupStep = requireStep(steps, "Public signup smoke check");
  requireEnvVar(publicSignupStep, "STAGING_BASE_URL", "Public signup smoke check");
  requireEnvVar(publicSignupStep, "STAGING_WEB_URL", "Public signup smoke check");
  requireEnvVar(publicSignupStep, "STAGING_EXPECT_PUBLIC_SIGNUP_ENABLED", "Public signup smoke check");
  requireEnvVar(publicSignupStep, "STAGING_EXPECTED_ENV", "Public signup smoke check");
  requireRunContains(publicSignupStep, "node scripts/staging-public-signup-check.cjs", "Public signup smoke check");

  const rlsStep = requireStep(steps, "Tenant RLS isolation check");
  requireEnvVar(rlsStep, "DATABASE_URL", "Tenant RLS isolation check");
  requireEnvVar(rlsStep, "DATABASE_URL_DIRECT", "Tenant RLS isolation check");
  requireRunContains(rlsStep, "node scripts/verify-tenant-rls.cjs", "Tenant RLS isolation check");

  requireStep(steps, "Stage 3 readiness summary");
  requireStepOrder(steps, "Deploy to production", "Resolve production web URL");
  requireStepOrder(steps, "Resolve production web URL", "Post-deploy auth + trust boundary check");
  requireStepOrder(steps, "Post-deploy auth + trust boundary check", "Public signup smoke check");
  requireStepOrder(steps, "Public signup smoke check", "Tenant RLS isolation check");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        workflow: ".github/workflows/promote-stage3.yml",
        validated: [
          "workflow_dispatch_trigger_present",
          "production_environment_protection_enabled",
          "production_deploy_contract_validated_before_migrations",
          "build_steps_run_before_railway_deploy",
          "production_deploy_uses_checked_in_railway_script",
          "production_web_url_is_resolved_after_deploy",
          "postdeploy_auth_verification_targets_resolved_web_url",
          "public_signup_and_rls_checks_remain_after_deploy",
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
