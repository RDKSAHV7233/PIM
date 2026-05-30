import Link from "next/link";
import { redirect } from "next/navigation";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { RefreshOnInterval } from "@/components/ui/refresh-on-interval";
import { StatusChip } from "@/components/ui/status-chip";
import { buttonVariants } from "@/components/ui/button";
import {
  ApiHttpError,
  getBillingUsage,
  getDashboardHealth,
  getDashboardOperationsSummary,
  getKpiTrends,
  getProductList,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { canEditWorkspace } from "@/lib/role-capabilities";
import { cn } from "@/lib/utils";
import { getServerSession } from "@/lib/server-session";
import { formatDate, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

function isDashboardApiUnavailable(error: unknown): boolean {
  if (error instanceof ApiHttpError) {
    return error.status === 502 || error.status === 503 || error.status === 504;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  const cause = "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  const causeDetails =
    cause && typeof cause === "object"
      ? `${String((cause as { code?: unknown }).code ?? "")} ${String((cause as { message?: unknown }).message ?? "")}`.toLowerCase()
      : String(cause ?? "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    causeDetails.includes("econnrefused") ||
    causeDetails.includes("enotfound") ||
    causeDetails.includes("socket hang up")
  );
}

function DashboardUnavailableState() {
  return (
    <div className="space-y-5">
      <RefreshOnInterval intervalMs={30_000} />
      <PageHeader
        title="Dashboard"
        description="The workspace overview is reconnecting to the API. We will refresh automatically while staging recovers."
        actions={
          <>
            <Link
              href="/catalog/products"
              className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Open catalog
            </Link>
            <Link
              href="/operations/imports"
              className={cn(buttonVariants({ variant: "dark" }))}
            >
              Open imports
            </Link>
          </>
        }
      />
      <section
        aria-live="polite"
        aria-atomic="true"
        role="status"
        className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm"
      >
        <h2 className="text-sm font-semibold text-amber-900">Dashboard data is temporarily unavailable</h2>
        <p className="mt-2 text-sm text-amber-900/90">
          We could not reach the staging API for live dashboard data. This usually clears once the API
          service finishes restarting.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/dashboard"
            className="rounded-md border border-amber-300 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100"
          >
            Retry dashboard
          </Link>
          <Link
            href="/quality/issues"
            className="rounded-md border border-amber-300 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100"
          >
            Open issue inbox
          </Link>
        </div>
      </section>
    </div>
  );
}

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
  return formatDateTime(timestamp);
}

function sumTrendValues(points: Array<{ value: number }>): number {
  return points.reduce((sum, point) => sum + (Number.isFinite(point.value) ? point.value : 0), 0);
}

function getLatestTrendValue(points: Array<{ value: number }>): number {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const value = points[index]?.value;
    if (Number.isFinite(value)) {
      return Number(value);
    }
  }
  return 0;
}

function formatHours(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  if (value === 0) {
    return "0h";
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)}h`;
}

function formatTrendDayLabel(value: string): string {
  return formatDate(`${value}T00:00:00Z`, { timeZone: "UTC" });
}

function resolveSignupHealthAlert({
  rangeDays,
  requests,
  verifications,
  verificationRate,
  medianVerifyHours,
}: {
  rangeDays: number;
  requests: number;
  verifications: number;
  verificationRate: number;
  medianVerifyHours: number;
}) {
  const pending = Math.max(requests - verifications, 0);
  if (requests < 3) {
    return null;
  }
  if (verificationRate < 40) {
    return {
      tone: "danger" as const,
      title: "Signup verification needs attention",
      body: `${pending} teams are still unverified in the last ${rangeDays} days. Check the verification email path before friction compounds.`,
    };
  }
  if (medianVerifyHours >= 24) {
    return {
      tone: "warning" as const,
      title: "Signup verification is slowing down",
      body: `Median verify time is ${formatHours(medianVerifyHours)} in the last ${rangeDays} days. Review the onboarding email and support touchpoints causing delay.`,
    };
  }
  return {
    tone: "success" as const,
    title: "Signup conversion looks healthy",
    body: `${verifications} of ${requests} signup requests verified in the last ${rangeDays} days. Keep watching the admin signup trend view for sudden drops.`,
  };
}

function buildSignupSparklineRows(signupTrends: NonNullable<Awaited<ReturnType<typeof getKpiTrends>>>) {
  const rows = new Map<
    string,
    {
      date: string;
      requests: number;
      verifications: number;
    }
  >();

  for (const point of signupTrends.signupRequests) {
    rows.set(point.date, {
      date: point.date,
      requests: Number.isFinite(point.value) ? Number(point.value) : 0,
      verifications: 0,
    });
  }

  for (const point of signupTrends.signupVerifications) {
    const existing = rows.get(point.date) ?? {
      date: point.date,
      requests: 0,
      verifications: 0,
    };
    existing.verifications = Number.isFinite(point.value) ? Number(point.value) : 0;
    rows.set(point.date, existing);
  }

  const orderedRows = Array.from(rows.values())
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-10);
  const maxValue = Math.max(
    1,
    ...orderedRows.map((row) => Math.max(row.requests, row.verifications)),
  );

  return orderedRows.map((row) => ({
    ...row,
    label: formatTrendDayLabel(row.date),
    requestHeight: row.requests > 0 ? Math.max(6, Math.round((row.requests / maxValue) * 44)) : 0,
    verificationHeight:
      row.verifications > 0 ? Math.max(6, Math.round((row.verifications / maxValue) * 44)) : 0,
  }));
}

export default async function DashboardPage() {
  const { authHeader, actorRole } = await getServerSession();
  const canViewOperationsSummary = canEditWorkspace(actorRole);
  const canViewBillingUsage = canViewOperationsSummary;

  try {
    const [health, usage, operationsSummary, products, signupTrends] = await Promise.all([
      getDashboardHealth({ role: actorRole, authHeader }),
      canViewBillingUsage ? getBillingUsage({ role: actorRole, authHeader }) : Promise.resolve(null),
      canViewOperationsSummary
        ? getDashboardOperationsSummary({ role: actorRole, authHeader })
        : Promise.resolve(null),
      getProductList({ slim: true }, { role: actorRole, authHeader }),
      actorRole === "admin"
        ? getKpiTrends({ days: 30 }, { role: actorRole, authHeader })
        : Promise.resolve(null),
    ]);
    const activeConnectors = operationsSummary?.activeConnectors ?? null;
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
    const blockedListingsTotal =
      typeof health.blockedTotal === "number" ? health.blockedTotal : blockedListings;
    const readinessGrandTotal =
      typeof health.publishReadyTotal === "number" ? health.publishReadyTotal : readinessTotal;
    const completeness =
      health.snapshot.totalSkus > 0
        ? (health.snapshot.completeSkus / health.snapshot.totalSkus) * 100
        : 0;
    const pendingApprovals = Number(health.pendingApprovals ?? 0);
    const connectorBreakdownRedacted = health.redactedSections?.includes("connector_breakdown") ?? false;
    const approvalQueueRedacted = health.redactedSections?.includes("approval_queue") ?? false;
    const failedImportJobs = operationsSummary?.failedImportJobs ?? null;
    const jobsNeedingRetry = operationsSummary?.jobsNeedingRetry ?? null;
    const signupRequests = signupTrends ? Math.round(sumTrendValues(signupTrends.signupRequests)) : 0;
    const signupVerifications = signupTrends
      ? Math.round(sumTrendValues(signupTrends.signupVerifications))
      : 0;
    const signupPendingBacklog = Math.max(signupRequests - signupVerifications, 0);
    const signupVerificationRate = signupTrends
      ? getLatestTrendValue(signupTrends.signupVerificationRate)
      : 0;
    const signupMedianVerifyHours = signupTrends
      ? getLatestTrendValue(signupTrends.signupMedianTimeToVerifyHours)
      : 0;
    const signupWindowLabel = signupTrends ? `Last ${signupTrends.rangeDays} days` : "";
    const signupHealthAlert = signupTrends
      ? resolveSignupHealthAlert({
          rangeDays: signupTrends.rangeDays,
          requests: signupRequests,
          verifications: signupVerifications,
          verificationRate: signupVerificationRate,
          medianVerifyHours: signupMedianVerifyHours,
        })
      : null;
    const signupSparklineRows = signupTrends ? buildSignupSparklineRows(signupTrends) : [];
    const signupDrilldownHref = signupTrends
      ? `/admin/plan?days=${signupTrends.rangeDays}#signup-conversion`
      : "/admin/plan";
    const priorityProducts = products
      .map((product) => {
        const blockingCount = product.openValidationErrorCount ?? 0;
        const warningCount = product.openValidationWarningCount ?? 0;
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
    const priorityProductColumns: Column<(typeof priorityProducts)[number]>[] = [
      {
        key: "product",
        header: "Product",
        render: (product) => (
          <div className="space-y-1">
            <p className="font-medium text-slate-900">{product.title}</p>
            <p className="text-xs text-slate-500">{product.categoryPath ?? product.categoryId}</p>
          </div>
        ),
      },
      {
        key: "whyNow",
        header: "Why now",
        render: (product) => (
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
        ),
      },
      { key: "complete", header: "Complete %", render: (product) => `${product.completenessScore}%` },
      { key: "updated", header: "Updated", render: (product) => <span className="text-slate-600">{formatUpdatedAt(product.updatedAt)}</span> },
      {
        key: "action",
        header: "Action",
        render: (product) => (
          <Link href={`/products/${encodeURIComponent(product.id)}`} className="text-sm font-medium text-blue-700 hover:underline">
            Open product
          </Link>
        ),
      },
    ];

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
                className={cn(buttonVariants({ variant: "dark" }))}
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

        {products.length === 0 ? (
          <section className="rounded-lg border border-blue-200 bg-blue-50 p-5 shadow-sm">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-blue-950">Get started - 3 steps to your first export</h2>
                <p className="mt-1 max-w-2xl text-sm text-blue-900/80">
                  Use this onboarding checklist to move from an empty catalog to a channel-ready first publish.
                </p>
              </div>
              <StatusChip label="Onboarding checklist" tone="info" />
            </div>
            <ol className="mt-4 space-y-3">
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-sm font-semibold text-blue-700">
                  1
                </span>
                <span className="text-sm text-blue-900">
                  <strong>Add products.</strong>{" "}
                  <Link href="/operations/imports" className="underline underline-offset-2">Import a CSV</Link>{" "}
                  or{" "}
                  <Link href="/catalog/products" className="underline underline-offset-2">create one manually</Link>{" "}
                  to build your starting catalog.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-sm font-semibold text-blue-700">
                  2
                </span>
                <span className="text-sm text-blue-900">
                  <strong>Connect a channel.</strong>{" "}
                  <Link href="/channels/connectors" className="underline underline-offset-2">Set up a connector</Link>{" "}
                  and configure attribute mapping before you publish.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-sm font-semibold text-blue-700">
                  3
                </span>
                <span className="text-sm text-blue-900">
                  <strong>Run quality checks.</strong>{" "}
                  <Link href="/quality/issues" className="underline underline-offset-2">Review open issues</Link>{" "}
                  to make products publish-ready before the first export.
                </span>
              </li>
            </ol>
          </section>
        ) : null}

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
              className={cn(buttonVariants({ variant: "dark" }))}
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
              value={approvalQueueRedacted ? "-" : pendingApprovals}
              helper={
                approvalQueueRedacted
                  ? "Approval queue visibility requires reviewer, editor, or admin access."
                  : "Products waiting for review"
              }
              tone={approvalQueueRedacted ? "default" : pendingApprovals > 0 ? "warning" : "default"}
              href={approvalQueueRedacted ? undefined : "/quality/approvals"}
            />
            <KpiCard
              label="Ready to Publish"
              value={readinessGrandTotal}
              helper={
                connectorBreakdownRedacted
                  ? "Aggregate readiness is visible. Channel-level breakdown requires editor or admin access."
                  : `${health.snapshot.totalSkus} total products`
              }
              tone={readinessGrandTotal > 0 ? "success" : "info"}
              href={connectorBreakdownRedacted ? "/channels/health" : "/catalog/products?view=ready"}
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
              value={blockedListingsTotal}
              helper={
                connectorBreakdownRedacted
                  ? "Aggregate blocked counts are visible. Channel-level breakdown requires editor or admin access."
                  : "Publish-ready products currently blocked by channel rules"
              }
              tone={blockedListingsTotal > 0 ? "danger" : "success"}
              href="/channels/health"
            />
            <KpiCard
              label="Active Channels"
              value={activeConnectors ?? "-"}
              helper={
                operationsSummary
                  ? `${operationsSummary.installedConnectors} installed`
                  : "Channel operations are limited to editor and admin roles."
              }
              tone={
                operationsSummary
                  ? operationsSummary.activeConnectors > 0
                    ? "info"
                    : "warning"
                  : "default"
              }
              href={operationsSummary ? "/channels/connectors" : undefined}
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

        {actorRole !== "viewer" && signupTrends && (signupTrends.mappingCompletionRate.length > 0 || signupTrends.firstPublishSuccessRate.length > 0) ? (
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Connector Performance</h2>
              <p className="text-sm text-slate-500">
                Mapping completion, first publish success, and setup efficiency across your active connectors.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <KpiCard
                label="Mapping Completion Rate"
                value={
                  signupTrends.mappingCompletionRate.length > 0
                    ? `${Math.round((signupTrends.mappingCompletionRate.at(-1)?.value ?? 0) * 10) / 10}%`
                    : "—"
                }
                helper={
                  signupTrends.mappingCompletionRate.length > 0
                    ? `${signupTrends.mappingCompletionRate.at(-1)?.connectorSlug ?? "across connectors"} · last 30 days`
                    : "No mapping activity yet"
                }
                tone={
                  signupTrends.mappingCompletionRate.length === 0
                    ? "default"
                    : (signupTrends.mappingCompletionRate.at(-1)?.value ?? 0) >= 80
                      ? "success"
                      : (signupTrends.mappingCompletionRate.at(-1)?.value ?? 0) >= 50
                        ? "warning"
                        : "danger"
                }
                href="/channels/mappings"
              />
              <KpiCard
                label="First Publish Success Rate"
                value={
                  signupTrends.firstPublishSuccessRate.length > 0
                    ? `${Math.round((signupTrends.firstPublishSuccessRate.at(-1)?.value ?? 0) * 10) / 10}%`
                    : "—"
                }
                helper={
                  signupTrends.firstPublishSuccessRate.length > 0
                    ? `${signupTrends.firstPublishSuccessRate.at(-1)?.connectorSlug ?? "across connectors"} · last 30 days`
                    : "No publish activity yet"
                }
                tone={
                  signupTrends.firstPublishSuccessRate.length === 0
                    ? "default"
                    : (signupTrends.firstPublishSuccessRate.at(-1)?.value ?? 0) >= 80
                      ? "success"
                      : (signupTrends.firstPublishSuccessRate.at(-1)?.value ?? 0) >= 50
                        ? "warning"
                        : "danger"
                }
                href="/channels/health"
              />
              <KpiCard
                label="Avg Setup to First Publish"
                value={
                  signupTrends.setupTimeToFirstPublishHours.length > 0
                    ? `${Math.round(signupTrends.setupTimeToFirstPublishHours.at(-1)?.value ?? 0)}h`
                    : "—"
                }
                helper={
                  signupTrends.setupTimeToFirstPublishHours.length > 0
                    ? "Hours from connector install to first successful publish"
                    : "No completed installs with publish yet"
                }
                tone={
                  signupTrends.setupTimeToFirstPublishHours.length === 0
                    ? "default"
                    : (signupTrends.setupTimeToFirstPublishHours.at(-1)?.value ?? 0) <= 24
                      ? "success"
                      : (signupTrends.setupTimeToFirstPublishHours.at(-1)?.value ?? 0) <= 72
                        ? "warning"
                        : "danger"
                }
                href="/channels/connectors"
              />
            </div>
          </section>
        ) : null}

        {actorRole === "admin" && signupTrends ? (
          <section className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Signup Funnel</h2>
                <p className="text-sm text-slate-500">
                  Track self-serve workspace creation and how quickly teams finish verification.
                </p>
              </div>
              <Link
                href={signupDrilldownHref}
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Open signup trends
              </Link>
            </div>
            {signupHealthAlert ? (
              <div
                className={`rounded-md border px-3 py-3 text-sm ${
                  signupHealthAlert.tone === "danger"
                    ? "border-red-200 bg-red-50 text-red-900"
                    : signupHealthAlert.tone === "warning"
                      ? "border-amber-200 bg-amber-50 text-amber-900"
                      : "border-emerald-200 bg-emerald-50 text-emerald-900"
                }`}
              >
                <div className="font-semibold">{signupHealthAlert.title}</div>
                <div className="mt-1">{signupHealthAlert.body}</div>
              </div>
            ) : null}
            {signupRequests > 0 ? (
              <div
                className={`rounded-md border px-3 py-3 text-sm ${
                  signupPendingBacklog > 0
                    ? "border-sky-200 bg-sky-50 text-sky-900"
                    : "border-slate-200 bg-slate-50 text-slate-700"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">Pending Verification Backlog</div>
                    <div className="mt-1">
                      {signupPendingBacklog > 0
                        ? `${signupPendingBacklog} signup requests in the last ${signupTrends.rangeDays} days still need email verification. Use the admin trend view to spot the slowest days.`
                        : `No pending verifications remain in the last ${signupTrends.rangeDays} days.`}
                    </div>
                  </div>
                  <Link
                    href={signupDrilldownHref}
                    className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-white"
                  >
                    Review backlog
                  </Link>
                </div>
              </div>
            ) : null}
            {signupSparklineRows.length > 0 ? (
              <div className="rounded-md border border-slate-200 bg-slate-50/70 px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Signup Trend Snapshot</div>
                    <div className="text-xs text-slate-500">
                      Last {signupSparklineRows.length} active days of signup and verification activity.
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
                      Signups
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                      Verified
                    </span>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(36px,1fr))] items-end gap-2">
                  {signupSparklineRows.map((row) => (
                    <div key={row.date} className="text-center">
                      <div className="mx-auto flex h-16 items-end justify-center gap-1">
                        <div
                          aria-label={`${row.date} dashboard signups`}
                          className="w-2.5 rounded-t bg-slate-400"
                          style={{ height: `${row.requestHeight}px` }}
                        />
                        <div
                          aria-label={`${row.date} dashboard verified workspaces`}
                          className="w-2.5 rounded-t bg-emerald-500"
                          style={{ height: `${row.verificationHeight}px` }}
                        />
                      </div>
                      <div className="mt-2 text-[10px] font-medium text-slate-500">{row.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                label="Workspace Signups"
                value={signupRequests}
                helper={signupWindowLabel}
                tone={signupRequests > 0 ? "info" : "default"}
                href={signupDrilldownHref}
              />
              <KpiCard
                label="Verified Workspaces"
                value={signupVerifications}
                helper={
                  signupRequests > 0
                    ? `${Math.max(signupRequests - signupVerifications, 0)} still pending or unverified`
                    : "No signup activity yet"
                }
                tone={signupVerifications > 0 ? "success" : "default"}
                href={signupDrilldownHref}
              />
              <KpiCard
                label="Verification Rate"
                value={formatPercent(signupVerificationRate)}
                helper={
                  signupRequests > 0
                    ? `${signupVerifications} of ${signupRequests} signups completed`
                    : "No signups in the current window"
                }
                tone={
                  signupRequests === 0
                    ? "default"
                    : signupVerificationRate >= 60
                      ? "success"
                      : "warning"
                }
                href={signupDrilldownHref}
              />
              <KpiCard
                label="Median Verify Time"
                value={formatHours(signupMedianVerifyHours)}
                helper={
                  signupVerifications > 0
                    ? "Latest daily median from request to verification"
                    : "No completed verifications yet"
                }
                tone={
                  signupVerifications === 0
                    ? "default"
                    : signupMedianVerifyHours <= 24
                      ? "success"
                      : "warning"
                }
                href={signupDrilldownHref}
              />
            </div>
          </section>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Top products to fix now</h2>
            <p className="mt-1 text-sm text-slate-500">
              Start here instead of hunting through separate channel and operations screens.
            </p>
            {priorityProducts.length === 0 ? (
              <p className="mt-4 text-sm text-slate-600">No products need immediate attention.</p>
            ) : (
              <DataGrid className="mt-4" columns={priorityProductColumns} rows={priorityProducts} getRowKey={(product) => product.id} />
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
                <StatusChip
                  label={approvalQueueRedacted ? "Restricted" : String(pendingApprovals)}
                  tone={approvalQueueRedacted ? "neutral" : pendingApprovals > 0 ? "warning" : "neutral"}
                />
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
                {operationsSummary ? (
                  <StatusChip
                    label={String(failedImportJobs)}
                    tone={operationsSummary.failedImportJobs > 0 ? "warning" : "neutral"}
                  />
                ) : (
                  <StatusChip label="Restricted" tone="neutral" />
                )}
              </li>
              <li className="flex items-center justify-between">
                <span>Jobs needing retry</span>
                {operationsSummary ? (
                  <StatusChip
                    label={String(jobsNeedingRetry)}
                    tone={operationsSummary.jobsNeedingRetry > 0 ? "warning" : "neutral"}
                  />
                ) : (
                  <StatusChip label="Restricted" tone="neutral" />
                )}
              </li>
              {!operationsSummary ? (
                <li className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Operational job counts are limited to editor and admin roles.
                </li>
              ) : null}
              {usage ? (
                <>
                  <li className="flex items-center justify-between">
                    <span>Plan tier</span>
                    <StatusChip label={usage.planTier} tone="info" />
                  </li>
                  <li className="flex items-center justify-between">
                    <span>SKU usage</span>
                    <StatusChip label={`${usage.skus.current}/${usage.skus.limit}`} tone="neutral" />
                  </li>
                </>
              ) : (
                <li className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Plan and billing usage are limited to editor and admin roles.
                </li>
              )}
            </ul>
            <div className="mt-4 flex gap-2">
              {operationsSummary ? (
                <Link href="/operations/jobs" className="text-sm font-medium text-blue-700 hover:underline">
                  Open Failed Jobs
                </Link>
              ) : null}
              {usage ? (
                <Link href="/admin/plan" className="text-sm font-medium text-blue-700 hover:underline">
                  Open Plan &amp; Usage
                </Link>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    );
  } catch (error) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/dashboard", error));
    }
    if (isDashboardApiUnavailable(error)) {
      return <DashboardUnavailableState />;
    }
    throw error;
  }
}
