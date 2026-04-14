import Link from "next/link";
import { redirect } from "next/navigation";
import {
  grantConnectorPermissionAction,
  revokeConnectorPermissionAction,
} from "@/app/actions";
import { ConnectorPermissionForm } from "@/components/settings/connector-permission-form";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { ApiHttpError, getConnectorDefinitions, getConnectorPermissions } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

interface ConnectorSettingsPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

function StatusBanner({ tone, message }: { tone: "success" | "error"; message: string }) {
  const classes =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-rose-200 bg-rose-50 text-rose-800";
  return <div className={`rounded-md border px-3 py-2 text-sm ${classes}`}>{message}</div>;
}

function presentAction(action: string): string {
  if (action === "install") {
    return "install";
  }
  if (action === "reconnect") {
    return "reconnect";
  }
  if (action === "uninstall") {
    return "disable";
  }
  return action;
}

function describeConnectorPermission(permission: {
  connectorSlug: string;
  principalType: string;
  principalId: string;
  accountAlias: string;
  action: string;
}) {
  const subject =
    permission.principalType === "role"
      ? `${permission.principalId} role holders`
      : `user ${permission.principalId}`;
  const scope = permission.accountAlias === "*" ? "all aliases" : `alias "${permission.accountAlias}"`;
  return `${subject} can ${presentAction(permission.action)} ${permission.connectorSlug} for ${scope}.`;
}

export default async function ConnectorSettingsPage({ searchParams }: ConnectorSettingsPageProps) {
  const query = await searchParams;
  const role = await getServerActorRole();
  const authHeader = await getServerAuthHeader();
  const status = String(query.status ?? "").trim();

  try {
    const [definitions, permissions] = await Promise.all([
      getConnectorDefinitions({ role, authHeader }),
      getConnectorPermissions(undefined, { role, authHeader }),
    ]);

    return (
      <div className="space-y-5">
        <PageHeader
          title="Connector Access"
          description="Define who can install, reconnect, or disable each connector account without exposing raw permission internals."
          breadcrumb={
            <>
              <Link href="/dashboard" className="hover:underline">
                Dashboard
              </Link>{" "}
              /{" "}
              <Link href="/admin" className="hover:underline">
                Admin
              </Link>{" "}
              / <span className="font-semibold text-slate-700">Connector Access</span>
            </>
          }
        />

        <section className="grid gap-4 lg:grid-cols-3">
          <Card>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Policy coverage</p>
            <p className="mt-3 text-3xl font-semibold text-slate-900">{permissions.length}</p>
            <p className="mt-2 text-sm text-slate-600">Saved connector access rules for this workspace.</p>
          </Card>
          <Card>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Connector catalog</p>
            <p className="mt-3 text-3xl font-semibold text-slate-900">{definitions.length}</p>
            <p className="mt-2 text-sm text-slate-600">Definitions currently available for access control.</p>
          </Card>
          <Card>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Admin-only surface</p>
            <div className="mt-3">
              <StatusChip label={role === "admin" ? "editable" : "read-only"} tone={role === "admin" ? "success" : "warning"} />
            </div>
            <p className="mt-2 text-sm text-slate-600">Only admins can change these rules. Everyone else can review them.</p>
          </Card>
        </section>

        {status === "permission-granted" ? <StatusBanner tone="success" message="Connector permission granted." /> : null}
        {status === "permission-revoked" ? <StatusBanner tone="success" message="Connector permission revoked." /> : null}
        {status === "permission-invalid-role" ? (
          <StatusBanner tone="error" message="Choose a valid role: admin, editor, reviewer, or viewer." />
        ) : null}
        {status === "permission-user-not-found" ? (
          <StatusBanner tone="error" message="That user ID was not found in this workspace." />
        ) : null}
        {status === "permission-user-required" ? (
          <StatusBanner tone="error" message="User ID is required when principal type is user." />
        ) : null}
        {status === "permission-invalid-request" ? (
          <StatusBanner tone="error" message="Connector permission request was invalid. Review the form and try again." />
        ) : null}

        {role === "admin" ? (
          <Card>
            <CardTitle>Permission Builder</CardTitle>
            <p className="mt-3 text-sm text-slate-600">
              Create one permission row per role or user. Most teams should grant by role first, then add user-specific exceptions only when needed.
            </p>
            <ConnectorPermissionForm definitions={definitions} grantAction={grantConnectorPermissionAction} />
          </Card>
        ) : (
          <Card>
            <CardTitle>Connector Permission Management</CardTitle>
            <p className="mt-3 text-sm text-slate-600">Admin role is required to grant or revoke connector permissions.</p>
          </Card>
        )}

        <Card>
          <CardTitle>Current Policies</CardTitle>
          {permissions.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No connector permissions configured for this tenant.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[1100px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">Policy summary</th>
                    <th className="py-2">Applies to</th>
                    <th className="py-2">Scope</th>
                    <th className="py-2">Action</th>
                    <th className="py-2">Created By</th>
                    <th className="py-2">Updated</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {permissions.map((permission) => (
                    <tr key={permission.id} className="border-t border-border">
                      <td className="py-2">
                        <p className="font-medium text-slate-900">{describeConnectorPermission(permission)}</p>
                        <p className="text-xs text-slate-500">{permission.connectorSlug}</p>
                      </td>
                      <td className="py-2">
                        <p className="text-slate-900">{permission.principalType === "role" ? "Role" : "Specific user"}</p>
                        <p className="text-xs text-slate-500">{permission.principalId}</p>
                      </td>
                      <td className="py-2">{permission.accountAlias === "*" ? "All aliases" : permission.accountAlias}</td>
                      <td className="py-2">{presentAction(permission.action)}</td>
                      <td className="py-2">{permission.createdBy || "-"}</td>
                      <td className="py-2 text-xs">{new Date(permission.updatedAt).toLocaleString()}</td>
                      <td className="py-2">
                        {role === "admin" ? (
                          <form action={revokeConnectorPermissionAction}>
                            <input type="hidden" name="permissionId" value={permission.id} />
                            <button type="submit" className="rounded-md border border-border px-3 py-2 text-sm">
                              Revoke
                            </button>
                          </form>
                        ) : (
                          <span className="text-xs text-slate-500">Read-only</span>
                        )}
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
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/admin/connectors", error));
    }
    throw error;
  }
}

