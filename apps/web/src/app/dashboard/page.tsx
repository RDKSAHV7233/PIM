import Link from "next/link";
import { redirect } from "next/navigation";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { RefreshOnInterval } from "@/components/ui/refresh-on-interval";
import { StatusChip } from "@/components/ui/status-chip";
import {
  ApiHttpError,
  getBillingUsage,
  getBulkImportJobs,
  getDashboardHealth,
  getDeadLetterSubmissions,
  getInstalledConnectors,
  getProducts,
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

function formatUpdatedAt(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return "-";
  }
  return timestamp.toLocaleString();
}

export default async function DashboardPage() {
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();

  try {
    const [stats, health, usage, connectors, submissionsResponse, deadLetterResponse, imports, products] = await Promise.all([
      getStats({ role: actorRole, authHeader }),
      getDashboardHealth({ role: actorRole, authHeader }),
      getBillingUsage({ role: actorRole, authHeader }),
      getInstalledConnectors({ role: actorRole, authHeader }),
      getSubmissions({ limit: 200 }, { role: actorRole, authHeader }),
      getDeadLetterSubmissions({ limit: 200 }, { role: actorRole, authHeader }),
      getBulkImportJobs({ role: actorRole, authHeader }),
      getProducts({ role: actorRole, authHeader }),
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
    const pendingApprovals = Number(stats.pendingApprovals ?? 0);
    const failedImportJobs = imports.filter((job) => job.status === "failed" || job.status === "dead_letter").length;
    const failedSubmissionJobs = submissions.filter((submission) => {
      const status = String(submission.status ?? "").toUpperCase();
      return status === "REJECTED" || status === "ERROR";
    }).length;
    const jobsNeedingRetry = failedSubmissionJobs + deadLetterJobs.length;
    const priorityProducts = products
      .map((product) => {
        const blockingCount = (product.validationIssues ?? []).filter((issue) => issue.severity === "error").length;
        const warningCount = (product.validationIssues ?? []).filter((issue) => issue.severity === "warning").length;
        const completenessScore = product.completenessScore ?? 0;
        const priorityReason =
          product.status === "in_review"
            ? "Awaiting review"
            : blockingCount > 0
              ? `${blockingCount} blocking issue${blockingCount === 1 ? "" : "s"}`
              : completenessScore < 100
                ? "Missing product data"
                : warningCount > 0
                  ? `${warningCount} warning${warningCount === 1 ? "" : "s"}`
                  : "Ready for publish review";
        return {
          ...product,
          blockingCount,
          warningCount,
          completenessScore,
          priorityReason,
        };
      })
      .sort((left, right) => {
        const leftNeedsApproval = left.status === "in_review" ? 1 : 0;
        const rightNeedsApproval = right.status === "in_review" ? 1 : 0;
        if (leftNeedsApproval !== rightNeedsApproval) {
          return rightNeedsApproval - leftNeedsApproval;
        }
        if (left.blockingCount !== right.blockingCount) {
          return right.blockingCount - left.blockingCount;
        }
        if (left.completenessScore !== right.completenessScore) {
          return left.completenessScore - right.completenessScore;
        }
        if (left.warningCount !== right.warningCount) {
          return right.warningCount - left.warningCount;
        }
        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      })
      .slice(0, 5);

    return (
      <div className="space-y-5">
        <RefreshOnInterval intervalMs={30_000} />
        <PageHeader
          title="Dashboard"
          description="Start with catalog health, then review channel readiness and operational follow-up."
          actions={
            <>
              <Link
                href="/catalog/products"
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                New Product
              </Link>
              <Link
                href="/quality/issues"
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Fix Issues
              </Link>
              <Link
                href="/operations/imports"
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Import Catalog
              </Link>
            </>
          }
        />

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Catalog Health</h2>
              <p className="text-sm text-slate-500">
                Focus on missing data, review queues, and products ready to publish.
              </p>
            </div>
            <Link
              href="/catalog/products"
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Open product workbench
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Products Needing Enrichment"
              value={health.snapshot.incompleteSkus}
              helper={`${formatPercent(completeness)} completeness`}
              tone={health.snapshot.incompleteSkus > 0 ? "warning" : "success"}
              href="/catalog/products?view=needs_attention"
            />
            <KpiCard
              label="Blocking Issues"
              value={blockingIssues}
              helper={`${warningIssues} warnings to review`}
              tone={blockingIssues > 0 ? "danger" : "success"}
              href="/quality/issues?severity=BLOCKING"
            />
            <KpiCard
              label="Pending Approvals"
              value={pendingApprovals}
              helper="Products waiting for review"
              tone={pendingApprovals > 0 ? "warning" : "default"}
              href="/quality/approvals"
            />
            <KpiCard
              label="Ready to Publish"
              value={readinessTotal}
              helper={`${stats.products} total products`}
              tone={readinessTotal > 0 ? "success" : "info"}
              href="/catalog/products?view=ready"
            />
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Publishing Health</h2>
            <p className="text-sm text-slate-500">
              Review channel availability and publish blockers after the catalog is in shape.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <KpiCard
              label="Blocked Listings"
              value={blockedListings}
              helper="Publish-ready products currently blocked by channel rules"
              tone={blockedListings > 0 ? "danger" : "success"}
              href="/channels/health"
            />
            <KpiCard
              label="Active Channels"
              value={activeConnectors}
              helper={`${connectors.length} installed`}
              tone={activeConnectors > 0 ? "info" : "warning"}
              href="/channels/connectors"
            />
            <KpiCard
              label="Warnings to Review"
              value={warningIssues}
              helper="Non-blocking quality issues worth resolving"
              tone={warningIssues > 0 ? "warning" : "default"}
              href="/quality/issues?severity=WARNING"
            />
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Top products to fix now</h2>
            <p className="mt-1 text-sm text-slate-500">
              Start here instead of hunting through separate channel and operations screens.
            </p>
            {priorityProducts.length === 0 ? (
              <p className="mt-4 text-sm text-slate-600">No products need immediate attention.</p>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Product</th>
                      <th className="px-3 py-2">Why now</th>
                      <th className="px-3 py-2">Complete %</th>
                      <th className="px-3 py-2">Updated</th>
                      <th className="px-3 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {priorityProducts.map((product) => (
                      <tr key={product.id} className="border-t border-slate-200 hover:bg-slate-50/50">
                        <td className="px-3 py-2.5">
                          <div className="space-y-1">
                            <p className="font-medium text-slate-900">{product.title}</p>
                            <p className="text-xs text-slate-500">{product.category?.path ?? product.categoryId}</p>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="space-y-1">
                            <StatusChip
                              label={product.priorityReason}
                              tone={
                                product.blockingCount > 0
                                  ? "danger"
                                  : product.status === "in_review"
                                    ? "warning"
                                    : product.warningCount > 0
                                      ? "warning"
                                      : "info"
                              }
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2.5">{product.completenessScore}%</td>
                        <td className="px-3 py-2.5 text-slate-600">{formatUpdatedAt(product.updatedAt)}</td>
                        <td className="px-3 py-2.5">
                          <Link
                            href={`/products/${encodeURIComponent(product.id)}`}
                            className="text-sm font-medium text-blue-700 hover:underline"
                          >
                            Open product
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Next best actions</h2>
            <p className="mt-1 text-sm text-slate-500">
              Move from fixing data to reviewing readiness, then publish.
            </p>
            <div className="mt-4 grid gap-3">
              <Link
                href="/catalog/products?view=needs_attention"
                className="rounded-md border border-slate-200 px-3 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Review products needing attention
              </Link>
              <Link
                href="/quality/issues"
                className="rounded-md border border-slate-200 px-3 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Open issue inbox
              </Link>
              <Link
                href="/quality/approvals"
                className="rounded-md border border-slate-200 px-3 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Review approval queue
              </Link>
              <Link
                href="/channels/mappings"
                className="rounded-md border border-slate-200 px-3 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Review channel mappings
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Catalog Work Queue</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              <li className="flex items-center justify-between">
                <span>Products needing enrichment</span>
                <StatusChip label={String(health.snapshot.incompleteSkus)} tone={health.snapshot.incompleteSkus > 0 ? "warning" : "neutral"} />
              </li>
              <li className="flex items-center justify-between">
                <span>Pending approvals</span>
                <StatusChip label={String(pendingApprovals)} tone={pendingApprovals > 0 ? "warning" : "neutral"} />
              </li>
              <li className="flex items-center justify-between">
                <span>Blocking issues</span>
                <StatusChip label={String(blockingIssues)} tone={blockingIssues > 0 ? "danger" : "neutral"} />
              </li>
              <li className="flex items-center justify-between">
                <span>Warnings to review</span>
                <StatusChip label={String(warningIssues)} tone={warningIssues > 0 ? "warning" : "neutral"} />
              </li>
            </ul>
            <div className="mt-4 flex gap-2">
              <Link href="/catalog/products" className="text-sm font-medium text-blue-700 hover:underline">
                Open Products
              </Link>
              <Link href="/quality/issues" className="text-sm font-medium text-blue-700 hover:underline">
                Open Issue Inbox
              </Link>
              <Link href="/quality/approvals" className="text-sm font-medium text-blue-700 hover:underline">
                Open Approval Queue
              </Link>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Operations &amp; Usage</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              <li className="flex items-center justify-between">
                <span>Imports needing repair</span>
                <StatusChip
                  label={String(failedImportJobs)}
                  tone={failedImportJobs > 0 ? "warning" : "neutral"}
                />
              </li>
              <li className="flex items-center justify-between">
                <span>Jobs needing retry</span>
                <StatusChip
                  label={String(jobsNeedingRetry)}
                  tone={jobsNeedingRetry > 0 ? "warning" : "neutral"}
                />
              </li>
              <li className="flex items-center justify-between">
                <span>Plan tier</span>
                <StatusChip label={usage.planTier} tone="info" />
              </li>
              <li className="flex items-center justify-between">
                <span>SKU usage</span>
                <StatusChip label={`${usage.skus.current}/${usage.skus.limit}`} tone="neutral" />
              </li>
            </ul>
            <div className="mt-4 flex gap-2">
              <Link href="/operations/jobs" className="text-sm font-medium text-blue-700 hover:underline">
                Open Failed Jobs
              </Link>
              <Link href="/admin/plan" className="text-sm font-medium text-blue-700 hover:underline">
                Open Plan &amp; Usage
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
