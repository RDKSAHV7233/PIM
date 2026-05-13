#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PREFLIGHT_COMPONENT = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "components",
  "operations",
  "import-preflight-form.tsx",
);
const PREFLIGHT_ROUTE = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "api",
  "bulk-import",
  "validate",
  "route.ts",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const componentSource = fs.readFileSync(PREFLIGHT_COMPONENT, "utf8");
  const routeSource = fs.readFileSync(PREFLIGHT_ROUTE, "utf8");

  assert(
    componentSource.includes('fetch("/api/bulk-import/validate"') &&
      componentSource.includes('readCookie("pim_csrf_token")') &&
      componentSource.includes('name="sourceFile"') &&
      componentSource.includes('aria-invalid={fieldErrors.sourceFile ? "true" : undefined}') &&
      componentSource.includes("Staged import workflow") &&
      componentSource.includes("Preflight readiness") &&
      componentSource.includes("Validation summary") &&
      componentSource.includes("Mapped fields:") &&
      componentSource.includes("Unmapped fields") &&
      componentSource.includes("Unused headers") &&
      componentSource.includes("Representative issues"),
    "Import preflight form must validate through the same-origin route, keep file-field accessibility wiring, and show a validation summary before import starts.",
  );
  assert(
    componentSource.includes('idleLabel={validation?.canImport ? "Start validated import" : "Validate before importing"}') &&
      componentSource.includes('disabled={!hasCategories || validating || !validation?.canImport}') &&
      componentSource.includes('title={') &&
      componentSource.includes("Resolve the blocking issues below before creating the import job."),
    "Import preflight form must gate job creation on preflight status and explain whether the file is ready to import.",
  );
  assert(
    componentSource.includes("Start import is disabled") &&
      componentSource.includes("Clear those issues before starting the import job."),
    "Import preflight form must explain why Stage 3 remains disabled when preflight finds blocking issues.",
  );
  assert(
    componentSource.includes("Warnings reviewed: import can continue") &&
      componentSource.includes("The file can still be imported, but review the warning context below before you start the job."),
    "Import preflight form must allow warning-only preflight outcomes while keeping the warning context explicit.",
  );
  assert(
    componentSource.includes("Check file format") &&
      componentSource.includes("Upload only <code>.csv</code> or <code>.json</code> source files.") &&
      componentSource.includes("JSON files must contain an array of row objects."),
    "Import preflight form must render a useful malformed-file state instead of a generic validation failure.",
  );
  assert(
    routeSource.includes("validateCsrf(request)") &&
      routeSource.includes('resolveBearerToken(request)') &&
      routeSource.includes('fetch(`${getApiBaseUrl()}/bulk-import/validate`') &&
      routeSource.includes('"Content-Type": "application/json"'),
    "Import preflight route must enforce CSRF, reuse the authenticated bearer token, and proxy the validation request to the API.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "bulk_import_preflight_form_uses_same_origin_validation_route",
          "bulk_import_preflight_form_gates_import_creation_on_preflight",
          "bulk_import_preflight_form_explains_blocking_state",
          "bulk_import_preflight_form_allows_warning_only_state",
          "bulk_import_preflight_form_handles_malformed_file_state",
          "bulk_import_preflight_route_enforces_csrf_and_auth",
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
  console.error("Bulk import preflight UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
