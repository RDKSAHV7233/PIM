#!/usr/bin/env node
/* eslint-disable no-console */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT_PATH = path.join(REPO_ROOT, "scripts", "staging-connector-export-coverage.cjs");
const WORKFLOW_PATH = path.join(REPO_ROOT, ".github", "workflows", "res-02-connector-export-coverage.yml");
const CI_PATH = path.join(REPO_ROOT, ".github", "workflows", "ci.yml");

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

function requireEnv(step, name, label) {
  assert(Object.prototype.hasOwnProperty.call(step?.env ?? {}, name), `${label} missing env ${name}`);
}

function requireRunContains(step, fragment, label) {
  assert(String(step?.run ?? "").includes(fragment), `${label} missing run fragment: ${fragment}`);
}

function main() {
  assert(fs.existsSync(SCRIPT_PATH), "RES-02 staging runner is missing");
  assert(fs.existsSync(WORKFLOW_PATH), "RES-02 staging workflow is missing");

  const script = read("scripts/staging-connector-export-coverage.cjs");
  assert(script.includes("STAGING_BASE_URL"), "runner must use staging API URL env");
  assert(script.includes("STAGING_SMOKE_WORKSPACE"), "runner must use normal staging workspace auth");
  assert(script.includes("STAGING_SMOKE_USER"), "runner must use normal staging user auth");
  assert(script.includes("STAGING_SMOKE_PASSWORD"), "runner must use normal staging password auth");
  assert(script.includes("/connectors/installed?limit=200"), "runner must inventory installed connectors");
  assert(script.includes("/connectors/definitions"), "runner must inventory connector definitions");
  assert(script.includes("/marketplace/connectors/"), "runner must use marketplace connector routes");
  assert(script.includes("/bulk-publish"), "runner must exercise bulk-publish");
  assert(script.includes("/publish-readiness"), "runner must evaluate publish readiness");
  assert(script.includes("/marketplace/products/"), "runner must create single-product export jobs");
  assert(script.includes("/export-jobs/"), "runner must inspect export-job history");
  assert(script.includes("/requeue"), "runner must exercise retry when a failed job exists");
  assert(script.includes("no_eligible_products"), "runner must prove no_eligible_products rejection");
  // Bulk-Publish Goes Async (Story 8) retired the old size-based batch_too_large rejection —
  // the runner now proves a 51-product batch is evaluated on merits instead of being
  // rejected for size alone.
  assert(
    script.includes("verifyOversizedBatchNotRejectedBySizeAlone"),
    "runner must prove a 51-product batch is no longer rejected for size alone",
  );
  assert(script.includes("BLOCKED"), "runner must report unavailable real fixtures as BLOCKED");
  assert(!script.includes("DATABASE_URL"), "runner must not use direct database access");
  assert(!script.includes("PrismaClient"), "runner must not use Prisma/direct DB access");
  assert(!script.includes("postgresql://"), "runner must not embed database URLs");

  const workflow = YAML.parse(read(".github/workflows/res-02-connector-export-coverage.yml"));
  assert(workflow?.name === "RES-02 Connector Export Coverage", "unexpected RES-02 workflow name");
  assert(workflow?.on && Object.prototype.hasOwnProperty.call(workflow.on, "workflow_dispatch"), "workflow must be manual");
  assert(!Object.prototype.hasOwnProperty.call(workflow.on ?? {}, "schedule"), "workflow must not be scheduled");
  const job = workflow.jobs?.["res-02"];
  assert(job, "workflow missing res-02 job");
  assert(job.environment === "staging", "workflow must target staging environment");
  assert(job.permissions?.contents === "read", "workflow should only request contents: read");
  assert(
    workflow.concurrency?.["cancel-in-progress"] === false ||
      String(workflow.concurrency?.["cancel-in-progress"] ?? "").trim() === "false",
    "workflow must not cancel an in-flight evidence run",
  );
  const steps = Array.isArray(job.steps) ? job.steps : [];
  requireStep(steps, "Checkout");
  assert(!steps.some((step) => String(step?.name ?? "").trim() === "Install dependencies"), "RES-02 workflow must not install repo dependencies");
  assert(!steps.some((step) => String(step?.run ?? "").includes("npm ci")), "RES-02 workflow must not run npm ci");
  requireStep(steps, "Install Railway CLI");
  const resolveStep = requireStep(steps, "Resolve staging API URL");
  requireEnv(resolveStep, "RAILWAY_PROJECT_ID", "Resolve staging API URL");
  requireEnv(resolveStep, "FALLBACK_STAGING_API_URL", "Resolve staging API URL");
  requireRunContains(resolveStep, "node scripts/resolve-railway-service-url.cjs", "Resolve staging API URL");
  const runStep = requireStep(steps, "Run RES-02 staging connector/export coverage");
  for (const envName of [
    "STAGING_BASE_URL",
    "STAGING_SMOKE_WORKSPACE",
    "STAGING_SMOKE_USER",
    "STAGING_SMOKE_PASSWORD",
    "RES02_FAIL_ON_BLOCKED",
    "RES02_PROCESS_EXPORT_JOBS",
    "RES02_ALLOWED_CONNECTOR_SLUGS",
  ]) {
    requireEnv(runStep, envName, "Run RES-02 staging connector/export coverage");
  }
  requireRunContains(runStep, "node scripts/staging-connector-export-coverage.cjs", "Run RES-02 staging connector/export coverage");
  requireStep(steps, "Upload RES-02 artifacts");

  const ci = read(".github/workflows/ci.yml");
  assert(
    ci.includes("node scripts/staging-connector-export-coverage.test.cjs"),
    "CI must run RES-02 static contract test",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "normal_staging_auth",
          "no_direct_database_access",
          "connector_inventory",
          "bulk_publish_success_or_blocked_matrix",
          "no_eligible_products_path",
          "oversized_batch_not_size_rejected_path",
          "export_job_history_and_retry_path",
          "manual_staging_workflow",
          "artifact_upload",
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
