import Link from "next/link";
import { redirect } from "next/navigation";
import {
  grantConnectorPermissionAction,
  revokeConnectorPermissionAction,
} from "@/app/actions";
import { Card, CardTitle } from "@/components/ui/card";
import { ApiHttpError, getConnectorDefinitions, getConnectorPermissions } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

interface ConnectorSettingsPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
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
          <Link href="/" className="underline">
            Dashboard
          </Link>
          <span>/</span>
          <Link href="/settings" className="underline">
            Settings
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

        {status === "permission-granted" ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Connector permission granted.
          </div>
        ) : null}
        {status === "permission-revoked" ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Connector permission revoked.
          </div>
        ) : null}

        {role === "admin" ? (
          <Card>
            <CardTitle>Grant Permission</CardTitle>
            <form action={grantConnectorPermissionAction} className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1">
                <label htmlFor="connector-slug" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Connector
                </label>
                <select id="connector-slug" name="connectorSlug" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" required>
                  {definitions.map((definition) => (
                    <option key={definition.id} value={definition.slug}>
                      {definition.displayName} ({definition.slug})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="principal-type" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Principal Type
                </label>
                <select id="principal-type" name="principalType" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" defaultValue="role">
                  <option value="role">role</option>
                  <option value="user">user</option>
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="principal-id" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Principal Id
                </label>
                <input
                  id="principal-id"
                  name="principalId"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="e.g. editor or user@tenant"
                  required
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="permission-action" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Action
                </label>
                <select id="permission-action" name="action" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" defaultValue="install">
                  <option value="install">install</option>
                  <option value="reconnect">reconnect</option>
                  <option value="uninstall">uninstall</option>
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="account-alias" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Account Alias (optional)
                </label>
                <input
                  id="account-alias"
                  name="accountAlias"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="* (all aliases)"
                />
              </div>
              <div className="flex items-end">
                <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
                  Grant
                </button>
              </div>
            </form>
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
                      <td className="py-2">{permission.accountAlias}</td>
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
      redirect(buildLoginRedirect("/settings/connectors", error.status));
    }
    throw error;
  }
}
