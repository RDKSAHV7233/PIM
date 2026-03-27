import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ApiHttpError, type PlanUpgradeRequest } from "@/lib/api";
import {
  getCommercialOverviewInternal,
  getCommercialOpsRequestOptions,
  listInternalUpgradeRequests,
  searchCommercialTenantsInternal,
  type CommercialOverviewResponse,
  type CommercialTenantSearchResult,
} from "@/lib/api/internal-billing";
import { getServerActorRole, getServerSessionClaims } from "@/lib/server-session";
import { updateUpgradeRequestStatusAction } from "./actions";

export const dynamic = "force-dynamic";

const REQUEST_STATUS_FILTERS = ["all", "open", "acknowledged", "resolved", "cancelled"] as const;

interface DeveloperPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

function normalizeRequestStatusFilter(value: string | undefined): (typeof REQUEST_STATUS_FILTERS)[number] {
  const normalized = String(value ?? "").trim().toLowerCase();
  return REQUEST_STATUS_FILTERS.includes(normalized as (typeof REQUEST_STATUS_FILTERS)[number])
    ? (normalized as (typeof REQUEST_STATUS_FILTERS)[number])
    : "open";
}

function normalizeText(value: string | undefined) {
  return String(value ?? "").trim();
}

function buildDeveloperHref(input: {
  tenantQuery?: string;
  tenantKey?: string;
  requestStatusFilter?: string;
  actionStatus?: string;
}) {
  const search = new URLSearchParams();
  if (input.tenantQuery) {
    search.set("tenantQuery", input.tenantQuery);
  }
  if (input.tenantKey) {
    search.set("tenantKey", input.tenantKey);
  }
  if (input.requestStatusFilter) {
    search.set("requestStatusFilter", input.requestStatusFilter);
  }
  if (input.actionStatus) {
    search.set("actionStatus", input.actionStatus);
  }
  const query = search.toString();
  return query ? `/internal/developer?${query}` : "/internal/developer";
}

function buildExportHref(input: {
  tenantKey?: string;
  requestStatusFilter?: string;
}) {
  const search = new URLSearchParams();
  if (input.tenantKey) {
    search.set("tenantKey", input.tenantKey);
  }
  if (input.requestStatusFilter && input.requestStatusFilter !== "all") {
    search.set("status", input.requestStatusFilter);
  }
  const query = search.toString();
  return query ? `/api/internal/commercial-requests/export?${query}` : "/api/internal/commercial-requests/export";
}

function formatBillingStatus(value: string) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "active_paid") {
    return "Active paid";
  }
  if (normalized === "past_due") {
    return "Past due";
  }
  if (normalized === "cancelled") {
    return "Cancelled";
  }
  return "Trial";
}

function formatAccessStatus(value: string) {
  return String(value ?? "").trim().toLowerCase() === "suspended" ? "Suspended" : "Active";
}

function formatRequestStatus(value: string) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "acknowledged") {
    return "Acknowledged";
  }
  if (normalized === "resolved") {
    return "Resolved";
  }
  if (normalized === "cancelled") {
    return "Cancelled";
  }
  return "Open";
}

function formatPlanTier(value: string) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "GROWTH") {
    return "Growth";
  }
  if (normalized === "ENTERPRISE") {
    return "Enterprise";
  }
  return "Starter";
}

function requestStatusTone(value: string) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "resolved") {
    return "bg-emerald-100 text-emerald-900";
  }
  if (normalized === "cancelled") {
    return "bg-slate-200 text-slate-700";
  }
  if (normalized === "acknowledged") {
    return "bg-amber-100 text-amber-900";
  }
  return "bg-sky-100 text-sky-900";
}

