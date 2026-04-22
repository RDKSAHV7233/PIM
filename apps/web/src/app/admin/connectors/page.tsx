import Link from "next/link";
import { redirect } from "next/navigation";
import {
  grantConnectorPermissionAction,
  revokeConnectorPermissionAction,
} from "@/app/actions";
import { ConnectorPermissionForm } from "@/components/settings/connector-permission-form";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ApiHttpError, getConnectorDefinitions, getConnectorPermissions } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

interface ConnectorSettingsPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

function formatPolicySubject(permission: {
  principalType: string;
  principalId: string;
}) {
  return permission.principalType === "role"
    ? `${permission.principalId} role`
    : `User ${permission.principalId}`;
}

function formatPolicyScope(permission: { accountAlias: string }) {
  return permission.accountAlias === "*" ? "All account aliases" : `Alias "${permission.accountAlias}"`;
}

function formatPolicyAction(permission: { action: string }) {
  return permission.action === "uninstall" ? "Disable connector" : `${permission.action[0]?.toUpperCase() ?? ""}${permission.action.slice(1)}`;
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
    const rolePolicies = permissions.filter((permission) => permission.principalType === "role").length;
    const userPolicies = permissions.length - rolePolicies;
    const aliasScopedPolicies = permissions.filter((permission) => permission.accountAlias !== "*").length;

    return (
      <div className="space-y-5">
          <PageHeader
          title="Connector Access"
          description="Manage connector governance with clear policy language, alias scope visibility, and an audit-friendly view of who can install, reconnect, or disable catalog channels."
          breadcrumb={
            <>
              <Link href="/dashboard" className="underline">
                Dashboard
              </Link>
              <span> / </span>
              <Link href="/admin" className="underline">
                Admin
              </Link>
              <span> / </span>
              <span className="font-semibold text-slate-700">Connector Access</span>
            </>
          }
        />

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

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardTitle>Policy coverage</CardTitle>
            <p className="mt-3 text-3xl font-semibold text-slate-900">{permissions.length}</p>
            <p className="mt-2 text-sm text-slate-600">Active connector policies across all catalog channels.</p>
          </Card>
          <Card>
            <CardTitle>Who gets access</CardTitle>
            <p className="mt-3 text-3xl font-semibold text-slate-900">{rolePolicies}</p>
            <p className="mt-2 text-sm text-slate-600">
              Role policies, plus <span className="font-medium text-slate-900">{userPolicies}</span> user-specific exceptions.
            </p>
          </Card>
          <Card>
            <CardTitle>Alias-specific rules</CardTitle>
            <p className="mt-3 text-3xl font-semibold text-slate-900">{aliasScopedPolicies}</p>
            <p className="mt-2 text-sm text-slate-600">
              Policies narrowed to one account alias instead of all accounts for the connector.
            </p>
          </Card>
        </div>

        {role === "admin" ? (
          <Card>
            <CardTitle>Create Governance Policy</CardTitle>
            <p className="mt-3 text-sm text-slate-600">
              Create one access policy row per role or user. Add another row when the same connector action should apply to more than one team or person.
            </p>
            <ConnectorPermissionForm definitions={definitions} grantAction={grantConnectorPermissionAction} />
          </Card>
        ) : (
          <Card>
            <CardTitle>Governance Visibility</CardTitle>
            <p className="mt-3 text-sm text-slate-600">
              Admin role is required to create or revoke connector access policies. You can still review the current governance matrix below.
            </p>
          </Card>
        )}

        <Card>
          <CardTitle>Current Access Policies</CardTitle>
          <p className="mt-3 text-sm text-slate-600">
            Review who gets access, which aliases are covered, and who last changed each policy so connector governance stays auditable.
          </p>
          {permissions.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No connector access policies configured for this tenant.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">Connector</th>
                    <th className="py-2">Who gets access</th>
                    <th className="py-2">Which accounts</th>
                    <th className="py-2">Allowed action</th>
                    <th className="py-2">Changed by</th>
                    <th className="py-2">Updated</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {permissions.map((permission) => (
                    <tr key={permission.id} className="border-t border-border">
                      <td className="py-2 font-medium text-slate-900">{permission.connectorSlug}</td>
                      <td className="py-2">{formatPolicySubject(permission)}</td>
                      <td className="py-2">{formatPolicyScope(permission)}</td>
                      <td className="py-2">{formatPolicyAction(permission)}</td>
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

