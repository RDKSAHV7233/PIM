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
  const page = read("apps/web/src/app/operations/imports/page.tsx");

  assert(
    page.includes('import { createBulkImportJobAction, processBulkImportJobAction } from "@/app/actions";'),
    "imports page must import processBulkImportJobAction",
  );
  assert(
    page.includes('canWrite && String(job.status).toLowerCase() === "queued"'),
    "imports page must gate Start import to writable queued jobs",
  );
  assert(
    page.includes('<form action={processBulkImportJobAction}>'),
    "imports page must render a Start import form wired to processBulkImportJobAction",
  );
  assert(
    page.includes('<input type="hidden" name="jobId" value={job.id} />'),
    "Start import form must submit the bulk import job id",
  );
  assert(
    page.includes('<input type="hidden" name="chunkSize" value={job.chunkSize} />'),
    "Start import form must submit the current chunk size",
  );
  assert(
    page.includes('<input type="hidden" name="returnTo" value={buildImportsHref(job.id)} />'),
    "Start import form must submit a returnTo path so the imports page visibly refreshes after processing starts",
  );
  assert(
    page.includes("Start import"),
    "imports page must expose Start import button text",
  );
  assert(
    page.includes("View rows"),
    "imports page must retain the View rows action",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "imports_page_imports_process_action",
          "queued_jobs_render_start_import_button",
          "start_import_submits_job_id_and_chunk_size",
          "start_import_submits_return_path",
          "view_rows_action_retained",
        ],
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error("bulk-import-start-button-ui integration test failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
