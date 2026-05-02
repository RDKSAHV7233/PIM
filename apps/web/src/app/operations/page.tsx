import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { RefreshOnInterval } from "@/components/ui/refresh-on-interval";
import {
  ApiHttpError,
  getBulkImportJobs,
  getDeadLetterSubmissions,
  getSubmissions,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { canEditWorkspace } from "@/lib/role-capabilities";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

function toItems<T>(value: T[] | { items: T[] } | null | undefined): T[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return Array.isArray(value.items) ? value.items : [];
}

function resolveResponseTotal<T>(value: T[] | { items: T[] } | null | undefined): number {
  if (!value || Array.isArray(value)) {
    return value?.length ?? 0;
  }
  const raw = value as { total?: unknown; count?: unknown; items?: unknown[] };
  if (typeof raw.total === "number" && Number.isFinite(raw.total)) {
    return raw.total;
  }
  if (typeof raw.count === "number" && Number.isFinite(raw.count)) {
    return raw.count;
  }
  return Array.isArray(raw.items) ? raw.items.length : 0;
}

export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  const submissionWindowLimit = 500;
  const deadLetterWindowLimit = 500;
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();
  const canRunWriteOperations = canEditWorkspace(actorRole);

  try {
    const [imports, submissionsResponse, deadLetterResponse] = await Promise.all([
      getBulkImportJobs({ role: actorRole, authHeader }),
      /*
       * Legacy contract reference: getSubmissions({ limit: 100 }, { role: actorRole, authHeader })
       * TODO: replace with count endpoint when available.
       */
      getSubmissions({ limit: submissionWindowLimit }, { role: actorRole, authHeader }),
      /*
       * Legacy contract reference: getDeadLetterSubmissions({ limit: 100 }, { role: actorRole, authHeader })
       * TODO: replace with count endpoint when available.
       */
      getDeadLetterSubmissions({ limit: deadLetterWindowLimit }, { role: actorRole, authHeader }),
    ]);

    const submissions = toItems(submissionsResponse);
    const submissionTotal = resolveResponseTotal(submissionsResponse);
    const deadLetterTotal = resolveResponseTotal(deadLetterResponse);
    const importNeedsAttention = imports.filter((job) => job.status === "failed" || job.status === "dead_letter").length;
    const submissionNeedsAttention = submissions.filter((submission) => submission.status === "REJECTED" || submission.status === "ERROR").length;

    return (
      <div className="space-y-5">
        <RefreshOnInterval intervalMs={30_000} />
        <PageHeader
          title="Operations"
          description="Throughput workspace for imports, bulk edits, jobs, and repairs."
          breadcrumb={
            <>
              Dashboard / <span className="font-semibold text-slate-700">Operations</span>
            </>
          }
        />

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Import Jobs"
            value={imports.length}
            helper={`${importNeedsAttention} need attention`}
            tone={importNeedsAttention > 0 ? "warning" : "default"}
            href="/operations/imports"
          />
          <KpiCard
            label="Submission Jobs"
            value={submissionTotal}
            helper={
              submissions.length >= submissionWindowLimit
                ? `${submissionNeedsAttention} of latest ${submissionWindowLimit} rejected/error`
                : `${submissionNeedsAttention} of ${submissionTotal} rejected/error`
            }
            tone={submissionNeedsAttention > 0 ? "danger" : "default"}
            href="/operations/jobs"
          />
          <KpiCard
            label="Dead Letter Queue"
            value={deadLetterTotal}
            helper={
              deadLetterTotal >= deadLetterWindowLimit
                ? `Latest ${deadLetterWindowLimit} jobs pending manual recovery`
                : "Jobs pending manual recovery"
            }
            tone={deadLetterTotal > 0 ? "danger" : "success"}
            href="/operations/repair"
          />
          <KpiCard
            label={canRunWriteOperations ? "Bulk Edit Control" : "Bulk Edit Review"}
            value={canRunWriteOperations ? "Preview first" : "Read only"}
            helper={
              canRunWriteOperations
                ? "Use scoped preview before applying any mass change."
                : "Workspace editors and admins apply bulk changes after preview."
            }
            tone="info"
            href="/operations/bulk-edit"
          />
        </section>
        <p className="text-xs text-slate-500">Refreshes every 30s</p>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardTitle>Imports</CardTitle>
            <p className="mt-2 text-sm text-slate-600">
              {canRunWriteOperations
                ? "Track import jobs and repair failed rows."
                : "Track import jobs and repair backlog. Workspace editors and admins start new imports."}
            </p>
            <Link href="/operations/imports" className="mt-4 inline-flex text-sm font-medium underline">
              {canRunWriteOperations ? "Open Imports" : "Review Imports"}
            </Link>
          </Card>
          <Card>
            <CardTitle>Bulk Edit</CardTitle>
            <p className="mt-2 text-sm text-slate-600">
              {canRunWriteOperations
                ? "Review and run scoped mass updates safely."
                : "Review pending bulk-edit scope safely. Workspace editors and admins apply mass changes."}
            </p>
            <Link href="/operations/bulk-edit" className="mt-4 inline-flex text-sm font-medium underline">
              {canRunWriteOperations ? "Open Bulk Edit" : "Review Bulk Edit"}
            </Link>
          </Card>
          <Card>
            <CardTitle>Jobs</CardTitle>
            <p className="mt-2 text-sm text-slate-600">Monitor submission statuses, failures, and retries.</p>
            <Link href="/operations/jobs" className="mt-4 inline-flex text-sm font-medium underline">
              Open Jobs
            </Link>
          </Card>
          <Card>
            <CardTitle>Repair Center</CardTitle>
            <p className="mt-2 text-sm text-slate-600">
              {canRunWriteOperations
                ? "Investigate dead-letter and row-level failures with guided recovery."
                : "Review dead-letter and row-level failures. Workspace editors and admins complete guided recovery."}
            </p>
            <Link href="/operations/repair" className="mt-4 inline-flex text-sm font-medium underline">
              {canRunWriteOperations ? "Open Repair Center" : "Review Repair Center"}
            </Link>
          </Card>
        </section>
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/operations", error));
    }
    throw error;
  }
}
