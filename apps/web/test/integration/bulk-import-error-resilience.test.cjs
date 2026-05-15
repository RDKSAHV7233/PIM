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
  const nextConfig = read("apps/web/next.config.ts");

  // --- createBulkImportJobAction: process call must be guarded ---
  const createStart = actions.indexOf("export async function createBulkImportJobAction");
  const createEnd = actions.indexOf("export async function createBulkImportTemplateAction");
  assert(createStart >= 0, "createBulkImportJobAction must exist");
  const createSource = actions.slice(createStart, createEnd);

  // The process POST must be inside a try block
  const createTryIdx = createSource.indexOf("try {");
  const createProcessIdx = createSource.indexOf('`/bulk-import/jobs/${createdJob.id}/process`');
  assert(createTryIdx >= 0, "createBulkImportJobAction must wrap the process call in try/catch");
  assert(createProcessIdx >= 0, "createBulkImportJobAction must call the process endpoint");
  assert(
    createProcessIdx > createTryIdx,
    "createBulkImportJobAction: process call must appear after the try { block",
  );
  // redirect must be outside the try (always runs)
  const createRedirectIdx = createSource.indexOf(
    'redirect(`/operations/imports?bulkJobId=${encodeURIComponent(createdJob.id)}`)',
  );
  assert(createRedirectIdx > createProcessIdx, "createBulkImportJobAction: redirect must follow the process call");
  const catchIdx = createSource.indexOf("} catch {", createTryIdx);
  assert(catchIdx > 0 && catchIdx < createRedirectIdx, "createBulkImportJobAction: catch block must precede the redirect");

  // --- processBulkImportJobAction: process call must be guarded ---
  const processStart = actions.indexOf("export async function processBulkImportJobAction");
  const processEnd = actions.indexOf("export async function requeueBulkImportDlqAction");
  assert(processStart >= 0, "processBulkImportJobAction must exist");
  const processSource = actions.slice(processStart, processEnd);

  const procTryIdx = processSource.indexOf("try {");
  const procCallIdx = processSource.indexOf("`/bulk-import/jobs/${jobId}/process`");
  assert(procTryIdx >= 0, "processBulkImportJobAction must wrap the process call in try/catch");
  assert(procCallIdx >= 0, "processBulkImportJobAction must call the process endpoint");
  assert(
    procCallIdx > procTryIdx,
    "processBulkImportJobAction: process call must appear after the try { block",
  );
  const procCatchIdx = processSource.indexOf("} catch {", procTryIdx);
  assert(procCatchIdx > 0, "processBulkImportJobAction: catch block must exist");
  // redirect must still fire (outside the try)
  const procRedirectIdx = processSource.indexOf("redirect(returnTo);");
  assert(procRedirectIdx > procCatchIdx, "processBulkImportJobAction: redirect must be outside the catch block");

  // --- next.config.ts: body limit must accommodate files up to the API's 8 MB cap ---
  assert(
    nextConfig.includes("bodySizeLimit"),
    "next.config.ts must set serverActions.bodySizeLimit",
  );
  const limitMatch = nextConfig.match(/bodySizeLimit:\s*"(\d+)(mb|kb)"/i);
  assert(limitMatch, "serverActions.bodySizeLimit must be a quoted byte string like \"10mb\"");
  const limitValue = Number(limitMatch[1]);
  const limitUnit = limitMatch[2].toLowerCase();
  const limitMb = limitUnit === "kb" ? limitValue / 1024 : limitValue;
  assert(
    limitMb >= 8,
    `serverActions.bodySizeLimit must be at least 8mb to match the API's MAX_SOURCE_BYTES; got ${limitMatch[0]}`,
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "create_bulk_import_action_process_call_is_guarded",
          "create_bulk_import_action_redirect_always_fires",
          "process_bulk_import_action_process_call_is_guarded",
          "process_bulk_import_action_redirect_always_fires",
          "next_config_body_limit_accommodates_api_max_source_size",
        ],
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error("bulk-import-error-resilience test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
