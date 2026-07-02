#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const IMPORTS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "operations", "imports", "page.tsx");
const ERROR_REPORT_ROUTE = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "api",
  "bulk-import",
  "jobs",
  "[jobId]",
  "error-report",
  "route.ts",
);
const RUN_ERROR_REPORT_ROUTE = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "api",
  "bulk-import",
  "runs",
  "[runId]",
  "error-report",
  "route.ts",
);
const BULK_IMPORT_CONTROLLER = path.join(REPO_ROOT, "apps", "api", "src", "bulk-import", "bulk-import.controller.ts");
const BULK_IMPORT_SERVICE = path.join(REPO_ROOT, "apps", "api", "src", "bulk-import", "bulk-import.service.ts");
const BULK_IMPORT_RUN_SERVICE = path.join(REPO_ROOT, "apps", "api", "src", "bulk-import", "bulk-import-run.service.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const pageSource = fs.readFileSync(IMPORTS_PAGE, "utf8");
  const routeSource = fs.readFileSync(ERROR_REPORT_ROUTE, "utf8");
  const runRouteSource = fs.readFileSync(RUN_ERROR_REPORT_ROUTE, "utf8");
  const controllerSource = fs.readFileSync(BULK_IMPORT_CONTROLLER, "utf8");
  const serviceSource = fs.readFileSync(BULK_IMPORT_SERVICE, "utf8");
  const runServiceSource = fs.readFileSync(BULK_IMPORT_RUN_SERVICE, "utf8");

  assert(
    pageSource.includes("const selectedJob = selectedBulkJobId") &&
      pageSource.includes("const selectedRowCounts = selectedRows.reduce") &&
      pageSource.includes("const selectedProblemRows = selectedRows.filter(isBulkImportProblemRow)") &&
      pageSource.includes("const selectedRowsNeedingRepair = selectedRows.filter") &&
      pageSource.includes("const selectedSuccessfulRows = selectedRows.filter"),
    "Operations imports must derive selected job, row counts, successful rows, problem rows, and repair rows from row-level results.",
  );
  assert(
    pageSource.includes("<CardTitle>Stage 4 | Review result and repair rows") &&
      pageSource.includes("Import result summary") &&
      pageSource.includes("Rows processed") &&
      pageSource.includes("Successful rows") &&
      pageSource.includes("Failed rows") &&
      pageSource.includes("Dead-letter rows"),
    "Operations imports must show a selected import result summary with row outcome counts.",
  );
  assert(
    pageSource.includes("Partial import: successful rows are available in the catalog") &&
      pageSource.includes("View product") &&
      pageSource.includes("No product created"),
    "Operations imports must explain partial failures and link successful rows back to catalog products.",
  );
  assert(
    pageSource.includes("Download failed rows CSV") &&
      pageSource.includes("Download error report") &&
      pageSource.includes("rows need repair") &&
      pageSource.includes("Reupload corrected file") &&
      pageSource.includes("/api/bulk-import/jobs/${encodeURIComponent(selectedBulkJobId)}/error-report") &&
      pageSource.includes("Open catalog"),
    "Operations imports must expose recovery-panel failed-row download and catalog follow-up actions for selected jobs.",
  );
  assert(
    pageSource.includes("<CardTitle>Row Repair Console") &&
      pageSource.includes("selectedRowsNeedingRepair") &&
      pageSource.includes("<RowRepairForm row={row} jobId={selectedBulkJobId} />"),
    "Operations imports must keep failed-row repair visible for selected jobs.",
  );
  assert(
    pageSource.includes("<CardTitle>Import Run") &&
      pageSource.includes("Large file mode enabled. Vexa will process this file in safe background batches.") &&
      pageSource.includes("Download failed rows CSV") &&
      pageSource.includes("Download combined error report") &&
      pageSource.includes("Unified Row Repair Console"),
    "Operations imports must expose a parent-run summary and repair path for large import mode.",
  );
  assert(
    pageSource.includes("/api/bulk-import/runs/${encodeURIComponent(selectedBulkRunId)}/error-report") &&
      pageSource.includes("<RowRepairForm row={row} jobId={row.jobId} />"),
    "Large import mode must expose a combined error-report proxy and repair rows by internal batch job id.",
  );
  assert(
    controllerSource.includes('@Get("jobs/:id/error-report")') &&
      controllerSource.includes('attachment; filename="bulk-import-${jobId}-errors.csv"'),
    "Backend bulk import error-report route must exist before exposing the web download link.",
  );
  assert(
    serviceSource.includes('"runId", "jobId", "rowNumber", "skuCode", "status", "errorCode", "errorMessage", "attemptCount", "originalData"') &&
      serviceSource.includes("{ errorMessage: { not: null } }") &&
      serviceSource.includes("extractSkuCode(originalData") &&
      serviceSource.includes("JSON.stringify(originalData)"),
    "Legacy bulk import error-report CSV must export the same problem rows and repair context visible in the UI.",
  );
  assert(
    runServiceSource.includes('"runId", "jobId", "rowNumber", "skuCode", "status", "errorCode", "errorMessage", "attemptCount", "originalData"') &&
      runServiceSource.includes("{ errorMessage: { not: null } }") &&
      runServiceSource.includes("take: 10_000") &&
      runServiceSource.includes("JSON.stringify(originalData)"),
    "Run-centric bulk import error-report CSV must export failed/problem rows with original row data.",
  );
  assert(
    routeSource.includes("resolveBearerToken(request)") &&
      routeSource.includes("/bulk-import/jobs/${encodeURIComponent(jobId)}/error-report") &&
      routeSource.includes('Accept: "text/csv"') &&
      routeSource.includes('"Content-Disposition"'),
    "Web error-report route must proxy the authenticated backend CSV without exposing credentials.",
  );
  assert(
    runRouteSource.includes("resolveBearerToken(request)") &&
      runRouteSource.includes("/bulk-import/runs/${encodeURIComponent(runId)}/error-report") &&
      runRouteSource.includes('Accept: "text/csv"') &&
      runRouteSource.includes('"Content-Disposition"'),
    "Large-run error-report route must proxy the authenticated backend CSV without exposing credentials.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "bulk_import_selected_job_derives_row_level_results",
          "bulk_import_result_summary_exposes_success_failed_dead_letter_counts",
          "bulk_import_partial_failure_and_catalog_reflection_are_visible",
          "bulk_import_recovery_panel_failed_rows_csv_is_exposed",
          "bulk_import_failed_rows_stay_repairable",
          "bulk_import_error_report_csv_exports_visible_problem_rows",
          "bulk_import_error_report_proxy_is_authenticated",
          "bulk_import_large_run_summary_and_repair_are_visible",
          "bulk_import_large_run_error_report_csv_exports_visible_problem_rows",
          "bulk_import_large_run_error_report_proxy_is_authenticated",
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
  console.error("Bulk import row verification UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
