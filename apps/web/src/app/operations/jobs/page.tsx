import Link from "next/link";
import { redirect } from "next/navigation";
import { retrySubmissionAction } from "@/app/actions";
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
import { ApiHttpError, getDeadLetterSubmissions, getSubmissions } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { canEditWorkspace } from "@/lib/role-capabilities";
import { getServerSession } from "@/lib/server-session";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

interface OperationsJobsPageProps {
  searchParams: Promise<{
    status?: string;
    connectorSlug?: string;
    submissionId?: string;
  }>;
}

function toItems<T>(value: T[] | { items: T[] } | null | undefined): T[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return Array.isArray(value.items) ? value.items : [];
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
  channelErrors: Array<{ sellerMessage: string }>;
}): string {
  const normalized = normalizeStatus(submission.status);
  if (normalized === "RETRYING" || normalized === "PENDING") {
    return "Monitor queue progress before retrying again.";
  }
  if (normalized === "REJECTED" || normalized === "ERROR") {
    return submission.channelErrors.length > 0
      ? "Fix the catalog or mapping issue, then retry."
      : "Inspect connector health, then retry.";
  }
  if (normalized === "SUCCESS") {
    return "No action needed.";
  }
  return "Review the latest outcome and decide the next step.";
}

function submissionTimelineItems(submission: {
  id: string;
  status: string;
  attemptNumber: number;
  submittedAt: string;
  resolvedAt: string | null;
  channelErrors: Array<{ sellerMessage: string }>;
}): TimelineItem[] {
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
  const resolvedDescription =
    submission.channelErrors[0]?.sellerMessage ||
    (normalized === "SUCCESS"
      ? "The connector accepted the submission."
      : "The latest channel outcome still needs operator review.");

  items.push({
    id: `${submission.id}-resolved`,
    title: normalized === "SUCCESS" ? "Resolved successfully" : `Latest status ${normalized}`,
    description: resolvedDescription,
    meta: submission.resolvedAt ? formatDateTime(submission.resolvedAt) : "Awaiting connector resolution",
    tone: statusTone(submission.status),
  });

  return items;
}

export default async function OperationsJobsPage({ searchParams }: OperationsJobsPageProps) {
  const visibleSubmissionLimit = 100;
  const deadLetterLimit = 100;
  const query = await searchParams;
  const statusFilter = String(query.status ?? "").trim().toUpperCase();
  const connectorSlug = String(query.connectorSlug ?? "").trim().toLowerCase();
  const selectedSubmissionId = String(query.submissionId ?? "").trim();
  const { authHeader, actorRole } = await getServerSession();
  const canWrite = canEditWorkspace(actorRole);

  try {
    const [submissionsResponse, deadLetterResponse] = await Promise.all([
      getSubmissions(
        {
          limit: visibleSubmissionLimit,
          status: statusFilter || undefined,
          connectorSlug: connectorSlug || undefined,
        },
        { role: actorRole, authHeader },
      ),
      getDeadLetterSubmissions({ limit: deadLetterLimit }, { role: actorRole, authHeader }),
    ]);
    const submissions = toItems(submissionsResponse);
    const deadLetterSubmissions = toItems(deadLetterResponse);
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
      const queryString = params.toString();
      return queryString ? `/operations/jobs?${queryString}` : "/operations/jobs";
    };
    // Legacy contract reference: className={`border-t border-slate-200 ${selectedSubmissionId === submission.id ? "bg-amber-50" : "hover:bg-slate-50/50"}`}
    const selectedRowClassName = (submission: (typeof submissions)[number]) =>
      `border-t border-slate-200 ${
        selectedSubmissionId === submission.id ? "bg-amber-50" : "hover:bg-slate-50/50"
      }`;
    const submissionReason = (submission: (typeof submissions)[number]) =>
      submission.channelErrors[0]?.sellerMessage || submission.externalRef || "No channel error details available yet.";
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
        render: (submission) => (
          <StatusChip
            label={submissionReason(submission)}
            tone={submission.channelErrors.length > 0 ? "danger" : statusTone(submission.status)}
          />
        ),
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
            {canWrite && (normalizeStatus(submission.status) === "REJECTED" || normalizeStatus(submission.status) === "ERROR") ? (
              <form action={retrySubmissionAction}>
                <input type="hidden" name="submissionId" value={submission.id} />
                <input type="hidden" name="submissionStatus" value={statusFilter} />
                <input type="hidden" name="submissionConnector" value={connectorSlug} />
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
        render: (job) => <span className="font-mono text-xs text-slate-700">{job.id}</span>,
      },
      { key: "connector", header: "Connector", render: (job) => job.channel },
      {
        key: "product",
        header: "Product",
        render: (job) => (
          <Link href={`/products/${encodeURIComponent(job.productId)}`} className="underline">
            {job.product?.title || job.productId}
          </Link>
        ),
      },
      {
        key: "reason",
        header: "Reason",
        render: (job) => <span className="text-sm text-slate-700">{job.dlqReason || job.failureReason || "Needs recovery."}</span>,
      },
      {
        key: "submitted",
        header: "Updated",
        mobileHide: true,
        render: (job) => <span className="text-xs text-slate-600">{formatDateTime(job.updatedAt)}</span>,
      },
    ];

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
            value={(statusCounts.REJECTED ?? 0) + (statusCounts.ERROR ?? 0) + deadLetterSubmissions.length}
            tone={(statusCounts.REJECTED ?? 0) + (statusCounts.ERROR ?? 0) + deadLetterSubmissions.length > 0 ? "danger" : "success"}
          />
          <KpiCard
            label="Dead Letter"
            value={deadLetterSubmissions.length}
            helper={`Latest ${deadLetterLimit} dead-letter jobs`}
            tone={deadLetterSubmissions.length > 0 ? "warning" : "default"}
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
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{deadLetterSubmissions.length}</p>
                  <p className="mt-1 text-xs text-slate-500">Jobs that already escalated out of the normal queue.</p>
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

        <FilterBar>
          <form method="get" className="grid gap-3 md:grid-cols-[200px_220px_140px_auto]">
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
              getRowKey={(submission) => submission.id}
              rowClassName={selectedRowClassName}
            />
          )}
        </Card>

        <Card>
          <CardTitle>Needs Recovery</CardTitle>
          {deadLetterSubmissions.length === 0 ? (
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
                getRowKey={(submission) => submission.id}
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
                {selectedSubmission.channelErrors.length === 0 ? (
                  <p className="text-sm text-slate-600">No channel error details available for this submission.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {selectedSubmission.channelErrors.slice(0, 5).map((error, index) => (
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
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/operations/jobs", error));
    }
    throw error;
  }
}
