import Link from "@/components/ui/app-link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { FilterBar } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import { SystemAdminRequiredCard } from "@/components/ui/system-admin-required-card";
import { ResolveIssueButton } from "@/components/error-authority/resolve-issue-button";
import { ApiHttpError } from "@/lib/api";
import {
  listErrorAuthorityIssues,
  listErrorAuthorityOccurrences,
  type ErrorAuthorityIssueListItem,
} from "@/lib/api/error-authority-ops";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { formatDateTime } from "@/lib/format";
import { isSystemAdminBoundary } from "@/lib/role-capabilities";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

interface InternalOpsErrorsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const RUNTIME_OPTIONS = ["api", "worker", "next_server", "browser"];
const SEVERITY_OPTIONS = ["p0", "p1", "p2", "p3"];
const STATE_OPTIONS = ["open", "muted", "resolved"];
const LIMIT_OPTIONS = [25, 50, 100];

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function clean(value: string | string[] | undefined) {
  return String(first(value) ?? "").trim();
}

function parseLimit(value: string | string[] | undefined) {
  const parsed = Number(clean(value) || "50");
  return LIMIT_OPTIONS.includes(parsed) ? parsed : 50;
}

function buildHref(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const normalized = String(value ?? "").trim();
    if (normalized) {
      search.set(key, normalized);
    }
  }
  const query = search.toString();
  return query ? `/internal/ops/errors?${query}` : "/internal/ops/errors";
}

function severityTone(severity: string) {
  if (severity === "p0" || severity === "p1") {
    return "danger" as const;
  }
  if (severity === "p2") {
    return "warning" as const;
  }
  return "neutral" as const;
}

function stateTone(state: string) {
  if (state === "open") {
    return "danger" as const;
  }
  if (state === "muted") {
    return "warning" as const;
  }
  return "success" as const;
}

function runtimeLabel(runtime: string) {
  return runtime === "next_server" ? "Next server" : runtime.replace(/_/g, " ");
}

function issueSummary(issue: ErrorAuthorityIssueListItem) {
  return [issue.errorCode, issue.category, issue.lastSeenRelease].filter(Boolean).join(" | ") || issue.category;
}

