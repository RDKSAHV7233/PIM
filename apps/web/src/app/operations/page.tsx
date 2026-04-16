import { redirect } from "next/navigation";
import { KpiCard } from "@/components/ui/kpi-card";
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
          description="Track imports, fix failures, and manage bulk changes."
          breadcrumb={<span className="font-semibold text-slate-700">Operations</span>}
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
            value={submissions.length}
            helper={`${submissionNeedsAttention} rejected/error`}
            tone={submissionNeedsAttention > 0 ? "danger" : "default"}
            href="/operations/jobs"
          />
          <KpiCard
            label="Dead Letter Queue"
            value={deadLetterJobs.length}
            helper="Jobs pending manual recovery"
            tone={deadLetterJobs.length > 0 ? "danger" : "success"}
            href="/operations/repair"
          />
          <KpiCard
            label="Jobs Needing Retry"
            value={submissions.filter((submission) => submission.status === "ERROR").length}
            helper="Errored submissions awaiting manual retry"
            tone={submissions.some((submission) => submission.status === "ERROR") ? "warning" : "default"}
            href="/operations/jobs"
          />
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
