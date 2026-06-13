import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PageHeader } from "@/components/ui/page-header";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerSession } from "@/lib/server-session";
import { ApiHttpError, getBillingUsage, getKpiTrends } from "@/lib/api";
import {
  getCommercialOverview,
  listUpgradeRequests,
  searchCommercialTenants,
  isOpsTokenConfigured,
} from "@/lib/api/commercial-ops";
import { changePlanTierAction, resolveUpgradeRequestAction } from "./actions";
import { SignupConversionSection } from "../plan/_components/signup-conversion";

export const dynamic = "force-dynamic";

interface CommercialPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

function formatTierBadge(tier: string | null) {
  const t = String(tier ?? "").toUpperCase();
  if (t === "ENTERPRISE") return "bg-purple-100 text-purple-800";
  if (t === "BUSINESS") return "bg-indigo-100 text-indigo-800";
  if (t === "GROWTH") return "bg-blue-100 text-blue-800";
  return "bg-slate-100 text-slate-700";
}

function formatStatus(status: string | null) {
  const s = String(status ?? "").toLowerCase();
  if (s === "active_paid") return "Paid";
  if (s === "past_due") return "Past due";
  if (s === "cancelled") return "Cancelled";
  if (s === "suspended") return "Suspended";
  return "Trial";
}

function hasCommercialOpsAccess(adminBoundaryRoles: readonly string[]): boolean {
  return adminBoundaryRoles.includes("system_admin") || adminBoundaryRoles.includes("super_admin");
}

function resolveOperatorRole(adminBoundaryRoles: readonly string[]): string {
  return adminBoundaryRoles.includes("super_admin") ? "super_admin" : "system_admin";
}

function sumTrendValues(points: Array<{ value: number }>): number {
  return points.reduce((sum, point) => sum + (Number.isFinite(point.value) ? point.value : 0), 0);
}

function latestTrendValue(points: Array<{ value: number }>): number {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const value = points[index]?.value;
    if (Number.isFinite(value)) return Number(value);
  }
  return 0;
}

function formatHours(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (value === 0) return "0h";
  return `${value.toFixed(value >= 10 ? 0 : 1)}h`;
}

function resolveSignupTrendDays(input: string | undefined): 7 | 30 | 90 {
  const parsed = Number.parseInt(String(input ?? ""), 10);
  return parsed === 7 || parsed === 90 ? parsed : 30;
}

function resolveSignupHealthAlert({ rangeDays, requests, verifications, verificationRate, medianVerifyHours }: { rangeDays: number; requests: number; verifications: number; verificationRate: number; medianVerifyHours: number }) {
  const pending = Math.max(requests - verifications, 0);
  if (requests < 3) return null;
  if (verificationRate < 40) return { tone: "border-red-200 bg-red-50 text-red-900", title: "Verification rate needs attention", body: `${pending} teams are still unverified in the last ${rangeDays} days. Check email delivery and the verification path.` };
  if (medianVerifyHours >= 24) return { tone: "border-amber-200 bg-amber-50 text-amber-900", title: "Verification is slowing down", body: `Median verification time is ${formatHours(medianVerifyHours)} in the last ${rangeDays} days. Review the onboarding email.` };
  return { tone: "border-emerald-200 bg-emerald-50 text-emerald-900", title: "Signup conversion looks healthy", body: `${verifications} of ${requests} signup requests verified in the last ${rangeDays} days.` };
}

function formatSnapshotUsage(snapshot: Record<string, unknown> | null): string {
  const resources = snapshot?.resources;
  if (!resources || typeof resources !== "object" || Array.isArray(resources)) {
    return "No usage snapshot captured";
  }
  const resourceRecord = resources as Record<string, { current?: unknown; limit?: unknown }>;
  const skus = resourceRecord.skus;
  const users = resourceRecord.users;
  const connectors = resourceRecord.connectorInstallations;
  return [
    skus ? `SKUs ${skus.current ?? "-"} / ${skus.limit ?? "-"}` : null,
    users ? `Users ${users.current ?? "-"} / ${users.limit ?? "-"}` : null,
    connectors ? `Connectors ${connectors.current ?? "-"} / ${connectors.limit ?? "-"}` : null,
  ].filter(Boolean).join(" | ") || "Usage snapshot captured";
}

