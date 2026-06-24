import Link from "next/link";
import { redirect } from "next/navigation";
import {
  deleteOidcConfigAction,
  upsertOidcConfigAction,
} from "@/app/admin/auth-policy/oidc/actions";
import { ApiHttpError, getBillingPlanProfile, getOidcConfig, type OidcConfigView } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerSession } from "@/lib/server-session";
import { formatDateTime } from "@/lib/format";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";

export const dynamic = "force-dynamic";

interface AdminOidcConfigPageProps {
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

function isOidcApiUnavailable(error: unknown): boolean {
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

function OidcUnavailableState() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="OIDC SSO Configuration"
        description="The canonical OIDC configuration surface is temporarily unavailable while identity or billing reads reconnect."
        breadcrumb={
          <>
            Dashboard / Admin / Auth Policy /{" "}
            <span className="font-semibold text-slate-700">OIDC</span>
          </>
        }
      />
      <Card>
        <CardTitle>OIDC configuration is temporarily unavailable</CardTitle>
        <p className="mt-2 text-sm text-slate-600">
          We couldn&apos;t confirm either the current OIDC configuration or the plan entitlement for this workspace, so this
          page will not guess whether SSO is configured or writable right now.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/admin/auth-policy/oidc"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Retry OIDC settings
          </Link>
          <Link
            href="/admin/auth-policy"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Back to Auth Policy
          </Link>
        </div>
      </Card>
    </div>
  );
}

