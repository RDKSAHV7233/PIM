#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  const actions = read("apps/web/src/app/actions.ts");
  const createStart = actions.indexOf("export async function createBulkImportJobAction");
  const createEnd = actions.indexOf("export async function createBulkImportTemplateAction");
  assert(createStart >= 0, "createBulkImportJobAction must exist");
  assert(createEnd > createStart, "createBulkImportJobAction slice must terminate before createBulkImportTemplateAction");

  const source = actions.slice(createStart, createEnd);
  const uploadRunIndex = source.indexOf("uploadBulkImportRun(");
  const validateRunIndex = source.indexOf("validateBulkImportRun(");
  const startRunIndex = source.indexOf("startBulkImportRun(");
  const runRedirectIndex = source.indexOf('redirect(`/operations/imports?bulkRunId=${encodeURIComponent(validatedRun.id)}`)');
  const blockedStandardIndex = source.indexOf('if (validatedRun.status !== "preflight_ready")');
  const createIndex = source.indexOf('"/bulk-import/jobs"');
  const processIndex = source.indexOf("/bulk-import/jobs/${createdJob.id}/process");
  const redirectIndex = source.indexOf('redirect(`/operations/imports?bulkJobId=${encodeURIComponent(createdJob.id)}`)');

  assert(uploadRunIndex >= 0, "CSV uploads must create a staged bulk import run before deciding standard vs large mode");
  assert(validateRunIndex > uploadRunIndex, "Bulk import run validation must happen after staged upload");
  assert(startRunIndex > validateRunIndex, "Large import runs must start only after validation");
  assert(runRedirectIndex > validateRunIndex, "Large import mode must redirect to the parent run view");
  assert(blockedStandardIndex > validateRunIndex, "CSV imports must stop when pre-validation is not ready");
  assert(createIndex >= 0, "standard bulk import path must still create a job");
  assert(source.includes("runId: linkedRunId"), "standard bulk import jobs must link back to their staged preflight run");
  assert(processIndex >= 0, "standard bulk import path must still start processing the created job");
  assert(processIndex > createIndex, "standard bulk import job processing must happen after job creation");
  assert(redirectIndex > processIndex, "standard bulk import upload must redirect only after process kickoff");

  console.log(JSON.stringify({
    status: "ok",
    validated: [
      "csv_uploads_stage_and_validate_bulk_import_runs",
      "large_import_runs_start_after_validation",
      "large_import_runs_redirect_to_parent_run",
      "blocked_csv_preflight_stops_standard_processing",
      "standard_bulk_import_jobs_link_to_staged_runs",
      "standard_bulk_import_upload_still_creates_job",
      "standard_bulk_import_upload_still_starts_processing",
      "standard_bulk_import_upload_redirects_after_process_kickoff",
    ],
  }, null, 2));
} catch (error) {
  console.error("bulk-import-auto-start-ui integration test failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
