import Link from "@/components/ui/app-link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid } from "@/components/ui/data-grid";
import { FilterBar } from "@/components/ui/filter-bar";
import { KpiCard } from "@/components/ui/kpi-card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import { Timeline, type TimelineItem } from "@/components/ui/timeline";
import { ApiHttpError, getSubmissions } from "@/lib/api";
import { getInstalledConnectors } from "@/lib/api/connectors";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerSession } from "@/lib/server-session";
import { formatDateTime } from "@/lib/format";
import { canPublishToChannels } from "@/lib/role-capabilities";
import { resolveInstallationLabel } from "@/lib/connector-utils";
import { SubmissionsGrid } from "./_components/submissions-grid";

export const dynamic = "force-dynamic";

interface ChannelsSubmissionsPageProps {
  searchParams: Promise<{
    status?: string;
    connectorSlug?: string;
    installationId?: string;
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
      title: "Submitted to channel",
      description: "The latest product payload entered the outbound channel queue.",
      meta: formatDateTime(submission.submittedAt),
      tone: "info",
    },
  ];

  if (submission.attemptNumber > 1) {
    items.push({
      id: `${submission.id}-retry`,
      title: `Attempt ${submission.attemptNumber}`,
      description: "This submission has retried at least once before reaching its latest state.",
      tone: "warning",
    });
  }

  const normalized = normalizeStatus(submission.status);
  items.push({
    id: `${submission.id}-status`,
    title: normalized === "SUCCESS" ? "Accepted by channel" : `Latest status ${normalized}`,
    description:
      submission.channelErrors[0]?.sellerMessage ||
      (normalized === "SUCCESS"
        ? "The latest submission completed successfully."
        : "Use Jobs when this submission needs recovery action."),
    meta: submission.resolvedAt ? formatDateTime(submission.resolvedAt) : "Awaiting connector resolution",
    tone: statusTone(submission.status),
  });

  return items;
}

