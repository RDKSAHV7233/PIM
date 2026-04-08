import Link from "next/link";
import { redirect } from "next/navigation";
import { ApiKeyCreatePanel } from "./api-key-create-panel";
import { revokeApiAccessKeyAction } from "./actions";
import { ApiHttpError, getApiAccessKeys, type ApiAccessKey } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";

export const dynamic = "force-dynamic";

interface ApiKeysPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

function StatusBanner({ tone, message }: { tone: "success" | "error" | "info"; message: string }) {
  const classes =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "error"
        ? "border-rose-200 bg-rose-50 text-rose-800"
        : "border-sky-200 bg-sky-50 text-sky-800";
  return <div className={`rounded-md border px-3 py-2 text-sm ${classes}`}>{message}</div>;
}

function formatTimestamp(value: string | null) {
  return value ? new Date(value).toLocaleString() : "-";
}

function resolveStatus(key: ApiAccessKey) {
  if (key.revokedAt) {
    return { label: "revoked", tone: "danger" as const };
  }
  if (!key.isActive && key.expiresAt) {
    return { label: "expired", tone: "warning" as const };
  }
  return { label: "active", tone: "success" as const };
}

export default async function ApiKeysPage({ searchParams }: ApiKeysPageProps) {
  const query = await searchParams;
  const role = await getServerActorRole();
  const authHeader = await getServerAuthHeader();
  const status = String(query.status ?? "").trim();

  try {
    const keys = await getApiAccessKeys({ role, authHeader });

    return (
      <div className="space-y-5">
        <PageHeader
          title="API Keys"
          description="Tenant-scoped machine credentials for integrations using the public API."
          breadcrumb={
            <>
              Dashboard / Admin / <span className="font-semibold text-slate-700">API Keys</span>
            </>
          }
        />

        {status === "api-key-revoked" ? (
          <StatusBanner tone="success" message="API key revoked." />
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
          <CardTitle>Issued API Keys</CardTitle>
          {keys.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No API keys issued for this tenant yet.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">Label</th>
                    <th className="py-2">Role</th>
                    <th className="py-2">Prefix</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Last used</th>
                    <th className="py-2">Expires</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((key) => {
                    const state = resolveStatus(key);
                    return (
                      <tr key={key.id} className="border-t border-slate-200 align-top">
                        <td className="py-2 font-medium text-slate-900">
                          <div>{key.label}</div>
                          <div className="text-xs text-slate-500">Created by {key.createdBy || "system"}</div>
                        </td>
                        <td className="py-2">
                          <StatusChip label={key.role} tone={key.role === "viewer" ? "neutral" : "info"} />
                        </td>
                        <td className="py-2 font-mono text-xs text-slate-600">{key.keyPrefix}</td>
                        <td className="py-2">
                          <StatusChip label={state.label} tone={state.tone} />
                        </td>
                        <td className="py-2 text-xs text-slate-600">{formatTimestamp(key.lastUsedAt)}</td>
                        <td className="py-2 text-xs text-slate-600">{formatTimestamp(key.expiresAt)}</td>
                        <td className="py-2">
                          {role === "admin" && !key.revokedAt ? (
                            <form action={revokeApiAccessKeyAction}>
                              <input type="hidden" name="keyId" value={key.id} />
                              <button
                                type="submit"
                                className="rounded-md border border-rose-200 px-3 py-2 text-sm text-rose-700"
                              >
                                Revoke
                              </button>
                            </form>
                          ) : (
                            <span className="text-xs text-slate-500">{key.revokedAt ? "Revoked" : "Read-only"}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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