async function loadConfig(): Promise<OidcConfigView | null> {
  try {
    const { authHeader: loadAuthHeader, actorRole: loadRole } = await getServerSession();
    const config = await getOidcConfig({
      role: loadRole,
      authHeader: loadAuthHeader,
    });
    return config ?? null;
  } catch (error) {
    if (error instanceof ApiHttpError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export default async function AdminOidcConfigPage({ searchParams }: AdminOidcConfigPageProps) {
  const query = await searchParams;
  const { authHeader, actorRole } = await getServerSession();
  if (!authHeader) {
    redirect(buildLoginRedirect("/admin/auth-policy/oidc", 401));
  }
  const status = String(query.status ?? "").trim();
  const message = String(query.message ?? "").trim();

  if (actorRole !== "admin") {
    return (
      <div className="space-y-5">
        <PageHeader
          title="OIDC SSO Configuration"
          description="Tenant OIDC identity provider configuration is limited to workspace admins."
          breadcrumb={
            <>
              <Link href="/dashboard" className="hover:underline">Dashboard</Link>{" / "}<Link href="/admin" className="hover:underline">Admin</Link>{" / "}<Link href="/admin/auth-policy" className="hover:underline">Auth Policy</Link>{" / "}
              <span className="font-semibold text-slate-700">OIDC</span>
            </>
          }
        />
        <Card>
          <CardTitle>Restricted</CardTitle>
          <p className="mt-2 text-sm text-slate-600">
            Only workspace administrators can view or change OIDC SSO configuration.
          </p>
        </Card>
      </div>
    );
  }

  let planTier: string;
  try {
    const planProfile = await getBillingPlanProfile({ role: actorRole, authHeader });
    planTier = String(planProfile.planTier ?? "TRIAL").toUpperCase();
  } catch (error) {
    if (error instanceof ApiHttpError && error.status === 401) {
      redirect(buildLoginRedirect("/admin/auth-policy/oidc", error.status));
    }
    if (isOidcApiUnavailable(error)) {
      return <OidcUnavailableState />;
    }
    throw error;
  }
  if (planTier !== "ENTERPRISE") {
    return (
      <div className="space-y-5">
        <PageHeader
          title="OIDC SSO Configuration"
          description="Tenant OIDC identity provider configuration is limited to workspace admins."
          breadcrumb={
            <>
              <Link href="/dashboard" className="hover:underline">Dashboard</Link>{" / "}<Link href="/admin" className="hover:underline">Admin</Link>{" / "}<Link href="/admin/auth-policy" className="hover:underline">Auth Policy</Link>{" / "}
              <span className="font-semibold text-slate-700">OIDC</span>
            </>
          }
        />
        <Card>
          <CardTitle>Enterprise Plan Required</CardTitle>
          <p className="mt-2 text-sm text-slate-600">
            OIDC / SSO configuration requires the Enterprise plan. Upgrade to configure your
            identity provider, enforce external authentication, and manage sign-in methods
            centrally.
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

  let config: OidcConfigView | null;
  try {
    config = await loadConfig();
  } catch (error) {
    if (error instanceof ApiHttpError && error.status === 401) {
      redirect(buildLoginRedirect("/admin/auth-policy/oidc", error.status));
    }
    if (isOidcApiUnavailable(error)) {
      return <OidcUnavailableState />;
    }
    throw error;
  }
  const banner =
    status === "oidc-saved"
      ? <StatusBanner tone="success" message="OIDC configuration saved. Test the sign-in flow before announcing to your team." />
      : status === "oidc-deleted"
        ? <StatusBanner tone="info" message="OIDC configuration removed. Sign-in via OIDC is now disabled for this workspace." />
        : status === "oidc-error"
          ? <StatusBanner tone="error" message={message || "Unable to update OIDC configuration."} />
          : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="OIDC SSO Configuration"
        description="Connect your identity provider (Okta, Azure AD, Google Workspace, Auth0, etc.) for sign-in. This is a pilot-period administrative surface; some advanced controls are operator-mediated."
        breadcrumb={
          <>
            <Link href="/dashboard" className="hover:underline">Dashboard</Link>{" / "}<Link href="/admin" className="hover:underline">Admin</Link>{" / "}<Link href="/admin/auth-policy" className="hover:underline">Auth Policy</Link>{" / "}
            <span className="font-semibold text-slate-700">OIDC</span>
          </>
        }
      />

      {banner}

      <Card>
        <div className="flex items-center justify-between">
          <CardTitle>Current status</CardTitle>
          <StatusChip
            label={config ? `Configured (${config.status})` : "Not configured"}
            tone={config && config.status === "active" ? "success" : "neutral"}
          />
        </div>
        {config ? (
          <dl className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            <div>
              <dt className="text-slate-500">Issuer</dt>
              <dd className="font-mono break-all text-slate-800">{config.issuer}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Client ID</dt>
              <dd className="font-mono break-all text-slate-800">{config.clientId}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Callback URL</dt>
              <dd className="font-mono break-all text-slate-800">{config.callbackUrl}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Scopes</dt>
              <dd className="text-slate-800">{config.scopes.join(" ") || "—"}</dd>
            </div>
            <div className="md:col-span-2">
              <dt className="text-slate-500">Last updated</dt>
              <dd className="text-slate-800">{formatDateTime(config.updatedAt)}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-slate-600">
            No identity provider is configured yet. Fill out the form below to connect your IdP. Client secrets are
            encrypted at rest with the tenant credential key.
          </p>
        )}
      </Card>

      <Card>
        <CardTitle>{config ? "Update configuration" : "Connect identity provider"}</CardTitle>
        <form action={upsertOidcConfigAction} className="mt-3 grid gap-4">
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-slate-700">
              Issuer URL <span className="text-rose-600">*</span>
            </span>
            <input
              type="url"
              name="issuer"
              required
              defaultValue={config?.issuer ?? ""}
              placeholder="https://login.example.com/oidc"
              className="rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
            />
            <span className="text-xs text-slate-500">
              The OIDC issuer (the base of <code>/.well-known/openid-configuration</code>). Trailing slashes are removed.
            </span>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="font-medium text-slate-700">
              Client ID <span className="text-rose-600">*</span>
            </span>
            <input
              type="text"
              name="clientId"
              required
              defaultValue={config?.clientId ?? ""}
              className="rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="font-medium text-slate-700">
              Client Secret <span className="text-rose-600">*</span>
            </span>
            <input
              type="password"
              name="clientSecret"
              required
              placeholder={config ? "•••••••• (enter to replace)" : ""}
              className="rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
            />
            <span className="text-xs text-slate-500">
              Stored encrypted with the tenant credential key. Submitting a new value replaces the existing secret.
            </span>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="font-medium text-slate-700">
              Callback URL <span className="text-rose-600">*</span>
            </span>
            <input
              type="url"
              name="callbackUrl"
              required
              defaultValue={config?.callbackUrl ?? ""}
              placeholder="https://app.vexa.example.com/auth/oidc/callback"
              className="rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
            />
            <span className="text-xs text-slate-500">
              Register this exact URL as an authorized redirect URI in your IdP.
            </span>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="font-medium text-slate-700">Scopes</span>
            <input
              type="text"
              name="scopes"
              defaultValue={(config?.scopes ?? ["openid", "email", "profile"]).join(" ")}
              placeholder="openid email profile"
              className="rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
            />
            <span className="text-xs text-slate-500">
              Space-separated. Defaults to <code>openid email profile</code> if left blank.
            </span>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="font-medium text-slate-700">Claims mapping (JSON)</span>
            <textarea
              name="claimsMapping"
              rows={4}
              defaultValue={JSON.stringify(config?.claimsMapping ?? {}, null, 2)}
              className="rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
            />
            <span className="text-xs text-slate-500">
              Optional. Map IdP claim values to Vexa roles. Example:{" "}
              <code>{'{ "roles": { "pim_admin": "admin", "pim_editor": "editor" } }'}</code>
            </span>
          </label>

          <label className="grid gap-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm">
            <span className="font-medium text-amber-900">
              Confirm with your password <span className="text-rose-600">*</span>
            </span>
            <input
              type="password"
              name="stepUpPassword"
              required
              autoComplete="current-password"
              className="rounded-md border border-amber-300 bg-white px-3 py-2 font-mono text-sm"
            />
            <span className="text-xs text-amber-800">
              Step-up authentication is required for auth-config changes. Your password is never stored; it confirms a
              fresh proof of session ownership.
            </span>
          </label>

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              {config ? "Save changes" : "Connect"}
            </button>
            <Link
              href="/admin/auth-policy"
              className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
            >
              Back to Auth Policy
            </Link>
          </div>
        </form>
      </Card>

      {config ? (
        <Card>
          <CardTitle>Disconnect identity provider</CardTitle>
          <p className="mt-2 text-sm text-slate-600">
            Removing the configuration disables OIDC sign-in for this workspace. Existing OIDC sessions are not
            invalidated automatically; rotate JWT secrets if you need an immediate revocation.
          </p>
          <form action={deleteOidcConfigAction} className="mt-3 grid gap-3">
            <label className="grid gap-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm">
              <span className="font-medium text-amber-900">
                Confirm with your password <span className="text-rose-600">*</span>
              </span>
              <input
                type="password"
                name="stepUpPassword"
                required
                autoComplete="current-password"
                className="rounded-md border border-amber-300 bg-white px-3 py-2 font-mono text-sm"
              />
              <span className="text-xs text-amber-800">
                Step-up authentication is required to remove OIDC sign-in. Your password is never stored.
              </span>
            </label>
            <div>
              <button
                type="submit"
                className="rounded-md border border-rose-300 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50"
              >
                Remove OIDC configuration
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      <p className="text-xs text-slate-500">
        Pilot note: this surface configures the identity provider connection only and requires step-up password
        confirmation on every mutation. Enforcement (whether OIDC is required for all users, MFA grace, etc.) lives on
        the parent Auth Policy page. Full OIDC enforcement claims remain gated until Gate C is complete — see PO
        sign-off V4 for the current claim boundary.
      </p>
    </div>
  );
}
