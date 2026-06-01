import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { Timeline, type TimelineItem } from "@/components/ui/timeline";
import { ApiHttpError } from "@/lib/api";
import { getSubmission, getSubmissionIssues } from "@/lib/api/operations";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerSession } from "@/lib/server-session";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

function submissionStatusTone(status: string): "success" | "warning" | "danger" | "info" | "neutral" {
  const normalized = status.toUpperCase();
  if (normalized === "SUCCESS") return "success";
  if (normalized === "PENDING") return "warning";
  if (normalized === "REJECTED" || normalized === "ERROR") return "danger";
  if (normalized === "SUPPRESSED") return "neutral";
  return "info";
}

function submissionStatusLabel(status: string): string {
  return status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function issueSeverityTone(severity: string): "danger" | "warning" {
  return severity === "error" ? "danger" : "warning";
}

interface SubmissionDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function SubmissionDetailPage({ params }: SubmissionDetailPageProps) {
  const { id: submissionId } = await params;
  const { authHeader, actorRole } = await getServerSession();
  if (!authHeader) {
    redirect(buildLoginRedirect(`/channels/submissions/${submissionId}`));
  }

  try {
    const [submission, issues] = await Promise.all([
      getSubmission(submissionId, { role: actorRole, authHeader }),
      getSubmissionIssues(submissionId, { role: actorRole, authHeader }).catch(() => []),
    ]);

    const timelineItems: TimelineItem[] = [
      {
        id: "submitted",
        title: `Submitted to ${submission.connectorDisplayName}`,
        meta: formatDateTime(new Date(submission.submittedAt)),
        tone: "info",
      },
    ];

    if (submission.resolvedAt) {
      timelineItems.push({
        id: "resolved",
        title: `Resolved as ${submissionStatusLabel(submission.status)}`,
        meta: formatDateTime(new Date(submission.resolvedAt)),
        tone: submission.status === "SUCCESS" ? "success" : "danger",
      });
    }

    const blockingIssues = issues.filter((i) => i.severity === "error");
    const warningIssues = issues.filter((i) => i.severity === "warning");

    return (
      <div className="space-y-5">
        <PageHeader
          title="Submission Detail"
          breadcrumb={
            <nav aria-label="Breadcrumb">
              <Link href="/channels/submissions" className="text-slate-500 hover:text-slate-700">
                Submission Log
              </Link>
              <span className="mx-1 text-slate-400">/</span>
              <span className="text-slate-700">{submissionId.slice(0, 8)}…</span>
            </nav>
          }
          actions={
            <Link
              href={`/products/${encodeURIComponent(submission.productId)}`}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Open product
            </Link>
          }
        />

        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            <Card>
              <CardTitle>Overview</CardTitle>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</dt>
                  <dd className="mt-1">
                    <StatusChip label={submissionStatusLabel(submission.status)} tone={submissionStatusTone(submission.status)} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Connector</dt>
                  <dd className="mt-1 font-medium text-slate-900">{submission.connectorDisplayName}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Type</dt>
                  <dd className="mt-1 text-slate-700">{submission.submissionType}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Source</dt>
                  <dd className="mt-1">
                    <StatusChip label={submission.source.replace(/_/g, " ")} tone="neutral" />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Attempt</dt>
                  <dd className="mt-1 text-slate-700">#{submission.attemptNumber}</dd>
                </div>
                {submission.externalRef && (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">External Ref</dt>
                    <dd className="mt-1 font-mono text-xs text-slate-600">{submission.externalRef}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Idempotency Key</dt>
                  <dd className="mt-1 font-mono text-xs text-slate-600">{submission.idempotencyKey}</dd>
                </div>
              </dl>
            </Card>

            {issues.length > 0 && (
              <Card>
                <CardTitle>
                  Channel Issues ({blockingIssues.length} error{blockingIssues.length !== 1 ? "s" : ""}, {warningIssues.length} warning{warningIssues.length !== 1 ? "s" : ""})
                </CardTitle>
                <div className="mt-3 space-y-2">
                  {issues.map((issue, index) => (
                    <InlineAlert
                      key={`${issue.code}-${index}`}
                      tone={issueSeverityTone(issue.severity) === "danger" ? "error" : "warning"}
                      title={issue.code}
                      message={`${issue.sellerMessage}${issue.fieldPath ? ` (field: ${issue.fieldPath})` : ""}`}
                    />
                  ))}
                </div>
              </Card>
            )}

            {submission.payloadSnapshot && (
              <Card>
                <CardTitle>Payload Snapshot</CardTitle>
                <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                  {JSON.stringify(submission.payloadSnapshot, null, 2)}
                </pre>
              </Card>
            )}
          </div>

          <aside className="space-y-5">
            <Card>
              <CardTitle>Timeline</CardTitle>
              <Timeline items={timelineItems} className="mt-3" />
            </Card>
          </aside>
        </div>
      </div>
    );
  } catch (error) {
    if (error instanceof ApiHttpError && error.status === 401) {
      redirect(buildLoginRedirect(`/channels/submissions/${submissionId}`, 401));
    }
    if (error instanceof ApiHttpError && error.status === 404) {
      return (
        <div className="space-y-5">
          <PageHeader title="Submission Not Found" />
          <InlineAlert
            tone="error"
            title="Not found"
            message={`Submission ${submissionId} does not exist or you do not have access to it.`}
          />
          <Link href="/channels/submissions" className="text-sm font-medium text-blue-700 hover:underline">
            ← Back to Submission Log
          </Link>
        </div>
      );
    }
    throw error;
  }
}
