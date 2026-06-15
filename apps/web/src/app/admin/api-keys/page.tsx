import Link from "next/link";
import { redirect } from "next/navigation";
import { ApiKeyCreatePanel } from "./api-key-create-panel";
import { revokeApiAccessKeyAction } from "./actions";
import { ApiHttpError, getApiAccessKeys, getBillingPlanProfile, type ApiAccessKey } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { API_SCOPE_LEGEND } from "@/lib/constants/api-scopes";
import { getServerSession } from "@/lib/server-session";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid } from "@/components/ui/data-grid";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

interface ApiKeysPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

function formatTimestamp(value: string | null) {
  return formatDateTime(value);
}

const EXPIRY_WARNING_MS = 7 * 24 * 60 * 60 * 1000;

function resolveStatus(key: ApiAccessKey) {
  if (key.revokedAt) {
    return { label: "revoked", tone: "danger" as const };
  }
  if (!key.isActive && key.expiresAt) {
    return { label: "expired", tone: "warning" as const };
  }
  if (key.isActive && key.expiresAt) {
    const ms = new Date(key.expiresAt).getTime() - Date.now();
    if (Number.isFinite(ms) && ms > 0 && ms < EXPIRY_WARNING_MS) {
      return { label: "expires soon", tone: "warning" as const };
    }
  }
  return { label: "active", tone: "success" as const };
}

function formatScopes(scopes: ApiAccessKey["scopes"]) {
  if (scopes.length === 0) {
    return "No scopes";
  }
  return scopes.join(", ");
}


