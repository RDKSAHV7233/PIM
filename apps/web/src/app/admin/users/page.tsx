import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { ApiHttpError, getBillingUsage, getConnectorPermissions } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

const rolePermissions = [
  { role: "Admin", catalog: "write", channels: "write", ops: "write", quality: "write", admin: "full" },
  { role: "Editor", catalog: "write", channels: "write", ops: "write", quality: "write", admin: "limited" },
  { role: "Viewer", catalog: "read", channels: "read", ops: "read", quality: "read", admin: "none" },
];

export default async function AdminUsersPage() {
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();

  try {
    const [usage, connectorPermissions] = await Promise.all([
      getBillingUsage({ role: actorRole, authHeader }),
      getConnectorPermissions(undefined, { role: actorRole, authHeader }),
    ]);

    const byPrincipalType = connectorPermissions.reduce<Record<string, number>>((acc, item) => {
      acc[item.principalType] = (acc[item.principalType] ?? 0) + 1;
      return acc;
    }, {});

    return (
      <div className="space-y-5">
        <PageHeader
          title="Users & Roles"
          description="Access model and governance view for workspace users."
          breadcrumb={
            <>
              Dashboard / Admin / <span className="font-semibold text-slate-700">Users & Roles</span>
            </>
          }
          actions={
            <Link
              href="/admin/connectors"
              className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Connector Access
            </Link>
          }
        />

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="User Limit" value={`${usage.users.current}/${usage.users.limit}`} />
          <KpiCard label="Role Profiles" value={rolePermissions.length} />
          <KpiCard label="Connector Overrides" value={connectorPermissions.length} tone="info" />
          <KpiCard
            label="User Principals"
            value={byPrincipalType.user ?? 0}
            helper={`Role principals: ${byPrincipalType.role ?? 0}`}
          />
        </section>

        <Card>
          <CardTitle>Role Matrix</CardTitle>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2">Role</th>
                  <th className="py-2">Catalog</th>
                  <th className="py-2">Channels</th>
                  <th className="py-2">Operations</th>
                  <th className="py-2">Quality</th>
                  <th className="py-2">Admin</th>
                </tr>
              </thead>
              <tbody>
                {rolePermissions.map((entry) => (
                  <tr key={entry.role} className="border-t border-slate-200">
                    <td className="py-2 font-medium text-slate-900">{entry.role}</td>
                    <td className="py-2"><StatusChip label={entry.catalog} tone={entry.catalog === "write" ? "success" : "neutral"} /></td>
                    <td className="py-2"><StatusChip label={entry.channels} tone={entry.channels === "write" ? "success" : "neutral"} /></td>
                    <td className="py-2"><StatusChip label={entry.ops} tone={entry.ops === "write" ? "success" : "neutral"} /></td>
                    <td className="py-2"><StatusChip label={entry.quality} tone={entry.quality === "write" ? "success" : "neutral"} /></td>
                    <td className="py-2"><StatusChip label={entry.admin} tone={entry.admin === "full" ? "info" : entry.admin === "none" ? "neutral" : "warning"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardTitle>Connector Permission Overrides</CardTitle>
          {connectorPermissions.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">No connector-specific overrides are configured.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">Principal</th>
                    <th className="py-2">Type</th>
                    <th className="py-2">Connector</th>
                    <th className="py-2">Action</th>
                    <th className="py-2">Alias</th>
                    <th className="py-2">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {connectorPermissions.map((permission) => (
                    <tr key={permission.id} className="border-t border-slate-200">
                      <td className="py-2 font-medium text-slate-900">{permission.principalId}</td>
                      <td className="py-2">{permission.principalType}</td>
                      <td className="py-2">{permission.connectorSlug}</td>
                      <td className="py-2">{permission.action}</td>
                      <td className="py-2">{permission.accountAlias}</td>
                      <td className="py-2 text-xs">{new Date(permission.updatedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Link href="/admin/connectors" className="mt-3 inline-flex text-sm font-medium text-blue-700 hover:underline">
            Manage Overrides
          </Link>
        </Card>
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/admin/users", error.status));
    }
    throw error;
  }
}
