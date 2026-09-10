#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const IMPORTS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "operations", "imports", "page.tsx");
const PREFLIGHT_FORM = path.join(REPO_ROOT, "apps", "web", "src", "components", "operations", "import-preflight-form.tsx");
const ROLE_CAPABILITIES = path.join(REPO_ROOT, "apps", "web", "src", "lib", "role-capabilities.ts");
const SAMPLE_CSV_ROUTE = path.join(REPO_ROOT, "apps", "web", "src", "app", "api", "imports", "templates", "sample.csv", "route.ts");
const SAMPLE_JSON_ROUTE = path.join(REPO_ROOT, "apps", "web", "src", "app", "api", "imports", "templates", "sample.json", "route.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(IMPORTS_PAGE, "utf8");
  const preflightSource = fs.readFileSync(PREFLIGHT_FORM, "utf8");
  const roleSource = fs.readFileSync(ROLE_CAPABILITIES, "utf8");
  const sampleCsvSource = fs.readFileSync(SAMPLE_CSV_ROUTE, "utf8");
  const sampleJsonSource = fs.readFileSync(SAMPLE_JSON_ROUTE, "utf8");

  assert(
    source.includes('const normalized = String(value ?? "").trim().toLowerCase();') &&
      source.includes('if (!normalized) {') &&
      source.includes("return true;") &&
      source.includes('normalized === "false" || normalized === "0" || normalized === "off"'),
    "Operations imports must default hideTestData to true and only opt out on explicit false/0/off values.",
  );
  assert(
      source.includes("await getServerSession();") &&
      source.includes("const canWrite = canEditWorkspace(actorRole);"),
    "Operations imports must derive shared auth/session context and workspace write capability on the server.",
  );
  assert(
    roleSource.includes('return role === "admin" || role === "editor";') &&
      source.includes("canEditWorkspace(actorRole)"),
    "Operations imports must rely on the shared editor-capable workspace write rule.",
  );
  assert(
    source.includes("await Promise.allSettled([") &&
      source.includes("getBulkImportJobs({ role: actorRole, authHeader })") &&
      source.includes("getCachedCategoryTree({ all: true }, { role: actorRole, authHeader"),
    "Operations imports must load import jobs and categories together from the shared auth context.",
  );
  assert(
    source.includes("const filteredByData = filterTestData(jobs, hideTestData);") &&
      source.includes("selectedStatus.length > 0") &&
      source.includes("String(job.status).toLowerCase() === selectedStatus"),
    "Operations imports must filter test data first and then apply the normalized status filter.",
  );
  assert(
    source.includes("getBulkImportJobRows(selectedBulkJobId, undefined, 200, { role: actorRole, authHeader })") &&
      source.includes("selectedBulkJobId") &&
      (source.includes(": [];") || source.includes(": Promise.resolve(")),
    "Operations imports must only fetch row detail when a bulkJobId is selected.",
  );
  assert(
    source.includes("const buildImportsHref = (bulkJobId?: string) => {") &&
      source.includes('search.set("status", selectedStatus);') &&
      source.includes('search.set("hideTestData", "false");') &&
      source.includes('search.set("bulkJobId", bulkJobId);'),
    "Operations imports must preserve normalized filter scope when building job detail links.",
  );
  assert(
    source.includes("<RefreshOnInterval intervalMs={30_000} />") &&
      source.includes("<CardTitle>Operator import flow</CardTitle>") &&
      source.includes("Upload and pre-validate") &&
      source.includes("Review validation summary") &&
      source.includes("Start import") &&
      source.includes("Review result and repair rows") &&
      source.includes("<WorkflowStepper steps={operatorWorkflowSteps} />") &&
      source.includes("<ImportPreflightForm") &&
      source.includes("initialRun={selectedRun}") &&
      source.includes("submitAction={createBulkImportJobAction}") &&
      source.includes("form action={processBulkImportJobAction}") &&
      preflightSource.includes("Validate file") &&
      preflightSource.includes("Start validated import"),
    "Operations imports must auto-refresh, expose one strict four-step import workflow, restore selected run state, validate before upload, and wire both create/process actions through the current workflow.",
  );
  assert(
    source.includes('href="/api/imports/templates/sample.csv"') &&
      source.includes('href="/api/imports/templates/sample.json"') &&
      source.includes("const SAMPLE_JSON_PREVIEW = `["),
    "Operations imports must expose sample-file downloads and an inline JSON format example.",
  );
  assert(
    sampleCsvSource.includes('"title,skuCode,') &&
      sampleCsvSource.includes('"TEE-BLK-M"') &&
      sampleJsonSource.includes('skuCode: "TEE-BLK-M"'),
    "Downloadable CSV and JSON samples must include the required canonical skuCode field and a usable example value.",
  );
  assert(
    source.includes('!canEditWorkspace(actorRole)') &&
      source.includes('"No import jobs are visible for this scope."') &&
      source.includes('"No import jobs match this filter."') &&
      source.includes("Select an import job from Stage 3 to open the result summary") &&
      source.includes('redirect(buildLoginRedirect("/operations/imports", error));'),
    "Operations imports must differentiate viewer/read-write empty states and redirect auth failures through the shared login helper.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "operations_imports_route_normalizes_hide_test_data",
          "operations_imports_route_uses_shared_auth_and_workspace_write_capability",
          "operations_imports_route_fetches_jobs_and_categories_in_parallel",
          "operations_imports_route_filters_test_data_and_status_scope",
          "operations_imports_route_fetches_row_detail_only_for_selected_job",
          "operations_imports_route_preserves_filter_scope_in_job_links",
          "operations_imports_route_wires_preflight_create_and_process_server_actions",
          "operations_imports_route_exposes_sample_files_and_json_preview",
          "operations_import_samples_include_required_sku_code",
          "operations_imports_route_handles_empty_states_and_auth_redirects",
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
  console.error("Operations imports route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
