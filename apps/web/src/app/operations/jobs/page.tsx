import Link from "next/link";
import { redirect } from "next/navigation";
import { retryFailedBulkPublishRunAction, retrySubmissionAction } from "@/app/actions";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { KpiCard } from "@/components/ui/kpi-card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { RefreshOnInterval } from "@/components/ui/refresh-on-interval";
import { Select } from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import { Timeline, type TimelineItem } from "@/components/ui/timeline";
import { ApiHttpError, getBulkPublishRuns, getDeadLetterSubmissions, getSubmissions } from "@/lib/api";
import { getInstalledConnectors } from "@/lib/api/connectors";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { canEditWorkspace, canPublishToChannels } from "@/lib/role-capabilities";
import { resolveInstallationLabel } from "@/lib/connector-utils";
import { getServerSession } from "@/lib/server-session";
import { formatDateTime } from "@/lib/format";
import { describeError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type SharedReadState = "available" | "restricted" | "unavailable";
type SharedReadResult<T> =
  | { state: "available"; value: T }
  | { state: "restricted" }
  | { state: "unavailable" };

interface OperationsJobsPageProps {
  searchParams: Promise<{
    status?: string;
    connectorSlug?: string;
    submissionId?: string;
    installationId?: string;
    retryError?: string;
    retryErrorMessage?: string;
  }>;
}

function toItems<T>(value: T[] | { items: T[] } | null | undefined): T[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  return Array.isArray(value.items) ? value.items.filter(Boolean) : [];
}

function normalizeStatus(status: string): string {
  const value = String(status ?? "").trim().toUpperCase();
  if (!value) {
    return "UNKNOWN";
  }
  return value;
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  const normalized = normalizeStatus(status);
  if (normalized === "SUCCESS") {
    return "success";
  }
  if (normalized === "PENDING" || normalized === "RETRYING") {
    return "warning";
  }
  if (normalized === "REJECTED" || normalized === "ERROR" || normalized === "DEAD_LETTER") {
    return "danger";
  }
  return "neutral";
}

function safeText(value: unknown, fallback = "-"): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function safeCount(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function channelErrorsFor(value: {
  channelErrors?: unknown;
}): Array<{ code: string; fieldPath: string | null; severity: "error" | "warning"; sellerMessage: string }> {
  if (!Array.isArray(value.channelErrors)) {
    return [];
  }
  return value.channelErrors
    .filter((issue): issue is Record<string, unknown> => Boolean(issue) && typeof issue === "object" && !Array.isArray(issue))
    .map((issue) => ({
      code: safeText(issue.code, "UNKNOWN_ISSUE"),
      fieldPath: safeText(issue.fieldPath, "") || null,
      severity: String(issue.severity ?? "").trim().toLowerCase() === "warning" ? "warning" : "error",
      sellerMessage: safeText(issue.sellerMessage ?? issue.message, "No channel error details available yet."),
    }));
}

function recoveryLaneLabel(status: string, deadLetter: boolean): string {
  if (deadLetter) {
    return "Needs recovery";
  }
  const normalized = normalizeStatus(status);
  if (normalized === "RETRYING" || normalized === "PENDING") {
    return "Retry queue";
  }
  if (normalized === "REJECTED" || normalized === "ERROR") {
    return "Fix and retry";
  }
  if (normalized === "SUCCESS") {
    return "Recent success";
  }
  return "Review";
}

function recoveryActionLabel(submission: {
  status: string;
  channelErrors?: unknown;
}): string {
  const normalized = normalizeStatus(submission.status);
  const channelErrors = channelErrorsFor(submission);
  if (normalized === "RETRYING" || normalized === "PENDING") {
    return "Monitor queue progress before retrying again.";
  }
  if (normalized === "REJECTED" || normalized === "ERROR") {
    return channelErrors.length > 0
      ? "Fix the catalog or mapping issue, then retry."
      : "Inspect connector health, then retry.";
  }
  if (normalized === "SUCCESS") {
    return "No action needed.";
  }
  return "Review the latest outcome and decide the next step.";
}

function operatorRecoveryReason(value: unknown): string {
  const reason = safeText(value, "");
  if (!reason) {
    return "Needs recovery.";
  }

  const internalRetryLeakPatterns = [
    /\bS\d+\s+bug\b/i,
    /\bBullMQ\b/i,
    /\bapp-level retry\b/i,
    /\bre-enqueue\b/i,
    /\bretry wrote\b/i,
  ];

  if (internalRetryLeakPatterns.some((pattern) => pattern.test(reason))) {
    return "Retry attempt did not resume automatically. Review connector health, then requeue from the Repair Center.";
  }

  return reason;
}

function submissionTimelineItems(submission: {
  id: string;
  status: string;
  attemptNumber: number;
  submittedAt: string;
  resolvedAt: string | null;
  channelErrors?: unknown;
}): TimelineItem[] {
  const channelErrors = channelErrorsFor(submission);
  const items: TimelineItem[] = [
    {
      id: `${submission.id}-submitted`,
      title: "Submitted to connector",
      description: "The payload entered the connector queue for processing.",
      meta: formatDateTime(submission.submittedAt),
      tone: "info",
    },
  ];

  if (submission.attemptNumber > 1) {
    items.push({
      id: `${submission.id}-retry`,
      title: `Retry attempt ${submission.attemptNumber}`,
      description: "The submission re-entered processing after an earlier failure or queue interruption.",
      tone: "warning",
    });
  }

  const normalized = normalizeStatus(submission.status);
  const hasErrors = channelErrors.length > 0;
  const effectiveStatus = normalized === "SUCCESS" && hasErrors ? "PARTIAL_SUCCESS" : normalized;
  const resolvedDescription = hasErrors
    ? channelErrors[0].sellerMessage
    : normalized === "SUCCESS"
      ? "The connector accepted the submission."
      : "The latest channel outcome still needs operator review.";

  items.push({
    id: `${submission.id}-resolved`,
    title: effectiveStatus === "SUCCESS"
      ? "Resolved successfully"
      : effectiveStatus === "PARTIAL_SUCCESS"
        ? "Completed with warnings"
        : `Latest status ${normalized}`,
    description: resolvedDescription,
    meta: submission.resolvedAt ? formatDateTime(submission.resolvedAt) : "Awaiting connector resolution",
    tone: effectiveStatus === "PARTIAL_SUCCESS" ? "warning" : statusTone(submission.status),
  });

  return items;
}

// Bulk-Publish Goes Async, Story 7: same status-tone mapping as submissions'
// statusTone, but for MarketplaceBulkPublishRun's own status enum (schema.prisma).
function bulkPublishRunStatusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  const normalized = safeText(status, "unknown").toLowerCase();
  if (normalized === "completed") {
    return "success";
  }
  if (normalized === "queued" || normalized === "processing") {
    return "info";
  }
  if (normalized === "completed_with_errors") {
    return "warning";
  }
  if (normalized === "failed") {
    return "danger";
  }
  return "neutral";
}

function bulkPublishRunStatusLabel(status: unknown): string {
  return safeText(status, "unknown").replace(/_/g, " ");
}

function bulkPublishRunProgressLabel(run: {
  succeededCount?: unknown;
  failedCount?: unknown;
  excludedCount?: unknown;
  requestedCount?: unknown;
}): string {
  return `${safeCount(run.succeededCount)} succeeded, ${safeCount(run.failedCount)} failed, ${safeCount(run.excludedCount)} excluded of ${safeCount(run.requestedCount)}`;
}

// CTO review follow-up (PR #719, 2026-09-05): only offer retry once the run has actually
// stopped moving (failed / completed_with_errors) and has at least one failed item —
// mirrors the retryFailedBulkPublishRun service method's own no-op-when-nothing-to-retry
// behavior, but avoids showing a button that would just come back with retriedCount: 0.
function bulkPublishRunHasRetryableFailures(run: { status?: unknown; failedCount?: unknown }): boolean {
  const status = safeText(run.status, "").toLowerCase();
  return (status === "failed" || status === "completed_with_errors") && safeCount(run.failedCount) > 0;
}

function isOperationsJobsApiUnavailable(error: unknown): boolean {
  if (error instanceof ApiHttpError) {
    return error.status === 429 || error.status === 500 || error.status === 502 || error.status === 503 || error.status === 504;
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

async function loadSharedRead<T>(promise: Promise<T>): Promise<SharedReadResult<T>> {
  try {
    return {
      state: "available",
      value: await promise,
    };
  } catch (error) {
    if (error instanceof ApiHttpError) {
      if (error.status === 401) {
        throw error;
      }
      if (error.status === 403) {
        return { state: "restricted" };
      }
    }
    if (isOperationsJobsApiUnavailable(error)) {
      return { state: "unavailable" };
    }
    throw error;
  }
}

function OperationsJobsStatusState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-5">
      <RefreshOnInterval intervalMs={30_000} />
      <PageHeader
        title="Jobs"
        description="Submission jobs, recovery decisions, and retries across all channels."
        breadcrumb={
          <>
            Dashboard / Operations / <span className="font-semibold text-slate-700">Jobs</span>
          </>
        }
      />
      <Card aria-live="polite" aria-atomic="true">
        <CardTitle>{title}</CardTitle>
        <p className="mt-3 text-sm text-slate-600">{description}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/operations" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Open operations overview
          </Link>
          <Link href="/operations/repair" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Open Repair Center
          </Link>
        </div>
      </Card>
    </div>
  );
}

export default async function OperationsJobsPage({ searchParams }: OperationsJobsPageProps) {
  const visibleSubmissionLimit = 100;
  const deadLetterLimit = 100;
  const query = await searchParams;
  const statusFilter = String(query.status ?? "").trim().toUpperCase();
  const connectorSlug = String(query.connectorSlug ?? "").trim().toLowerCase();
  const selectedSubmissionId = String(query.submissionId ?? "").trim();
  const bulkPublishInstallationId = String(query.installationId ?? "").trim();
  const retryError = String(query.retryError ?? "").trim();
  const retryErrorCopy = retryError ? describeError(retryError) : null;
  const { authHeader, actorRole } = await getServerSession();
  const canWrite = canEditWorkspace(actorRole);

  try {
    const [submissionsResult, deadLetterResult, bulkPublishRunsResult, installationsResult] = await Promise.all([
      loadSharedRead(getSubmissions(
        {
          limit: visibleSubmissionLimit,
          status: statusFilter || undefined,
          connectorSlug: connectorSlug || undefined,
        },
        { role: actorRole, authHeader },
      )),
      loadSharedRead(getDeadLetterSubmissions({ limit: deadLetterLimit }, { role: actorRole, authHeader })),
      // Bulk-Publish Goes Async, Story 7: recent async bulk-publish runs (Shopify,
      // WooCommerce, ...) — separate from the submissions/dead-letter data above since
      // a run isn't a ConnectorSubmission until the worker actually processes each item.
      loadSharedRead(getBulkPublishRuns({ limit: 20, installationId: bulkPublishInstallationId || undefined }, { role: actorRole, authHeader })),
      // Installed connector accounts only label/filter bulk-publish runs, so any failure
      // other than an expired session degrades to "unavailable" instead of taking the
      // whole Jobs page down (loadSharedRead rethrows e.g. 400/404).
      loadSharedRead(getInstalledConnectors({ role: actorRole, authHeader })).catch((error: unknown): SharedReadResult<never> => {
        if (error instanceof ApiHttpError && error.status === 401) {
          throw error;
        }
        return { state: "unavailable" };
      }),
    ]);

    if (submissionsResult.state === "restricted") {
      return (
        <OperationsJobsStatusState
          title="Job recovery access is restricted"
          description="Your role can open the operations area, but submission job and retry details are intentionally redacted."
        />
      );
    }

    if (submissionsResult.state === "unavailable") {
      return (
        <OperationsJobsStatusState
          title="Job recovery is temporarily unavailable"
          description="We could not load submission jobs right now. The page holds the recovery workspace in an unavailable state instead of showing a false empty queue."
        />
      );
    }

    const submissions = toItems(submissionsResult.value);
    const deadLetterSubmissions =
      deadLetterResult.state === "available" ? toItems(deadLetterResult.value) : [];
    const selectedSubmission = selectedSubmissionId
      ? submissions.find((submission) => submission.id === selectedSubmissionId) ?? null
      : null;
    const failedSubmissions = submissions.filter((submission) => {
      const normalized = normalizeStatus(submission.status);
      return normalized === "REJECTED" || normalized === "ERROR";
    });
    const retryingSubmissions = submissions.filter((submission) => {
      const normalized = normalizeStatus(submission.status);
      return normalized === "PENDING" || normalized === "RETRYING";
    });
    const successfulRecentSubmissions = submissions.filter(
      (submission) => normalizeStatus(submission.status) === "SUCCESS",
    );

    const statusCounts = submissions.reduce<Record<string, number>>((accumulator, submission) => {
      const key = normalizeStatus(submission.status);
      accumulator[key] = (accumulator[key] ?? 0) + 1;
      return accumulator;
    }, {});
    const buildJobsHref = (submissionId?: string) => {
      const params = new URLSearchParams();
      if (statusFilter) {
        params.set("status", statusFilter);
      }
      if (connectorSlug) {
        params.set("connectorSlug", connectorSlug);
      }
      if (submissionId) {
        params.set("submissionId", submissionId);
      }
      if (bulkPublishInstallationId) {
        params.set("installationId", bulkPublishInstallationId);
      }
      const queryString = params.toString();
      return queryString ? `/operations/jobs?${queryString}` : "/operations/jobs";
    };
    // Legacy contract reference: className={`border-t border-slate-200 ${selectedSubmissionId === submission.id ? "bg-amber-50" : "hover:bg-slate-50/50"}`}
    const selectedRowClassName = (submission: (typeof submissions)[number]) =>
      `border-t border-slate-200 ${
        selectedSubmissionId === submission.id ? "bg-amber-50" : "hover:bg-slate-50/50"
      }`;
    const submissionReason = (submission: (typeof submissions)[number]) =>
      channelErrorsFor(submission)[0]?.sellerMessage || submission.externalRef || "No channel error details available yet.";
    const submissionColumns: Column<(typeof submissions)[number]>[] = [
      {
        key: "submission",
        header: "Submission",
        render: (submission) => (
          <div className="space-y-1">
            <Link href={buildJobsHref(submission.id)} className="font-mono text-xs text-slate-700 underline">
              {submission.id}
            </Link>
            <div className="text-xs text-slate-500">{submission.idempotencyKey}</div>
          </div>
        ),
      },
      { key: "connector", header: "Connector", render: (submission) => submission.connectorDisplayName },
      {
        key: "product",
        header: "Product",
        render: (submission) => (
          <Link href={`/products/${encodeURIComponent(submission.productId)}`} className="underline">
            {submission.productId}
          </Link>
        ),
      },
      {
        key: "status",
        header: "Status",
        render: (submission) => (
          <StatusChip label={normalizeStatus(submission.status)} tone={statusTone(submission.status)} />
        ),
      },
      {
        key: "reason",
        header: "Reason",
        render: (submission) => {
          const channelErrors = channelErrorsFor(submission);
          return (
            <StatusChip
              label={submissionReason(submission)}
              tone={channelErrors.length > 0 ? "danger" : statusTone(submission.status)}
            />
          );
        },
      },
      {
        key: "attempts",
        header: "Attempts",
        mobileHide: true,
        render: (submission) => (
          <StatusChip
            label={String(submission.attemptNumber)}
            tone={submission.attemptNumber > 1 ? "warning" : "neutral"}
          />
        ),
      },
      {
        key: "submitted",
        header: "Submitted",
        mobileHide: true,
        render: (submission) => (
          <span className="text-xs text-slate-600">{formatDateTime(submission.submittedAt)}</span>
        ),
      },
      {
        key: "actions",
        header: "Actions",
        render: (submission) => (
          <div className="flex flex-wrap gap-2">
            <Link
              href={buildJobsHref(submission.id)}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              View detail
            </Link>
            {canPublishToChannels(actorRole) && (normalizeStatus(submission.status) === "REJECTED" || normalizeStatus(submission.status) === "ERROR") ? (
              <form action={retrySubmissionAction}>
                <input type="hidden" name="submissionId" value={submission.id} />
                <input type="hidden" name="submissionStatus" value={statusFilter} />
                <input type="hidden" name="submissionConnector" value={connectorSlug} />
                <input type="hidden" name="installationId" value={bulkPublishInstallationId} />
                <PendingSubmitButton
                  type="submit"
                  variant="secondary"
                  idleLabel="Retry"
                  pendingLabel="Retrying..."
                />
              </form>
            ) : null}
          </div>
        ),
      },
    ];
    const deadLetterColumns: Column<(typeof deadLetterSubmissions)[number]>[] = [
      {
        key: "submission",
        header: "Job",
        render: (job) => <span className="font-mono text-xs text-slate-700">{safeText(job.id)}</span>,
      },
      { key: "connector", header: "Connector", render: (job) => safeText(job.channel) },
      {
        key: "product",
        header: "Product",
        render: (job) => (
          <Link href={`/products/${encodeURIComponent(safeText(job.productId, ""))}`} className="underline">
            {safeText(job.product?.title || job.productId)}
          </Link>
        ),
      },
      {
        key: "reason",
        header: "Reason",
        render: (job) => (
          <span className="text-sm text-slate-700">
            {operatorRecoveryReason(job.dlqReason || job.failureReason)}
          </span>
        ),
      },
      {
        key: "submitted",
        header: "Updated",
        mobileHide: true,
        render: (job) => <span className="text-xs text-slate-600">{formatDateTime(job.updatedAt)}</span>,
      },
    ];
    // Bulk-Publish Goes Async, Story 7: bulkPublishRunsResult mirrors the same
    // available/restricted/unavailable handling as deadLetterResult above — a run list
    // that silently defaulted to empty on a real API failure would read as "nothing is
    // running" when it might mean "we can't tell you."
    const bulkPublishRuns = bulkPublishRunsResult.state === "available" ? toItems(bulkPublishRunsResult.value) : [];
    const installations = installationsResult.state === "available" ? installationsResult.value : [];
    const installationById = new Map(installations.map((installation) => [installation.id, installation]));
    // The store filter is only worth showing when there is more than one installation to
    // pick between; the Store column always renders.
    const showBulkPublishStoreFilter = installations.length > 1;
    // A URL-supplied store filter must never apply invisibly (picker hidden, or the id
    // isn't one of its options) -- surface it with a way to clear it.
    const hiddenBulkPublishStoreFilter =
      bulkPublishInstallationId && !(showBulkPublishStoreFilter && installationById.has(bulkPublishInstallationId))
        ? bulkPublishInstallationId
        : "";
    const clearBulkPublishStoreFilterHref = (() => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (connectorSlug) params.set("connectorSlug", connectorSlug);
      if (selectedSubmissionId) params.set("submissionId", selectedSubmissionId);
      const queryString = params.toString();
      return queryString ? `/operations/jobs?${queryString}` : "/operations/jobs";
    })();
    const bulkPublishRunColumns: Column<(typeof bulkPublishRuns)[number]>[] = [
      {
        key: "run",
        header: "Run",
        render: (run) => <span className="font-mono text-xs text-slate-700">{safeText(run.id)}</span>,
      },
      { key: "connector", header: "Connector", render: (run) => safeText(run.connectorSlug) },
      {
        key: "store",
        header: "Store",
        render: (run) => {
          const installation = installationById.get(run.installationId);
          if (installation) {
            return <span className="text-xs text-slate-700">{resolveInstallationLabel(installation)}</span>;
          }
          // Fall back to the id so two unresolvable stores stay distinguishable. Only claim
          // "no longer connected" when the installation list actually loaded.
          return (
            <span
              className="font-mono text-xs text-slate-400"
              title={installationsResult.state === "available" ? "Installation no longer connected" : "Store details unavailable"}
            >
              {safeText(run.installationId)}
            </span>
          );
        },
      },
      {
        key: "status",
        header: "Status",
        render: (run) => <StatusChip label={bulkPublishRunStatusLabel(run.status)} tone={bulkPublishRunStatusTone(run.status)} />,
      },
      {
        key: "progress",
        header: "Progress",
        render: (run) => (
          <span className="text-xs text-slate-600">
            {bulkPublishRunProgressLabel(run)}
          </span>
        ),
      },
      {
        key: "updated",
        header: "Updated",
        mobileHide: true,
        render: (run) => <span className="text-xs text-slate-600">{formatDateTime(run.updatedAt)}</span>,
      },
      {
        key: "actions",
        header: "Actions",
        render: (run) =>
          canPublishToChannels(actorRole) && bulkPublishRunHasRetryableFailures(run) ? (
            <form action={retryFailedBulkPublishRunAction}>
              <input type="hidden" name="runId" value={run.id} />
              <input type="hidden" name="submissionStatus" value={statusFilter} />
              <input type="hidden" name="submissionConnector" value={connectorSlug} />
              <input type="hidden" name="jobsSubmissionId" value={selectedSubmissionId} />
              <input type="hidden" name="installationId" value={bulkPublishInstallationId} />
              <PendingSubmitButton
                type="submit"
                variant="secondary"
                idleLabel="Retry failed"
                pendingLabel="Retrying..."
              />
            </form>
          ) : null,
      },
    ];

    const deadLetterCount =
      deadLetterResult.state === "available"
        ? deadLetterSubmissions.length
        : deadLetterResult.state === "restricted"
          ? "Restricted"
          : "Unavailable";
    const failedCountValue =
      deadLetterResult.state === "available"
        ? (statusCounts.REJECTED ?? 0) + (statusCounts.ERROR ?? 0) + deadLetterSubmissions.length
        : deadLetterResult.state === "restricted"
          ? "Restricted"
          : "Unavailable";

    return (
      <div className="space-y-5">
        <RefreshOnInterval intervalMs={30_000} />
        <PageHeader
          title="Jobs"
          description="Submission jobs, recovery decisions, and retries across all channels."
          breadcrumb={
            <>
              <Link href="/dashboard" className="hover:underline">Dashboard</Link>{" / "}<Link href="/operations" className="hover:underline">Operations</Link>{" / "}<span className="font-semibold text-slate-700">Jobs</span>
            </>
          }
          actions={
            <>
              <Link href="/operations/repair" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
                Open Repair Center
              </Link>
              <Link href="/channels/connectors" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
                Manage Channels
              </Link>
            </>
          }
        />

        {deadLetterResult.state !== "available" ? (
          <section
            aria-live="polite"
            aria-atomic="true"
            role="status"
            className={`rounded-xl border p-4 shadow-sm ${
              deadLetterResult.state === "unavailable" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"
            }`}
          >
            <h2 className={`text-sm font-semibold ${deadLetterResult.state === "unavailable" ? "text-amber-900" : "text-slate-900"}`}>
              {deadLetterResult.state === "unavailable"
                ? "Dead-letter recovery data is temporarily unavailable"
                : "Dead-letter recovery data is restricted"}
            </h2>
            <p className={`mt-2 text-sm ${deadLetterResult.state === "unavailable" ? "text-amber-900/90" : "text-slate-700"}`}>
              {deadLetterResult.state === "unavailable"
                ? "We could not load escalated recovery jobs right now. Dead-letter counts are held back instead of defaulting to healthy zeroes."
                : "Your role can still review the latest submission jobs, but dead-letter recovery details are intentionally redacted."}
            </p>
          </section>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Visible Submissions"
            value={submissions.length}
            helper={`Latest ${visibleSubmissionLimit} matching jobs`}
          />
          <KpiCard label="Pending" value={statusCounts.PENDING ?? 0} tone="warning" />
          <KpiCard
            label="Rejected / Error"
            value={(statusCounts.REJECTED ?? 0) + (statusCounts.ERROR ?? 0)}
            tone={(statusCounts.REJECTED ?? 0) + (statusCounts.ERROR ?? 0) > 0 ? "danger" : "success"}
          />
          <KpiCard
            label="Failed Count"
            value={failedCountValue}
            helper={
              deadLetterResult.state === "available"
                ? "Rejected, errored, and dead-letter jobs needing attention"
                : deadLetterResult.state === "restricted"
                  ? "Combined failure totals are limited for your role."
                  : "Combined failure totals are temporarily unavailable."
            }
            tone={
              deadLetterResult.state === "available"
                ? (statusCounts.REJECTED ?? 0) + (statusCounts.ERROR ?? 0) + deadLetterSubmissions.length > 0
                  ? "danger"
                  : "success"
                : deadLetterResult.state === "unavailable"
                  ? "warning"
                  : "default"
            }
          />
          <KpiCard
            label="Dead Letter"
            value={deadLetterCount}
            helper={
              deadLetterResult.state === "available"
                ? `Latest ${deadLetterLimit} dead-letter jobs`
                : deadLetterResult.state === "restricted"
                  ? "Dead-letter volume is limited for your role."
                  : "Dead-letter volume is temporarily unavailable."
            }
            tone={
              deadLetterResult.state === "available"
                ? deadLetterSubmissions.length > 0
                  ? "warning"
                  : "default"
                : deadLetterResult.state === "unavailable"
                  ? "warning"
                  : "default"
            }
          />
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardTitle>Recovery Now</CardTitle>
            <div className="mt-2 space-y-3 text-sm text-slate-700">
              <p>
                Use Jobs as the recovery center: what failed, what is retrying, and what needs an operator decision right now.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fix and retry</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{failedSubmissions.length}</p>
                  <p className="mt-1 text-xs text-slate-500">Rejected or errored jobs needing intervention.</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Retry queue</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{retryingSubmissions.length}</p>
                  <p className="mt-1 text-xs text-slate-500">Pending or retrying jobs still in motion.</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Needs recovery</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{deadLetterCount}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {deadLetterResult.state === "available"
                      ? "Jobs that already escalated out of the normal queue."
                      : deadLetterResult.state === "restricted"
                        ? "Dead-letter recovery counts are limited for your role."
                        : "Dead-letter recovery counts are temporarily unavailable."}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href="/operations/repair" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Open Repair Center
                </Link>
                <Link href="/channels/submissions" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Open submission history
                </Link>
              </div>
            </div>
          </Card>

          <Card>
            <CardTitle>Use Jobs vs Submissions</CardTitle>
            <div className="mt-2 space-y-3 text-sm text-slate-700">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="font-medium text-slate-900">Jobs</p>
                <p className="mt-1 text-slate-600">Answer: what failed, what is retrying, and what should I do now?</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="font-medium text-slate-900">Submissions</p>
                <p className="mt-1 text-slate-600">Answer: what happened to this product or channel publish over time?</p>
              </div>
              <p className="text-xs text-slate-500">
                Keep recovery here. Use submission history when you need channel-by-channel outcome context.
              </p>
            </div>
          </Card>
        </section>

        {retryErrorCopy ? (
          <section className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-semibold">{retryErrorCopy.title}</p>
            <p className="mt-1">{retryErrorCopy.description}</p>
            {retryErrorCopy.action ? <p className="mt-1 text-xs">{retryErrorCopy.action}</p> : null}
            {query.retryErrorMessage ? <p className="mt-2 text-xs text-amber-800">{query.retryErrorMessage}</p> : null}
          </section>
        ) : null}

        <FilterBar>
          <form method="get" className="grid gap-3 md:grid-cols-[200px_220px_140px_200px_auto]">
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="jobs-status-filter">
                Status
              </label>
              <Select id="jobs-status-filter" name="status" defaultValue={statusFilter}>
                <option value="">All statuses</option>
                <option value="PENDING">PENDING</option>
                <option value="SUCCESS">SUCCESS</option>
                <option value="REJECTED">REJECTED</option>
                <option value="ERROR">ERROR</option>
                <option value="DEAD_LETTER">DEAD_LETTER</option>
                <option value="RETRYING">RETRYING</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="jobs-connector-filter">
                Connector Slug
              </label>
              <Input id="jobs-connector-filter" name="connectorSlug" defaultValue={connectorSlug} placeholder="amazon-in / connector slug" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="jobs-submission-filter">
                Submission ID
              </label>
              <Input id="jobs-submission-filter" name="submissionId" defaultValue={selectedSubmissionId} placeholder="optional" />
            </div>
            {showBulkPublishStoreFilter ? (
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="jobs-installation-filter">
                  Store (Bulk Publish Runs)
                </label>
                <Select id="jobs-installation-filter" name="installationId" defaultValue={bulkPublishInstallationId}>
                  <option value="">All stores</option>
                  {/* Bulk publish runs span every connector type, so prefix the slug to keep options unambiguous. */}
                  {installations.map((installation) => (
                    <option key={installation.id} value={installation.id}>
                      {`${installation.slug} — ${resolveInstallationLabel(installation)}`}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
            <div className="flex items-end gap-2">
              <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
                Apply
              </button>
              <Link href="/operations/jobs" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Clear
              </Link>
            </div>
          </form>
        </FilterBar>

        <Card>
          <CardTitle>Latest Submission Jobs</CardTitle>
          {submissions.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusChip label={`Fix and retry ${failedSubmissions.length}`} tone={failedSubmissions.length > 0 ? "danger" : "success"} />
              <StatusChip label={`Retry queue ${retryingSubmissions.length}`} tone={retryingSubmissions.length > 0 ? "warning" : "success"} />
              <StatusChip label={`Recent success ${successfulRecentSubmissions.length}`} tone="info" />
            </div>
          ) : null}
          {submissions.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                icon="SEARCH"
                title="No submission jobs found"
                description="No jobs match the current filter scope."
                action={{ label: "Clear filters", href: "/operations/jobs" }}
                secondaryAction={{ label: "Open Repair Center", href: "/operations/repair" }}
              />
            </div>
          ) : (
            <DataGrid
              columns={submissionColumns}
              rows={submissions.slice(0, 100)}
              getRowKey={(submission) => safeText(submission.id)}
              rowClassName={selectedRowClassName}
            />
          )}
        </Card>

        <Card>
          <CardTitle>Bulk Publish Runs</CardTitle>
          <p className="mt-2 text-sm text-slate-600">
            Connectors without a native batch-publish API (Shopify, WooCommerce, ...) queue an
            async run per bulk-publish request instead of publishing inline — track progress here.
          </p>
          {hiddenBulkPublishStoreFilter ? (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Showing runs for installation <span className="font-mono text-xs">{hiddenBulkPublishStoreFilter}</span> only.{" "}
              <Link href={clearBulkPublishStoreFilterHref} className="font-medium underline">
                Clear store filter
              </Link>
            </div>
          ) : null}
          {bulkPublishRunsResult.state === "restricted" ? (
            <p className="mt-2 text-sm text-slate-600">Bulk publish run details are restricted for your role.</p>
          ) : bulkPublishRunsResult.state === "unavailable" ? (
            <p className="mt-2 text-sm text-slate-600">Bulk publish run details are temporarily unavailable.</p>
          ) : bulkPublishRuns.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">No bulk publish runs yet.</p>
          ) : (
            <DataGrid
              className="mt-3"
              columns={bulkPublishRunColumns}
              rows={bulkPublishRuns}
              getRowKey={(run) => safeText(run.id)}
            />
          )}
        </Card>

        <Card>
          <CardTitle>Needs Recovery</CardTitle>
          {deadLetterResult.state === "restricted" ? (
            <p className="mt-2 text-sm text-slate-600">Dead-letter recovery details are restricted for your role.</p>
          ) : deadLetterResult.state === "unavailable" ? (
            <p className="mt-2 text-sm text-slate-600">Dead-letter recovery details are temporarily unavailable.</p>
          ) : deadLetterSubmissions.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">No jobs need recovery right now.</p>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-slate-600">
                These jobs already escalated out of the standard queue. Use Repair when the failure is broader than a single retry.
              </p>
              <DataGrid
                className="mt-3"
                columns={deadLetterColumns}
                rows={deadLetterSubmissions}
                getRowKey={(submission) => safeText(submission.id)}
              />
            </div>
          )}
        </Card>

        {selectedSubmission ? (
          <Card>
            <CardTitle>Selected Submission Detail</CardTitle>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="space-y-1 text-sm text-slate-700">
                <p>
                  <span className="text-slate-500">ID:</span>{" "}
                  <span className="font-mono text-xs">{selectedSubmission.id}</span>
                </p>
                <p>
                  <span className="text-slate-500">Connector:</span> {selectedSubmission.connectorDisplayName}
                </p>
                <p>
                  <span className="text-slate-500">Product:</span>{" "}
                  <Link href={`/products/${encodeURIComponent(selectedSubmission.productId)}`} className="underline">
                    {selectedSubmission.productId}
                  </Link>
                </p>
                <p>
                  <span className="text-slate-500">Attempt:</span> {selectedSubmission.attemptNumber}
                </p>
              </div>
              <div className="space-y-2">
                <StatusChip label={`Status ${normalizeStatus(selectedSubmission.status)}`} tone={statusTone(selectedSubmission.status)} />
                <StatusChip
                  label={recoveryLaneLabel(selectedSubmission.status, false)}
                  tone={statusTone(selectedSubmission.status)}
                />
                <p className="text-sm text-slate-600">{recoveryActionLabel(selectedSubmission)}</p>
                {channelErrorsFor(selectedSubmission).length === 0 ? (
                  <p className="text-sm text-slate-600">No channel error details available for this submission.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {channelErrorsFor(selectedSubmission).slice(0, 5).map((error, index) => (
                      <li key={`${error.code}-${index}`} className="rounded-md border border-slate-200 px-3 py-2">
                        <p className="font-mono text-xs text-slate-700">{error.code}</p>
                        <p className="text-slate-700">{error.sellerMessage}</p>
                        <p className="text-xs text-slate-500">
                          {error.severity} {error.fieldPath ? `| ${error.fieldPath}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="mt-4 border-t border-slate-200 pt-4">
              <p className="text-sm font-medium text-slate-900">Submission recovery timeline</p>
              <p className="mt-1 text-sm text-slate-600">
                Review the sequence before retrying so the operator can distinguish queue movement from a true connector failure.
              </p>
              <Timeline className="mt-3" items={submissionTimelineItems(selectedSubmission)} />
            </div>
          </Card>
        ) : null}
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && error.status === 401) {
      redirect(buildLoginRedirect("/operations/jobs", error));
    }
    throw error;
  }
}
