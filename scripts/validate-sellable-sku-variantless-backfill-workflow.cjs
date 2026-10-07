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
  "sellable-sku-variantless-backfill.yml",
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
  assert(workflow?.name === "Sellable SKU Variant-less Historical Backfill", "Unexpected workflow name");
  assert(workflow?.on && Object.prototype.hasOwnProperty.call(workflow.on, "workflow_dispatch"), "Workflow must be manual only");

  const confirmInput = workflow.on.workflow_dispatch?.inputs?.confirm;
  assert(confirmInput, "Workflow must declare a workflow_dispatch 'confirm' input");
  assert(confirmInput.required === true, "'confirm' input must be required — no silent default write path");
  assert(confirmInput.default === "false", "'confirm' input must default to \"false\" (dry run)");

  const job = workflow.jobs?.["sellable-sku-variantless-backfill"];
  assert(job, "Missing sellable-sku-variantless-backfill job");
  assert(job.environment === "production", "Backfill must target GitHub environment=production");
  assert(job.concurrency?.group === "sellable-sku-variantless-backfill", "Workflow must serialize backfill runs");
  assert(job.concurrency?.["cancel-in-progress"] === false, "Workflow must not cancel an in-flight backfill");
  assert(
    job.env?.CONFIRM_SELLABLE_SKU_BACKFILL === "${{ github.event.inputs.confirm }}",
    "CONFIRM_SELLABLE_SKU_BACKFILL env var must be wired to the confirm input, not hardcoded",
  );

  const steps = job.steps ?? [];
  requireStep(steps, "Checkout");
  requireStep(steps, "Setup Node");
  requireStep(steps, "Install dependencies");
  requireStep(steps, "Generate Prisma client");

  const backfillStep = requireStep(steps, "Run sellable-SKU variant-less backfill");
  assert(
    backfillStep.env?.OPS_DATABASE_URL === "${{ secrets.PRODUCTION_OPS_DATABASE_URL }}",
    "OPS_DATABASE_URL must map ONLY the PRODUCTION_OPS_DATABASE_URL secret (7.9c opt-in); a blank secret keeps the script on DATABASE_URL",
  );
  assert(
    /\[ -z "\$\{DATABASE_URL\}" \] && \[ -z "\$\{OPS_DATABASE_URL\}" \]/.test(String(backfillStep.run ?? "")),
    "The missing-secret guard must fail closed only when BOTH the fallback and the dedicated credential are absent",
  );
  assert(backfillStep.env?.DATABASE_URL === "${{ secrets.STAGE3_DATABASE_URL }}", "Backfill must use protected STAGE3_DATABASE_URL secret");
  const backfillRun = String(backfillStep.run ?? "");
  assert(backfillRun.includes("Missing STAGE3_DATABASE_URL secret"), "Backfill step must fail closed when production DB secret is absent");
  assert(backfillRun.includes("node scripts/sellable-sku-variantless-backfill.cjs"), "Backfill step must run the backfill script");
  assert(
    backfillRun.includes('if [ "${CONFIRM_SELLABLE_SKU_BACKFILL}" = "true" ]'),
    "Backfill step must branch on an exact \"true\" match before ever passing --confirm",
  );
  assert(backfillRun.includes("--confirm"), "Backfill step must have a real-write branch that passes --confirm");
  assert(backfillRun.includes("Dry run"), "Backfill step must have an explicit dry-run branch, not just a real-write path");

  const artifactStep = requireStep(steps, "Upload report artifact");
  assert(String(artifactStep.with?.name ?? "").includes("sellable-sku-variantless-backfill"), "Artifact name must identify the backfill run");
  assert(
    String(artifactStep.with?.path ?? "") === ".run-logs/sellable-sku-variantless-backfill-report.json",
    "Artifact path must match the report output path",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        workflow: ".github/workflows/sellable-sku-variantless-backfill.yml",
        validated: [
          "manual_dispatch_only",
          "confirm_input_required_defaults_false",
          "production_environment_gate",
          "serialized_runs",
          "confirm_env_var_wired_to_input_not_hardcoded",
          "stage3_database_secret_required",
          "dry_run_and_confirm_branches_both_present",
          "backfill_report_artifact_uploaded",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

main();
