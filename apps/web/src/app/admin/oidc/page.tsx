import Link from "next/link";
import { redirect } from "next/navigation";
import { ApiHttpError, getOidcConfig } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerSession } from "@/lib/server-session";
import { formatDateTime } from "@/lib/format";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { deleteOidcConfigAction, saveOidcConfigAction } from "./actions";

export const dynamic = "force-dynamic";

interface OidcPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

function StatusBanner({ tone, message }: { tone: "success" | "error"; message: string }) {
  const classes =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-rose-200 bg-rose-50 text-rose-800";
  return <div className={`rounded-md border px-3 py-2 text-sm ${classes}`}>{message}</div>;
}

export default async function AdminOidcPage({ searchParams }: OidcPageProps) {
  const query = await searchParams;
  const { authHeader, actorRole, adminBoundaryRoles } = await getServerSession();
  if (!authHeader) {
    redirect(buildLoginRedirect("/admin/oidc", 401));
  }
  const isSystemAdmin = adminBoundaryRoles.includes("system_admin") || adminBoundaryRoles.includes("super_admin");
  if (actorRole !== "admin" || !isSystemAdmin) {
    redirect("/admin");
  }
  const status = String(query.status ?? "").trim();
  const errorMessage = String(query.message ?? "").trim();

  let existingConfig: Awaited<ReturnType<typeof getOidcConfig>> | null = null;
  try {
    existingConfig = await getOidcConfig({ role: actorRole, authHeader });
  } catch (error) {
    if (error instanceof ApiHttpError && error.status === 404) {
      existingConfig = null;
    } else if (error instanceof ApiHttpError) {
      redirect(buildLoginRedirect("/admin/oidc", error.status));
    } else {
      throw error;
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="OIDC / SSO Configuration"
        description="Connect your workspace to an external identity provider using OpenID Connect. Admins can configure issuer, credentials, and role claim mapping."
        breadcrumb={
          <>
            Dashboard / Admin / <span className="font-semibold text-slate-700">OIDC &amp; SSO</span>
          </>
        }
      />

      {status === "oidc-error" ? (
        <StatusBanner tone="error" message={errorMessage || "Unable to update OIDC configuration."} />
      ) : null}
      {status === "oidc-saved" ? (
        <StatusBanner tone="success" message="OIDC configuration saved." />
      ) : null}
      {status === "oidc-deleted" ? (
        <StatusBanner tone="success" message="OIDC configuration removed." />
      ) : null}

      {existingConfig ? (
        <section className="grid gap-4 xl:grid-cols-3">
          <Card>
            <CardTitle>Current IdP</CardTitle>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusChip label={existingConfig.status} tone={existingConfig.status === "active" ? "success" : "warning"} />
            </div>
            <dl className="mt-3 space-y-2 text-sm text-slate-600">
              <div>
                <dt className="font-medium text-slate-700">Issuer</dt>
                <dd className="mt-0.5 break-all">{existingConfig.issuer}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-700">Client ID</dt>
                <dd className="mt-0.5 font-mono text-xs">{existingConfig.clientId}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-700">Callback URL</dt>
                <dd className="mt-0.5 break-all text-xs">{existingConfig.callbackUrl}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-700">Scopes</dt>
                <dd className="mt-0.5">{existingConfig.scopes.join(", ")}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardTitle>Timestamps</CardTitle>
            <dl className="mt-3 space-y-2 text-sm text-slate-600">
              <div className="flex items-center justify-between gap-4">
                <dt>Created</dt>
                <dd className="font-medium text-slate-900">{formatDateTime(existingConfig.createdAt)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt>Last updated</dt>
                <dd className="font-medium text-slate-900">{formatDateTime(existingConfig.updatedAt)}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardTitle>SSO Login URL</CardTitle>
            <p className="mt-2 text-sm text-slate-600">
              Direct users to this URL to initiate SSO login. The workspace query parameter routes to the correct IdP.
            </p>
            <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 font-mono text-xs break-all text-slate-700">
              {`/api/auth/oidc/login?workspace=`}
              <span className="text-slate-400">&lt;your-workspace-key&gt;</span>
            </div>
            <Link
              href="/admin/auth-policy"
              className="mt-4 inline-flex text-sm font-medium text-blue-700 hover:underline"
            >
              Review auth policy
            </Link>
          </Card>
        </section>
      ) : (
        <Card>
          <CardTitle>No IdP Configured</CardTitle>
          <p className="mt-2 text-sm text-slate-600">
            No OIDC identity provider is configured for this workspace. Use the form below to add one.
          </p>
        </Card>
      )}

      <Card>
        <CardTitle>{existingConfig ? "Update OIDC Configuration" : "Configure OIDC Identity Provider"}</CardTitle>
        <p className="mt-2 text-sm text-slate-600">
          All fields are required except Scopes (defaults to <code className="font-mono text-xs">openid email profile</code>)
          {" "}and Claims Mapping. The Client Secret is write-only — enter it again when updating to rotate credentials.
        </p>

        <form action={saveOidcConfigAction} className="mt-4 grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">Issuer URL</span>
              <input
                type="url"
                name="issuer"
                required
                defaultValue={existingConfig?.issuer ?? ""}
                placeholder="https://accounts.google.com"
                className="rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
              />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">Callback URL</span>
              <input
                type="url"
                name="callbackUrl"
                required
                defaultValue={existingConfig?.callbackUrl ?? ""}
                placeholder="https://your-domain.com/api/auth/oidc/callback"
                className="rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">Client ID</span>
              <input
                type="text"
                name="clientId"
                required
                defaultValue={existingConfig?.clientId ?? ""}
                placeholder="your-client-id"
                className="rounded-md border border-slate-300 px-3 py-2"
              />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">
                Client Secret{existingConfig ? " (re-enter to rotate)" : ""}
              </span>
              <input
                type="password"
                name="clientSecret"
                required
                autoComplete="new-password"
                placeholder={existingConfig ? "••••••••" : "your-client-secret"}
                className="rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">Scopes</span>
              <input
                type="text"
                name="scopes"
                defaultValue={existingConfig ? existingConfig.scopes.join(" ") : "openid email profile"}
                placeholder="openid email profile"
                className="rounded-md border border-slate-300 px-3 py-2"
              />
              <span className="text-xs text-slate-500">Space or comma-separated.</span>
            </label>

            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">Claims Mapping (JSON)</span>
              <textarea
                name="claimsMapping"
                rows={3}
                defaultValue={
                  existingConfig && Object.keys(existingConfig.claimsMapping).length > 0
                    ? JSON.stringify(existingConfig.claimsMapping, null, 2)
                    : ""
                }
                placeholder={`{"roles": {"pim_admin": "admin", "pim_editor": "editor"}}`}
                className="rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
              />
              <span className="text-xs text-slate-500">Maps IdP claim values to Vexa roles. Leave empty if not needed.</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              {existingConfig ? "Update IdP Configuration" : "Save IdP Configuration"}
            </button>
          </div>
        </form>
      </Card>

      {existingConfig ? (
        <Card>
          <CardTitle>Remove Configuration</CardTitle>
          <p className="mt-2 text-sm text-slate-600">
            Removing the OIDC configuration disables SSO login for this workspace. Users must sign in with password login
            until a new IdP is configured.
          </p>
          <form action={deleteOidcConfigAction} className="mt-4">
            <button
              type="submit"
              className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"
            >
              Remove OIDC Configuration
            </button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
