#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const workflowPath = path.join(
  __dirname,
  "..",
  ".github",
  "workflows",
  "media-integrity-production-confirmation.yml",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function stepIndex(steps, name) {
  return steps.findIndex((step) => String(step?.name ?? "").trim() === name);
}

function requireStep(steps, name) {
  const index = stepIndex(steps, name);
  assert(index >= 0, `Missing workflow step: ${name}`);
  return steps[index];
}

function assertBefore(steps, first, second) {
  const firstIndex = stepIndex(steps, first);
  const secondIndex = stepIndex(steps, second);
  assert(firstIndex >= 0, `Missing workflow step: ${first}`);
  assert(secondIndex >= 0, `Missing workflow step: ${second}`);
  assert(firstIndex < secondIndex, `${first} must run before ${second}`);
}

function main() {
  assert(fs.existsSync(workflowPath), `Workflow not found: ${workflowPath}`);
  const workflow = YAML.parse(fs.readFileSync(workflowPath, "utf8"));
  assert(workflow?.name === "Media Integrity Production Confirmation", "Unexpected workflow name");
  assert(workflow?.on && Object.prototype.hasOwnProperty.call(workflow.on, "workflow_dispatch"), "Workflow must be manual only");

  const job = workflow.jobs?.["media-integrity-production-confirmation"];
  assert(job, "Missing media-integrity-production-confirmation job");
  assert(job.environment === "production", "Production confirmation must target GitHub environment=production");
  assert(job.concurrency?.group === "media-integrity-production-confirmation", "Workflow must serialize production confirmations");
  assert(job.concurrency?.["cancel-in-progress"] === false, "Workflow must not cancel an in-flight confirmation");

  const steps = job.steps ?? [];
  requireStep(steps, "Checkout");
  requireStep(steps, "Setup Node");
  const redisStep = requireStep(steps, "Install system redis-server (for redis-memory-server)");
  assert(String(redisStep.run ?? "").includes("apt-get install -y redis-server"), "Redis guard must install system redis-server");
  assert(String(redisStep.run ?? "").includes("REDISMS_SYSTEM_BINARY"), "Redis guard must export REDISMS_SYSTEM_BINARY");
  requireStep(steps, "Install dependencies");
  assertBefore(steps, "Install system redis-server (for redis-memory-server)", "Install dependencies");

  const reportStep = requireStep(steps, "Run read-only media integrity report");
  assert(
    reportStep.env?.REPORTER_DATABASE_URL === "${{ secrets.PRODUCTION_REPORTER_DATABASE_URL }}",
    "REPORTER_DATABASE_URL must map ONLY the PRODUCTION_REPORTER_DATABASE_URL secret (7.9c opt-in); a blank secret keeps the script on DATABASE_URL",
  );
  assert(
    /\[ -z "\$\{DATABASE_URL\}" \] && \[ -z "\$\{REPORTER_DATABASE_URL\}" \]/.test(String(reportStep.run ?? "")),
    "The missing-secret guard must fail closed only when BOTH the fallback and the dedicated credential are absent",
  );
  assert(reportStep.env?.DATABASE_URL === "${{ secrets.STAGE3_DATABASE_URL }}", "Report must use protected STAGE3_DATABASE_URL secret");
  assert(reportStep.env?.MEDIA_INTEGRITY_VERIFY_LOCAL_FILES === "false", "Production workflow must not probe local runner files");
  const reportRun = String(reportStep.run ?? "");
  assert(reportRun.includes("Missing STAGE3_DATABASE_URL secret"), "Report step must fail closed when production DB secret is absent");
  assert(reportRun.includes("node scripts/media-integrity-readonly-report.cjs"), "Report step must run the read-only media integrity script");
  assert(reportRun.includes("--target-environment production"), "Report step must mark target environment as production");

  const artifactStep = requireStep(steps, "Upload report artifact");
  assert(String(artifactStep.with?.name ?? "").includes("media-integrity-production-confirmation"), "Artifact name must identify production confirmation");
  assert(
    String(artifactStep.with?.path ?? "") === ".run-logs/media-integrity-production-confirmation.json",
    "Artifact path must match the report output path",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        workflow: ".github/workflows/media-integrity-production-confirmation.yml",
        validated: [
          "manual_dispatch_only",
          "production_environment_gate",
          "serialized_confirmations",
          "system_redis_guard_before_npm_ci",
          "stage3_database_secret_required",
          "local_file_probe_disabled",
          "read_only_report_command",
          "production_report_artifact_uploaded",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

main();
