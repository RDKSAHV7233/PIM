import Link from "next/link";
import { redirect } from "next/navigation";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import {
  ApiHttpError,
  getBillingUsage,
  getBulkImportJobs,
  getDashboardHealth,
  getDeadLetterSubmissions,
  getInstalledConnectors,
  getStats,
  getSubmissions,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return "0%";
  }
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

export default async function DashboardPage() {
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();

  try {
    const [stats, health, usage, connectors, submissionsResponse, deadLetterResponse, imports] = await Promise.all([
      getStats({ role: actorRole, authHeader }),
      getDashboardHealth({ role: actorRole, authHeader }),
      getBillingUsage({ role: actorRole, authHeader }),
      getInstalledConnectors({ role: actorRole, authHeader }),
      getSubmissions({ limit: 200 }, { role: actorRole, authHeader }),
      getDeadLetterSubmissions({ limit: 200 }, { role: actorRole, authHeader }),
      getBulkImportJobs({ role: actorRole, authHeader }),
    ]);
    const submissions = Array.isArray(submissionsResponse)
      ? submissionsResponse
      : submissionsResponse.items ?? [];
    const deadLetterJobs = Array.isArray(deadLetterResponse)
      ? deadLetterResponse
      : deadLetterResponse.items ?? [];

    const activeConnectors = connectors.filter((item) => item.status === "ACTIVE").length;
    const blockingIssues = health.snapshot.openIssuesBlocking;
    const warningIssues = health.snapshot.openIssuesWarning;
    const blockedListings = Object.values(health.snapshot.blockedByConnector).reduce(
      (sum, count) => sum + count,
      0,
    );
    const readinessTotal = Object.values(health.snapshot.publishReadyByConnector).reduce(
      (sum, count) => sum + count,
      0,
    );
    const completeness =
      stats.products > 0 ? (health.snapshot.completeSkus / stats.products) * 100 : 0;
    const failedImportJobs = imports.filter((job) => job.status === "failed" || job.status === "dead_letter").length;
    const failedSubmissionJobs = submissions.filter((submission) => {
      const status = String(submission.status ?? "").toUpperCase();
      return status === "REJECTED" || status === "ERROR";
    }).length;
    const jobsNeedingRetry = failedSubmissionJobs + deadLetterJobs.length;
    const failedJobsTotal = failedImportJobs + jobsNeedingRetry;

    return (
      <div className="space-y-5">
        <PageHeader
          title="Dashboard"
          description="What needs attention now across catalog, channels, and operations."
          actions={
            <>
              <Link
                href="/catalog/products"
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                New Product
              </Link>
              <Link
                href="/operations/imports"
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Import Catalog
              </Link>
              <Link
                href="/quality/issues"
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Fix Issues
              </Link>
            </>
          }
        />

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard label="Total SKUs" value={stats.products} helper={`Variants: ${stats.variants}`} />
          <KpiCard
            label="Incomplete Products"
            value={health.snapshot.incompleteSkus}
            helper={`${formatPercent(completeness)} completeness`}
            tone={health.snapshot.incompleteSkus > 0 ? "warning" : "success"}
          />
          <KpiCard
            label="Blocked Listings"
            value={blockedListings}
            helper="Listing-level channel BLOCK"
            tone={blockedListings > 0 ? "danger" : "success"}
          />
          <KpiCard
            label="Failed Jobs (Recent)"
            value={failedJobsTotal}
            helper={`${failedImportJobs} import + ${jobsNeedingRetry} submission retries`}
            tone={failedJobsTotal > 0 ? "danger" : "default"}
          />
          <KpiCard
            label="Active Channels"
            value={activeConnectors}
            helper={`${connectors.length} installed`}
            tone={activeConnectors > 0 ? "info" : "warning"}
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Work Queue</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              <li className="flex items-center justify-between">
                <span>Assigned Issues</span>
                <StatusChip label={String(blockingIssues)} tone={blockingIssues > 0 ? "danger" : "neutral"} />
              </li>
              <li className="flex items-center justify-between">
                <span>Pending Approvals</span>
                <StatusChip label="0" />
              </li>
              <li className="flex items-center justify-between">
                <span>Imports Needing Repair</span>
                <StatusChip
                  label={String(failedImportJobs)}
                  tone={failedImportJobs > 0 ? "warning" : "neutral"}
                />
              </li>
              <li className="flex items-center justify-between">
                <span>Jobs Needing Retry</span>
                <StatusChip
                  label={String(jobsNeedingRetry)}
                  tone={jobsNeedingRetry > 0 ? "warning" : "neutral"}
                />
              </li>
            </ul>
            <div className="mt-4 flex gap-2">
              <Link href="/quality/issues" className="text-sm font-medium text-blue-700 hover:underline">
                Open Issue Inbox
              </Link>
              <Link href="/operations/jobs" className="text-sm font-medium text-blue-700 hover:underline">
                Open Failed Jobs
              </Link>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Health Snapshot</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              <li className="flex items-center justify-between">
                <span>Catalog Health</span>
                <StatusChip
                  label={blockingIssues > 0 ? "Attention" : "Healthy"}
                  tone={blockingIssues > 0 ? "warning" : "success"}
                />
              </li>
              <li className="flex items-center justify-between">
                <span>Channel Readiness</span>
                <StatusChip label={`${readinessTotal} ready`} tone="info" />
              </li>
              <li className="flex items-center justify-between">
                <span>Operations Health</span>
                <StatusChip
                  label={failedJobsTotal > 0 ? "Retry needed" : "Stable"}
                  tone={failedJobsTotal > 0 ? "warning" : "success"}
                />
              </li>
            </ul>
            <div className="mt-4">
              <Link href="/channels" className="text-sm font-medium text-blue-700 hover:underline">
                Configure Channel
              </Link>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Plan & Usage</h2>
            <p className="mt-3 text-sm text-slate-700">
              Plan <span className="font-semibold">{usage.planTier}</span>
            </p>
            <ul className="mt-2 space-y-2 text-sm text-slate-700">
              <li>SKUs: {usage.skus.current}/{usage.skus.limit}</li>
              <li>Submissions: {usage.submissions.current}/{usage.submissions.limit}</li>
              <li>Storage: {usage.storageGb.current.toFixed(2)}/{usage.storageGb.limit} GB</li>
            </ul>
            <div className="mt-4">
              <Link href="/admin/plan" className="text-sm font-medium text-blue-700 hover:underline">
                Open Plan & Usage
              </Link>
            </div>
          </div>
        </section>
      </div>
    );
  } catch (error) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/dashboard", error.status));
    }
    throw error;
  }
}
