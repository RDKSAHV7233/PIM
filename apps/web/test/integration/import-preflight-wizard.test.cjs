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

  assert(
    importsPageSource.includes("validateImportPreflight") &&
      importsPageSource.includes('from "@/lib/api/imports"'),
    "Imports page must import the preflight client function validateImportPreflight from @/lib/api/imports.",
  );

  assert(
    importsClientSource.includes("export async function validateImportPreflight") &&
      importsClientSource.includes("ImportValidateRequest") &&
      importsClientSource.includes("ImportValidateResponse"),
    "imports.ts must export validateImportPreflight and define ImportValidateRequest/ImportValidateResponse types.",
  );

  assert(
    importsPageSource.includes('aria-label="Import wizard steps"') &&
      importsPageSource.includes("Upload & Pre-validate") &&
      importsPageSource.includes("Review Validation Summary") &&
      importsPageSource.includes("Start Import") &&
      importsPageSource.includes("Review Result & Repair"),
    "Imports page must contain a 4-step wizard indicator with all step labels.",
  );

  assert(
    importsPageSource.includes('data-wizard-step="validation-summary"') ||
      importsPageSource.includes("Validation Summary") ||
      importsPageSource.includes("blockingCount") ||
      importsPageSource.includes("Blocking issues"),
    "Imports page must contain a validation summary section for step 2 of the wizard.",
  );

  assert(
    importsPageSource.includes('aria-current={step === 1 ? "step" : undefined}'),
    "Import wizard step indicator must mark the current step with aria-current='step' for accessibility.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "imports_page_imports_preflight_client",
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
