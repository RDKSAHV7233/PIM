#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const IMPORTS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "operations", "imports", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(IMPORTS_PAGE, "utf8");

  assert(
    source.includes("Upload, validate, and start") &&
      source.includes("Stage 3 | Start import") &&
      source.includes("Stage 4 | Review result and repair rows"),
    "Operations imports must label the workflow as one upload/validate/start surface plus result/repair sections.",
  );
  assert(
    source.includes("Preflight creates the job in a queued state.") &&
      source.includes("Select an import job from Stage 3 to open the result summary"),
    "Operations imports must explain how operators move from validation into queued jobs and then into results and repair.",
  );
  assert(
    source.includes("Import result summary") &&
      source.includes("repair console remains available in the next section") &&
      source.includes("<CardTitle>Row Repair Console"),
    "Operations imports must keep repair discoverable from the result stage instead of hiding it behind a separate workflow.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "bulk_import_page_exposes_staged_operator_sections",
          "bulk_import_page_explains_handoff_from_preflight_to_jobs",
          "bulk_import_page_keeps_repair_discoverable_from_results",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

try {
  run();
} catch (error) {
  console.error("Bulk import staged workflow UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
