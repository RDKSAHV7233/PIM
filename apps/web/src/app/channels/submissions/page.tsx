import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { FilterBar } from "@/components/ui/filter-bar";
import { KpiCard } from "@/components/ui/kpi-card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import { ApiHttpError, getSubmissions } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

interface ChannelsSubmissionsPageProps {
  searchParams: Promise<{
    status?: string;
    connectorSlug?: string;
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

export default async function ChannelsSubmissionsPage({ searchParams }: ChannelsSubmissionsPageProps) {
  const query = await searchParams;
  const statusFilter = String(query.status ?? "").trim().toUpperCase();
  const connectorSlug = String(query.connectorSlug ?? "").trim().toLowerCase();
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();

  try {
    const submissionsResponse = await getSubmissions(
      {
        limit: 100,
        status: statusFilter || undefined,
        connectorSlug: connectorSlug || undefined,
      },
      { role: actorRole, authHeader },
    );
    const submissions = toItems(submissionsResponse);
    const statusCounts = submissions.reduce<Record<string, number>>((accumulator, submission) => {
      const key = normalizeStatus(submission.status);
      accumulator[key] = (accumulator[key] ?? 0) + 1;
      return accumulator;
    }, {});

    return (
      <div className="space-y-5">
        <PageHeader
          title="Submissions"
          description="Track channel submission lifecycle and hand off failures to operations repair flows."
          breadcrumb={
            <>
              Dashboard / Channels / <span className="font-semibold text-slate-700">Submissions</span>
            </>
          }
          actions={
            <>
              <Link href="/channels/health" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
                Channel Health
              </Link>
              <Link href="/operations/jobs" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
                Open Jobs Workspace
              </Link>
            </>
          }
        />

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Total Submissions" value={submissions.length} />
          <KpiCard label="Pending" value={statusCounts.PENDING ?? 0} tone="warning" />
          <KpiCard
            label="Accepted"
            value={statusCounts.SUCCESS ?? 0}
            tone={(statusCounts.SUCCESS ?? 0) > 0 ? "success" : "default"}
          />
          <KpiCard
            label="Rejected / Error"
            value={(statusCounts.REJECTED ?? 0) + (statusCounts.ERROR ?? 0)}
            tone={(statusCounts.REJECTED ?? 0) + (statusCounts.ERROR ?? 0) > 0 ? "danger" : "default"}
          />
        </section>

        <FilterBar>
          <form method="get" className="grid gap-3 md:grid-cols-[220px_240px_auto]">
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="channel-submissions-status">
                Status
              </label>
              <Select id="channel-submissions-status" name="status" defaultValue={statusFilter}>
                <option value="">All statuses</option>
                <option value="PENDING">PENDING</option>
                <option value="SUCCESS">SUCCESS</option>
                <option value="REJECTED">REJECTED</option>
                <option value="ERROR">ERROR</option>
                <option value="RETRYING">RETRYING</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="channel-submissions-connector">
                Connector Slug
              </label>
              <Input id="channel-submissions-connector" name="connectorSlug" defaultValue={connectorSlug} placeholder="amazon-in / flipkart / meesho" />
            </div>
            <div className="flex items-end gap-2">
              <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
                Apply
              </button>
              <Link href="/channels/submissions" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Clear
              </Link>
            </div>
          </form>
        </FilterBar>

        <Card>
          <CardTitle>Latest Channel Submissions</CardTitle>
          {submissions.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No submissions found for the current filter scope.</p>
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
                  {submissions.map((submission) => (
                    <tr key={submission.id} className="border-t border-slate-200 hover:bg-slate-50/50">
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
                      <td className="px-3 py-2.5">{submission.attemptNumber}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">{new Date(submission.submittedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/channels/submissions", error.status));
    }
    throw error;
  }
}
