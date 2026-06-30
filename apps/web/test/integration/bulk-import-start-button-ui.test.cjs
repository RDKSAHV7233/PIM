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

  // --- Import assertions ---
  assert(
    page.includes("processBulkImportJobAction"),
    "imports page must import processBulkImportJobAction",
  );
  assert(
    page.includes("requeueBulkImportDlqAction"),
    "imports page must import requeueBulkImportDlqAction for dead-letter requeue",
  );

  // --- Per-status button assertions ---
  assert(
    page.includes('status === "queued"') && page.includes('idleLabel="Start import"'),
    "queued jobs must show 'Start import' button",
  );
  assert(
    page.includes('status === "retrying"') && page.includes('idleLabel="Resume import"'),
    "retrying jobs must show 'Resume import' button",
  );
  assert(
    page.includes('status === "dead_letter"') && page.includes('idleLabel="Requeue rows"'),
    "dead_letter jobs must show 'Requeue rows' button (not Resume)",
  );
  assert(
    page.includes('status === "processing"') && page.includes("In progress"),
    "processing jobs must show 'In progress' badge (no action button)",
  );
  assert(
    page.includes('status === "completed" ? "View result" : "View rows"'),
    "completed jobs show 'View result'; all others show 'View rows'",
  );

  // --- Resume import must appear exactly once (only for retrying) ---
  const resumeMatches = page.match(/Resume import/g);
  assert(
    resumeMatches && resumeMatches.length === 1,
    `'Resume import' must appear exactly once in the page (for retrying status), found ${resumeMatches ? resumeMatches.length : 0}`,
  );

  // --- requeueBulkImportDlqAction is wired to the dead_letter form ---
  assert(
    page.includes("requeueBulkImportDlqAction"),
    "dead_letter form must be wired to requeueBulkImportDlqAction",
  );

  // --- failed status has no action button (only View rows link) ---
  assert(
    !page.includes('status === "failed"'),
    "failed jobs must NOT have a dedicated action button (only the generic View rows link)",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "imports_process_action_imported",
          "requeue_dlq_action_imported",
          "queued_shows_start_import",
          "retrying_shows_resume_import",
          "dead_letter_shows_requeue_rows",
          "processing_shows_in_progress_badge",
          "completed_shows_view_result",
          "resume_import_appears_exactly_once",
          "failed_has_no_action_button",
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