export default async function InternalOpsErrorsPage({ searchParams }: InternalOpsErrorsPageProps) {
  const query = await searchParams;
  const { authHeader, actorRole, adminBoundaryRoles } = await getServerSession();
  const baseParams = {
    runtime: clean(query.runtime),
    service: clean(query.service),
    severity: clean(query.severity),
    state: clean(query.state),
    release: clean(query.release),
    errorCode: clean(query.errorCode),
    route: clean(query.route),
    dateFrom: clean(query.dateFrom),
    dateTo: clean(query.dateTo),
    limit: parseLimit(query.limit),
  };
  const issueId = clean(query.issueId);
  const cursor = clean(query.cursor);
  const occurrenceCursor = clean(query.occurrenceCursor);
  const resolveStatus = clean(query.resolveStatus);

  if (!authHeader) {
    redirect(buildLoginRedirect(buildHref({ ...baseParams, issueId })));
  }

  if (!isSystemAdminBoundary(adminBoundaryRoles)) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Internal Ops Errors"
          breadcrumb={
            <>
              <Link href="/dashboard" className="hover:underline">Dashboard</Link>{" / "}
              <span className="font-semibold text-slate-700">Internal Ops Errors</span>
            </>
          }
        />
        <SystemAdminRequiredCard surfaceLabel="Internal Ops Errors" backHref="/dashboard" />
      </div>
    );
  }
  if (actorRole !== "admin") {
    redirect("/dashboard");
  }

  try {
    const issues = await listErrorAuthorityIssues(
      {
        ...baseParams,
        cursor: cursor || undefined,
      },
      { authHeader },
    );
    const selectedIssue = issueId
      ? (issues.items.find((item) => item.id === issueId) ?? null)
      : (issues.items[0] ?? null);
    const occurrences = selectedIssue
      ? await listErrorAuthorityOccurrences(
          selectedIssue.id,
          {
            dateFrom: baseParams.dateFrom || undefined,
            dateTo: baseParams.dateTo || undefined,
            cursor: occurrenceCursor || undefined,
            limit: 25,
          },
          { authHeader },
        )
      : null;

    return (
      <div className="space-y-5">
        <PageHeader
          title="Internal Ops Errors"
          description="Read-only Error Authority view for internal platform operations."
          breadcrumb={
            <>
              <Link href="/dashboard" className="hover:underline">Dashboard</Link>{" / "}
              <span className="font-semibold text-slate-700">Internal Ops Errors</span>
            </>
          }
        />

        <FilterBar>
          <form className="grid gap-3 md:grid-cols-4 xl:grid-cols-6" action="/internal/ops/errors">
            <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Runtime
              <Select name="runtime" defaultValue={baseParams.runtime}>
                <option value="">All</option>
                {RUNTIME_OPTIONS.map((value) => <option key={value} value={value}>{runtimeLabel(value)}</option>)}
              </Select>
            </label>
            <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Severity
              <Select name="severity" defaultValue={baseParams.severity}>
                <option value="">All</option>
                {SEVERITY_OPTIONS.map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}
              </Select>
            </label>
            <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              State
              <Select name="state" defaultValue={baseParams.state}>
                <option value="">All</option>
                {STATE_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
              </Select>
            </label>
            <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Service
              <Input name="service" defaultValue={baseParams.service} placeholder="vexa-pim-web" />
            </label>
            <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Route
              <Input name="route" defaultValue={baseParams.route} placeholder="/login" />
            </label>
            <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Limit
              <Select name="limit" defaultValue={String(baseParams.limit)}>
                {LIMIT_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
              </Select>
            </label>
            <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Error code
              <Input name="errorCode" defaultValue={baseParams.errorCode} placeholder="ERR04C..." />
            </label>
            <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Release
              <Input name="release" defaultValue={baseParams.release} placeholder="commit SHA" />
            </label>
            <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              From
              <Input name="dateFrom" type="date" defaultValue={baseParams.dateFrom.slice(0, 10)} />
            </label>
            <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              To
              <Input name="dateTo" type="date" defaultValue={baseParams.dateTo.slice(0, 10)} />
            </label>
            <div className="flex items-end gap-2 md:col-span-2">
              <button className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white" type="submit">
                Apply
              </button>
              <Link className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700" href="/internal/ops/errors">
                Reset
              </Link>
            </div>
          </form>
        </FilterBar>

        {!issues.storageAvailable ? (
          <Card className="border-amber-200 bg-amber-50">
            <CardTitle>Storage unavailable</CardTitle>
            <p className="text-sm text-amber-900">Error Authority storage is not reachable from the API runtime.</p>
          </Card>
        ) : null}

        {resolveStatus === "resolved" ? (
          <Card className="border-emerald-200 bg-emerald-50">
            <p className="text-sm text-emerald-900">Issue resolved.</p>
          </Card>
        ) : resolveStatus === "forbidden" ? (
          <Card className="border-amber-200 bg-amber-50">
            <p className="text-sm text-amber-900">You do not have permission to resolve issues.</p>
          </Card>
        ) : resolveStatus === "error" ? (
          <Card className="border-red-200 bg-red-50">
            <p className="text-sm text-red-900">Resolving the issue failed. Please try again.</p>
          </Card>
        ) : null}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(420px,0.75fr)]">
          <Card className="overflow-hidden p-0">
            <div className="border-b border-slate-200 p-4">
              <CardTitle>Issues</CardTitle>
              <p className="text-sm text-slate-500">
                Window {formatDateTime(issues.window.dateFrom)} to {formatDateTime(issues.window.dateTo)}
              </p>
            </div>
            {issues.items.length === 0 ? (
              <div className="p-6 text-sm text-slate-600">No error issues match the current filters.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3 text-left">Issue</th>
                      <th className="px-4 py-3 text-left">Runtime</th>
                      <th className="px-4 py-3 text-left">Severity</th>
                      <th className="px-4 py-3 text-left">State</th>
                      <th className="px-4 py-3 text-right">Count</th>
                      <th className="px-4 py-3 text-left">Last seen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {issues.items.map((issue) => (
                      <tr key={issue.id} className={issue.id === selectedIssue?.id ? "bg-blue-50" : "bg-white"}>
                        <td className="max-w-[440px] px-4 py-3">
                          <Link
                            className="font-semibold text-slate-900 hover:underline"
                            href={buildHref({ ...baseParams, cursor: cursor || undefined, issueId: issue.id })}
                          >
                            {issue.safeTitle}
                          </Link>
                          <div className="mt-1 truncate text-xs text-slate-500">{issueSummary(issue)}</div>
                        </td>
                        <td className="px-4 py-3 capitalize">{runtimeLabel(issue.runtime)}</td>
                        <td className="px-4 py-3">
                          <StatusChip label={issue.severity.toUpperCase()} tone={severityTone(issue.severity)} />
                        </td>
                        <td className="px-4 py-3">
                          <StatusChip label={issue.state} tone={stateTone(issue.state)} />
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{issue.occurrenceCount}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(issue.lastSeenAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-slate-200 p-4">
              <span className="text-xs text-slate-500">{issues.items.length} shown</span>
              {issues.nextCursor ? (
                <Link
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                  href={buildHref({ ...baseParams, cursor: issues.nextCursor })}
                >
                  Next
                </Link>
              ) : null}
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="border-b border-slate-200 p-4">
              <CardTitle>Occurrences</CardTitle>
              {selectedIssue ? (
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <p className="truncate text-sm text-slate-500">{selectedIssue.safeTitle}</p>
                  <div className="flex items-center gap-2">
                    <StatusChip label={selectedIssue.state} tone={stateTone(selectedIssue.state)} />
                    <ResolveIssueButton
                      issueId={selectedIssue.id}
                      state={selectedIssue.state}
                      returnParams={{ ...baseParams, cursor: cursor || undefined, issueId: selectedIssue.id }}
                    />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">Select an issue.</p>
              )}
            </div>
            {!selectedIssue || !occurrences ? (
              <div className="p-6 text-sm text-slate-600">No issue selected.</div>
            ) : occurrences.items.length === 0 ? (
              <div className="p-6 text-sm text-slate-600">No occurrences in the current window.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {occurrences.items.map((occurrence) => (
                  <div key={occurrence.id} className="space-y-2 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">{formatDateTime(occurrence.occurredAt)}</span>
                      <StatusChip label={occurrence.category} tone="info" />
                    </div>
                    <p className="text-sm text-slate-700">{occurrence.safeMessage}</p>
                    <dl className="grid grid-cols-2 gap-2 text-xs text-slate-500">
                      <div>
                        <dt className="font-semibold uppercase">Route</dt>
                        <dd className="truncate">{occurrence.routeTemplate ?? "none"}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold uppercase">Release</dt>
                        <dd className="truncate">{occurrence.release ?? "none"}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold uppercase">Request</dt>
                        <dd className="truncate">{occurrence.requestId ?? occurrence.correlationId ?? "none"}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold uppercase">Tenant impact</dt>
                        <dd>{occurrence.safeTenantRef ? "hashed" : "none"}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="font-semibold uppercase">Top frame</dt>
                        <dd className="truncate">{occurrence.topFrameFile ?? "none"}</dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
            )}
            {occurrences?.nextCursor ? (
              <div className="border-t border-slate-200 p-4">
                <Link
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                  href={buildHref({
                    ...baseParams,
                    cursor: cursor || undefined,
                    issueId: selectedIssue?.id,
                    occurrenceCursor: occurrences.nextCursor,
                  })}
                >
                  More occurrences
                </Link>
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    );
  } catch (error) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect(buildHref({ ...baseParams, issueId }), error));
    }
    throw error;
  }
}
