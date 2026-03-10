import Link from "next/link";
import { redirect } from "next/navigation";
import { RowRepairForm } from "@/components/ui/row-repair-form";
import { Card, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { RefreshOnInterval } from "@/components/ui/refresh-on-interval";
import { ApiHttpError, getBulkImportJobRows, getBulkImportJobs } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { extractErrorCode, translateError, translateJobStatus } from "@/lib/errors";
import { canEditWorkspace } from "@/lib/role-capabilities";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";
import { filterTestData } from "@/lib/test-data-filter";

export const dynamic = "force-dynamic";

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
    const jobs = await getBulkImportJobs({ role: actorRole, authHeader });
    const filteredByData = filterTestData(jobs, hideTestData);
    const visibleJobs =
      selectedStatus.length > 0
        ? filteredByData.filter((job) => String(job.status).toLowerCase() === selectedStatus)
        : filteredByData;

    const selectedRows = selectedBulkJobId
      ? await getBulkImportJobRows(selectedBulkJobId, undefined, 200, { role: actorRole, authHeader })
      : [];

    const statusCounts = filteredByData.reduce<Record<string, number>>((accumulator, job) => {
      const key = String(job.status ?? "").toLowerCase() || "unknown";
      accumulator[key] = (accumulator[key] ?? 0) + 1;
      return accumulator;
    }, {});

    const hideToggleHref = hideTestData
      ? "/operations/imports?hideTestData=false"
      : "/operations/imports";

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

        <Card>
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
                          <Link
                            href={`/operations/imports?bulkJobId=${encodeURIComponent(job.id)}${hideTestData ? "" : "&hideTestData=false"}`}
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
          <Card>
            <CardTitle>Row Repair Console ({selectedBulkJobId})</CardTitle>
            {selectedRows.filter((row) => row.status !== "success").length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">No rows require repair for this import job.</p>
            ) : (
              <div className="space-y-3">
                {selectedRows
                  .filter((row) => row.status !== "success")
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
                            <RowRepairForm row={row} jobId={selectedBulkJobId} role={actorRole} />
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
      redirect(buildLoginRedirect("/operations/imports", error.status));
    }
    throw error;
  }
}
