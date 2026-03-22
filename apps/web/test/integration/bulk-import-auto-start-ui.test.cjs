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
  const createIndex = source.indexOf('"/bulk-import/jobs"');
  const processIndex = source.indexOf("/bulk-import/jobs/${createdJob.id}/process");
  const redirectIndex = source.indexOf('redirect(`/operations/imports?bulkJobId=${encodeURIComponent(createdJob.id)}`)');

  assert(createIndex >= 0, "bulk import upload must create a job");
  assert(processIndex >= 0, "bulk import upload must start processing the created job");
  assert(processIndex > createIndex, "bulk import job processing must happen after job creation");
  assert(redirectIndex > processIndex, "bulk import upload must redirect only after process kickoff");

  console.log(JSON.stringify({
    status: "ok",
    validated: [
      "bulk_import_upload_creates_job",
      "bulk_import_upload_starts_processing",
      "bulk_import_upload_redirects_after_process_kickoff",
    ],
  }, null, 2));
} catch (error) {
  console.error("bulk-import-auto-start-ui integration test failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
