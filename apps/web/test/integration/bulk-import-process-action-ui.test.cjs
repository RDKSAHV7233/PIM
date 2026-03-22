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
  const start = actions.indexOf("export async function processBulkImportJobAction");
  const end = actions.indexOf("export async function requeueBulkImportDlqAction");

  assert(start >= 0, "processBulkImportJobAction must exist");
  assert(end > start, "processBulkImportJobAction slice must terminate before requeueBulkImportDlqAction");

  const source = actions.slice(start, end);

  assert(
    source.includes('const returnTo = resolveReturnToPath('),
    "process bulk import action must resolve a return path",
  );
  assert(
    source.includes('`/operations/imports?bulkJobId=${encodeURIComponent(jobId)}`'),
    "process bulk import action must fall back to the imports page for the current job",
  );
  assert(
    source.includes('revalidatePath("/operations/imports");'),
    "process bulk import action must revalidate the imports page",
  );
  assert(
    source.includes("redirect(returnTo);"),
    "process bulk import action must redirect back to the imports page after starting processing",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "process_bulk_import_action_resolves_return_path",
          "process_bulk_import_action_revalidates_imports_page",
          "process_bulk_import_action_redirects_after_submit",
        ],
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error("bulk-import-process-action-ui integration test failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