export default async function ApiKeysPage({ searchParams }: ApiKeysPageProps) {
  const query = await searchParams;
  const { authHeader, actorRole: role, adminBoundaryRoles } = await getServerSession();
  const isSystemAdmin = adminBoundaryRoles.includes("system_admin") || adminBoundaryRoles.includes("super_admin");
  if (role !== "admin" || !isSystemAdmin) {
    redirect("/admin");
  }
  const status = String(query.status ?? "").trim();
  const confirmRevokeKeyId = String(query.confirmRevoke ?? "").trim();

  try {
    const [keys, planProfile] = await Promise.all([
      getApiAccessKeys({ role, authHeader }),
      getBillingPlanProfile({ role, authHeader }),
    ]);
    const planTier = String(planProfile.planTier ?? "TRIAL").toUpperCase();

    const pageHeader = (
      <PageHeader
        title="API Keys"
        description="Tenant-scoped machine credentials for integrations using the public API."
        breadcrumb={
          <>
            Dashboard / Admin / <span className="font-semibold text-slate-700">API Keys</span>
          </>
        }
      />
    );

    if (planTier === "TRIAL" || planTier === "STARTER") {
      return (
        <div className="space-y-5">
          {pageHeader}
          <Card>
            <CardTitle>Plan Upgrade Required</CardTitle>
            <p className="mt-2 text-sm text-slate-600">
              API keys for machine credentials are available on the Growth plan and above. Upgrade to create
              tenant-scoped tokens for programmatic access and integrations.
            </p>
            <div className="mt-4">
              <Link
                href="/admin/plan"
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                View Plan &amp; Upgrade
              </Link>
            </div>
          </Card>
        </div>
      );
    }

    return (
      <div className="space-y-5">
        {pageHeader}

        {status === "api-key-revoked" ? (
          <InlineAlert tone="success" message="API key revoked." />
        ) : null}

        {role === "admin" ? (
          <ApiKeyCreatePanel />
        ) : (
          <Card>
            <CardTitle>API Key Management</CardTitle>
            <p className="mt-3 text-sm text-slate-600">
              Admin role is required to create or revoke API keys. You can still review the issued machine credentials below.
            </p>
          </Card>
        )}

        <Card>
          <CardTitle>Scope legend</CardTitle>
          <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-slate-800">
              Review what each API scope allows
            </summary>
            <div className="mt-3 space-y-3">
              <p className="text-sm text-slate-600">
                Use the scope chips below as a plain-English guide before creating or reviewing machine credentials.
              </p>
              <div className="space-y-2">
                {API_SCOPE_LEGEND.map((entry) => (
                  <div key={entry.scope} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
                    <StatusChip label={entry.scope} tone="info" />
                    <p className="text-sm text-slate-600">{entry.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </details>
        </Card>

        <Card>
          <CardTitle>Machine credential lifecycle</CardTitle>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">1. Scope access tightly</p>
              <p className="mt-1 text-sm text-slate-600">
                Start with the narrowest role and scope set needed for the integration instead of issuing broad write access by default.
              </p>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">2. Track usage and expiry</p>
              <p className="mt-1 text-sm text-slate-600">
                Review last-used and expiry dates regularly so stale credentials do not remain active longer than the integration needs.
              </p>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">3. Revoke deliberately</p>
              <p className="mt-1 text-sm text-slate-600">
                Revoke keys when ownership changes, automation is retired, or you need to contain a delivery or credential incident quickly.
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Pair API keys with webhook monitoring so machine access and outbound delivery behavior stay auditable together.
          </p>
        </Card>

        <Card>
          <CardTitle>Issued API Keys</CardTitle>
          <div className="mt-3">
            <DataGrid
              columns={[
                {
                  key: "label",
                  header: "Label",
                  cellClassName: "font-medium text-slate-900",
                  render: (key) => (
                    <>
                      <div>{key.label}</div>
                      <div className="text-xs text-slate-500">Created by {key.createdBy || "system"}</div>
                    </>
                  ),
                },
                {
                  key: "role",
                  header: "Role",
                  render: (key) => (
                    <StatusChip label={key.role} tone={key.role === "viewer" ? "neutral" : "info"} />
                  ),
                },
                {
                  key: "scopes",
                  header: "Scopes",
                  cellClassName: "text-xs text-slate-600",
                  render: (key) => formatScopes(key.scopes),
                },
                {
                  key: "keyPrefix",
                  header: "Prefix",
                  mobileHide: true,
                  cellClassName: "font-mono text-xs text-slate-600",
                },
                {
                  key: "status",
                  header: "Status",
                  render: (key) => {
                    const state = resolveStatus(key);
                    return <StatusChip label={state.label} tone={state.tone} />;
                  },
                },
                {
                  key: "lastUsedAt",
                  header: "Last used",
                  mobileHide: true,
                  cellClassName: "text-xs text-slate-600",
                  render: (key) => formatTimestamp(key.lastUsedAt),
                },
                {
                  key: "expiresAt",
                  header: "Expires",
                  mobileHide: true,
                  cellClassName: "text-xs text-slate-600",
                  render: (key) => formatTimestamp(key.expiresAt),
                },
                {
                  key: "actions",
                  header: "Actions",
                  render: (key) =>
                    role === "admin" && !key.revokedAt ? (
                      confirmRevokeKeyId === key.id ? (
                        <form action={revokeApiAccessKeyAction} className="flex items-center gap-2">
                          <input type="hidden" name="keyId" value={key.id} />
                          <span className="text-xs text-rose-700">Confirm revoke?</span>
                          <button type="submit" className="rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100">
                            Revoke
                          </button>
                          <Link href="/admin/api-keys" className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                            Cancel
                          </Link>
                        </form>
                      ) : (
                        <Link
                          href={`/admin/api-keys?confirmRevoke=${encodeURIComponent(key.id)}`}
                          className="rounded-md border border-rose-200 px-3 py-2 text-sm text-rose-700 hover:bg-rose-50"
                        >
                          Revoke
                        </Link>
                      )
                    ) : (
                      <span className="text-xs text-slate-500">{key.revokedAt ? "Revoked" : "Read-only"}</span>
                    ),
                },
              ]}
              rows={keys}
              getRowKey={(key) => key.id}
              rowClassName="align-top"
              caption="Issued API Keys"
              emptyState={
                <p className="text-sm text-slate-600">No API keys issued for this tenant yet.</p>
              }
            />
          </div>
        </Card>

        <div className="text-sm text-slate-600">
          Delivery automation lives under{" "}
          <Link href="/admin/webhooks" className="text-blue-700 hover:underline">
            Outbound Webhooks
          </Link>
          .
        </div>
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/admin/api-keys", error));
    }
    throw error;
  }
}
