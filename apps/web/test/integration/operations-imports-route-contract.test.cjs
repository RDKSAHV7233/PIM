#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const IMPORTS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "operations", "imports", "page.tsx");
const ROLE_CAPABILITIES = path.join(REPO_ROOT, "apps", "web", "src", "lib", "role-capabilities.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(IMPORTS_PAGE, "utf8");
  const roleSource = fs.readFileSync(ROLE_CAPABILITIES, "utf8");

  assert(
    source.includes('const normalized = String(value ?? "").trim().toLowerCase();') &&
      source.includes('if (!normalized) {') &&
      source.includes("return true;") &&
      source.includes('normalized === "false" || normalized === "0" || normalized === "off"'),
    "Operations imports must default hideTestData to true and only opt out on explicit false/0/off values.",
  );
  assert(
    source.includes("const authHeader = await getServerAuthHeader();") &&
      source.includes("const actorRole = await getServerActorRole();") &&
      source.includes("const canWrite = canEditWorkspace(actorRole);"),
    "Operations imports must derive shared auth/session context and workspace write capability on the server.",
  );
  assert(
    roleSource.includes('return role === "admin" || role === "editor";') &&
      source.includes("canEditWorkspace(actorRole)"),
    "Operations imports must rely on the shared editor-capable workspace write rule.",
  );
  assert(
    source.includes("const [jobs, categories] = await Promise.all([") &&
      source.includes("getBulkImportJobs({ role: actorRole, authHeader })") &&
      source.includes("getCategoryTree({ all: true }, { role: actorRole, authHeader })"),
    "Operations imports must load import jobs and categories together from the shared auth context.",
  );
  assert(
    source.includes("const filteredByData = filterTestData(jobs, hideTestData);") &&
      source.includes("selectedStatus.length > 0") &&
      source.includes("String(job.status).toLowerCase() === selectedStatus"),
    "Operations imports must filter test data first and then apply the normalized status filter.",
  );
  assert(
    source.includes("const selectedRows = selectedBulkJobId") &&
      source.includes("getBulkImportJobRows(selectedBulkJobId, undefined, 200, { role: actorRole, authHeader })") &&
      source.includes(": [];"),
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
      source.includes("form action={createBulkImportJobAction}") &&
      source.includes("form action={processBulkImportJobAction}") &&
      source.includes('idleLabel="Upload Import File"') &&
      source.includes('pendingLabel="Uploading and starting import..."'),
    "Operations imports must auto-refresh and wire both create/process server actions through pending-submit controls.",
  );
  assert(
    source.includes('href="/api/imports/templates/sample.csv"') &&
      source.includes('href="/api/imports/templates/sample.json"') &&
      source.includes("const SAMPLE_JSON_PREVIEW = `["),
    "Operations imports must expose sample-file downloads and an inline JSON format example.",
  );
  assert(
    source.includes('actorRole === "viewer"') &&
      source.includes('"No import jobs are visible for this scope."') &&
      source.includes('"No import jobs match this filter."') &&
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
          "operations_imports_route_wires_create_and_process_server_actions",
          "operations_imports_route_exposes_sample_files_and_json_preview",
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
