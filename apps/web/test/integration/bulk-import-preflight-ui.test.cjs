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
    componentSource.includes('fetch("/api/bulk-import/runs/upload"') &&
      !componentSource.includes("encodeBase64") &&
      !componentSource.includes('fetch("/api/bulk-import/validate"') &&
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
    routeSource.includes("validateCsrf(request)") &&
      routeSource.includes('resolveBearerToken(request)'),
    "Import preflight route must enforce CSRF and reuse the authenticated bearer token.",
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

  // CTO audit: Next.js upload proxy must forward the raw multipart body (preserving
  // the browser-generated boundary) instead of re-encoding via FormData.
  const uploadRouteSource = fs.readFileSync(
    path.join(REPO_ROOT, "apps", "web", "src", "app", "api", "bulk-import", "runs", "upload", "route.ts"),
    "utf8",
  );
  assert(
    !uploadRouteSource.includes("new FormData") &&
      uploadRouteSource.includes("request.arrayBuffer()") &&
      uploadRouteSource.includes('"Content-Type": contentType'),
    "Upload proxy must forward the raw body with the original Content-Type (preserving multipart boundary), not re-encode via FormData.",
  );
  assert(
    uploadRouteSource.includes("MAX_UPLOAD_BYTES") &&
      uploadRouteSource.includes("File too large"),
    "Upload proxy must enforce a size limit matching the API FileInterceptor (32 MB).",
  );

  // CTO audit: next.config must allow large request bodies through the proxy.
  const nextConfigSource = fs.readFileSync(
    path.join(REPO_ROOT, "apps", "web", "next.config.ts"),
    "utf8",
  );
  assert(
    nextConfigSource.includes("middlewareClientMaxBodySize"),
    "next.config.ts must set experimental.middlewareClientMaxBodySize to allow uploads larger than the default 10 MB limit.",
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
          "bulk_import_preflight_route_enforces_csrf_and_auth",
          "bulk_import_preflight_clears_file_after_staging",
          "bulk_import_preflight_resets_staged_run_on_category_change",
          "server_action_requires_staged_run_id_no_raw_file_fallback",
          "upload_proxy_forwards_raw_body_preserving_boundary",
          "upload_proxy_enforces_32mb_size_limit",
          "next_config_allows_large_body_through_proxy",
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