export default async function CommercialOpsPage({ searchParams }: CommercialPageProps) {
  const query = await searchParams;
  const { authHeader, actorRole, adminBoundaryRoles } = await getServerSession();
  const signupTrendDays = resolveSignupTrendDays(query.days);

  if (!authHeader) {
    redirect(buildLoginRedirect("/admin/commercial", 401));
  }
  if (actorRole !== "admin" || !hasCommercialOpsAccess(adminBoundaryRoles)) {
    redirect("/admin");
  }
  if (!isOpsTokenConfigured()) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Commercial Ops"
          description="Tenant plan management and upgrade request processing."
          breadcrumb={<><Link href="/dashboard" className="underline">Dashboard</Link> / <Link href="/admin" className="underline">Admin</Link> / <span className="font-semibold text-slate-700">Commercial</span></>}
        />
        <InlineAlert tone="warning" title="Not configured" message="Set PIM_COMMERCIAL_OPS_TOKEN in your environment to enable commercial operations." />
      </div>
    );
  }

  const operatorId = "web-admin";
  const operatorRole = resolveOperatorRole(adminBoundaryRoles);
  let overview;
  let requests;
  let currentUsage;
  let signupTrends: Awaited<ReturnType<typeof getKpiTrends>> | null = null;
  let searchResults = null as Awaited<ReturnType<typeof searchCommercialTenants>> | null;
  const searchQuery = String(query.q ?? "").trim();

  try {
    [overview, requests, currentUsage, signupTrends] = await Promise.all([
      getCommercialOverview(operatorId),
      listUpgradeRequests(operatorId, "open"),
      getBillingUsage({ role: actorRole, authHeader }),
      getKpiTrends({ days: signupTrendDays }, { role: actorRole, authHeader }).catch((err: unknown) => {
        if (err instanceof ApiHttpError && err.status === 404) return null;
        throw err;
      }),
    ]);
    if (searchQuery.length >= 2) {
      searchResults = await searchCommercialTenants(searchQuery, operatorId);
    }
  } catch (error) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Commercial Ops"
          description="Tenant plan management."
          breadcrumb={<><Link href="/dashboard" className="underline">Dashboard</Link> / <Link href="/admin" className="underline">Admin</Link> / <span className="font-semibold text-slate-700">Commercial</span></>}
        />
        <InlineAlert tone="error" title="Failed to load" message={error instanceof Error ? error.message : "Unknown error"} />
      </div>
    );
  }

  const successMessage = query.success === "tier_changed"
    ? `Plan changed to ${query.tier ?? "?"} for ${query.tenant ?? "?"}`
    : query.success === "request_resolved"
      ? "Upgrade request resolved"
      : query.success === "request_cancelled"
        ? "Upgrade request cancelled"
        : null;

  const t = overview.tenantOverview;
  const signupRequests = signupTrends ? Math.round(sumTrendValues(signupTrends.signupRequests)) : 0;
  const signupVerifications = signupTrends ? Math.round(sumTrendValues(signupTrends.signupVerifications)) : 0;
  const signupPendingBacklog = Math.max(signupRequests - signupVerifications, 0);
  const signupVerificationRate = signupTrends ? latestTrendValue(signupTrends.signupVerificationRate) : 0;
  const signupMedianVerifyHours = signupTrends ? latestTrendValue(signupTrends.signupMedianTimeToVerifyHours) : 0;
  const signupHealthAlert = signupTrends ? resolveSignupHealthAlert({ rangeDays: signupTrends.rangeDays, requests: signupRequests, verifications: signupVerifications, verificationRate: signupVerificationRate, medianVerifyHours: signupMedianVerifyHours }) : null;
  const signupExportHref = `/api/admin/plan/signup-trends/export?days=${signupTrendDays}`;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Commercial Ops"
        description="Search tenants, change plan tiers, and process upgrade requests."
        breadcrumb={<><Link href="/dashboard" className="underline">Dashboard</Link> / <Link href="/admin" className="underline">Admin</Link> / <span className="font-semibold text-slate-700">Commercial</span></>}
      />

      {successMessage ? <InlineAlert tone="success" message={successMessage} /> : null}
      {query.error ? <InlineAlert tone="error" title="Error" message={decodeURIComponent(query.error)} /> : null}
      {operatorRole !== "system_admin" ? (
        <InlineAlert tone="info" message={`Commercial Ops session is running as ${operatorRole}.`} />
      ) : null}

      {/* Overview */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total tenants</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{t.totalTenants}</div>
        </Card>
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">By tier</div>
          <div className="mt-1 space-y-1 text-sm">
            <div>Trial: <span className="font-semibold">{t.planTierCounts.trial}</span></div>
            <div>Starter: <span className="font-semibold">{t.planTierCounts.starter}</span></div>
            <div>Growth: <span className="font-semibold">{t.planTierCounts.growth}</span></div>
            <div>Business: <span className="font-semibold">{t.planTierCounts.business}</span></div>
            <div>Enterprise: <span className="font-semibold">{t.planTierCounts.enterprise}</span></div>
          </div>
        </Card>
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Billing</div>
          <div className="mt-1 space-y-1 text-sm">
            <div>Trial: <span className="font-semibold">{t.billingStatusCounts.trial}</span></div>
            <div>Paid: <span className="font-semibold">{t.billingStatusCounts.activePaid}</span></div>
            <div>Past due: <span className="font-semibold text-amber-600">{t.billingStatusCounts.pastDue}</span></div>
          </div>
        </Card>
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Open requests</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{overview.requestOverview.openRequests}</div>
          <div className="mt-1 text-xs text-slate-500">{overview.requestOverview.acknowledgedRequests} acknowledged</div>
        </Card>
      </div>

      {signupTrends ? (
        <SignupConversionSection
          signupTrends={signupTrends}
          signupRequests={signupRequests}
          signupVerifications={signupVerifications}
          signupPendingBacklog={signupPendingBacklog}
          signupVerificationRate={signupVerificationRate}
          signupMedianVerifyHours={signupMedianVerifyHours}
          signupHealthAlert={signupHealthAlert}
          signupExportHref={signupExportHref}
        />
      ) : null}

      {/* Current Tenant — always visible, no search needed */}
      {currentUsage ? (
        <Card>
          <CardTitle>This workspace — {currentUsage.profile.tenantKey}</CardTitle>
          <div className="mt-3 flex flex-wrap items-center gap-6">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current tier</div>
              <span className={`mt-1 inline-block rounded px-2 py-0.5 text-sm font-semibold ${formatTierBadge(currentUsage.planTier)}`}>
                {currentUsage.planTier}
              </span>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Billing</div>
              <div className="mt-1 text-sm">{formatStatus(currentUsage.billingStatus)}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">SKUs</div>
              <div className="mt-1 text-sm">{currentUsage.skus.current.toLocaleString()} / {currentUsage.skus.limit.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Users</div>
              <div className="mt-1 text-sm">{currentUsage.users.current} / {currentUsage.users.limit}</div>
            </div>
          </div>
          <form action={changePlanTierAction} className="mt-4 flex items-center gap-3">
            <input type="hidden" name="tenantKey" value={currentUsage.profile.tenantKey} />
            <input type="hidden" name="operatorId" value="web-admin" />
            <select
              name="planTier"
              defaultValue={currentUsage.planTier}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            >
              <option value="STARTER">STARTER — 500 SKUs, 3 users</option>
              <option value="GROWTH">GROWTH — 10,000 SKUs, 20 users</option>
              <option value="BUSINESS">BUSINESS — 50,000 SKUs, 100 users</option>
              <option value="ENTERPRISE">ENTERPRISE — 100,000 SKUs, 999 users</option>
            </select>
            <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
              Apply
            </button>
          </form>
        </Card>
      ) : null}

      {/* Search Tenants */}
      <Card>
        <CardTitle>Find tenant</CardTitle>
        <form method="GET" action="/admin/commercial" className="mt-2 flex gap-3">
          <input
            name="q"
            type="text"
            defaultValue={searchQuery}
            placeholder="Search by workspace name, slug, or admin email..."
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
          <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
            Search
          </button>
        </form>

        {searchQuery.length > 0 && searchQuery.length < 2 ? (
          <p className="mt-3 text-sm text-slate-500">Type at least 2 characters to search.</p>
        ) : null}

        {searchResults && searchResults.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No tenants found for &ldquo;{searchQuery}&rdquo;.</p>
        ) : null}

        {searchResults && searchResults.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="pb-2 pr-4">Workspace</th>
                  <th className="pb-2 pr-4">Name</th>
                  <th className="pb-2 pr-4">Admins</th>
                  <th className="pb-2 pr-4">Tier</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2">Change tier</th>
                </tr>
              </thead>
              <tbody>
                {searchResults.map((tenant) => (
                  <tr key={tenant.tenantKey} className="border-b last:border-0">
                    <td className="py-3 pr-4 font-mono text-xs">{tenant.workspaceSlug}</td>
                    <td className="py-3 pr-4 text-sm">{tenant.displayName}</td>
                    <td className="py-3 pr-4 text-xs text-slate-600">{(tenant.adminEmails ?? []).join(", ") || "—"}</td>
                    <td className="py-3 pr-4">
                      <span className={`rounded px-2 py-0.5 text-xs font-semibold ${formatTierBadge(tenant.planTier)}`}>
                        {tenant.planTier ?? "—"}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-xs">{formatStatus(tenant.billingStatus)}</td>
                    <td className="py-3">
                      <form action={changePlanTierAction} className="flex items-center gap-2">
                        <input type="hidden" name="tenantKey" value={tenant.tenantKey} />
                        <input type="hidden" name="operatorId" value="web-admin" />
                        <select
                          name="planTier"
                          defaultValue={tenant.planTier ?? "STARTER"}
                          className="rounded border border-slate-300 px-2 py-1 text-xs"
                        >
                          <option value="STARTER">STARTER</option>
                          <option value="GROWTH">GROWTH</option>
                          <option value="BUSINESS">BUSINESS</option>
                          <option value="ENTERPRISE">ENTERPRISE</option>
                        </select>
                        <button type="submit" className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800">
                          Apply
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      {/* Pending Upgrade Requests */}
      <Card>
        <CardTitle>Pending upgrade requests ({requests.length})</CardTitle>
        {requests.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No open upgrade requests.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="pb-2 pr-4">Tenant</th>
                  <th className="pb-2 pr-4">Current tier</th>
                  <th className="pb-2 pr-4">Requested tier</th>
                  <th className="pb-2 pr-4">Requested by</th>
                  <th className="pb-2 pr-4">Usage snapshot</th>
                  <th className="pb-2 pr-4">Notes</th>
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((req) => (
                  <tr key={req.id} className="border-b last:border-0">
                    <td className="py-3 pr-4 font-mono text-xs">{req.tenantKey}</td>
                    <td className="py-3 pr-4">
                      <span className={`rounded px-2 py-0.5 text-xs font-semibold ${formatTierBadge(req.currentPlanTier)}`}>
                        {req.currentPlanTier}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`rounded px-2 py-0.5 text-xs font-semibold ${formatTierBadge(req.requestedPlanTier)}`}>
                        {req.requestedPlanTier ?? "Not specified"}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-xs">{req.requestedBy}</td>
                    <td className="py-3 pr-4 text-xs text-slate-600">{formatSnapshotUsage(req.usageSnapshot)}</td>
                    <td className="py-3 pr-4 text-xs text-slate-600">{req.notes ?? "—"}</td>
                    <td className="py-3 pr-4 text-xs text-slate-500">{new Date(req.createdAt).toLocaleDateString("en-IN")}</td>
                    <td className="py-3">
                      <div className="flex gap-2">
                        <form action={resolveUpgradeRequestAction}>
                          <input type="hidden" name="requestId" value={req.id} />
                          <input type="hidden" name="status" value="resolved" />
                          <input type="hidden" name="operatorId" value="web-admin" />
                          <button type="submit" className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100">
                            Resolve
                          </button>
                        </form>
                        <form action={resolveUpgradeRequestAction}>
                          <input type="hidden" name="requestId" value={req.id} />
                          <input type="hidden" name="status" value="cancelled" />
                          <input type="hidden" name="operatorId" value="web-admin" />
                          <button type="submit" className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100">
                            Cancel
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
