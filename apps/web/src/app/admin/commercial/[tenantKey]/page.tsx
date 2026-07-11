import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PageHeader } from "@/components/ui/page-header";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerSession, getServerSessionClaims } from "@/lib/server-session";
import { canAccessCommercialOperations } from "@/lib/role-capabilities";
import { SystemAdminRequiredCard } from "@/components/ui/system-admin-required-card";
import { getTenantDetail, isOpsTokenConfigured } from "@/lib/api/commercial-ops";
import type { TenantDetail } from "@/lib/api/commercial-ops";

export const dynamic = "force-dynamic";

interface TenantDetailPageProps {
  params: Promise<{ tenantKey: string }>;
}

function formatTierBadge(tier: string) {
  const t = tier.toUpperCase();
  if (t === "ENTERPRISE") return "bg-purple-100 text-purple-800";
  if (t === "BUSINESS") return "bg-indigo-100 text-indigo-800";
  if (t === "GROWTH") return "bg-blue-100 text-blue-800";
  return "bg-slate-100 text-slate-700";
}

function formatBillingStatus(status: string) {
  if (status === "active_paid") return "Paid";
  if (status === "past_due") return "Past due";
  if (status === "cancelled") return "Cancelled";
  if (status === "suspended") return "Suspended";
  return "Trial";
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

function formatDateShort(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
}

export default async function TenantDetailPage({ params }: TenantDetailPageProps) {
  const { tenantKey } = await params;
  const { authHeader, actorRole, adminBoundaryRoles } = await getServerSession();

  if (!authHeader) {
    redirect(buildLoginRedirect(`/admin/commercial/${encodeURIComponent(tenantKey)}`, 401));
  }
  if (!canAccessCommercialOperations({ actorRole, adminBoundaryRoles })) {
    if (actorRole !== "admin") {
      redirect("/admin");
    }
    return (
      <div className="space-y-5">
        <PageHeader
          title="Tenant Detail"
          description="Commercial tenant information."
          breadcrumb={<><Link href="/dashboard" className="underline">Dashboard</Link> / <Link href="/admin" className="underline">Admin</Link> / <Link href="/admin/commercial" className="underline">Commercial</Link> / <span className="font-semibold text-slate-700">Detail</span></>}
        />
        <SystemAdminRequiredCard surfaceLabel="Tenant detail" />
      </div>
    );
  }
  if (!isOpsTokenConfigured()) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Tenant Detail"
          description="Commercial tenant information."
          breadcrumb={<><Link href="/dashboard" className="underline">Dashboard</Link> / <Link href="/admin" className="underline">Admin</Link> / <Link href="/admin/commercial" className="underline">Commercial</Link> / <span className="font-semibold text-slate-700">Detail</span></>}
        />
        <InlineAlert tone="warning" title="Not configured" message="Set PIM_COMMERCIAL_OPS_TOKEN in your environment to enable commercial operations." />
      </div>
    );
  }

  const claims = await getServerSessionClaims();
  const operatorId = claims?.sub || "web-admin";
  let detail: TenantDetail;
  try {
    detail = await getTenantDetail(tenantKey, operatorId);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes("404")) {
      notFound();
    }
    return (
      <div className="space-y-5">
        <PageHeader
          title="Tenant Detail"
          description="Commercial tenant information."
          breadcrumb={<><Link href="/dashboard" className="underline">Dashboard</Link> / <Link href="/admin" className="underline">Admin</Link> / <Link href="/admin/commercial" className="underline">Commercial</Link> / <span className="font-semibold text-slate-700">Detail</span></>}
        />
        <InlineAlert tone="error" title="Failed to load tenant" message="Tenant detail could not be loaded. Retry in a moment or check the PIM_COMMERCIAL_OPS_TOKEN configuration." />
      </div>
    );
  }

  const t = detail.tenant;
  const c = detail.commercial;
  const u = detail.usage;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t.workspaceName}
        description={`Tenant key: ${t.tenantKey}`}
        breadcrumb={<><Link href="/dashboard" className="underline">Dashboard</Link> / <Link href="/admin" className="underline">Admin</Link> / <Link href="/admin/commercial" className="underline">Commercial</Link> / <span className="font-semibold text-slate-700">{t.workspaceName}</span></>}
      />

      {/* Tenant + Commercial summary */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Plan tier</div>
          <span className={`mt-1 inline-block rounded px-2 py-0.5 text-sm font-semibold ${formatTierBadge(c.planTier)}`}>
            {c.planTier}
          </span>
        </Card>
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Billing</div>
          <div className="mt-1 text-sm font-medium text-slate-900">{formatBillingStatus(c.billingStatus)}</div>
          {c.accessStatus === "suspended" ? (
            <div className="mt-0.5 text-xs text-red-600">Suspended{c.suspensionReason ? `: ${c.suspensionReason}` : ""}</div>
          ) : null}
        </Card>
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Workspace</div>
          <div className="mt-1 font-mono text-sm text-slate-900">{t.workspaceSlug}</div>
          <div className="mt-0.5 text-xs text-slate-500">Since {formatDateShort(t.createdAt)}</div>
        </Card>
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Usage</div>
          <div className="mt-1 space-y-0.5 text-sm">
            <div>SKUs: <span className="font-semibold">{u.skuCount.toLocaleString()}</span></div>
            <div>Users: <span className="font-semibold">{u.userCount}</span></div>
            <div>Storage: <span className="font-semibold">{formatBytes(u.storageBytes)}</span></div>
          </div>
        </Card>
      </div>

      {/* Commercial dates */}
      {(c.trialEndsAt || c.paidThroughAt || c.graceEndsAt || c.cancelledAt || c.billingContactEmail) ? (
        <Card>
          <CardTitle>Commercial Details</CardTitle>
          <div className="mt-3 grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
            {c.trialEndsAt ? <div><span className="text-xs font-semibold uppercase text-slate-500">Trial ends</span><div>{formatDateShort(c.trialEndsAt)}</div></div> : null}
            {c.paidThroughAt ? <div><span className="text-xs font-semibold uppercase text-slate-500">Paid through</span><div>{formatDateShort(c.paidThroughAt)}</div></div> : null}
            {c.graceEndsAt ? <div><span className="text-xs font-semibold uppercase text-slate-500">Grace ends</span><div>{formatDateShort(c.graceEndsAt)}</div></div> : null}
            {c.cancelledAt ? <div><span className="text-xs font-semibold uppercase text-slate-500">Cancelled</span><div>{formatDateShort(c.cancelledAt)}</div></div> : null}
            {c.billingContactEmail ? <div><span className="text-xs font-semibold uppercase text-slate-500">Billing contact</span><div>{c.billingContactEmail}</div></div> : null}
          </div>
        </Card>
      ) : null}

      {/* Signup info */}
      {detail.signup ? (
        <Card>
          <CardTitle>Signup</CardTitle>
          <div className="mt-3 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div><span className="text-xs font-semibold uppercase text-slate-500">Admin email</span><div>{detail.signup.adminEmail}</div></div>
            <div><span className="text-xs font-semibold uppercase text-slate-500">Status</span><div>{detail.signup.status}</div></div>
            <div><span className="text-xs font-semibold uppercase text-slate-500">Requested</span><div>{formatDate(detail.signup.requestedAt)}</div></div>
            <div><span className="text-xs font-semibold uppercase text-slate-500">Verified</span><div>{detail.signup.verifiedAt ? formatDate(detail.signup.verifiedAt) : "—"}</div></div>
          </div>
        </Card>
      ) : null}

      {/* Users */}
      <Card>
        <CardTitle>Users ({detail.users.total}){detail.users.truncated ? ` — showing ${detail.users.limit}` : ""}</CardTitle>
        {detail.users.items.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No users found.</p>
        ) : (
          <>
            <div className="mt-3 hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="pb-2 pr-4">Identity</th>
                    <th className="pb-2 pr-4">Role</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.users.items.map((user) => (
                    <tr key={user.userId} className="border-b last:border-0">
                      <td className="py-2 pr-4 text-xs text-slate-900">{user.userId}</td>
                      <td className="py-2 pr-4 text-xs text-slate-600">{user.role}</td>
                      <td className="py-2 pr-4">
                        <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${
                          user.isLocked
                            ? "bg-red-100 text-red-800"
                            : user.isActive
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-100 text-slate-600"
                        }`}>
                          {user.isLocked ? "Locked" : user.isActive ? "Active" : "Inactive"}
                        </span>
                        {user.isLocked && user.lockedUntil ? (
                          <span className="ml-1 text-xs text-slate-400">until {formatDateShort(user.lockedUntil)}</span>
                        ) : null}
                      </td>
                      <td className="py-2 text-xs text-slate-500">{formatDateShort(user.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 space-y-2 md:hidden">
              {detail.users.items.map((user) => (
                <div key={user.userId} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{user.userId}</p>
                    </div>
                    <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${
                      user.isLocked
                        ? "bg-red-100 text-red-800"
                        : user.isActive
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-100 text-slate-600"
                    }`}>
                      {user.isLocked ? "Locked" : user.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{user.role} — {formatDateShort(user.createdAt)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* Connectors */}
      <Card>
        <CardTitle>Connectors ({detail.connectors.total}){detail.connectors.truncated ? ` — showing ${detail.connectors.limit}` : ""}</CardTitle>
        {detail.connectors.items.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No connectors installed.</p>
        ) : (
          <>
            <div className="mt-3 hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="pb-2 pr-4">Connector</th>
                    <th className="pb-2 pr-4">Slug</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2">Installed</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.connectors.items.map((conn) => (
                    <tr key={conn.installationId} className="border-b last:border-0">
                      <td className="py-2 pr-4 text-sm font-medium text-slate-900">{conn.connectorName}</td>
                      <td className="py-2 pr-4 font-mono text-xs text-slate-500">{conn.connectorSlug}</td>
                      <td className="py-2 pr-4">
                        <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${
                          conn.status === "ACTIVE" || conn.status === "CONNECTED"
                            ? "bg-emerald-100 text-emerald-800"
                            : conn.status === "DISABLED"
                              ? "bg-red-100 text-red-800"
                              : "bg-slate-100 text-slate-600"
                        }`}>
                          {conn.status}
                        </span>
                      </td>
                      <td className="py-2 text-xs text-slate-500">{formatDateShort(conn.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 space-y-2 md:hidden">
              {detail.connectors.items.map((conn) => (
                <div key={conn.installationId} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{conn.connectorName}</p>
                      <p className="mt-0.5 font-mono text-xs text-slate-500">{conn.connectorSlug}</p>
                    </div>
                    <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${
                      conn.status === "ACTIVE" || conn.status === "CONNECTED"
                        ? "bg-emerald-100 text-emerald-800"
                        : conn.status === "DISABLED"
                          ? "bg-red-100 text-red-800"
                          : "bg-slate-100 text-slate-600"
                    }`}>
                      {conn.status}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{formatDateShort(conn.createdAt)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
