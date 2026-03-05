import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { KpiCard } from "@/components/ui/kpi-card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import { ApiHttpError, getDeadLetterSubmissions, getSubmissions } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

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

export default async function OperationsJobsPage({ searchParams }: OperationsJobsPageProps) {
  const query = await searchParams;
  const statusFilter = String(query.status ?? "").trim().toUpperCase();
  const connectorSlug = String(query.connectorSlug ?? "").trim().toLowerCase();
  const selectedSubmissionId = String(query.submissionId ?? "").trim();
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();

  try {
    const [submissionsResponse, deadLetterResponse] = await Promise.all([
      getSubmissions(
        {
          limit: 100,
          status: statusFilter || undefined,
          connectorSlug: connectorSlug || undefined,
        },
        { role: actorRole, authHeader },
      ),
      getDeadLetterSubmissions({ limit: 100 }, { role: actorRole, authHeader }),
    ]);
    const submissions = toItems(submissionsResponse);
    const deadLetterSubmissions = toItems(deadLetterResponse);
    const selectedSubmission = selectedSubmissionId
      ? submissions.find((submission) => submission.id === selectedSubmissionId) ?? null
      : null;

    const statusCounts = submissions.reduce<Record<string, number>>((accumulator, submission) => {
      const key = normalizeStatus(submission.status);
      accumulator[key] = (accumulator[key] ?? 0) + 1;
      return accumulator;
    }, {});

    return (
      <div className="space-y-5">
        <PageHeader
          title="Jobs"
          description="Submission jobs, failures, and retries across all channels."
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
          <KpiCard label="Total Submissions" value={submissions.length} />
          <KpiCard label="Pending" value={statusCounts.PENDING ?? 0} tone="warning" />
          <KpiCard
            label="Rejected / Error"
            value={(statusCounts.REJECTED ?? 0) + (statusCounts.ERROR ?? 0)}
            tone={(statusCounts.REJECTED ?? 0) + (statusCounts.ERROR ?? 0) > 0 ? "danger" : "success"}
          />
          <KpiCard label="Dead Letter" value={deadLetterSubmissions.length} tone={deadLetterSubmissions.length > 0 ? "warning" : "default"} />
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
              <Input id="jobs-connector-filter" name="connectorSlug" defaultValue={connectorSlug} placeholder="amazon-in / flipkart / meesho" />
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
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Submission</th>
                    <th className="px-3 py-2">Connector</th>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Attempts</th>
                    <th className="px-3 py-2">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.slice(0, 100).map((submission) => (
                    <tr
                      key={submission.id}
                      className={`border-t border-slate-200 ${
                        selectedSubmissionId === submission.id ? "bg-amber-50" : "hover:bg-slate-50/50"
                      }`}
                    >
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-700">{submission.id}</td>
                      <td className="px-3 py-2.5">{submission.connectorDisplayName}</td>
                      <td className="px-3 py-2.5">
                        <Link href={`/products/${encodeURIComponent(submission.productId)}`} className="underline">
                          {submission.productId}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusChip label={normalizeStatus(submission.status)} tone={statusTone(submission.status)} />
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusChip
                          label={String(submission.attemptNumber)}
                          tone={submission.attemptNumber > 1 ? "warning" : "neutral"}
                        />
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">{new Date(submission.submittedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
          </Card>
        ) : null}
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/operations/jobs", error.status));
    }
    throw error;
  }
}
