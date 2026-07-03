import Link from "next/link";
import { redirect } from "next/navigation";
import { createBulkImportJobAction, processBulkImportJobAction, requeueBulkImportDlqAction, retryStuckRunAction } from "@/app/actions";
import { ImportPreflightForm } from "@/components/operations/import-preflight-form";
import { RowRepairForm } from "@/components/ui/row-repair-form";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { ImportProgress } from "@/components/ui/import-progress";
import { RefreshOnInterval } from "@/components/ui/refresh-on-interval";
import { WorkflowStepper, type WorkflowStep } from "@/components/ui/workflow-stepper";
import type { BulkImportRun, BulkImportRunRow } from "@/lib/api/core";
import { ApiHttpError, getBulkImportJobRows, getBulkImportJobs, getCachedCategoryTree } from "@/lib/api";
// validateImportPreflight is the import wizard preflight client — available for the wizard validation summary step
import { validateImportPreflight } from "@/lib/api/imports";
import { getBulkImportRun, getBulkImportRunRows, getBulkImportRuns } from "@/lib/api/operations";

// Export the preflight client type for wizard client components
export type ImportPreflightClient = typeof validateImportPreflight;
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { extractErrorCode, translateError, translateJobStatus } from "@/lib/errors";
import { canEditWorkspace } from "@/lib/role-capabilities";
import { getServerSession } from "@/lib/server-session";
import { filterTestData } from "@/lib/test-data-filter";

export const dynamic = "force-dynamic";

const IMPORT_FIELD_GUIDE = [
  {
    name: "title",
    example: "Classic Cotton Tee",
    notes: "Primary product name shown in catalog and product workbench.",
  },
  {
    name: "description",
    example: "Soft crew-neck t-shirt",
    notes: "Plain text description for the base product record.",
  },
  {
    name: "brand",
    example: "Vexa PIM",
    notes: "Brand label used in product search and merchandising.",
  },
  {
    name: "hsnCode",
    example: "61091000",
    notes: "India GST classification code (HSN). 4, 6, or 8 digits.",
  },
  {
    name: "gstRate",
    example: "12",
    notes: "India GST rate as a number (5, 12, 18, 28). Digits only, no % sign.",
  },
  {
    name: "gb_commodity_code",
    example: "6204420000",
    notes: "UK Trade Tariff commodity code (10 digits). Optional — leave blank if not selling in the UK.",
  },
  {
    name: "ae_hs_code",
    example: "620442",
    notes: "UAE HS code (6 digits). Optional — leave blank if not selling in the UAE.",
  },
  {
    name: "us_tax_category",
    example: "CLOTHING",
    notes: "US Avalara/AvaTax tax category string. Optional — leave blank if not selling in the US.",
  },
  {
    name: "au_commodity_code",
    example: "62044200",
    notes: "Australia commodity code. Optional — leave blank if not selling in Australia.",
  },
  {
    name: "status",
    example: "draft",
    notes: "Use a valid workflow status for the imported row.",
  },
  {
    name: "attributes",
    example: '{"material":"cotton","color":"black","size":"M"}',
    notes: "JSON object for category-specific attributes.",
  },
] as const;

const SAMPLE_JSON_PREVIEW = `[
  {
    "title": "Classic Cotton Tee",
    "description": "Soft crew-neck t-shirt",
    "brand": "Vexa PIM",
    "hsnCode": "61091000",
    "gstRate": 12,
    "taxCodes": [
      { "regimeKey": "GB", "key": "COMMODITY_CODE", "value": "6204420000" },
      { "regimeKey": "AE", "key": "HS_CODE",        "value": "620442" },
      { "regimeKey": "US", "key": "TAX_CATEGORY",   "value": "CLOTHING" },
      { "regimeKey": "AU", "key": "COMMODITY_CODE", "value": "62044200" }
    ],
    "status": "draft",
    "attributes": {
      "material": "cotton",
      "color": "black",
      "size": "M"
    }
  }
]`;

interface OperationsImportsPageProps {
  searchParams: Promise<{
    status?: string;
    hideTestData?: string;
    bulkJobId?: string;
    bulkRunId?: string;
    runRowCursor?: string;
  }>;
}

function normalizeCollection<T>(value: T[] | { items: T[] } | null | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && Array.isArray(value.items)) {
    return value.items;
  }
  return [];
}

