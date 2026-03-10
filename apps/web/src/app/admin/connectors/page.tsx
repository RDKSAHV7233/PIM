import Link from "next/link";
import { redirect } from "next/navigation";
import {
  grantConnectorPermissionAction,
  revokeConnectorPermissionAction,
} from "@/app/actions";
import { ConnectorPermissionForm } from "@/components/settings/connector-permission-form";
import { Card, CardTitle } from "@/components/ui/card";
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
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Link href="/dashboard" className="underline">
            Dashboard
          </Link>
          <span>/</span>
          <Link href="/admin" className="underline">
            Admin
          </Link>
          <span>/</span>
          <span>Connector Access</span>
        </div>
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Connector Access</h1>
          <p className="text-sm text-slate-600">
            Manage connector action permissions (install, reconnect, uninstall) for users and roles.
          </p>
        </header>

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
            <CardTitle>Grant Permission</CardTitle>
            <p className="mt-3 text-sm text-slate-600">
              Create one permission row per role or user. Add multiple rows if the same connector action should apply to multiple roles or people.
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
          <CardTitle>Current Permissions</CardTitle>
          {permissions.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No connector permissions configured for this tenant.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">Connector</th>
                    <th className="py-2">Principal Type</th>
                    <th className="py-2">Principal Id</th>
                    <th className="py-2">Alias</th>
                    <th className="py-2">Action</th>
                    <th className="py-2">Created By</th>
                    <th className="py-2">Updated</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {permissions.map((permission) => (
                    <tr key={permission.id} className="border-t border-border">
                      <td className="py-2 font-medium text-slate-900">{permission.connectorSlug}</td>
                      <td className="py-2">{permission.principalType}</td>
                      <td className="py-2">{permission.principalId}</td>
                      <td className="py-2">{permission.accountAlias === "*" ? "All aliases" : permission.accountAlias}</td>
                      <td className="py-2">{permission.action}</td>
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
      redirect(buildLoginRedirect("/admin/connectors", error.status));
    }
    throw error;
  }
}

