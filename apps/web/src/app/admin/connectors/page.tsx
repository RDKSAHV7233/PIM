import Link from "next/link";
import { redirect } from "next/navigation";
import {
  grantConnectorPermissionAction,
  revokeConnectorPermissionAction,
} from "@/app/actions";
import { ConnectorPermissionForm } from "@/components/settings/connector-permission-form";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { InlineAlert } from "@/components/ui/inline-alert";
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

export default async function ConnectorSettingsPage({ searchParams }: ConnectorSettingsPageProps) {
  const query = await searchParams;
  const role = await getServerActorRole();
  const authHeader = await getServerAuthHeader();
  const status = String(query.status ?? "").trim();

  if (role !== "admin" && role !== "connector_admin") {
    redirect(buildLoginRedirect("/admin/connectors", { status: 403 }));
  }

  try {
    const [definitions, permissions] = await Promise.all([
      getConnectorDefinitions({ role, authHeader }),
      getConnectorPermissions(undefined, { role, authHeader }).catch((err) => {
        if (err instanceof ApiHttpError && (err.status === 403 || err.status === 401)) {
          return [] as Awaited<ReturnType<typeof getConnectorPermissions>>;
        }
        throw err;
      }),
    ]);
    const rolePolicies = permissions.filter((permission) => permission.principalType === "role").length;
    const userPolicies = permissions.length - rolePolicies;
    const aliasScopedPolicies = permissions.filter((permission) => permission.accountAlias !== "*").length;
    const permissionColumns: Column<(typeof permissions)[number]>[] = [
      {
        key: "connector",
        header: "Connector",
        render: (permission) => <span className="font-medium text-slate-900">{permission.connectorSlug}</span>,
      },
      { key: "subject", header: "Who gets access", render: (permission) => formatPolicySubject(permission) },
      { key: "scope", header: "Which accounts", render: (permission) => formatPolicyScope(permission) },
      { key: "action", header: "Allowed action", render: (permission) => formatPolicyAction(permission) },
      { key: "changedBy", header: "Changed by", render: (permission) => <span>{permission.createdBy || "-"}</span> },
      {
        key: "updatedAt",
        header: "Updated",
        render: (permission) => <span className="text-xs">{new Date(permission.updatedAt).toLocaleString()}</span>,
      },
      {
        key: "actions",
        header: "Actions",
        render: (permission) =>
          role === "admin" ? (
            <form action={revokeConnectorPermissionAction}>
              <input type="hidden" name="permissionId" value={permission.id} />
              <button type="submit" className="rounded-md border border-border px-3 py-2 text-sm">
                Revoke
              </button>
            </form>
          ) : (
            <span className="text-xs text-slate-500">Read-only</span>
          ),
      },
    ];

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

        {status === "permission-granted" ? <InlineAlert tone="success" message="Connector permission granted." /> : null}
        {status === "permission-revoked" ? <InlineAlert tone="success" message="Connector permission revoked." /> : null}
        {status === "permission-invalid-role" ? (
          <InlineAlert tone="error" message="Choose a valid role: admin, editor, reviewer, or viewer." />
        ) : null}
        {status === "permission-user-not-found" ? (
          <InlineAlert tone="error" message="That user ID was not found in this workspace." />
        ) : null}
        {status === "permission-user-required" ? (
          <InlineAlert tone="error" message="User ID is required when principal type is user." />
        ) : null}
        {status === "permission-invalid-request" ? (
          <InlineAlert tone="error" message="Connector permission request was invalid. Review the form and try again." />
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

        <Card>
          <CardTitle>Connector access review checklist</CardTitle>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">Prefer role policies first</p>
              <p className="mt-1 text-sm text-slate-600">
                Start with role-based access for install, reconnect, and disable flows so connector governance stays predictable across teams.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">Keep alias rules exceptional</p>
              <p className="mt-1 text-sm text-slate-600">
                Use alias-specific exceptions only when business ownership really differs by connector account, then review those rules before launches.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">Retire stale grants</p>
              <p className="mt-1 text-sm text-slate-600">
                Revoke user-specific policies when staffing changes or temporary escalation ends so connector access does not drift quietly over time.
              </p>
            </div>
          </div>
        </Card>

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
            <DataGrid
              className="mt-3"
              columns={permissionColumns}
              rows={permissions}
              getRowKey={(permission) => permission.id}
            />
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