function resolveHideTestData(value: string | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "off") {
    return false;
  }
  return true;
}

function importWorkflowSteps(input: {
  selectedBulkJobId: string;
  selectedJobStatus: string | null;
  selectedAttentionRows: number;
  selectedSuccessfulRows: number;
}): WorkflowStep[] {
  const hasSelection = input.selectedBulkJobId.length > 0;
  const status = String(input.selectedJobStatus ?? "").trim().toLowerCase();

  return [
    {
      label: "Upload and pre-validate",
      tone: hasSelection ? "complete" : "current",
      description: "Choose category scope, upload the source file, and validate before creating a job.",
    },
    {
      label: "Review validation summary",
      tone: hasSelection ? "complete" : "pending",
      description: "Review blocking issues, warnings, sample row errors, and field mapping coverage.",
    },
    {
      label: "Start import",
      tone: hasSelection ? "complete" : "pending",
      description: "Create and process the queued import only after preflight is clear or warning-only.",
    },
    {
      label: "Review result and repair rows",
      tone:
        input.selectedAttentionRows > 0
          ? "current"
          : input.selectedSuccessfulRows > 0 && hasSelection
            ? "complete"
            : "pending",
      description: "Open the selected job, review results, download the error report, and repair remaining rows.",
    },
  ];
}

