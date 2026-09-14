import Link from "next/link";
import { redirect } from "next/navigation";
import { updateTenantAuthPolicyAction } from "@/app/admin/auth-policy/actions";
import { ApiHttpError, getBillingPlanProfile, getTenantAuthPolicy } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerSession } from "@/lib/server-session";
import { isSystemAdminBoundary } from "@/lib/role-capabilities";
import { formatDateTime } from "@/lib/format";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { SystemAdminRequiredCard } from "@/components/ui/system-admin-required-card";
import { AuthPolicyEnterpriseForm } from "./_components/auth-policy-enterprise-form";

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

function isAuthPolicyApiUnavailable(error: unknown): boolean {
  if (error instanceof ApiHttpError) {
    return error.status === 502 || error.status === 503 || error.status === 504;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  const cause = "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  const causeDetails =
    cause && typeof cause === "object"
      ? `${String((cause as { code?: unknown }).code ?? "")} ${String((cause as { message?: unknown }).message ?? "")}`.toLowerCase()
      : String(cause ?? "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    causeDetails.includes("econnrefused") ||
    causeDetails.includes("enotfound") ||
    causeDetails.includes("socket hang up")
  );
}

function AdminAuthPolicyUnavailableState() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Auth Policy"
        description="Tenant authentication policy is temporarily unavailable while identity or billing surfaces reconnect."
        breadcrumb={
          <>
            Dashboard / Admin / <span className="font-semibold text-slate-700">Auth Policy</span>
          </>
        }
      />

      <Card>
        <CardTitle>Auth policy data is temporarily unavailable</CardTitle>
        <p className="mt-2 text-sm text-slate-600">
          We couldn&apos;t load the current auth policy or plan entitlement, so this page will not guess whether defaults,
          plan gating, or live runtime enforcement are in effect right now.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/admin/auth-policy"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Retry auth policy
          </Link>
          <Link
            href="/admin/audit"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Review audit evidence
          </Link>
        </div>
      </Card>
    </div>
  );
}

// Mirrors AuthPolicyService.isWithinMfaGracePeriod's date math for display —
// this is read-only, so duplicating the trivial calculation here avoids a
// second round trip just to render a status string.
function describeMfaGracePeriod(mfaRequiredSince: string | null, mfaGracePeriodDays: number): string {
  if (!mfaRequiredSince) {
    return "No rollout window recorded — enforced immediately";
  }
  const graceEndsAt = new Date(mfaRequiredSince).getTime() + mfaGracePeriodDays * 24 * 60 * 60 * 1000;
  if (Date.now() >= graceEndsAt) {
    return "Ended — enforced immediately";
  }
  return `Active until ${formatDateTime(new Date(graceEndsAt).toISOString())}`;
}

function InfoCards({ policy }: { policy: Awaited<ReturnType<typeof getTenantAuthPolicy>> }) {
  return (
    <section className="grid gap-4 xl:grid-cols-3">
      <Card>
        <CardTitle>Policy State</CardTitle>
        <div className="mt-3 flex flex-wrap gap-2">
          <StatusChip label={policy.isPersisted ? "persisted" : "not configured"} tone={policy.isPersisted ? "success" : "info"} />
          <StatusChip label={`timeout ${policy.sessionTimeoutMinutes}m`} tone="info" />
          <StatusChip label={policy.mfaRequired ? "mfa required" : "mfa off"} tone={policy.mfaRequired ? "warning" : "neutral"} />
        </div>
        <p className="mt-3 text-sm text-slate-600">
          Session timeout and MFA enrollment enforcement are active in database mode. Allowed auth methods (password vs
          OIDC gating) are enforced at login. Configure your OIDC identity provider in{" "}
          <Link href="/admin/auth-policy/oidc" className="text-blue-700 hover:underline">Admin → OIDC / SSO</Link>.
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
          {policy.mfaRequired && (
            <div className="flex items-center justify-between gap-4">
              <dt>MFA grace period</dt>
              <dd className="font-medium text-slate-900">{describeMfaGracePeriod(policy.mfaRequiredSince, policy.mfaGracePeriodDays)}</dd>
            </div>
          )}
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
            <dd className="font-medium text-slate-900">{formatDateTime(policy.updatedAt)}</dd>
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
  );
}

