import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { ApiHttpError, getBulkImportJobs, getDeadLetterSubmissions } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { translateJobStatus } from "@/lib/errors";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

function toItems<T>(value: T[] | { items: T[] } | null | undefined): T[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return Array.isArray(value.items) ? value.items : [];
}

export default async function OperationsRepairPage() {
  const { authHeader, actorRole } = await getServerSession();

  try {
    const [importJobs, deadLetterRaw] = await Promise.all([
      getBulkImportJobs({ role: actorRole, authHeader }),
      getDeadLetterSubmissions({ limit: 100 }, { role: actorRole, authHeader }),
    ]);
    const deadLetterSubmissions = toItems(deadLetterRaw);
    const failedImports = importJobs.filter((job) => job.deadLetterRows > 0 || job.failedRows > 0);
    const deadLetterRows = failedImports.reduce((sum, job) => sum + job.deadLetterRows, 0);
    const failedRows = failedImports.reduce((sum, job) => sum + job.failedRows, 0);

    return (
      <div className="space-y-5">
        <PageHeader
          title="Repair Center"
          description="Resolve failed imports and dead-letter channel submissions."
          breadcrumb={
            <>
              Dashboard / Operations / <span className="font-semibold text-slate-700">Repair Center</span>
            </>
          }
          actions={
            <>
              <Link href="/operations/imports" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
                Import Repairs
              </Link>
              <Link href="/operations/jobs" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
                Submission Jobs
              </Link>
            </>
          }
        />

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Import Jobs Requiring Repair" value={failedImports.length} tone={failedImports.length > 0 ? "warning" : "success"} />
          <KpiCard label="Import Dead-Letter Rows" value={deadLetterRows} tone={deadLetterRows > 0 ? "danger" : "default"} />
          <KpiCard label="Import Failed Rows" value={failedRows} tone={failedRows > 0 ? "warning" : "default"} />
          <KpiCard label="Submission Dead Letter Queue" value={deadLetterSubmissions.length} tone={deadLetterSubmissions.length > 0 ? "danger" : "default"} />
        </section>

        <Card>
          <CardTitle>Repair playbook</CardTitle>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">Fix source data first</p>
              <p className="mt-1 text-sm text-slate-600">
                Repair import rows when the catalog payload itself is incomplete, malformed, or mapped to the wrong category context.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">Retry delivery only when ready</p>
              <p className="mt-1 text-sm text-slate-600">
                Move to Jobs after the catalog or connector issue is resolved so retries do not repeat the same downstream failure.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">Escalate repeated dead letter</p>
              <p className="mt-1 text-sm text-slate-600">
                Escalate when the same submission keeps failing after fixes, because that usually points to connector configuration or receiver-side drift.
              </p>
            </div>
          </div>
        </Card>

        <section className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardTitle>Import Jobs Needing Repair</CardTitle>
            {failedImports.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">No import repair backlog.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {failedImports.slice(0, 10).map((job) => (
                  <li key={job.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50/50">
                    <div>
                      <p className="font-mono text-xs text-slate-700">{job.id}</p>
                      <p className="text-slate-600">{job.category?.path ?? job.categoryId}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusChip label={`${job.deadLetterRows} dead letter`} tone={job.deadLetterRows > 0 ? "danger" : "warning"} />
                      <Link href={`/operations/imports?bulkJobId=${encodeURIComponent(job.id)}`} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                        Repair
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle>Submission Dead Letter Queue</CardTitle>
            {deadLetterSubmissions.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">No dead-letter submission backlog.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {deadLetterSubmissions.slice(0, 10).map((submission) => (
                  <li key={submission.id} className="rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50/50">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-mono text-xs text-slate-700">{submission.id}</p>
                      <StatusChip label={translateJobStatus(submission.status)} tone="warning" />
                    </div>
                    <p className="mt-1 text-slate-600">Channel: {submission.channel}</p>
                    <p className="text-xs text-slate-500">{submission.failureReason ?? submission.dlqReason ?? "No reason recorded"}</p>
                    <Link href="/operations/jobs" className="mt-2 inline-flex rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                      Open in Jobs
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/operations/repair", error));
    }
    throw error;
  }
}