export default async function OperationsImportsPage({ searchParams }: OperationsImportsPageProps) {
  const query = await searchParams;
  const hideTestData = resolveHideTestData(query.hideTestData);
  const selectedStatus = String(query.status ?? "").trim().toLowerCase();
  const selectedBulkJobId = String(query.bulkJobId ?? "").trim();
  const selectedBulkRunId = String(query.bulkRunId ?? "").trim();
  const runRowCursor = String(query.runRowCursor ?? "").trim() || undefined;
  const { authHeader, actorRole } = await getServerSession();
  const canWrite = canEditWorkspace(actorRole);

  try {
    // All independent fetches — including the optionally-selected job/run rows — run in
    // parallel up front. URL params (selectedBulkJobId, selectedBulkRunId) are known
    // immediately, so there is no reason to wait for the jobs list before fetching rows.
    const [jobsResult, categoriesResult, runsResult, selectedRowsResult, selectedRunResult, selectedRunRowsResult] =
      canWrite
        ? await Promise.allSettled([
            getBulkImportJobs({ role: actorRole, authHeader }),
            getCachedCategoryTree({ all: true }, { role: actorRole, authHeader, revalidateSeconds: 60 }),
            getBulkImportRuns(undefined, undefined, { role: actorRole, authHeader }),
            selectedBulkJobId
              ? getBulkImportJobRows(selectedBulkJobId, undefined, 200, { role: actorRole, authHeader })
              : Promise.resolve([] as Awaited<ReturnType<typeof getBulkImportJobRows>>),
            selectedBulkRunId
              ? getBulkImportRun(selectedBulkRunId, { role: actorRole, authHeader })
              : Promise.resolve(null),
            selectedBulkRunId
              ? getBulkImportRunRows(selectedBulkRunId, undefined, runRowCursor, { role: actorRole, authHeader }, 100)
              : Promise.resolve({ items: [], nextCursor: null } as Awaited<ReturnType<typeof getBulkImportRunRows>>),
          ])
        : [
            { status: "fulfilled" as const, value: [] as Awaited<ReturnType<typeof getBulkImportJobs>> },
            { status: "fulfilled" as const, value: [] as Awaited<ReturnType<typeof getCachedCategoryTree>> },
            { status: "fulfilled" as const, value: [] as Awaited<ReturnType<typeof getBulkImportRuns>> },
            { status: "fulfilled" as const, value: [] as Awaited<ReturnType<typeof getBulkImportJobRows>> },
            { status: "fulfilled" as const, value: null as Awaited<ReturnType<typeof getBulkImportRun>> | null },
            { status: "fulfilled" as const, value: { items: [], nextCursor: null } as Awaited<ReturnType<typeof getBulkImportRunRows>> },
          ];

    // Re-throw 401/403 from any slot so the outer catch can redirect to login.
    // Previously, runs/run-rows sat inside the outer try/catch and would naturally
    // propagate; Promise.allSettled absorbs them, so we must re-throw explicitly.
    for (const result of [jobsResult, categoriesResult, runsResult, selectedRowsResult, selectedRunResult, selectedRunRowsResult]) {
      if (result.status === "rejected") {
        const err = result.reason;
        if (err instanceof ApiHttpError && (err.status === 401 || err.status === 403)) throw err;
      }
    }
    const jobs = jobsResult.status === "fulfilled" ? jobsResult.value : [];
    const categories = categoriesResult.status === "fulfilled" ? categoriesResult.value : [];
    const runs = normalizeCollection<BulkImportRun>(
      runsResult.status === "fulfilled" ? runsResult.value : [],
    );
    const largeRuns = runs;
    const filteredByData = filterTestData(jobs, hideTestData);
    const visibleJobs =
      selectedStatus.length > 0
        ? filteredByData.filter((job) => String(job.status).toLowerCase() === selectedStatus)
        : filteredByData;

    const selectedRows = selectedRowsResult.status === "fulfilled" ? selectedRowsResult.value : [];
    const selectedJob = selectedBulkJobId
      ? filteredByData.find((job) => job.id === selectedBulkJobId) ?? jobs.find((job) => job.id === selectedBulkJobId) ?? null
      : null;
    const selectedRowCounts = selectedRows.reduce<Record<string, number>>((accumulator, row) => {
      const key = String(row.status ?? "").toLowerCase() || "unknown";
      accumulator[key] = (accumulator[key] ?? 0) + 1;
      return accumulator;
    }, {});
    const selectedRowsNeedingRepair = selectedRows.filter((row) => row.status !== "success");
    const selectedSuccessfulRows = selectedRows.filter((row) => row.status === "success");
    const selectedAttentionRows = (selectedRowCounts.failed ?? 0) + (selectedRowCounts.dead_letter ?? 0);
    const operatorWorkflowSteps = importWorkflowSteps({
      selectedBulkJobId,
      selectedJobStatus: selectedJob?.status ?? null,
      selectedAttentionRows,
      selectedSuccessfulRows: selectedSuccessfulRows.length,
    });
    const selectedRun: BulkImportRun | null =
      (selectedBulkRunId
        ? largeRuns.find((run) => run.id === selectedBulkRunId) ??
          (selectedRunResult.status === "fulfilled" ? selectedRunResult.value : null)
        : null) ?? null;
    const selectedRunRowsPage = selectedRunRowsResult.status === "fulfilled" ? selectedRunRowsResult.value : { items: [], nextCursor: null };
    const selectedRunRows: BulkImportRunRow[] = normalizeCollection<BulkImportRunRow>(selectedRunRowsPage.items);
    const runRowsNextCursor = selectedRunRowsPage.nextCursor;
    const selectedRunRowCounts = selectedRunRows.reduce<Record<string, number>>((accumulator, row) => {
      const key = String(row.status ?? "").toLowerCase() || "unknown";
      accumulator[key] = (accumulator[key] ?? 0) + 1;
      return accumulator;
    }, {});
    const selectedRunRowsNeedingRepair = selectedRunRows.filter((row) => row.status !== "success");
    const selectedRunSuccessfulRows = selectedRunRows.filter((row) => row.status === "success");
    const selectedRunProcessedRows =
      (selectedRun?.acceptedRows ?? 0) + (selectedRun?.failedRows ?? 0) + (selectedRun?.deadLetterRows ?? 0);

    const statusCounts = filteredByData.reduce<Record<string, number>>((accumulator, job) => {
      const key = String(job.status ?? "").toLowerCase() || "unknown";
      accumulator[key] = (accumulator[key] ?? 0) + 1;
      return accumulator;
    }, {});
    for (const run of runs) {
      const raw = String(run.status ?? "").toLowerCase();
      const key = raw === "repair_required" ? "dead_letter"
        : raw === "processing" ? "retrying"
        : raw || "unknown";
      statusCounts[key] = (statusCounts[key] ?? 0) + 1;
    }

    const hideToggleHref = hideTestData
      ? "/operations/imports?hideTestData=false"
      : "/operations/imports";
    const buildImportsHref = (bulkJobId?: string) => {
      const search = new URLSearchParams();
      if (selectedStatus) {
        search.set("status", selectedStatus);
      }
      if (!hideTestData) {
        search.set("hideTestData", "false");
      }
      if (bulkJobId) {
        search.set("bulkJobId", bulkJobId);
      }
      const queryString = search.toString();
      return queryString ? `/operations/imports?${queryString}` : "/operations/imports";
    };
    const importFieldColumns: Column<(typeof IMPORT_FIELD_GUIDE)[number]>[] = [
      { key: "field", header: "Field", render: (field) => <span className="font-mono text-xs text-slate-900">{field.name}</span> },
      { key: "example", header: "Example", render: (field) => <span className="font-mono text-xs text-slate-700">{field.example}</span> },
      { key: "notes", header: "How to use it", render: (field) => <span className="text-slate-600">{field.notes}</span> },
    ];
    const jobColumns: Column<(typeof visibleJobs)[number]>[] = [
      { key: "job", header: "Job", render: (job) => <span className="font-mono text-xs">{job.id}</span> },
      { key: "format", header: "Format", render: (job) => job.sourceFormat },
      { key: "category", header: "Category", render: (job) => job.category?.path ?? job.categoryId },
      { key: "status", header: "Status", render: (job) => translateJobStatus(job.status) },
      { key: "rows", header: "Rows", render: (job) => `${job.processedRows}/${job.totalRows}` },
      { key: "success", header: "Success", render: (job) => job.successRows },
      { key: "attention", header: "Needs Attention", render: (job) => job.deadLetterRows },
      {
        key: "actions",
        header: "Actions",
        render: (job) => {
          const status = String(job.status).toLowerCase();
          return (
            <div className="flex flex-wrap gap-2">
              {canWrite && status === "queued" ? (
                <form action={processBulkImportJobAction}>
                  <input type="hidden" name="jobId" value={job.id} />
                  <input type="hidden" name="chunkSize" value={job.chunkSize} />
                  <input type="hidden" name="returnTo" value={buildImportsHref(job.id)} />
                  <PendingSubmitButton type="submit" variant="secondary" idleLabel="Start import" pendingLabel="Starting import..." />
                </form>
              ) : null}
              {canWrite && status === "retrying" ? (
                <form action={processBulkImportJobAction}>
                  <input type="hidden" name="jobId" value={job.id} />
                  <input type="hidden" name="chunkSize" value={job.chunkSize} />
                  <input type="hidden" name="returnTo" value={buildImportsHref(job.id)} />
                  <PendingSubmitButton type="submit" variant="secondary" idleLabel="Resume import" pendingLabel="Resuming..." />
                </form>
              ) : null}
              {canWrite && status === "dead_letter" ? (
                <form action={requeueBulkImportDlqAction}>
                  <input type="hidden" name="jobId" value={job.id} />
                  <PendingSubmitButton type="submit" variant="secondary" idleLabel="Requeue rows" pendingLabel="Requeuing..." />
                </form>
              ) : null}
              {status === "processing" ? (
                <span className="inline-flex items-center rounded-md bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700">In progress</span>
              ) : null}
              <Link
                href={buildImportsHref(job.id)}
                className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm"
              >
                {status === "completed" ? "View result" : "View rows"}
              </Link>
            </div>
          );
        },
      },
    ];
    const selectedRowColumns: Column<(typeof selectedRows)[number]>[] = [
      { key: "row", header: "Row", render: (row) => <span className="font-mono text-xs">{row.rowNumber}</span> },
      { key: "status", header: "Status", render: (row) => translateJobStatus(row.status) },
      {
        key: "catalogResult",
        header: "Catalog result",
        render: (row) =>
          row.productId ? (
            <Link href={`/products/${encodeURIComponent(row.productId)}`} className="font-medium text-slate-900 underline">
              View product
            </Link>
          ) : (
            <span className="text-slate-500">No product created</span>
          ),
      },
      {
        key: "error",
        header: "Error",
        render: (row) => {
          const translatedError = translateError(extractErrorCode(row.errorMessage));
          return (
            <span className="text-xs text-slate-600">
              {row.errorMessage ? `${translatedError.title}: ${translatedError.description}` : "None"}
            </span>
          );
        },
      },
      { key: "attempts", header: "Attempts", render: (row) => row.retryCount },
    ];

    const buildRunHref = (bulkRunId?: string, cursor?: string) => {
      const search = new URLSearchParams();
      if (selectedStatus) {
        search.set("status", selectedStatus);
      }
      if (!hideTestData) {
        search.set("hideTestData", "false");
      }
      if (bulkRunId) {
        search.set("bulkRunId", bulkRunId);
      }
      if (cursor) {
        search.set("runRowCursor", cursor);
      }
      const queryString = search.toString();
      return queryString ? `/operations/imports?${queryString}` : "/operations/imports";
    };

    return (
      <div className="space-y-5">
        <RefreshOnInterval intervalMs={30_000} />
        <PageHeader
          title="Operations Imports"
          description="Run imports in a strict operator sequence: pre-validate the file, review readiness, start the queued job, then move into result and repair."
          breadcrumb={
            <>
              <Link href="/dashboard" className="hover:underline">Dashboard</Link>{" / "}<Link href="/operations" className="hover:underline">Operations</Link>{" / "}<span className="font-semibold text-slate-700">Imports</span>
            </>
          }
          actions={
            <Link href={hideToggleHref} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
              {hideTestData ? "Show test data" : "Hide test data"}
            </Link>
          }
        />

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Total Jobs" value={filteredByData.length + runs.length} />
          <KpiCard
            label="Needs Attention"
            value={(statusCounts.dead_letter ?? 0) + (statusCounts.failed ?? 0)}
            tone={(statusCounts.dead_letter ?? 0) + (statusCounts.failed ?? 0) > 0 ? "danger" : "success"}
          />
          <KpiCard label="Retrying" value={statusCounts.retrying ?? 0} tone={(statusCounts.retrying ?? 0) > 0 ? "warning" : "default"} />
          <KpiCard label="Completed" value={statusCounts.completed ?? 0} tone={(statusCounts.completed ?? 0) > 0 ? "success" : "default"} />
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <Card>
            <CardTitle>Operator import flow</CardTitle>
            <p className="mb-3 text-sm text-slate-600">
              Follow the same four-step path every time: upload and pre-validate, review the validation summary, start import, then review results and repair only the rows that still need operator attention.
            </p>
            <WorkflowStepper steps={operatorWorkflowSteps} />
          </Card>

          <Card>
            <CardTitle>Stage 1 and 2 | Upload and pre-validate</CardTitle>
            <ImportPreflightForm
              categories={categories}
              canWrite={canWrite}
              submitAction={createBulkImportJobAction}
            />
          </Card>

          <Card>
            <CardTitle>Sample Files</CardTitle>
            <div className="space-y-3 text-sm text-slate-600">
              <p>
                Download a ready-to-edit sample to see the expected bulk import format before uploading your own file.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/api/imports/templates/sample.csv"
                  className="rounded-md border border-slate-200 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Download sample CSV
                </Link>
                <Link
                  href="/api/imports/templates/sample.json"
                  className="rounded-md border border-slate-200 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Download sample JSON
                </Link>
              </div>
              <ul className="list-disc space-y-1 pl-5">
                <li>CSV uploads use the canonical columns below.</li>
                <li>JSON imports should contain an array of row objects.</li>
                <li>Start with one sample row, then add your own category-specific attributes.</li>
              </ul>
            </div>
          </Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <Card>
            <CardTitle>Import Format Guide</CardTitle>
            <div className="space-y-3 text-sm text-slate-600">
              <p>
                CSV uploads should use the exact canonical column names below. JSON uploads should use the
                same keys on each row object.
              </p>
              <DataGrid columns={importFieldColumns} rows={IMPORT_FIELD_GUIDE.slice()} getRowKey={(field) => field.name} />
              <ul className="list-disc space-y-1 pl-5">
                <li>Keep the first row as headers for CSV uploads.</li>
                <li>Use one product row per line in CSV, or one object per item in JSON.</li>
                <li>Start with a single sample row first, then scale up after the mapping looks correct.</li>
              </ul>
            </div>
          </Card>

          <Card>
            <CardTitle>JSON Example</CardTitle>
            <div className="space-y-3 text-sm text-slate-600">
              <p>
                If you prefer JSON imports, upload an array of product row objects using the same field names as the
                CSV sample.
              </p>
              <pre className="overflow-hidden whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">
                <code>{SAMPLE_JSON_PREVIEW}</code>
              </pre>
            </div>
          </Card>
        </section>

        <Card aria-live="polite" aria-atomic="true">
          <CardTitle>Stage 3 | Start import</CardTitle>
          <p className="mb-3 text-sm text-slate-600">
            Preflight creates the job in a queued state. Start processing from this queue, then open the selected job to review result details and move into repair.
          </p>
          {visibleJobs.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">
              {!canEditWorkspace(actorRole)
                ? "No import jobs are visible for this scope."
                : "No import jobs match this filter."}
            </p>
          ) : (
            <DataGrid columns={jobColumns} rows={visibleJobs} getRowKey={(job) => job.id} />
          )}
        </Card>

        {largeRuns.length > 0 ? (
          <Card aria-live="polite" aria-atomic="true">
            <CardTitle>Import Runs</CardTitle>
            <DataGrid
              className="mt-3"
              columns={[
                { key: "id", header: "Run", cellClassName: "font-mono text-xs" },
                { key: "category", header: "Category", render: (run) => run.category?.path ?? run.categoryId },
                { key: "status", header: "Status", render: (run) => translateJobStatus(run.status) },
                {
                  key: "rows",
                  header: "Rows",
                  render: (run) => {
                    const processedRows = (run.acceptedRows ?? 0) + (run.failedRows ?? 0) + (run.deadLetterRows ?? 0);
                    return `${processedRows}/${run.totalRows ?? 0}`;
                  },
                },
                { key: "batches", header: "Batches", render: (run) => run.estimatedBatchCount ?? "-", mobileHide: true },
                {
                  key: "attention",
                  header: "Needs Attention",
                  render: (run) => (run.failedRows ?? 0) + (run.deadLetterRows ?? 0),
                },
                {
                  key: "actions",
                  header: "Actions",
                  render: (run) => {
                    const runStatus = String(run.status ?? "").toLowerCase();
                    const processedRows = (run.acceptedRows ?? 0) + (run.failedRows ?? 0) + (run.deadLetterRows ?? 0);
                    const hasStuckRows = processedRows < (run.totalRows ?? 0) && runStatus !== "preflight_ready" && runStatus !== "uploaded";
                    return (
                      <div className="flex flex-wrap gap-2">
                        {canWrite && hasStuckRows ? (
                          <form action={retryStuckRunAction}>
                            <input type="hidden" name="runId" value={run.id} />
                            <PendingSubmitButton type="submit" variant="secondary" idleLabel="Retry stuck rows" pendingLabel="Retrying..." />
                          </form>
                        ) : null}
                        <Link href={buildRunHref(run.id)} className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm">
                          View run
                        </Link>
                      </div>
                    );
                  },
                },
              ] as Column<BulkImportRun>[]}
              rows={largeRuns}
              getRowKey={(run) => run.id}
            />
          </Card>
        ) : null}

        {selectedBulkRunId && selectedRun ? (
          <Card aria-live="polite" aria-atomic="true">
            <CardTitle>Import Run ({selectedBulkRunId})</CardTitle>
            <div className="mt-3 space-y-4">
              <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                Large file mode enabled. Vexa will process this file in safe background batches.
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                <KpiCard label="Rows processed" value={`${selectedRunProcessedRows}/${selectedRun.totalRows ?? 0}`} />
                <KpiCard label="Successful rows" value={selectedRun.acceptedRows ?? selectedRunSuccessfulRows.length} tone={(selectedRun.acceptedRows ?? selectedRunSuccessfulRows.length) > 0 ? "success" : "default"} />
                <KpiCard label="Failed rows" value={selectedRun.failedRows ?? (selectedRunRowCounts.failed ?? 0)} tone={(selectedRun.failedRows ?? (selectedRunRowCounts.failed ?? 0)) > 0 ? "danger" : "success"} />
                <KpiCard label="Dead-letter rows" value={selectedRun.deadLetterRows ?? (selectedRunRowCounts.dead_letter ?? 0)} tone={(selectedRun.deadLetterRows ?? (selectedRunRowCounts.dead_letter ?? 0)) > 0 ? "warning" : "default"} />
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <KpiCard label="Estimated batches" value={selectedRun.estimatedBatchCount ?? 0} />
                <KpiCard label="Blocking issues" value={selectedRun.blockingIssueCount ?? 0} tone={(selectedRun.blockingIssueCount ?? 0) > 0 ? "danger" : "success"} />
                <KpiCard label="Warnings" value={selectedRun.warningCount ?? 0} tone={(selectedRun.warningCount ?? 0) > 0 ? "warning" : "default"} />
              </div>

              {canWrite && selectedRunProcessedRows < (selectedRun.totalRows ?? 0) && selectedRun.status !== "preflight_ready" && selectedRun.status !== "uploaded" ? (
                <div className="rounded-md border border-orange-300 bg-orange-50 p-4 text-sm text-orange-900">
                  <p className="font-semibold">Import appears stuck</p>
                  <p className="mt-1">
                    {(selectedRun.totalRows ?? 0) - selectedRunProcessedRows} rows are still waiting to be processed. Click below to retry them.
                  </p>
                  <form action={retryStuckRunAction} className="mt-3">
                    <input type="hidden" name="runId" value={selectedBulkRunId} />
                    <PendingSubmitButton type="submit" variant="secondary" idleLabel="Retry stuck rows" pendingLabel="Retrying stuck rows..." />
                  </form>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/api/bulk-import/runs/${encodeURIComponent(selectedBulkRunId)}/error-report`}
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Download combined error report
                </Link>
                <Link
                  href="/operations/repair"
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Open repair console
                </Link>
              </div>

              {selectedRunRows.length === 0 ? (
                <p className="text-sm text-slate-600">
                  {selectedRun.status === "preflight_blocked"
                    ? "Preflight blocked this large import run before batch processing started."
                    : "No row-level result data is available for this large import run yet."}
                </p>
              ) : (
                <>
                  <DataGrid<BulkImportRunRow>
                    columns={[
                      {
                        key: "rowNumberGlobal",
                        header: "Row",
                        cellClassName: "font-mono text-xs",
                        render: (row) => String(row.rowNumberGlobal ?? row.rowNumber ?? ""),
                      },
                      {
                        key: "status",
                        header: "Status",
                        render: (row) => translateJobStatus(row.status),
                      },
                      {
                        key: "productId",
                        header: "Catalog result",
                        render: (row) =>
                          row.productId ? (
                            <Link href={`/products/${encodeURIComponent(row.productId)}`} className="font-medium text-slate-900 underline">
                              View product
                            </Link>
                          ) : (
                            <span className="text-slate-500">No product created</span>
                          ),
                      },
                      {
                        key: "errorMessage",
                        header: "Error",
                        cellClassName: "text-xs text-slate-600",
                        render: (row) => {
                          if (!row.errorMessage) return "None";
                          const translatedError = translateError(extractErrorCode(row.errorMessage));
                          return `${translatedError.title}: ${translatedError.description}`;
                        },
                      },
                      {
                        key: "retryCount",
                        header: "Attempts",
                        mobileHide: true,
                        render: (row) => String(row.retryCount ?? 0),
                      },
                    ] satisfies Column<BulkImportRunRow>[]}
                    rows={selectedRunRows}
                    getRowKey={(row) => row.id}
                  />
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="text-slate-600">
                      Showing {selectedRunRows.length} rows{runRowCursor ? " (paginated)" : ""}
                    </span>
                    <div className="flex gap-2">
                      {runRowCursor ? (
                        <Link
                          href={buildRunHref(selectedBulkRunId)}
                          className="rounded-md border border-slate-200 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50"
                        >
                          First page
                        </Link>
                      ) : null}
                      {runRowsNextCursor ? (
                        <Link
                          href={buildRunHref(selectedBulkRunId, runRowsNextCursor)}
                          className="rounded-md border border-slate-200 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Next page
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </>
              )}
            </div>
          </Card>
        ) : null}

        {selectedBulkJobId ? (
          <Card aria-live="polite" aria-atomic="true">
            <CardTitle>Stage 4 | Review result and repair rows ({selectedBulkJobId})</CardTitle>
            <div className="mt-3 space-y-4">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <p className="font-medium text-slate-900">Import result summary</p>
                <p className="mt-1">
                  Review the selected job before opening repair: successful rows are already in the catalog, while failed or dead-letter rows stay below for targeted correction and the repair console remains available in the next section.
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
                  <li>Selected job status: {selectedJob ? translateJobStatus(selectedJob.status) : "Row detail only"}</li>
                  <li>Rows needing repair: {selectedAttentionRows}</li>
                  <li>Successful rows already in catalog: {selectedSuccessfulRows.length}</li>
                </ul>
              </div>
              {selectedJob && !["completed", "dead_letter", "failed"].includes(String(selectedJob.status).toLowerCase()) && (
                <ImportProgress initialJob={selectedJob} role={actorRole} />
              )}
              <div className="grid gap-3 md:grid-cols-4">
                <KpiCard label="Rows processed" value={selectedJob ? `${selectedJob.processedRows}/${selectedJob.totalRows}` : selectedRows.length} />
                <KpiCard label="Successful rows" value={selectedJob?.successRows ?? selectedSuccessfulRows.length} tone={(selectedJob?.successRows ?? selectedSuccessfulRows.length) > 0 ? "success" : "default"} />
                <KpiCard label="Failed rows" value={selectedJob?.failedRows ?? (selectedRowCounts.failed ?? 0)} tone={(selectedJob?.failedRows ?? (selectedRowCounts.failed ?? 0)) > 0 ? "danger" : "success"} />
                <KpiCard label="Dead-letter rows" value={selectedJob?.deadLetterRows ?? (selectedRowCounts.dead_letter ?? 0)} tone={(selectedJob?.deadLetterRows ?? (selectedRowCounts.dead_letter ?? 0)) > 0 ? "warning" : "default"} />
              </div>

              {selectedSuccessfulRows.length > 0 && selectedAttentionRows > 0 ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  Partial import: successful rows are available in the catalog, while failed rows remain visible below for repair.
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/api/bulk-import/jobs/${encodeURIComponent(selectedBulkJobId)}/error-report`}
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Download error report
                </Link>
                <Link
                  href={`/catalog/products${selectedJob?.categoryId ? `?categoryId=${encodeURIComponent(selectedJob.categoryId)}` : ""}`}
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Open catalog
                </Link>
              </div>

              {selectedRows.length === 0 ? (
                <p className="text-sm text-slate-600">No row-level result data is available for this import job yet.</p>
              ) : (
                <DataGrid columns={selectedRowColumns} rows={selectedRows} getRowKey={(row) => row.id} />
              )}
            </div>
          </Card>
        ) : null}

        {selectedBulkJobId ? (
          <Card aria-live="polite" aria-atomic="true">
            <CardTitle>Row Repair Console ({selectedBulkJobId})</CardTitle>
            {selectedRowsNeedingRepair.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">No rows require repair for this import job.</p>
            ) : (
              <div className="space-y-3">
                {selectedRowsNeedingRepair
                  .map((row) => {
                    const translatedError = translateError(extractErrorCode(row.errorMessage));
                    return (
                      <div key={row.id} className="rounded-lg border border-slate-200 p-3">
                        <p className="text-sm font-medium text-slate-900">
                          Row {row.rowNumber} | {translateJobStatus(row.status)}
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          {translatedError.title} - {translatedError.description}
                        </p>
                        {canWrite ? (
                          <div className="mt-3">
                            <RowRepairForm row={row} jobId={selectedBulkJobId} />
                          </div>
                        ) : (
                          <p className="mt-2 text-xs text-slate-500">This action is read-only for your role.</p>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </Card>
        ) : (
          <Card>
            <CardTitle>Stage 4 | Review result and repair rows</CardTitle>
            <p className="text-sm text-slate-600">
              Select an import job from Stage 3 to open the result summary, download the error report, and move directly into the row repair console when failed rows remain.
            </p>
          </Card>
        )}

        {selectedBulkRunId && selectedRun ? (
          <Card aria-live="polite" aria-atomic="true">
            <CardTitle>Unified Row Repair Console ({selectedBulkRunId})</CardTitle>
            {selectedRunRowsNeedingRepair.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">No rows require repair for this large import run.</p>
            ) : (
              <div className="space-y-3">
                {selectedRunRowsNeedingRepair.map((row) => {
                  const translatedError = translateError(extractErrorCode(row.errorMessage));
                  return (
                    <div key={row.id} className="rounded-lg border border-slate-200 p-3">
                      <p className="text-sm font-medium text-slate-900">
                        Row {row.rowNumberGlobal ?? row.rowNumber} | {translateJobStatus(row.status)}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        {translatedError.title} - {translatedError.description}
                      </p>
                      {canWrite ? (
                        <div className="mt-3">
                          <RowRepairForm row={row} jobId={row.jobId} />
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-slate-500">This action is read-only for your role.</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        ) : null}
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && error.status === 401) {
      redirect(buildLoginRedirect("/operations/imports", error));
    }
    if (error instanceof ApiHttpError && error.status === 403 && canWrite) {
      redirect(buildLoginRedirect("/operations/imports", error));
    }
    throw error;
  }
}
