#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const REPO_ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

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
  assert(Object.prototype.hasOwnProperty.call(step?.env ?? {}, name), `${label} missing env var ${name}`);
}

function requireRunContains(step, fragment, label) {
  assert(String(step?.run ?? "").includes(fragment), `${label} missing run fragment: ${fragment}`);
}

function main() {
  const workflow = YAML.parse(read(".github/workflows/deploy-staging.yml"));
  const steps = workflow.jobs["deploy-staging"].steps;
  const script = read("scripts/staging-error-authority-ops-errors-acceptance.cjs");

  const observabilityMigration = requireStep(steps, "Apply observability migrations");
  requireEnvVar(observabilityMigration, "OBSERVABILITY_DATABASE_URL", "Apply observability migrations");
  requireRunContains(observabilityMigration, "npm run prisma:migrate:deploy --workspace @pim1/observability-db", "Apply observability migrations");
  requireRunContains(observabilityMigration, "Missing OBSERVABILITY_DATABASE_URL secret for Error Authority migrations.", "Apply observability migrations");
  requireStepOrder(steps, "Apply migrations", "Apply observability migrations");
  requireStepOrder(steps, "Apply observability migrations", "Build API");

  const acceptance = requireStep(steps, "Internal Ops Errors staging acceptance");
  requireEnvVar(acceptance, "STAGING_BASE_URL", "Internal Ops Errors staging acceptance");
  requireEnvVar(acceptance, "STAGING_WEB_URL", "Internal Ops Errors staging acceptance");
  requireEnvVar(acceptance, "STAGING_SMOKE_WORKSPACE", "Internal Ops Errors staging acceptance");
  requireEnvVar(acceptance, "STAGING_SMOKE_USER", "Internal Ops Errors staging acceptance");
  requireEnvVar(acceptance, "STAGING_SMOKE_PASSWORD", "Internal Ops Errors staging acceptance");
  requireEnvVar(acceptance, "ERROR_AUTHORITY_INGEST_TOKEN", "Internal Ops Errors staging acceptance");
  requireEnvVar(acceptance, "ERROR_AUTHORITY_RELEASE", "Internal Ops Errors staging acceptance");
  requireRunContains(acceptance, "node scripts/staging-error-authority-ops-errors-acceptance.cjs", "Internal Ops Errors staging acceptance");
  requireStepOrder(steps, "Staging post-deploy verification (auth + trust boundary)", "Internal Ops Errors staging acceptance");
  requireStepOrder(steps, "Internal Ops Errors staging acceptance", "Public signup smoke check");

  const upload = requireStep(steps, "Upload gate + rollout + smoke artifacts");
  assert(
    String(upload.with?.path ?? "").includes(".run-logs/internal-ops-errors-acceptance-*.json"),
    "Upload artifacts step must include internal ops errors acceptance evidence.",
  );

  assert(script.includes('requireEnv("ERROR_AUTHORITY_INGEST_TOKEN")'), "Acceptance script must fail closed when ingest token is absent.");
  assert(script.includes("/error-authority/ingest/next-server"), "Acceptance script must create a controlled real Error Authority event.");
  assert(script.includes("/error-authority/ops/issues"), "Acceptance script must verify ops issue reads.");
  assert(script.includes("/internal/ops/errors"), "Acceptance script must verify the Web console route.");
  assert(script.includes("createTemporaryViewer"), "Acceptance script must verify non-admin denial with a real temporary viewer.");
  assert(script.includes("findProhibitedKeys"), "Acceptance script must verify prohibited fields are absent.");
  assert(!script.includes("OBSERVABILITY_DATABASE_URL"), "Acceptance script must not receive or print the observability DB URL.");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "observability_migration_runs_before_build",
          "ops_errors_acceptance_runs_after_postdeploy",
          "acceptance_uses_staging_api_and_web_urls",
          "acceptance_uses_masked_ingest_secret",
          "acceptance_creates_real_controlled_event",
          "acceptance_checks_admin_visibility",
          "acceptance_checks_non_admin_denial",
          "acceptance_artifact_uploaded",
          "acceptance_does_not_use_observability_db_url",
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
  console.error("Internal Ops Errors staging acceptance contract failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