function resolveActionAlert(statusInput: string | undefined) {
  const status = String(statusInput ?? "").trim().toLowerCase();
  if (status === "acknowledged") {
    return {
      tone: "border-emerald-200 bg-emerald-50 text-emerald-900",
      title: "Request acknowledged",
      body: "The commercial request is now in TEJ's active review queue.",
    };
  }
  if (status === "resolved") {
    return {
      tone: "border-emerald-200 bg-emerald-50 text-emerald-900",
      title: "Request resolved",
      body: "The request was marked resolved and will drop out of the customer pending view.",
    };
  }
  if (status === "cancelled") {
    return {
      tone: "border-slate-300 bg-slate-50 text-slate-800",
      title: "Request cancelled",
      body: "The request was cancelled and will no longer appear as an active commercial request.",
    };
  }
  if (status === "open") {
    return {
      tone: "border-sky-200 bg-sky-50 text-sky-900",
      title: "Request re-opened",
      body: "The request is active again and visible in the customer pending view.",
    };
  }
  if (status === "error") {
    return {
      tone: "border-amber-200 bg-amber-50 text-amber-900",
      title: "Request update failed",
      body: "The status change did not complete. Check the request state and try again.",
    };
  }
  if (status === "forbidden") {
    return {
      tone: "border-amber-200 bg-amber-50 text-amber-900",
      title: "Admin session required",
      body: "Sign in with an active admin session to update commercial request state.",
    };
  }
  return null;
}

function buildRequestActions(request: PlanUpgradeRequest) {
  if (request.status === "open") {
    return [
      { status: "acknowledged", label: "Acknowledge" },
      { status: "resolved", label: "Resolve" },
      { status: "cancelled", label: "Cancel" },
    ];
  }
  if (request.status === "acknowledged") {
    return [
      { status: "resolved", label: "Resolve" },
      { status: "cancelled", label: "Cancel" },
      { status: "open", label: "Re-open" },
    ];
  }
  return [{ status: "open", label: "Re-open" }];
}

function formatDateValue(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not set";
  }
  return date.toLocaleDateString("en-IN");
}