export default async function AdminAuthPolicyPage({ searchParams }: AdminAuthPolicyPageProps) {
  const query = await searchParams;
  const { authHeader, actorRole, adminBoundaryRoles } = await getServerSession();
  if (!authHeader) {
    redirect(buildLoginRedirect("/admin/auth-policy", 401));
  }
  if (!isSystemAdminBoundary(adminBoundaryRoles)) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Auth Policy"
          description="Tenant authentication policy overview."
          breadcrumb={
            <>
              Dashboard / Admin / <span className="font-semibold text-slate-700">Auth Policy</span>
            </>
          }
        />
        <SystemAdminRequiredCard surfaceLabel="Auth policy" />
      </div>
    );
  }
  if (actorRole !== "admin") {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Auth Policy"
          description="Tenant authentication policy overview."
          breadcrumb={
            <>
              Dashboard / Admin / <span className="font-semibold text-slate-700">Auth Policy</span>
            </>
          }
        />
        <Card>
          <CardTitle>Admin Role Required</CardTitle>
          <p className="mt-2 text-sm text-slate-600">
            Viewing and editing tenant auth policy changes stay admin-only. Your current role does not have write access to this surface.
          </p>
          <div className="mt-4">
            <Link href="/admin" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
              Back to Admin
            </Link>
          </div>
        </Card>
      </div>
    );
  }
  const status = String(query.status ?? "").trim();
  const errorMessage = String(query.message ?? "").trim();

  try {
    const [policy, planProfile] = await Promise.all([
      getTenantAuthPolicy({ role: actorRole, authHeader }),
      getBillingPlanProfile({ role: actorRole, authHeader }),
    ]);
    const planTier = String(planProfile.planTier ?? "TRIAL").toUpperCase();

    const pageHeader = (
      <PageHeader
        title="Auth Policy"
        description="Store and audit tenant identity posture now, while keeping current password login backward compatible until later MFA and OIDC slices land."
        breadcrumb={
          <>
            <Link href="/dashboard" className="hover:underline">Dashboard</Link>
            {" / "}
            <Link href="/admin" className="hover:underline">Admin</Link>
            {" / "}
            <span className="font-semibold text-slate-700">Auth Policy</span>
          </>
        }
      />
    );

    // TRIAL / STARTER — auth policy configuration is not available
    if (planTier === "TRIAL" || planTier === "STARTER") {
      return (
        <div className="space-y-5">
          {pageHeader}
          <Card>
            <CardTitle>Auth Policy — Plan Upgrade Required</CardTitle>
            <p className="mt-2 text-sm text-slate-600">
              Auth Policy configuration — including session timeout, MFA enforcement, and external identity mode — is
              available on the Growth and Enterprise plans.
            </p>
            {planTier === "TRIAL" && (
              <p className="mt-2 text-sm text-slate-600">
                Your trial workspace includes default session and authentication settings. Upgrade to Growth or Enterprise
                to define and enforce a custom auth policy.
              </p>
            )}
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

    const statusBanners = (
      <>
        {status === "auth-policy-error" ? (
          <StatusBanner tone="error" message={errorMessage || "Unable to update tenant auth policy."} />
        ) : null}
        {status === "auth-policy-updated" ? (
          <StatusBanner tone="success" message="Tenant auth policy updated." />
        ) : null}
      </>
    );

    // GROWTH — session timeout only; enterprise fields are visible but locked
    if (planTier === "GROWTH") {
      return (
        <div className="space-y-5">
          {pageHeader}
          {statusBanners}
          <InfoCards policy={policy} />
          <Card>
            <CardTitle>Tenant Authentication Policy</CardTitle>
            <p className="mt-2 text-sm text-slate-600">
              Growth plan includes session timeout configuration. MFA enforcement, external identity mode, and allowed
              sign-in methods are available on the{" "}
              <Link href="/admin/plan" className="text-blue-700 hover:underline">Enterprise plan</Link>.
            </p>

            <form action={updateTenantAuthPolicyAction} className="mt-4 grid gap-4">
              <input type="hidden" name="errorRedirectTo" value="/admin/auth-policy" />

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

              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
                <span className="font-medium text-slate-700">Enterprise-only fields locked: </span>
                MFA required, MFA grace period, external identity mode, and allowed sign-in methods require an Enterprise
                plan.{" "}
                <Link href="/admin/plan" className="text-blue-700 hover:underline">Upgrade to unlock.</Link>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                  Save Session Timeout
                </button>
              </div>
            </form>
          </Card>
        </div>
      );
    }

    // ENTERPRISE — full form
    return (
      <div className="space-y-5">
        {pageHeader}
        {statusBanners}
        <InfoCards policy={policy} />

        <Card>
          <CardTitle>Tenant Authentication Policy</CardTitle>
          <p className="mt-2 text-sm text-slate-600">
            Password login remains enabled today. Use this page to store and audit the intended tenant policy so later MFA
            and OIDC slices can enforce it without redefining the contract.
          </p>

          <AuthPolicyEnterpriseForm action={updateTenantAuthPolicyAction} policy={policy} />
        </Card>
      </div>
    );
  } catch (error) {
    if (error instanceof ApiHttpError && error.status === 401) {
      redirect(buildLoginRedirect("/admin/auth-policy", error.status));
    }
    if (isAuthPolicyApiUnavailable(error)) {
      return <AdminAuthPolicyUnavailableState />;
    }
    throw error;
  }
}
