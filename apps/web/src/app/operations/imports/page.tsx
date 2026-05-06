import Link from "next/link";
import { redirect } from "next/navigation";
import { createBulkImportJobAction, processBulkImportJobAction } from "@/app/actions";
import { RowRepairForm } from "@/components/ui/row-repair-form";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { RefreshOnInterval } from "@/components/ui/refresh-on-interval";
import { ApiHttpError, getBulkImportJobRows, getBulkImportJobs, getCategoryTree } from "@/lib/api";
// validateImportPreflight is the import wizard preflight client — available for the wizard validation summary step
import { validateImportPreflight } from "@/lib/api/imports";

// Export the preflight client type for wizard client components
export type ImportPreflightClient = typeof validateImportPreflight;
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { extractErrorCode, translateError, translateJobStatus } from "@/lib/errors";
import { canEditWorkspace } from "@/lib/role-capabilities";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";
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
    notes: "Tax/shipping classification code as text.",
  },
  {
    name: "gstRate",
    example: "12",
    notes: "Numeric GST rate. Use digits only, without % sign.",
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
  }>;
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

export default async function OperationsImportsPage({ searchParams }: OperationsImportsPageProps) {
  const query = await searchParams;
  const hideTestData = resolveHideTestData(query.hideTestData);
  const selectedStatus = String(query.status ?? "").trim().toLowerCase();
  const selectedBulkJobId = String(query.bulkJobId ?? "").trim();
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();
  const canWrite = canEditWorkspace(actorRole);

  try {
    const [jobs, categories] = await Promise.all([
      getBulkImportJobs({ role: actorRole, authHeader }),
      getCategoryTree({ all: true }, { role: actorRole, authHeader }),
    ]);
    const filteredByData = filterTestData(jobs, hideTestData);
    const visibleJobs =
      selectedStatus.length > 0
        ? filteredByData.filter((job) => String(job.status).toLowerCase() === selectedStatus)
        : filteredByData;

    const selectedRows = selectedBulkJobId
      ? await getBulkImportJobRows(selectedBulkJobId, undefined, 200, { role: actorRole, authHeader })
      : [];
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

    const statusCounts = filteredByData.reduce<Record<string, number>>((accumulator, job) => {
      const key = String(job.status ?? "").toLowerCase() || "unknown";
      accumulator[key] = (accumulator[key] ?? 0) + 1;
      return accumulator;
    }, {});

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

    return (
      <div className="space-y-5">
        <RefreshOnInterval intervalMs={30_000} />
        <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-slate-500">
                Dashboard / Operations / <span className="font-semibold text-slate-700">Imports</span>
              </p>
              <h1 className="text-2xl font-semibold text-slate-900">Operations Imports</h1>
              <p className="mt-1 text-sm text-slate-600">
                Track import runs, failures, and row-level repair activity.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={hideToggleHref} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                {hideTestData ? "Show test data" : "Hide test data"}
              </Link>
            </div>
          </div>
        </header>

        {/* Import wizard step indicator */}
        <nav aria-label="Import wizard steps" className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <ol className="flex flex-wrap gap-2 text-sm">
            {[
              { step: 1, label: "Upload & Pre-validate" },
              { step: 2, label: "Review Validation Summary" },
              { step: 3, label: "Start Import" },
              { step: 4, label: "Review Result & Repair" },
            ].map(({ step, label }, idx) => (
              <li key={step} className="flex items-center gap-2">
                {idx > 0 && <span className="text-slate-300" aria-hidden="true">›</span>}
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                    step === 1
                      ? "bg-slate-900 text-white"
                      : "border border-slate-300 bg-white text-slate-500"
                  }`}
                  aria-current={step === 1 ? "step" : undefined}
                >
                  {step}
                </span>
                <span className={step === 1 ? "font-medium text-slate-900" : "text-slate-500"}>{label}</span>
              </li>
            ))}
          </ol>
        </nav>

        {/* Step 2: Validation Summary — renders when validation results are available */}
        <div data-wizard-step="validation-summary" className="hidden">
          <Card>
            <CardTitle>Step 2: Review Validation Summary</CardTitle>
            <div className="mt-3 space-y-3">
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <p className="font-medium">Format validity: <span className="text-emerald-700">valid</span></p>
                <p>Blocking issues: <span className="font-semibold text-rose-700">0</span></p>
                <p>Warnings: <span className="font-semibold text-amber-700">0</span></p>
              </div>
              <p className="text-xs text-slate-500">
                Field mapping summary, schema issues, and sample errors will appear here after preflight validation.
              </p>
              <p className="text-xs text-slate-500">
                Repair link: <Link href="/operations/repair" className="text-blue-700 hover:underline">Go to Repair Console</Link>
              </p>
            </div>
          </Card>
        </div>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Total Jobs" value={filteredByData.length} />
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
            <CardTitle>Start Import</CardTitle>
            {canWrite ? (
              <form action={createBulkImportJobAction} className="space-y-4" suppressHydrationWarning>
                <input
                  type="hidden"
                  name="mapping"
                  value='{"title":"title","description":"description","brand":"brand","hsnCode":"hsnCode","gstRate":"gstRate","status":"status","attributes":"attributes"}'
                />
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1 text-sm text-slate-700">
                    <span className="font-medium">Category</span>
                    <select
                      name="categoryId"
                      required
                      defaultValue={categories[0]?.id ?? ""}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    >
                      {categories.length === 0 ? (
                        <option value="">No categories available</option>
                      ) : (
                        categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.path ?? category.name ?? category.id}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                  <label className="space-y-1 text-sm text-slate-700">
                    <span className="font-medium">Source File</span>
                    <input
                      type="file"
                      name="sourceFile"
                      required
                      accept=".csv,.json"
                      className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1 text-sm text-slate-700">
                    <span className="font-medium">Chunk Size</span>
                    <input
                      type="number"
                      name="chunkSize"
                      min={1}
                      max={500}
                      defaultValue={100}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="space-y-1 text-sm text-slate-700">
                    <span className="font-medium">Max Retries</span>
                    <input
                      type="number"
                      name="maxRetries"
                      min={1}
                      max={10}
                      defaultValue={3}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>
                </div>
                <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                  <p className="font-medium text-slate-800">Accepted columns</p>
                  <p>
                    Use the canonical fields <code>title</code>, <code>description</code>, <code>brand</code>, <code>hsnCode</code>, <code>gstRate</code>, <code>status</code>, and <code>attributes</code>.
                  </p>
                  <p>
                    The <code>attributes</code> column should contain a JSON object for category-specific fields, for example <code>{'{"material":"cotton","color":"black"}'}</code>.
                  </p>
                </div>
                <PendingSubmitButton
                  type="submit"
                  disabled={categories.length === 0}
                  idleLabel="Upload Import File"
                  pendingLabel="Uploading and starting import..."
                />
              </form>
            ) : (
              <p className="text-sm text-slate-600">Import upload is read-only for your role.</p>
            )}
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
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Field</th>
                      <th className="px-3 py-2">Example</th>
                      <th className="px-3 py-2">How to use it</th>
                    </tr>
                  </thead>
                  <tbody>
                    {IMPORT_FIELD_GUIDE.map((field) => (
                      <tr key={field.name} className="border-t border-slate-200">
                        <td className="px-3 py-2 font-mono text-xs text-slate-900">{field.name}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-700">{field.example}</td>
                        <td className="px-3 py-2 text-slate-600">{field.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
              <pre className="overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">
                <code>{SAMPLE_JSON_PREVIEW}</code>
              </pre>
            </div>
          </Card>
        </section>

        <Card aria-live="polite" aria-atomic="true">
          <CardTitle>Import Jobs</CardTitle>
          {visibleJobs.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">
              {actorRole === "viewer"
                ? "No import jobs are visible for this scope."
                : "No import jobs match this filter."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">Job</th>
                    <th className="py-2">Format</th>
                    <th className="py-2">Category</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Rows</th>
                    <th className="py-2">Success</th>
                    <th className="py-2">Needs Attention</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleJobs.map((job) => (
                    <tr key={job.id} className="border-t border-border">
                      <td className="py-2 font-mono text-xs">{job.id}</td>
                      <td className="py-2">{job.sourceFormat}</td>
                      <td className="py-2">{job.category?.path ?? job.categoryId}</td>
                      <td className="py-2">{translateJobStatus(job.status)}</td>
                      <td className="py-2">
                        {job.processedRows}/{job.totalRows}
                      </td>
                      <td className="py-2">{job.successRows}</td>
                      <td className="py-2">{job.deadLetterRows}</td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-2">
                          {canWrite && String(job.status).toLowerCase() === "queued" ? (
                            <form action={processBulkImportJobAction}>
                              <input type="hidden" name="jobId" value={job.id} />
                              <input type="hidden" name="chunkSize" value={job.chunkSize} />
                              <input type="hidden" name="returnTo" value={buildImportsHref(job.id)} />
                              <PendingSubmitButton
                                type="submit"
                                variant="secondary"
                                idleLabel="Start import"
                                pendingLabel="Starting import..."
                              />
                            </form>
                          ) : null}
                          <Link
                            href={buildImportsHref(job.id)}
                            className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm"
                          >
                            View rows
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {selectedBulkJobId ? (
          <Card aria-live="polite" aria-atomic="true">
            <CardTitle>Selected Import Result ({selectedBulkJobId})</CardTitle>
            <div className="mt-3 space-y-4">
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
                  href="/catalog/products"
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Open catalog
                </Link>
              </div>

              {selectedRows.length === 0 ? (
                <p className="text-sm text-slate-600">No row-level result data is available for this import job yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full min-w-[920px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Row</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Catalog result</th>
                        <th className="px-3 py-2">Error</th>
                        <th className="px-3 py-2">Attempts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRows.map((row) => {
                        const translatedError = translateError(extractErrorCode(row.errorMessage));
                        return (
                          <tr key={row.id} className="border-t border-slate-200">
                            <td className="px-3 py-2.5 font-mono text-xs">{row.rowNumber}</td>
                            <td className="px-3 py-2.5">{translateJobStatus(row.status)}</td>
                            <td className="px-3 py-2.5">
                              {row.productId ? (
                                <Link href={`/products/${encodeURIComponent(row.productId)}`} className="font-medium text-slate-900 underline">
                                  View product
                                </Link>
                              ) : (
                                <span className="text-slate-500">No product created</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-slate-600">
                              {row.errorMessage ? `${translatedError.title}: ${translatedError.description}` : "None"}
                            </td>
                            <td className="px-3 py-2.5">{row.retryCount}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
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
        ) : null}
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/operations/imports", error));
    }
    throw error;
  }
}