export default async function ChannelsSubmissionsPage({ searchParams }: ChannelsSubmissionsPageProps) {
  const query = await searchParams;
  const statusFilter = String(query.status ?? "").trim().toUpperCase();
  const connectorSlug = String(query.connectorSlug ?? "").trim().toLowerCase();
  const installationId = String(query.installationId ?? "").trim();
  const { authHeader, actorRole } = await getServerSession();

  try {
    const [submissionsResponse, allInstallations] = await Promise.all([
      getSubmissions(
        {
          limit: 100,
          status: statusFilter || undefined,
          connectorSlug: connectorSlug || undefined,
          installationId: installationId || undefined,
        },
        { role: actorRole, authHeader },
      ),
      getInstalledConnectors({ role: actorRole, authHeader }).catch(() => [] as import("@/lib/api").ConnectorInstallation[]),
    ]);
    // Scope the store picker to the active connector filter (if any) so it doesn't list
    // unrelated stores from other connector types; any connector can have multiple
    // installations under a high-enough plan tier, not just Shopify.
    const storeFilterInstallations = connectorSlug
      ? allInstallations.filter((i) => i.slug === connectorSlug)
      : allInstallations;
    // A store filter the picker can't show (picker hidden, or the id belongs to another
    // connector) still narrows the results, so it must be surfaced with a way to clear it.
    const hiddenStoreFilter =
      installationId && !(storeFilterInstallations.length > 1 && storeFilterInstallations.some((i) => i.id === installationId))
        ? installationId
        : "";
    const clearStoreFilterParams = new URLSearchParams();
    if (statusFilter) clearStoreFilterParams.set("status", statusFilter);
    if (connectorSlug) clearStoreFilterParams.set("connectorSlug", connectorSlug);
    const clearStoreFilterHref = clearStoreFilterParams.toString()
      ? `/channels/submissions?${clearStoreFilterParams.toString()}`
      : "/channels/submissions";
    const submissions = toItems(submissionsResponse);
    const latestSubmission = submissions[0] ?? null;
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
              <Link href="/dashboard" className="hover:underline">Dashboard</Link>{" / "}<Link href="/channels" className="hover:underline">Channels</Link>{" / "}<span className="font-semibold text-slate-700">Submissions</span>
            </>
          }
          actions={
            <>
              <a
                href={`/api/marketplace/submissions/error-report${connectorSlug ? `?connectorSlug=${encodeURIComponent(connectorSlug)}` : ""}`}
                download
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Download Error Report
              </a>
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

        <Card>
          <CardTitle>Submission triage guide</CardTitle>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">Watch pending work</p>
              <p className="mt-1 text-sm text-slate-600">
                Stay in Submissions when the latest payload is still queued or retrying and no repair action is needed yet.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">Open Jobs for recovery</p>
              <p className="mt-1 text-sm text-slate-600">
                Move to Jobs when a submission is rejected, errors repeatedly, or needs an explicit retry after catalog or connector fixes.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">Trace product context</p>
              <p className="mt-1 text-sm text-slate-600">
                Open the product when you need to confirm the latest payload context, readiness state, or mapped channel data behind a submission.
              </p>
            </div>
          </div>
        </Card>

        {latestSubmission ? (
          <Card>
            <CardTitle>Latest Submission Timeline</CardTitle>
            <div className="mt-2 grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <div>
                <p className="text-sm text-slate-700">
                  Review the most recent submission lifecycle before opening Jobs for active recovery.
                </p>
                <Timeline className="mt-3" items={submissionTimelineItems(latestSubmission)} />
              </div>
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current submission</p>
                <p className="font-mono text-xs text-slate-700">{latestSubmission.id}</p>
                <StatusChip label={normalizeStatus(latestSubmission.status)} tone={statusTone(latestSubmission.status)} />
                <Link href="/operations/jobs" className="inline-flex rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                  Open Jobs Workspace
                </Link>
              </div>
            </div>
          </Card>
        ) : null}

        <FilterBar>
          <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[220px_240px_220px_auto]">
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
              <Input id="channel-submissions-connector" name="connectorSlug" defaultValue={connectorSlug} placeholder="amazon-in / connector slug" />
            </div>
            {storeFilterInstallations.length > 1 ? (
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="channel-submissions-store">
                  Store
                </label>
                <Select id="channel-submissions-store" name="installationId" defaultValue={installationId}>
                  <option value="">All stores</option>
                  {storeFilterInstallations.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {/* Without an active connector filter, options can span multiple
                          connector types -- prefix with the slug so they stay distinguishable. */}
                      {connectorSlug ? resolveInstallationLabel(inst) : `${inst.slug} — ${resolveInstallationLabel(inst)}`}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
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

        {hiddenStoreFilter ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Showing submissions for installation <span className="font-mono text-xs">{hiddenStoreFilter}</span> only.{" "}
            <Link href={clearStoreFilterHref} className="font-medium underline">
              Clear store filter
            </Link>
          </div>
        ) : null}

        <Card>
          <CardTitle>Latest Channel Submissions</CardTitle>
          <p className="mt-1 text-xs text-slate-500">Click any row to open the submission detail drawer and view channel errors with field-level repair links.</p>
          <div className="mt-3 overflow-x-auto">
            <SubmissionsGrid submissions={submissions} canRetrySubmission={canPublishToChannels(actorRole)} />
          </div>
          <div className="mt-3">
            <DataGrid
              columns={[
                {
                  key: "id",
                  header: "Submission",
                  cellClassName: "font-mono text-xs text-slate-700",
                  render: (submission) => submission.id,
                },
                { key: "connectorDisplayName", header: "Connector" },
                {
                  key: "productId",
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
                  key: "externalRef",
                  header: "External Ref",
                  mobileHide: true,
                  cellClassName: "font-mono text-xs text-slate-700",
                  render: (submission) => {
                    if (!submission.externalRef) return <span className="text-slate-400">—</span>;
                    const gidMatch = submission.externalRef.match(/gid:\/\/shopify\/Product\/(\d+)/);
                    if (gidMatch) {
                      return <span title={submission.externalRef}>shopify:{gidMatch[1]}</span>;
                    }
                    return <span title={submission.externalRef}>{submission.externalRef.slice(0, 40)}</span>;
                  },
                },
                {
                  key: "attemptNumber",
                  header: "Attempts",
                  mobileHide: true,
                  render: (submission) => submission.attemptNumber,
                },
                {
                  key: "submittedAt",
                  header: "Submitted",
                  mobileHide: true,
                  cellClassName: "text-xs text-slate-600",
                  render: (submission) => formatDateTime(submission.submittedAt),
                },
              ]}
              rows={submissions}
              getRowKey={(submission) => submission.id}
              caption="Latest Channel Submissions"
              emptyState={
                <p className="text-sm text-slate-600">No submissions found for the current filter scope.</p>
              }
            />
          </div>
        </Card>
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/channels/submissions", error));
    }
    throw error;
  }
}
