import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  ApiHttpError,
  getBulkImportJobs,
  getDeadLetterSubmissions,
  getSubmissions,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
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

export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();

  try {
    const [imports, submissionsResponse, deadLetterResponse] = await Promise.all([
      getBulkImportJobs({ role: actorRole, authHeader }),
      getSubmissions({ limit: 100 }, { role: actorRole, authHeader }),
      getDeadLetterSubmissions({ limit: 100 }, { role: actorRole, authHeader }),
    ]);

    const submissions = toItems(submissionsResponse);
    const deadLetterJobs = toItems(deadLetterResponse);
    const importNeedsAttention = imports.filter((job) => job.status === "failed" || job.status === "dead_letter").length;
    const submissionNeedsAttention = submissions.filter((submission) => submission.status === "REJECTED" || submission.status === "ERROR").length;

    return (
      <div className="space-y-5">
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
          <Card>
            <CardTitle>Import Jobs</CardTitle>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{imports.length}</p>
            <p className="mt-1 text-xs text-slate-500">{importNeedsAttention} need attention</p>
          </Card>
          <Card>
            <CardTitle>Submission Jobs</CardTitle>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{submissions.length}</p>
            <p className="mt-1 text-xs text-slate-500">{submissionNeedsAttention} rejected/error</p>
          </Card>
          <Card>
            <CardTitle>Dead Letter Queue</CardTitle>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{deadLetterJobs.length}</p>
            <p className="mt-1 text-xs text-slate-500">Jobs pending manual recovery</p>
          </Card>
          <Card>
            <CardTitle>Bulk Edit Control</CardTitle>
            <p className="mt-2 text-sm text-slate-700">Use scoped preview before applying any mass change.</p>
          </Card>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardTitle>Imports</CardTitle>
            <p className="mt-2 text-sm text-slate-600">Track import jobs and repair failed rows.</p>
            <Link href="/operations/imports" className="mt-4 inline-flex text-sm font-medium underline">
              Open Imports
            </Link>
          </Card>
          <Card>
            <CardTitle>Bulk Edit</CardTitle>
            <p className="mt-2 text-sm text-slate-600">Review and run scoped mass updates safely.</p>
            <Link href="/operations/bulk-edit" className="mt-4 inline-flex text-sm font-medium underline">
              Open Bulk Edit
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
            <p className="mt-2 text-sm text-slate-600">Investigate dead-letter and row-level failures with guided recovery.</p>
            <Link href="/operations/repair" className="mt-4 inline-flex text-sm font-medium underline">
              Open Repair Center
            </Link>
          </Card>
        </section>
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/operations", error.status));
    }
    throw error;
  }
}