function OverviewMetric({
  label,
  value,
  tone = "text-slate-900",
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

export default async function DeveloperPage({ searchParams }: DeveloperPageProps) {
  const actorRole = await getServerActorRole();
  if (actorRole !== "admin" || process.env.APP_ENV === "production") {
    notFound();
  }

  const claims = await getServerSessionClaims();
  const query = await searchParams;
  const tenantQuery = normalizeText(query.tenantQuery);
  const tenantKey = normalizeText(query.tenantKey);
  const requestStatusFilter = normalizeRequestStatusFilter(query.requestStatusFilter);
  const actionAlert = resolveActionAlert(query.actionStatus);
  const tokenConfigured = String(process.env.PIM_COMMERCIAL_OPS_TOKEN ?? "").trim().length > 0;

  let requestItems: PlanUpgradeRequest[] = [];
  let tenantResults: CommercialTenantSearchResult[] = [];
  let overview: CommercialOverviewResponse | null = null;
  let selectedTenant: CommercialTenantSearchResult | null = null;
  let opsError: string | null = null;

  if (!claims?.sub) {
    opsError = "An authenticated admin session is required for internal commercial tools.";
  } else if (!tokenConfigured) {
    opsError = "PIM_COMMERCIAL_OPS_TOKEN is not configured for the web runtime, so request handling tools are unavailable here.";
  } else {
    try {
      const requestOptions = getCommercialOpsRequestOptions(claims.sub, actorRole);
      const tenantSearchPromise =
        tenantQuery.length >= 2
          ? searchCommercialTenantsInternal({ q: tenantQuery, limit: 8 }, requestOptions)
          : Promise.resolve({ items: [], count: 0, query: tenantQuery });
      const selectedTenantPromise = tenantKey
        ? (tenantQuery.length >= 2
            ? tenantSearchPromise
            : searchCommercialTenantsInternal({ q: tenantKey, limit: 8 }, requestOptions))
        : Promise.resolve(null);
      const [overviewResponse, requestResponse, tenantResponse, selectedTenantResponse] = await Promise.all([
        getCommercialOverviewInternal(requestOptions),
        listInternalUpgradeRequests(
          {
            tenantKey: tenantKey || undefined,
            status: requestStatusFilter === "all" ? undefined : requestStatusFilter,
            limit: 25,
          },
          requestOptions,
        ),
        tenantSearchPromise,
        selectedTenantPromise,
      ]);
      overview = overviewResponse;
      requestItems = requestResponse.items;
      tenantResults = tenantResponse.items;
      selectedTenant =
        selectedTenantResponse?.items?.find((item) => item.tenantKey === tenantKey) ??
        tenantResponse.items.find((item) => item.tenantKey === tenantKey) ??
        null;
    } catch (error: unknown) {
      if (error instanceof ApiHttpError) {
        opsError = `Commercial tools API returned ${error.status}.`;
      } else if (error instanceof Error) {
        opsError = error.message;
      } else {
        opsError = "Commercial tools could not be loaded.";
      }
    }
  }

  return (
    <div className="space-y-5">
      <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs text-slate-500">
          Dashboard / Internal / <span className="font-semibold text-slate-700">Developer</span>
        </p>
        <h1 className="text-2xl font-semibold text-slate-900">Internal Tools</h1>
        <p className="mt-1 text-sm text-slate-600">
          Internal phase navigation, commercial request handling, and engineering utilities.
        </p>
      </header>
      <Card>
        <CardTitle>Internal phase navigation</CardTitle>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Link className="rounded-md border border-border px-3 py-2" href="/media">
            Phase 5 DAM
          </Link>
          <Link className="rounded-md border border-border px-3 py-2" href="/rejection">
            Phase 6 Intelligence
          </Link>
          <Link className="rounded-md border border-border px-3 py-2" href="/ondc">
            Phase 7 ONDC
          </Link>
          <Link className="rounded-md border border-border px-3 py-2" href="/ai">
            Phase 8 AI
          </Link>
        </div>
      </Card>
      <Card>
        <CardTitle>Commercial ops request queue</CardTitle>
        <div className="space-y-4 text-sm text-slate-700">
          <p>
            Search workspaces, review commercial upgrade requests, and move them through the TEJ ops workflow without leaving the internal surface.
          </p>
          {overview ? (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                <OverviewMetric label="Tenants" value={overview.tenantOverview.totalTenants} />
                <OverviewMetric label="Trial" value={overview.tenantOverview.billingStatusCounts.trial} tone="text-blue-900" />
                <OverviewMetric label="Paid" value={overview.tenantOverview.billingStatusCounts.activePaid} tone="text-emerald-900" />
                <OverviewMetric label="Past due" value={overview.tenantOverview.billingStatusCounts.pastDue} tone="text-amber-900" />
                <OverviewMetric label="Suspended" value={overview.tenantOverview.accessStatusCounts.suspended} tone="text-rose-900" />
                <OverviewMetric label="Active queue" value={overview.requestOverview.activeRequests} tone="text-sky-900" />
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <div>
                  Workspace activity: {overview.tenantOverview.activeWorkspaces} active / {overview.tenantOverview.inactiveWorkspaces} inactive
                </div>
                <div className="mt-1">
                  Plans: {overview.tenantOverview.planTierCounts.starter} starter, {overview.tenantOverview.planTierCounts.growth} growth, {overview.tenantOverview.planTierCounts.enterprise} enterprise
                </div>
                <div className="mt-1">
                  Request queue: {overview.requestOverview.openRequests} open, {overview.requestOverview.acknowledgedRequests} acknowledged, {overview.requestOverview.resolvedRequests} resolved, {overview.requestOverview.cancelledRequests} cancelled
                </div>
                <div className="mt-1">
                  Last 7 days: {overview.requestOverview.recentRequests} new requests, {overview.requestOverview.recentResolvedRequests} resolved
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    className={`rounded-md border px-2 py-1 font-medium ${
                      requestStatusFilter === "open"
                        ? "border-sky-300 bg-sky-100 text-sky-900"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                    }`}
                    href={buildDeveloperHref({ tenantQuery, tenantKey, requestStatusFilter: "open" })}
                  >
                    Open queue
                  </Link>
                  <Link
                    className={`rounded-md border px-2 py-1 font-medium ${
                      requestStatusFilter === "acknowledged"
                        ? "border-amber-300 bg-amber-100 text-amber-900"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                    }`}
                    href={buildDeveloperHref({ tenantQuery, tenantKey, requestStatusFilter: "acknowledged" })}
                  >
                    Acknowledged
                  </Link>
                  <Link
                    className={`rounded-md border px-2 py-1 font-medium ${
                      requestStatusFilter === "resolved"
                        ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                    }`}
                    href={buildDeveloperHref({ tenantQuery, tenantKey, requestStatusFilter: "resolved" })}
                  >
                    Resolved
                  </Link>
                  <Link
                    className={`rounded-md border px-2 py-1 font-medium ${
                      requestStatusFilter === "cancelled"
                        ? "border-slate-300 bg-slate-200 text-slate-800"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                    }`}
                    href={buildDeveloperHref({ tenantQuery, tenantKey, requestStatusFilter: "cancelled" })}
                  >
                    Cancelled
                  </Link>
                </div>
              </div>
            </div>
          ) : null}
          <form action="/internal/developer" className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 md:grid-cols-[minmax(0,1.6fr)_220px_auto] md:items-end">
            <div>
              <label htmlFor="tenant-query" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Search workspaces
              </label>
              <p className="mt-1 text-xs text-slate-500">
                Search by workspace slug, display name, tenant key, or active admin email.
              </p>
              <Input
                id="tenant-query"
                name="tenantQuery"
                defaultValue={tenantQuery}
                placeholder="workspace slug, tenant key, display name, or admin email"
              />
            </div>
            <div>
              <label htmlFor="request-status-filter" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Request filter
              </label>
              <Select id="request-status-filter" name="requestStatusFilter" defaultValue={requestStatusFilter}>
                <option value="all">All requests</option>
                <option value="open">Open</option>
                <option value="acknowledged">Acknowledged</option>
                <option value="resolved">Resolved</option>
                <option value="cancelled">Cancelled</option>
              </Select>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
                Filter queue
              </button>
              <Link
                href={buildExportHref({ tenantKey, requestStatusFilter })}
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Export CSV
              </Link>
              {(tenantQuery || tenantKey || requestStatusFilter !== "open") ? (
                <Link href="/internal/developer" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Reset
                </Link>
              ) : null}
            </div>
          </form>
          {actionAlert ? (
            <div className={`rounded-md border px-3 py-3 text-sm ${actionAlert.tone}`}>
              <div className="font-semibold">{actionAlert.title}</div>
              <div className="mt-1">{actionAlert.body}</div>
            </div>
          ) : null}
          {opsError ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
              <div className="font-semibold">Commercial tools unavailable</div>
              <div className="mt-1">{opsError}</div>
            </div>
          ) : null}
          {tenantQuery.length === 1 ? (
            <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-3 text-sm text-sky-900">
              Use at least 2 characters to search the tenant directory.
            </div>
          ) : null}
          {tenantResults.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Search results</div>
              <div className="grid gap-3 lg:grid-cols-2">
                {tenantResults.map((result) => (
                  <div key={result.tenantKey} className="rounded-md border border-slate-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-900">{result.displayName || result.workspaceSlug}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {result.workspaceSlug} | {result.tenantKey}
                        </div>
                      </div>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                          result.workspaceIsActive ? "bg-emerald-100 text-emerald-900" : "bg-slate-200 text-slate-700"
                        }`}
                      >
                        {result.workspaceIsActive ? "Workspace active" : "Workspace inactive"}
                      </span>
                    </div>
                    <div className="mt-3 space-y-1 text-xs text-slate-600">
                      <div>
                        Plan: {result.planTier} | Billing: {formatBillingStatus(result.billingStatus)} | Access: {formatAccessStatus(result.accessStatus)}
                      </div>
                      <div>
                        Billing notices: {result.billingContactEmail ?? "active workspace admins"}
                      </div>
                      <div>Admins: {result.adminEmails.length > 0 ? result.adminEmails.join(", ") : "none found"}</div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        href={buildDeveloperHref({
                          tenantQuery,
                          tenantKey: result.tenantKey,
                          requestStatusFilter,
                        })}
                      >
                        View requests
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : tenantQuery.length >= 2 && !opsError ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
              No workspaces matched this search.
            </div>
          ) : null}
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Queue scope</div>
                <div className="mt-1 text-sm text-slate-700">
                  {tenantKey ? `Showing requests for ${tenantKey}.` : "Showing commercial requests across all tenants."}
                </div>
              </div>
              {tenantKey ? (
                <Link
                  href={buildDeveloperHref({
                    tenantQuery,
                    requestStatusFilter,
                  })}
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Clear tenant filter
                </Link>
              ) : null}
            </div>
          </div>
          {selectedTenant ? (
            <div className="rounded-md border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected tenant snapshot</div>
                  <div className="mt-1 text-base font-semibold text-slate-900">
                    {selectedTenant.displayName || selectedTenant.workspaceSlug}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {selectedTenant.workspaceSlug} | {selectedTenant.tenantKey}
                  </div>
                </div>
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                    selectedTenant.workspaceIsActive ? "bg-emerald-100 text-emerald-900" : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {selectedTenant.workspaceIsActive ? "Workspace active" : "Workspace inactive"}
                </span>
              </div>
              <div className="mt-3 grid gap-2 text-sm text-slate-700 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Commercial state</div>
                  <div className="mt-1">
                    {formatPlanTier(selectedTenant.planTier)} | {formatBillingStatus(selectedTenant.billingStatus)} | {formatAccessStatus(selectedTenant.accessStatus)}
                  </div>
                  <div className="text-xs text-slate-500">
                    Billing notices: {selectedTenant.billingContactEmail ?? "active workspace admins"}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dates</div>
                  <div className="mt-1">Trial ends: {formatDateValue(selectedTenant.trialEndsAt)}</div>
                  <div className="text-xs text-slate-500">Paid through: {formatDateValue(selectedTenant.paidThroughAt)}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Grace and cancellation</div>
                  <div className="mt-1">Grace ends: {formatDateValue(selectedTenant.graceEndsAt)}</div>
                  <div className="text-xs text-slate-500">Cancelled at: {formatDateValue(selectedTenant.cancelledAt)}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Suspension</div>
                  <div className="mt-1">Suspended at: {formatDateValue(selectedTenant.suspendedAt)}</div>
                  <div className="text-xs text-slate-500">{selectedTenant.suspensionReason ?? "No suspension reason recorded"}</div>
                </div>
              </div>
              <div className="mt-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Admin recipients</div>
                <div className="mt-1">
                  {selectedTenant.adminEmails.length > 0 ? selectedTenant.adminEmails.join(", ") : "No active admins found"}
                </div>
              </div>
            </div>
          ) : null}
          {requestItems.length === 0 && !opsError ? (
            <div className="rounded-md border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700">
              No commercial requests found for this filter.
            </div>
          ) : null}
          <div className="space-y-3">
            {requestItems.map((request) => (
              <div key={request.id} className="rounded-md border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900">
                      {request.displayName || request.workspaceSlug || request.tenantKey}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {request.workspaceSlug || "no workspace slug"} | {request.tenantKey}
                    </div>
                  </div>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${requestStatusTone(request.status)}`}>
                    {formatRequestStatus(request.status)}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 text-sm text-slate-700 md:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Requested by</div>
                    <div className="mt-1">{request.requestedBy}</div>
                    <div className="text-xs text-slate-500">{request.requesterRole}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Commercial state</div>
                    <div className="mt-1">
                      {request.currentPlanTier} | {formatBillingStatus(request.currentBillingStatus)} | {formatAccessStatus(request.currentAccessStatus)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Created</div>
                    <div className="mt-1">{new Date(request.createdAt).toLocaleString("en-IN")}</div>
                    <div className="text-xs text-slate-500">Source: {request.source}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Resolution</div>
                    <div className="mt-1">{request.resolvedAt ? new Date(request.resolvedAt).toLocaleString("en-IN") : "Still active"}</div>
                    <div className="text-xs text-slate-500">{request.resolvedBy ?? "No resolver yet"}</div>
                  </div>
                </div>
                {request.notes ? (
                  <div className="mt-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Request notes</div>
                    <div className="mt-1 whitespace-pre-wrap">{request.notes}</div>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {buildRequestActions(request).map((action) => (
                    <form key={`${request.id}-${action.status}`} action={updateUpgradeRequestStatusAction}>
                      <input type="hidden" name="requestId" value={request.id} />
                      <input type="hidden" name="status" value={action.status} />
                      <input type="hidden" name="tenantQuery" value={tenantQuery} />
                      <input type="hidden" name="tenantKey" value={tenantKey} />
                      <input type="hidden" name="requestStatusFilter" value={requestStatusFilter} />
                      <button
                        type="submit"
                        className={`rounded-md px-3 py-2 text-sm font-medium ${
                          action.status === "resolved"
                            ? "bg-emerald-600 text-white"
                            : action.status === "cancelled"
                              ? "bg-slate-700 text-white"
                              : "border border-slate-200 text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {action.label}
                      </button>
                    </form>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

