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

function requireAnyEnvVar(step, names, label) {
  const env = step?.env ?? {};
  const hasAny = names.some((name) => Object.prototype.hasOwnProperty.call(env, name));
  assert(hasAny, `${label} missing one of env vars: ${names.join(", ")}`);
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
  const pushTrigger = triggers.push ?? {};
  assert(pushTrigger && typeof pushTrigger === "object", "deploy-staging workflow must support push-triggered auto deploys");
  const pushBranches = Array.isArray(pushTrigger.branches) ? pushTrigger.branches : [];
  assert(pushBranches.includes("main"), "deploy-staging push trigger must include main");
  const pathsIgnore = Array.isArray(pushTrigger["paths-ignore"]) ? pushTrigger["paths-ignore"] : [];
  assert(pathsIgnore.includes("docs/execution/gates/**"), "deploy-staging push trigger must ignore docs/execution/gates/**");
  assert(pathsIgnore.includes("docs/execution/rollout/**"), "deploy-staging push trigger must ignore docs/execution/rollout/**");

  const jobs = workflow.jobs ?? {};
  const job = jobs["deploy-staging"];
  assert(job && typeof job === "object", "Missing deploy-staging job");
  assert(job.environment === "staging", "deploy-staging job must target environment=staging");
  assert(Number.parseInt(String(job["timeout-minutes"] ?? ""), 10) <= 75, "deploy-staging job must cap runtime at 75 minutes or less");
  assert(job.concurrency && typeof job.concurrency === "object", "deploy-staging job must define concurrency");
  assert(String(job.concurrency.group ?? "").trim() === "deploy-staging", "deploy-staging concurrency group must be deploy-staging");
  assert(job.concurrency["cancel-in-progress"] === false, "deploy-staging concurrency must not cancel in-progress deploys");

  const steps = Array.isArray(job.steps) ? job.steps : [];
  assert(steps.length > 0, "deploy-staging job has no steps");

  const checkoutStep = requireStep(steps, "Checkout");
  assert(
    Number.parseInt(String(checkoutStep?.with?.["fetch-depth"] ?? ""), 10) === 0,
    "Checkout must use fetch-depth: 0 so selective deploy diffs can compare github.event.before to HEAD",
  );
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
  requireStep(steps, "Install Railway CLI");
  requireStepOrder(steps, "Apply migrations", "Install Railway CLI");
  const observabilityUrlStep = requireStep(steps, "Resolve observability database URL");
  assert(
    String(observabilityUrlStep?.id ?? "").trim() === "resolve_observability_database_url",
    "Resolve observability database URL step must expose id=resolve_observability_database_url",
  );
  requireEnvVar(observabilityUrlStep, "OBSERVABILITY_DATABASE_URL", "Resolve observability database URL");
  requireAnyEnvVar(observabilityUrlStep, ["RAILWAY_TOKEN", "RAILWAY_API_TOKEN"], "Resolve observability database URL");
  requireEnvVar(observabilityUrlStep, "RAILWAY_PROJECT_ID", "Resolve observability database URL");
  requireAnyEnvVar(observabilityUrlStep, ["RAILWAY_API_SERVICE", "RAILWAY_API_SERVICE_ID"], "Resolve observability database URL");
  requireRunContains(
    observabilityUrlStep,
    "node scripts/resolve-observability-database-url.cjs",
    "Resolve observability database URL",
  );
  const observabilityMigrationsStep = requireStep(steps, "Apply observability migrations");
  requireEnvVar(observabilityMigrationsStep, "OBSERVABILITY_DATABASE_URL", "Apply observability migrations");
  assert(
    String(observabilityMigrationsStep.env?.OBSERVABILITY_DATABASE_URL ?? "").trim() ===
      "${{ steps.resolve_observability_database_url.outputs.observability_database_url }}",
    "Apply observability migrations must use the resolved observability database URL output.",
  );
  requireRunContains(
    observabilityMigrationsStep,
    "Missing OBSERVABILITY_DATABASE_URL secret for Error Authority migrations.",
    "Apply observability migrations",
  );
  requireRunContains(
    observabilityMigrationsStep,
    "npm run prisma:migrate:deploy --workspace @pim1/observability-db",
    "Apply observability migrations",
  );
  requireStepOrder(steps, "Apply migrations", "Apply observability migrations");
  requireStepOrder(steps, "Apply migrations", "Resolve observability database URL");
  requireStepOrder(steps, "Install Railway CLI", "Resolve observability database URL");
  requireStepOrder(steps, "Resolve observability database URL", "Apply observability migrations");
  requireStepOrder(steps, "Apply observability migrations", "Build API");
  const authHashBackfillStep = requireStep(steps, "Backfill legacy auth hashes");
  requireEnvVar(authHashBackfillStep, "DATABASE_URL_DIRECT", "Backfill legacy auth hashes");
  requireEnvVar(authHashBackfillStep, "DATABASE_URL", "Backfill legacy auth hashes");
  requireEnvVar(authHashBackfillStep, "PIM_AUTH_PASSWORD", "Backfill legacy auth hashes");
  requireRunContains(
    authHashBackfillStep,
    "Missing STAGING_DATABASE_URL_DIRECT or STAGING_DATABASE_URL secret for auth hash backfill.",
    "Backfill legacy auth hashes",
  );
  requireRunContains(
    authHashBackfillStep,
    "Missing STAGING_SMOKE_PASSWORD secret for auth hash backfill.",
    "Backfill legacy auth hashes",
  );
  requireRunContains(
    authHashBackfillStep,
    "node scripts/migrate-legacy-auth-password-hashes.cjs",
    "Backfill legacy auth hashes",
  );
  requireStepOrder(steps, "Apply migrations", "Backfill legacy auth hashes");
  requireStepOrder(steps, "Backfill legacy auth hashes", "Build API");
  requireStep(steps, "Build API");
  requireStep(steps, "Build Web");
  requireStepOrder(steps, "Install Railway CLI", "Resolve staging API URL");
  requireStepOrder(steps, "Resolve staging API URL", "Deploy to staging");

  const resolveApiUrlStep = requireStep(steps, "Resolve staging API URL");
  assert(String(resolveApiUrlStep?.id ?? "").trim() === "resolve_staging_api_url", "Resolve staging API URL step must expose id=resolve_staging_api_url");
  requireAnyEnvVar(resolveApiUrlStep, ["RAILWAY_TOKEN", "RAILWAY_API_TOKEN"], "Resolve staging API URL");
  requireEnvVar(resolveApiUrlStep, "RAILWAY_PROJECT_ID", "Resolve staging API URL");
  requireAnyEnvVar(resolveApiUrlStep, ["RAILWAY_SERVICE", "RAILWAY_SERVICE_ID"], "Resolve staging API URL");
  requireEnvVar(resolveApiUrlStep, "RAILWAY_ENVIRONMENT_NAME", "Resolve staging API URL");
  requireEnvVar(resolveApiUrlStep, "FALLBACK_STAGING_API_URL", "Resolve staging API URL");
  requireRunContains(resolveApiUrlStep, "node scripts/resolve-railway-service-url.cjs", "Resolve staging API URL");
  requireRunContains(
    resolveApiUrlStep,
    "Could not resolve staging API URL from Railway and no STAGING_BASE_URL secret fallback is configured.",
    "Resolve staging API URL",
  );
  requireRunContains(resolveApiUrlStep, 'echo "api_url=${resolved_api_url}" >> "$GITHUB_OUTPUT"', "Resolve staging API URL");

  const deployStep = requireStep(steps, "Deploy to staging");
  assert(Number.parseInt(String(deployStep["timeout-minutes"] ?? ""), 10) <= 45, "Deploy to staging must cap runtime at 45 minutes or less");
  requireAnyEnvVar(deployStep, ["RAILWAY_TOKEN", "RAILWAY_API_TOKEN"], "Deploy to staging");
  requireEnvVar(deployStep, "RAILWAY_PROJECT_ID", "Deploy to staging");
  requireAnyEnvVar(deployStep, ["RAILWAY_API_SERVICE", "RAILWAY_API_SERVICE_ID"], "Deploy to staging");
  requireAnyEnvVar(deployStep, ["RAILWAY_WEB_SERVICE", "RAILWAY_WEB_SERVICE_ID"], "Deploy to staging");
  requireEnvVar(deployStep, "RAILWAY_ENVIRONMENT_NAME", "Deploy to staging");
  requireEnvVar(deployStep, "DATABASE_URL_POOLED", "Deploy to staging");
  requireEnvVar(deployStep, "DATABASE_URL_DIRECT", "Deploy to staging");
  requireEnvVar(deployStep, "DATABASE_URL", "Deploy to staging");
  requireEnvVar(deployStep, "STAGING_BASE_URL", "Deploy to staging");
  requireEnvVar(deployStep, "GITHUB_SHA", "Deploy to staging");
  requireEnvVar(deployStep, "ERROR_AUTHORITY_RELEASE", "Deploy to staging");
  requireEnvVar(deployStep, "ERROR_AUTHORITY_INGEST_TOKEN", "Deploy to staging");
  requireEnvVar(deployStep, "RAILWAY_DEPLOY_RETRIES", "Deploy to staging");
  requireEnvVar(deployStep, "RAILWAY_DEPLOY_TIMEOUT_MS", "Deploy to staging");
  requireEnvVar(deployStep, "RAILWAY_DEPLOY_RETRY_DELAY_MS", "Deploy to staging");
  requireRunContains(deployStep, "node scripts/railway-deploy.cjs", "Deploy to staging");
  assert(!String(deployStep.run ?? "").includes("eval"), "Deploy to staging must not use eval");
  assert(
    String(deployStep.env?.STAGING_BASE_URL ?? "").trim() === "${{ steps.resolve_staging_api_url.outputs.api_url }}",
    "Deploy to staging must use the resolved staging API URL output.",
  );
  assert(
    String(deployStep.env?.ERROR_AUTHORITY_RELEASE ?? "").trim() === "${{ github.sha }}",
    "Deploy to staging must use github.sha as ERROR_AUTHORITY_RELEASE.",
  );
  const resolveWebUrlStep = requireStep(steps, "Resolve staging web URL");
  assert(String(resolveWebUrlStep?.id ?? "").trim() === "resolve_staging_web_url", "Resolve staging web URL step must expose id=resolve_staging_web_url");
  requireAnyEnvVar(resolveWebUrlStep, ["RAILWAY_TOKEN", "RAILWAY_API_TOKEN"], "Resolve staging web URL");
  requireEnvVar(resolveWebUrlStep, "RAILWAY_PROJECT_ID", "Resolve staging web URL");
  requireAnyEnvVar(resolveWebUrlStep, ["RAILWAY_WEB_SERVICE", "RAILWAY_WEB_SERVICE_ID"], "Resolve staging web URL");
  requireEnvVar(resolveWebUrlStep, "RAILWAY_ENVIRONMENT_NAME", "Resolve staging web URL");
  requireEnvVar(resolveWebUrlStep, "FALLBACK_STAGING_WEB_URL", "Resolve staging web URL");
  requireRunContains(resolveWebUrlStep, "node scripts/resolve-railway-service-url.cjs", "Resolve staging web URL");
  requireRunContains(
    resolveWebUrlStep,
    "Could not resolve staging web URL from Railway and no STAGING_WEB_URL secret fallback is configured.",
    "Resolve staging web URL",
  );
  requireRunContains(resolveWebUrlStep, 'echo "web_url=${resolved_web_url}" >> "$GITHUB_OUTPUT"', "Resolve staging web URL");
  requireStepOrder(steps, "Deploy to staging", "Resolve staging web URL");
  requireStepOrder(steps, "Resolve staging web URL", "Staging post-deploy verification (auth + trust boundary)");

  const smokeStep = requireStep(steps, "Staging smoke test");
  requireEnvVar(smokeStep, "STAGING_BASE_URL", "Staging smoke test");
  assert(
    String(smokeStep.env?.STAGING_BASE_URL ?? "").trim() === "${{ steps.resolve_staging_api_url.outputs.api_url }}",
    "Staging smoke test must use the resolved staging API URL output.",
  );
  requireRunContains(smokeStep, "/api/v1/health", "Staging smoke test");
  requireRunContains(smokeStep, "for attempt in $(seq 1 30)", "Staging smoke test");
  requireRunContains(smokeStep, "--max-time 20", "Staging smoke test");
  requireRunContains(smokeStep, "waiting for Railway readiness", "Staging smoke test");
  requireRunContains(smokeStep, "Staging health did not become ready after 30 attempts.", "Staging smoke test");
  requireRunMatches(smokeStep, /status.{0,8}ok/i, "Staging smoke test", 'health status ok assertion');
  requireRunMatches(smokeStep, /env.{0,12}staging/i, "Staging smoke test", 'health env staging assertion');

  const postDeployStep = requireStep(steps, "Staging post-deploy verification (auth + trust boundary)");
  requireEnvVar(postDeployStep, "STAGING_BASE_URL", "Post-deploy verification");
  assert(
    String(postDeployStep.env?.STAGING_BASE_URL ?? "").trim() === "${{ steps.resolve_staging_api_url.outputs.api_url }}",
    "Post-deploy verification must use the resolved staging API URL output.",
  );
  requireEnvVar(postDeployStep, "STAGING_WEB_URL", "Post-deploy verification");
  requireEnvVar(postDeployStep, "STAGING_SMOKE_WORKSPACE", "Post-deploy verification");
  requireEnvVar(postDeployStep, "STAGING_SMOKE_USER", "Post-deploy verification");
  requireEnvVar(postDeployStep, "STAGING_SMOKE_PASSWORD", "Post-deploy verification");
  requireEnvVar(postDeployStep, "STAGING_EXPECTED_ENV", "Post-deploy verification");
  requireEnvVar(postDeployStep, "STAGING_VALIDATE_NON_ADMIN", "Post-deploy verification");
  assert(
    String(postDeployStep.env?.STAGING_VALIDATE_NON_ADMIN ?? "").trim() === "true",
    "Post-deploy verification must enable STAGING_VALIDATE_NON_ADMIN=true",
  );
  requireRunContains(postDeployStep, "node scripts/staging-postdeploy-check.cjs", "Post-deploy verification");

  const opsErrorsAcceptanceStep = requireStep(steps, "Internal Ops Errors staging acceptance");
  requireEnvVar(opsErrorsAcceptanceStep, "STAGING_BASE_URL", "Internal Ops Errors staging acceptance");
  assert(
    String(opsErrorsAcceptanceStep.env?.STAGING_BASE_URL ?? "").trim() === "${{ steps.resolve_staging_api_url.outputs.api_url }}",
    "Internal Ops Errors staging acceptance must use the resolved staging API URL output.",
  );
  requireEnvVar(opsErrorsAcceptanceStep, "STAGING_WEB_URL", "Internal Ops Errors staging acceptance");
  assert(
    String(opsErrorsAcceptanceStep.env?.STAGING_WEB_URL ?? "").trim() === "${{ steps.resolve_staging_web_url.outputs.web_url }}",
    "Internal Ops Errors staging acceptance must use the resolved staging Web URL output.",
  );
  requireEnvVar(opsErrorsAcceptanceStep, "STAGING_SMOKE_WORKSPACE", "Internal Ops Errors staging acceptance");
  requireEnvVar(opsErrorsAcceptanceStep, "STAGING_SMOKE_USER", "Internal Ops Errors staging acceptance");
  requireEnvVar(opsErrorsAcceptanceStep, "STAGING_SMOKE_PASSWORD", "Internal Ops Errors staging acceptance");
  requireEnvVar(opsErrorsAcceptanceStep, "ERROR_AUTHORITY_INGEST_TOKEN", "Internal Ops Errors staging acceptance");
  requireEnvVar(opsErrorsAcceptanceStep, "ERROR_AUTHORITY_RELEASE", "Internal Ops Errors staging acceptance");
  requireEnvVar(opsErrorsAcceptanceStep, "OPS_ERRORS_ACCEPTANCE_OUTPUT", "Internal Ops Errors staging acceptance");
  requireRunContains(
    opsErrorsAcceptanceStep,
    "node scripts/staging-error-authority-ops-errors-acceptance.cjs",
    "Internal Ops Errors staging acceptance",
  );
  requireStepOrder(steps, "Staging post-deploy verification (auth + trust boundary)", "Internal Ops Errors staging acceptance");
  requireStepOrder(steps, "Internal Ops Errors staging acceptance", "Public signup smoke check");

  const publicSignupStep = requireStep(steps, "Public signup smoke check");
  requireEnvVar(publicSignupStep, "STAGING_BASE_URL", "Public signup smoke check");
  assert(
    String(publicSignupStep.env?.STAGING_BASE_URL ?? "").trim() === "${{ steps.resolve_staging_api_url.outputs.api_url }}",
    "Public signup smoke check must use the resolved staging API URL output.",
  );
  requireEnvVar(publicSignupStep, "STAGING_WEB_URL", "Public signup smoke check");
  requireEnvVar(publicSignupStep, "STAGING_EXPECT_PUBLIC_SIGNUP_ENABLED", "Public signup smoke check");
  requireEnvVar(publicSignupStep, "STAGING_EXPECTED_ENV", "Public signup smoke check");
  requireRunContains(publicSignupStep, "node scripts/staging-public-signup-check.cjs", "Public signup smoke check");
  requireStepOrder(steps, "Staging post-deploy verification (auth + trust boundary)", "Public signup smoke check");
  requireStepOrder(steps, "Public signup smoke check", "E2E smoke - post-deploy verification");

  const e2eSmokeStep = requireStep(steps, "E2E smoke - post-deploy verification");
  requireEnvVar(e2eSmokeStep, "STAGING_BASE_URL", "E2E smoke - post-deploy verification");
  assert(
    String(e2eSmokeStep.env?.STAGING_BASE_URL ?? "").trim() === "${{ steps.resolve_staging_api_url.outputs.api_url }}",
    "E2E smoke must use the resolved staging API URL output.",
  );
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
  assert(
    String(snapshotStep.env?.STAGING_BASE_URL ?? "").trim() === "${{ steps.resolve_staging_api_url.outputs.api_url }}",
    "Controlled rollout snapshot must use the resolved staging API URL output.",
  );
  requireEnvVar(snapshotStep, "STAGING_SMOKE_TENANT_ID", "Capture controlled rollout snapshot");
  requireEnvVar(snapshotStep, "STAGING_SMOKE_WORKSPACE", "Capture controlled rollout snapshot");
  requireEnvVar(snapshotStep, "STAGING_SMOKE_USER", "Capture controlled rollout snapshot");
  requireEnvVar(snapshotStep, "STAGING_SMOKE_PASSWORD", "Capture controlled rollout snapshot");
  requireRunContains(snapshotStep, "node scripts/capture-controlled-rollout-snapshot.cjs", "Capture controlled rollout snapshot");
  requireRunContains(snapshotStep, "--environment staging", "Capture controlled rollout snapshot");
  requireRunContains(snapshotStep, "--apiBase \"${STAGING_BASE_URL}/api/v1\"", "Capture controlled rollout snapshot");
  requireRunContains(snapshotStep, "--diagnosticOutputPath \".run-logs/queue-failure-diagnostics-${GITHUB_RUN_ID}.json\"", "Capture controlled rollout snapshot");

  const uploadStep = requireStep(steps, "Upload gate + rollout + smoke artifacts");
  assert(
    /^actions\/upload-artifact@v\d+$/.test(String(uploadStep.uses ?? "").trim()),
    "Upload step must use actions/upload-artifact",
  );
  const uploadWith = uploadStep.with ?? {};
  const uploadPath = String(uploadWith.path ?? "");
  assert(uploadPath.includes("docs/execution/gates/*.json"), "Upload step missing gate artifact path");
  assert(uploadPath.includes("docs/execution/rollout/*CONTROLLED_ROLLOUT_SNAPSHOT.json"), "Upload step missing rollout snapshot path");
  assert(uploadPath.includes(".run-logs/queue-failure-diagnostics-*.json"), "Upload step missing queue failure diagnostics path");
  assert(uploadPath.includes(".run-logs/internal-ops-errors-acceptance-*.json"), "Upload step missing Internal Ops Errors acceptance path");
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
          "push_to_main_autodeploy_trigger_present",
          "deploy_job_serialized_with_environment_protection",
          "migration_step_has_database_secret_guard",
          "observability_database_url_resolver_reads_github_secret_or_railway_api_variable",
          "observability_migration_step_has_secret_guard",
          "legacy_auth_hash_backfill_runs_before_builds",
          "railway_cli_install_step_present_before_deploy",
          "deploy_step_uses_checked_in_railway_script",
          "postdeploy_uses_live_resolved_web_url",
          "staging_smoke_checks_health_and_env",
          "postdeploy_verification_runs_workspace_scoped_trust_boundary_check",
          "postdeploy_verification_enables_non_admin_access_policy_smoke",
          "internal_ops_errors_acceptance_runs_with_live_api_web_and_masked_ingest_secret",
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
