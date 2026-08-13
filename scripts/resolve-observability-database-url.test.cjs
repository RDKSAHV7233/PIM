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
  const script = read("scripts/resolve-observability-database-url.cjs");
  const deployScript = read("scripts/railway-deploy.cjs");
  const workflow = YAML.parse(read(".github/workflows/deploy-staging.yml"));
  const steps = workflow.jobs["deploy-staging"].steps;

  assert(script.includes("readRailwayVariablesAcrossServiceTargets"), "Resolver must read Railway service variables as fallback.");
  assert(
    /readRailwayVariablesAcrossServiceTargets,\s*\n/.test(deployScript),
    "railway-deploy.cjs must export readRailwayVariablesAcrossServiceTargets for the resolver.",
  );
  assert(script.includes("::add-mask::"), "Resolver must mask the resolved database URL.");
  assert(!script.includes("console.log(value)"), "Resolver must not print the raw database URL.");

  const resolveStep = requireStep(steps, "Resolve observability database URL");
  assert(String(resolveStep.id ?? "").trim() === "resolve_observability_database_url", "Resolver step id must be stable.");
  requireEnvVar(resolveStep, "OBSERVABILITY_DATABASE_URL", "Resolve observability database URL");
  requireEnvVar(resolveStep, "RAILWAY_PROJECT_ID", "Resolve observability database URL");
  requireEnvVar(resolveStep, "RAILWAY_API_SERVICE", "Resolve observability database URL");
  requireEnvVar(resolveStep, "RAILWAY_API_SERVICE_ID", "Resolve observability database URL");
  requireRunContains(resolveStep, "node scripts/resolve-observability-database-url.cjs", "Resolve observability database URL");

  const migrationStep = requireStep(steps, "Apply observability migrations");
  assert(
    String(migrationStep.env?.OBSERVABILITY_DATABASE_URL ?? "").trim() ===
      "${{ steps.resolve_observability_database_url.outputs.observability_database_url }}",
    "Apply observability migrations must use the masked resolver output.",
  );
  requireStepOrder(steps, "Apply migrations", "Resolve observability database URL");
  requireStepOrder(steps, "Resolve observability database URL", "Apply observability migrations");
  requireStepOrder(steps, "Apply observability migrations", "Build API");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "observability_url_resolver_masks_value",
          "resolver_falls_back_to_api_railway_service_variable",
          "workflow_uses_resolver_before_observability_migration",
          "migration_uses_resolved_output",
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
  console.error("Observability database URL resolver contract failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
