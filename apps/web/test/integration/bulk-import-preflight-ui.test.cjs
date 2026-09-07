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
const UPLOAD_ROUTE = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "api",
  "bulk-import",
  "runs",
  "upload",
  "route.ts",
);
const RUN_VALIDATE_ROUTE = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "api",
  "bulk-import",
  "runs",
  "[runId]",
  "validate",
  "route.ts",
);
const API_CONTROLLER = path.join(
  REPO_ROOT,
  "apps",
  "api",
  "src",
  "bulk-import",
  "bulk-import.controller.ts",
);
const API_RUN_SERVICE = path.join(
  REPO_ROOT,
  "apps",
  "api",
  "src",
  "bulk-import",
  "bulk-import-run.service.ts",
);
const SERVER_ACTION = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "actions.ts",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const componentSource = fs.readFileSync(PREFLIGHT_COMPONENT, "utf8");
  const routeSource = fs.readFileSync(PREFLIGHT_ROUTE, "utf8");
  const uploadRouteSource = fs.readFileSync(UPLOAD_ROUTE, "utf8");
  const runValidateRouteSource = fs.readFileSync(RUN_VALIDATE_ROUTE, "utf8");
  const controllerSource = fs.readFileSync(API_CONTROLLER, "utf8");
  const runServiceSource = fs.readFileSync(API_RUN_SERVICE, "utf8");
  const serverActionSource = fs.readFileSync(SERVER_ACTION, "utf8");

  assert(
    componentSource.includes('fetch("/api/bulk-import/runs/upload"') &&
      (componentSource.includes('readCsrfCookie') || componentSource.includes('readCookie("pim_csrf_token")')) &&
      componentSource.includes('name="sourceFile"') &&
      componentSource.includes('aria-invalid={fieldErrors.sourceFile ? "true" : undefined}') &&
      componentSource.includes("Staged import workflow") &&
      componentSource.includes("Preflight readiness") &&
      componentSource.includes("Validation summary") &&
      componentSource.includes("Mapped fields:") &&
      componentSource.includes("Unmapped fields") &&
      componentSource.includes("Unused headers") &&
      componentSource.includes("Representative issues"),
    "Import preflight form must use multipart upload (not base64 JSON), keep file-field accessibility wiring, and show a validation summary before import starts.",
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
    routeSource.includes("ENDPOINT_DEPRECATED") &&
      routeSource.includes("410") &&
      routeSource.includes("staged upload flow"),
    "Legacy /api/bulk-import/validate route must return 410 Gone directing clients to the staged upload flow.",
  );

  // CTO audit: file input must be cleared after staging so the Server Action
  // never receives raw file bytes (stays under the 10 MB body limit).
  assert(
    componentSource.includes('input[type="file"]') &&
      componentSource.includes("fileInput.value"),
    "Import preflight form must clear the file input after staging to keep the Server Action request body small.",
  );

  // CTO audit: changing category must reset stagedRunId so stale staged runs
  // cannot be submitted against a different category.
  assert(
    componentSource.includes("resetValidationState") &&
      componentSource.includes("onChange={resetValidationState}"),
    "Import preflight form must reset validation state (including stagedRunId) when the category selection changes.",
  );

  // CTO audit: the Server Action must require stagedRunId and never accept raw files.
  const actionsSource = fs.readFileSync(
    path.join(REPO_ROOT, "apps", "web", "src", "app", "actions.ts"),
    "utf8",
  );
  assert(
    actionsSource.includes("stagedRunId") &&
      !actionsSource.includes("uploadBulkImportRun"),
    "Server Action createBulkImportJobAction must require stagedRunId and not contain a raw-file upload fallback.",
  );

  assert(
    componentSource.includes('id="bulk-import-file-guidance"') &&
      componentSource.includes("CSV or JSON only") &&
      componentSource.includes("Maximum upload size: 32 MB") &&
      componentSource.includes("staged validation"),
    "Import preflight form must show upload guidance near the file input with allowed types, size limit, and staged validation note.",
  );

  // ── Multipart upload flow regression tests ────────────────────────────────

  assert(
    !componentSource.includes("encodeBase64") &&
      !componentSource.includes("btoa("),
    "Component must not contain encodeBase64 or btoa — file content must never be base64-encoded into JSON.",
  );
  assert(
    !componentSource.includes("fileContentBase64"),
    "Component must not reference fileContentBase64 — large files must use multipart upload.",
  );
  assert(
    componentSource.includes('uploadForm.append("sourceFile"') &&
      componentSource.includes('uploadForm.append("categoryId"') &&
      componentSource.includes('uploadForm.append("sourceFormat"') &&
      componentSource.includes('uploadForm.append("sourceName"') &&
      componentSource.includes('uploadForm.append("maxRetries"'),
    "Multipart upload FormData must include sourceFile, categoryId, sourceFormat, sourceName, and maxRetries fields.",
  );
  assert(
    componentSource.includes('/api/bulk-import/runs/${encodeURIComponent(runId)}/validate'),
    "Component must validate the run after upload via /api/bulk-import/runs/:id/validate.",
  );
  assert(
    componentSource.includes('name="stagedRunId"') &&
      componentSource.includes("stagedRun.id") &&
      componentSource.includes('name="sourceFormat"') &&
      componentSource.includes("stagedRun?.sourceFormat"),
    "Component must pass stagedRunId and validated sourceFormat as hidden form fields so Start import reuses the validated run contract.",
  );
  assert(
    componentSource.includes("formatSampleIssue") &&
      componentSource.includes("Array.isArray(record.issues)") &&
      componentSource.includes("Validation issue found.") &&
      componentSource.includes("formatSampleIssue(issue)"),
    "Representative issue rows must render message/code text and legacy issue arrays without producing blank Row N output.",
  );
  assert(
    componentSource.includes('skuCode: "skuCode"') &&
      componentSource.includes("<code>skuCode</code>"),
    "Import preflight form must document and default to canonical skuCode, not the legacy sku alias.",
  );
  assert(
    componentSource.includes("serializeMapping(stagedRun?.preflightSummary?.mapping)") &&
      componentSource.includes('name="mapping" value={effectiveMapping}'),
    "Start import must submit the mapping returned by staged preflight so validation and job creation use the same inferred headers.",
  );

  // ── Upload route regression tests ─────────────────────────────────────────

  assert(
    uploadRouteSource.includes("validateCsrf(request)") &&
      uploadRouteSource.includes("resolveBearerToken(request)") &&
      uploadRouteSource.includes("request.arrayBuffer()") &&
      uploadRouteSource.includes("/bulk-import/runs/upload"),
    "Upload route must enforce CSRF, use bearer auth, and forward the raw multipart body to the API.",
  );

  // ── Run validate route regression tests ───────────────────────────────────

  assert(
    runValidateRouteSource.includes("validateCsrf(request)") &&
      runValidateRouteSource.includes("resolveBearerToken(request)") &&
      runValidateRouteSource.includes("/bulk-import/runs/"),
    "Run validate route must enforce CSRF and auth, and proxy to the API run validate endpoint.",
  );

  // ── Backend: multipart endpoint with size limit ───────────────────────────

  assert(
    controllerSource.includes('FileInterceptor("sourceFile"') &&
      controllerSource.includes("32 * 1024 * 1024"),
    "Backend must accept multipart upload via FileInterceptor on sourceFile with 32MB limit.",
  );

  // ── Backend: user-safe error for oversized files ──────────────────────────

  assert(
    runServiceSource.includes("File exceeds maximum allowed size") &&
      runServiceSource.includes("Uploaded file is empty"),
    "Backend must return user-safe errors for oversized and empty files.",
  );

  assert(
    runServiceSource.includes("readStagedSourceRows") &&
      runServiceSource.includes("parseJsonSourceRows") &&
      runServiceSource.includes("validateCanonicalRowForImport") &&
      runServiceSource.includes("JSON import file must contain an array of row objects."),
    "Backend staged validation must honor CSV/JSON sourceFormat and return canonical user-readable issue messages.",
  );

  // ── Backend: malformed CSV and bad attributes handled at row level ────────

  assert(
    runServiceSource.includes("CSV must include a header row and at least one data row") &&
      runServiceSource.includes("validateCanonicalRowForImport"),
    "Backend must detect malformed CSV (no headers/rows) and delegate missing required field checks to canonical row validation.",
  );

  // ── Backend: tenant isolation via prisma.tenant() ─────────────────────────

  assert(
    runServiceSource.includes("prisma.tenant().bulkImportRun.findUnique") &&
      runServiceSource.includes("Bulk import run not found"),
    "Backend must scope run lookups to the current tenant and return 404 for foreign runs.",
  );

  // ── Server action: Start import reuses validated run ──────────────────────

  assert(
    serverActionSource.includes("stagedRunId") &&
      (serverActionSource.includes("prestagedRunId") || serverActionSource.includes("linkedRunId")),
    "Server action must accept stagedRunId from the form and skip re-uploading when present.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "bulk_import_preflight_uses_multipart_upload_not_base64",
          "bulk_import_preflight_form_no_legacy_validate_endpoint",
          "bulk_import_preflight_form_gates_import_creation_on_preflight",
          "bulk_import_preflight_form_explains_blocking_state",
          "bulk_import_preflight_form_allows_warning_only_state",
          "bulk_import_preflight_form_handles_malformed_file_state",
          "bulk_import_legacy_validate_route_returns_410_gone",
          "bulk_import_preflight_clears_file_after_staging",
          "bulk_import_preflight_resets_staged_run_on_category_change",
          "server_action_requires_staged_run_id_no_raw_file_fallback",
          "upload_guidance_shows_types_size_and_staged_validation",
          "no_base64_encoding_in_component",
          "no_fileContentBase64_in_component",
          "multipart_formdata_fields_match_backend_dto",
          "validate_after_upload_flow",
          "staged_run_id_passed_to_start_import",
          "canonical_skuCode_mapping_and_guidance",
          "start_import_reuses_preflight_mapping",
          "upload_route_csrf_auth_multipart",
          "run_validate_route_csrf_auth",
          "backend_multipart_file_interceptor_32mb",
          "backend_user_safe_oversized_empty_errors",
          "backend_malformed_csv_row_validation",
          "backend_tenant_isolation",
          "server_action_reuses_staged_run",
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
