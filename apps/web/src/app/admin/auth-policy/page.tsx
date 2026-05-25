import Link from "next/link";
import { redirect } from "next/navigation";
import { updateTenantAuthPolicyAction } from "@/app/admin/auth-policy/actions";
import { ApiHttpError, getTenantAuthPolicy } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerSession } from "@/lib/server-session";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";

export const dynamic = "force-dynamic";

interface AdminAuthPolicyPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

function StatusBanner({ tone, message }: { tone: "success" | "error"; message: string }) {
  const classes =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-rose-200 bg-rose-50 text-rose-800";
  return <div className={`rounded-md border px-3 py-2 text-sm ${classes}`}>{message}</div>;
}

export default async function AdminAuthPolicyPage({ searchParams }: AdminAuthPolicyPageProps) {
  const query = await searchParams;
  const { authHeader, actorRole } = await getServerSession();
  if (!authHeader) {
    redirect(buildLoginRedirect("/admin/auth-policy", 401));
  }
  const status = String(query.status ?? "").trim();
  const errorMessage = String(query.message ?? "").trim();

  if (actorRole !== "admin") {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Auth Policy"
          description="Tenant authentication policy is limited to workspace admins because it controls security posture and future enterprise identity rollout."
          breadcrumb={
            <>
              Dashboard / Admin / <span className="font-semibold text-slate-700">Auth Policy</span>
            </>
          }
        />

        <Card>
          <CardTitle>Admin Role Required</CardTitle>
          <p className="mt-2 text-sm text-slate-600">
            Your current role can review account privacy, but tenant auth policy changes stay admin-only. Ask a workspace
            admin if MFA posture, session timeout, or external identity planning needs to change.
          </p>
        </Card>
      </div>
    );
  }

  try {
    const policy = await getTenantAuthPolicy({ role: actorRole, authHeader });

    return (
      <div className="space-y-5">
        <PageHeader
          title="Auth Policy"
          description="Store and audit tenant identity posture now, while keeping current password login backward compatible until later MFA and OIDC slices land."
          breadcrumb={
            <>
              Dashboard / Admin / <span className="font-semibold text-slate-700">Auth Policy</span>
            </>
          }
        />

        {status === "auth-policy-error" ? (
          <StatusBanner tone="error" message={errorMessage || "Unable to update tenant auth policy."} />
        ) : null}
        {status === "auth-policy-updated" ? (
          <StatusBanner tone="success" message="Tenant auth policy updated." />
        ) : null}

        <section className="grid gap-4 xl:grid-cols-3">
          <Card>
            <CardTitle>Policy State</CardTitle>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusChip label={policy.isPersisted ? "persisted" : "defaults"} tone={policy.isPersisted ? "success" : "info"} />
              <StatusChip label={`timeout ${policy.sessionTimeoutMinutes}m`} tone="info" />
              <StatusChip label={policy.mfaRequired ? "mfa required" : "mfa off"} tone={policy.mfaRequired ? "warning" : "neutral"} />
            </div>
            <p className="mt-3 text-sm text-slate-600">
              Session timeout and MFA enrollment enforcement are active in database mode. Allowed auth methods (password vs
              OIDC gating) are enforced at login. Configure your OIDC identity provider in{" "}
              <a href="/admin/auth-policy/oidc" className="text-blue-700 hover:underline">Admin â†’ OIDC / SSO</a>.
            </p>
          </Card>

          <Card>
            <CardTitle>Runtime Truth</CardTitle>
            <dl className="mt-3 space-y-2 text-sm text-slate-600">
              <div className="flex items-center justify-between gap-4">
                <dt>Session timeout enforcement</dt>
                <dd className="font-medium text-slate-900">{policy.runtimeApplied.sessionTimeout ? "Active now" : "Not active"}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt>MFA enrollment enforcement</dt>
                <dd className="font-medium text-slate-900">{policy.runtimeApplied.mfaEnrollment ? "Active now" : "Stored only"}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt>External identity enforcement</dt>
                <dd className="font-medium text-slate-900">{policy.runtimeApplied.externalIdentity ? "Active now" : "Stored only"}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardTitle>Audit Metadata</CardTitle>
            <dl className="mt-3 space-y-2 text-sm text-slate-600">
              <div className="flex items-center justify-between gap-4">
                <dt>Updated by</dt>
                <dd className="font-medium text-slate-900">{policy.updatedBy ?? "-"}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt>Updated at</dt>
                <dd className="font-medium text-slate-900">{policy.updatedAt ? new Date(policy.updatedAt).toLocaleString() : "-"}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt>Created by</dt>
                <dd className="font-medium text-slate-900">{policy.createdBy ?? "-"}</dd>
              </div>
            </dl>
            <Link href="/admin/audit" className="mt-4 inline-flex text-sm font-medium text-blue-700 hover:underline">
              Review audit evidence
            </Link>
          </Card>
        </section>

        <Card>
          <CardTitle>Tenant Authentication Policy</CardTitle>
          <p className="mt-2 text-sm text-slate-600">
            Password login remains enabled today. Use this page to store and audit the intended tenant policy so later MFA
            and OIDC slices can enforce it without redefining the contract.
          </p>

          <form action={updateTenantAuthPolicyAction} className="mt-4 grid gap-4">
            <input type="hidden" name="errorRedirectTo" value="/admin/auth-policy" />

            <label className="flex items-start gap-3 rounded-md border border-slate-200 px-3 py-3 text-sm">
              <input type="checkbox" name="externalIdentityMode" defaultChecked={policy.externalIdentityMode} className="mt-1 h-4 w-4" />
              <span>
                <span className="font-medium text-slate-900">External identity mode</span>
                <span className="mt-1 block text-slate-600">
                  Stores tenant intent for OIDC-based sign-in. Runtime OIDC login is not enforced in this slice.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 rounded-md border border-slate-200 px-3 py-3 text-sm">
              <input type="checkbox" name="mfaRequired" defaultChecked={policy.mfaRequired} className="mt-1 h-4 w-4" />
              <span>
                <span className="font-medium text-slate-900">Require MFA</span>
                <span className="mt-1 block text-slate-600">
                  Stores the tenant MFA requirement now. Enrollment and challenge enforcement ship in the MFA follow-on slice.
                </span>
              </span>
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">MFA grace period (days)</span>
                <input
                  type="number"
                  min={0}
                  max={90}
                  name="mfaGracePeriodDays"
                  defaultValue={policy.mfaGracePeriodDays}
                  className="rounded-md border border-slate-300 px-3 py-2"
                />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">Session timeout (minutes)</span>
                <select
                  name="sessionTimeoutMinutes"
                  defaultValue={String(policy.sessionTimeoutMinutes)}
                  className="rounded-md border border-slate-300 px-3 py-2"
                >
                  <option value="30">30 minutes</option>
                  <option value="60">60 minutes</option>
                  <option value="120">120 minutes</option>
                  <option value="240">240 minutes</option>
                </select>
              </label>
            </div>

            <fieldset className="grid gap-2 text-sm">
              <legend className="font-medium text-slate-700">Allowed sign-in methods</legend>
              <label className="flex items-start gap-3 rounded-md border border-slate-200 px-3 py-3">
                <input
                  type="checkbox"
                  name="allowedAuthMethods"
                  value="password"
                  defaultChecked={policy.allowedAuthMethods.includes("password")}
                  className="mt-1 h-4 w-4"
                />
                <span>
                  <span className="font-medium text-slate-900">Password login</span>
                  <span className="mt-1 block text-slate-600">Current production sign-in path.</span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-md border border-slate-200 px-3 py-3">
                <input
                  type="checkbox"
                  name="allowedAuthMethods"
                  value="oidc"
                  defaultChecked={policy.allowedAuthMethods.includes("oidc")}
                  className="mt-1 h-4 w-4"
                />
                <span>
                  <span className="font-medium text-slate-900">OIDC sign-in</span>
                  <span className="mt-1 block text-slate-600">
                    Enables OIDC-based login. Configure your identity provider in{" "}
                    <a href="/admin/auth-policy/oidc" className="text-blue-700 hover:underline">Admin â†’ OIDC / SSO</a>.
                  </span>
                </span>
              </label>
            </fieldset>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Save Auth Policy
              </button>
              <span className="text-xs text-slate-500">
                Session timeout takes effect now. MFA enrollment and allowed auth methods enforcement are active in database mode. OIDC sign-in requires an active IdP configuration â€” see{" "}
                <a href="/admin/auth-policy/oidc" className="text-blue-700 hover:underline">Admin â†’ OIDC / SSO</a>.
              </span>
            </div>
          </form>
        </Card>
      </div>
    );
  } catch (error) {
    if (error instanceof ApiHttpError) {
      redirect(buildLoginRedirect("/admin/auth-policy", error.status));
    }
    throw error;
  }
}
