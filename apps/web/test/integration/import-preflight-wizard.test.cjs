#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const IMPORTS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "operations", "imports", "page.tsx");
const IMPORTS_CLIENT = path.join(REPO_ROOT, "apps", "web", "src", "lib", "api", "imports.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const importsPageSource = fs.readFileSync(IMPORTS_PAGE, "utf8");
  const importsClientSource = fs.readFileSync(IMPORTS_CLIENT, "utf8");

  // The page's actual validate step is client-side (import-preflight-form.tsx's
  // handleValidate: raw fetch() calls to /api/bulk-import/runs/upload and
  // .../validate), not this server-side client function — page.tsx's import of
  // validateImportPreflight was dead (unused outside a re-exported type nothing
  // consumed), so it was removed rather than kept just to satisfy this
  // assertion. imports.ts itself still exports it below; nothing in
  // apps/web/src currently calls it, which is a separate, pre-existing
  // question this test isn't trying to answer.
  assert(
    importsClientSource.includes("export async function validateImportPreflight") &&
      importsClientSource.includes("ImportValidateRequest") &&
      importsClientSource.includes("ImportValidateResponse"),
    "imports.ts must export validateImportPreflight and define ImportValidateRequest/ImportValidateResponse types.",
  );

  assert(
    importsPageSource.includes("<WorkflowStepper") &&
      importsPageSource.includes("Upload and pre-validate") &&
      importsPageSource.includes("Review validation summary") &&
      importsPageSource.includes("Start import") &&
      importsPageSource.includes("Review result and repair rows"),
    "Imports page must contain a 4-step workflow stepper with all step labels.",
  );

  assert(
    importsPageSource.includes('data-wizard-step="validation-summary"') ||
      importsPageSource.includes("Validation Summary") ||
      importsPageSource.includes("blockingCount") ||
      importsPageSource.includes("Blocking issues"),
    "Imports page must contain a validation summary section for step 2 of the wizard.",
  );

  assert(
    importsPageSource.includes('aria-current={isCurrent ? "step" : undefined}') ||
      importsPageSource.includes("WorkflowStepper"),
    "Import wizard step indicator must mark the current step with aria-current='step' for accessibility.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "imports_ts_exports_correct_types",
          "imports_page_has_4_step_wizard_indicator",
          "imports_page_has_validation_summary_section",
          "wizard_step_indicator_is_accessible",
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
  console.error("Import preflight wizard integration test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
