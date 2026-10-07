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
  "sellable-sku-variantless-production-audit.yml",
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

function main() {
  assert(fs.existsSync(workflowPath), `Workflow not found: ${workflowPath}`);
  const workflow = YAML.parse(fs.readFileSync(workflowPath, "utf8"));
  assert(workflow?.name === "Sellable SKU Variant-less Production Audit", "Unexpected workflow name");
  assert(workflow?.on && Object.prototype.hasOwnProperty.call(workflow.on, "workflow_dispatch"), "Workflow must be manual only");

  const job = workflow.jobs?.["sellable-sku-variantless-production-audit"];
  assert(job, "Missing sellable-sku-variantless-production-audit job");
  assert(job.environment === "production", "Production audit must target GitHub environment=production");
  assert(job.concurrency?.group === "sellable-sku-variantless-production-audit", "Workflow must serialize production audits");
  assert(job.concurrency?.["cancel-in-progress"] === false, "Workflow must not cancel an in-flight audit");

  const steps = job.steps ?? [];
  requireStep(steps, "Checkout");
  requireStep(steps, "Setup Node");
  requireStep(steps, "Install dependencies");
  requireStep(steps, "Generate Prisma client");

  const reportStep = requireStep(steps, "Run read-only sellable-SKU variant-less audit report");
  assert(
    reportStep.env?.REPORTER_DATABASE_URL === "${{ secrets.PRODUCTION_REPORTER_DATABASE_URL }}",
    "REPORTER_DATABASE_URL must map ONLY the PRODUCTION_REPORTER_DATABASE_URL secret (7.9c opt-in); a blank secret keeps the script on DATABASE_URL",
  );
  assert(
    /\[ -z "\$\{DATABASE_URL\}" \] && \[ -z "\$\{REPORTER_DATABASE_URL\}" \]/.test(String(reportStep.run ?? "")),
    "The missing-secret guard must fail closed only when BOTH the fallback and the dedicated credential are absent",
  );
  assert(reportStep.env?.DATABASE_URL === "${{ secrets.STAGE3_DATABASE_URL }}", "Report must use protected STAGE3_DATABASE_URL secret");
  const reportRun = String(reportStep.run ?? "");
  assert(reportRun.includes("Missing STAGE3_DATABASE_URL secret"), "Report step must fail closed when production DB secret is absent");
  assert(reportRun.includes("node scripts/sellable-sku-variantless-audit-report.cjs"), "Report step must run the read-only audit script");
  assert(reportRun.includes("--target-environment production"), "Report step must mark target environment as production");

  const artifactStep = requireStep(steps, "Upload report artifact");
  assert(String(artifactStep.with?.name ?? "").includes("sellable-sku-variantless-production-audit"), "Artifact name must identify the production audit");
  assert(
    String(artifactStep.with?.path ?? "") === ".run-logs/sellable-sku-variantless-production-audit.json",
    "Artifact path must match the report output path",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        workflow: ".github/workflows/sellable-sku-variantless-production-audit.yml",
        validated: [
          "manual_dispatch_only",
          "production_environment_gate",
          "serialized_audits",
          "stage3_database_secret_required",
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
