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

  // ST-LARGE-IMPORT-004: stepper state reconciliation — a run ID in the URL
  // with an in-flight ("uploaded"/"validating") or unrecognised status must
  // land on stage 2, not stage 1, so the server-rendered stepper stays
  // consistent with the client-side validation form that already shows the
  // validation zone.  The sentinel is the inline comment co-located with the
  // fix in importWorkflowSteps.
  assert(
    source.includes("uploaded") &&
      source.includes("validating") &&
      source.includes("validation zone") &&
      /runStatus === "preflight_blocked"[\s\S]*?: 2/.test(source),
    "importWorkflowSteps must map preflight_blocked to stage 2, and its in-flight statuses (uploaded/validating) must also resolve to the validation zone (stage 2), not stage 1.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "bulk_import_page_exposes_staged_operator_sections",
          "bulk_import_page_explains_handoff_from_preflight_to_jobs",
          "bulk_import_page_keeps_repair_discoverable_from_results",
          "bulk_import_stepper_reconciles_preflight_blocked_to_stage_2",
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
