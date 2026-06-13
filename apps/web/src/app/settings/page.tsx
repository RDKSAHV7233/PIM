import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession, getServerSessionClaims } from "@/lib/server-session";
import { buildLoginRedirect } from "@/lib/auth-redirect";

export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin — full workspace access",
  editor: "Editor — catalog write and import",
  publisher: "Publisher — approve and publish",
  approver: "Approver — review and approve",
  channel_manager: "Channel Manager — connector and channel ops",
  connector_admin: "Connector Admin — connector setup and credentials",
  reviewer: "Reviewer — read with approval authority",
  viewer: "Viewer — read-only access",
};

export default async function AccountProfilePage() {
  const { authHeader, actorRole } = await getServerSession();
  if (!authHeader) {
    redirect(buildLoginRedirect("/settings", 401));
  }

  const claims = await getServerSessionClaims();
  const email = claims?.sub ?? "";
  const tenantId = claims?.tenantId ?? "";
  const role = actorRole;
  const assignedRoles = (claims?.assignedRoles ?? []) as string[];

  const displayRole = role ? `${role.charAt(0).toUpperCase()}${role.slice(1)}` : "Unknown";
  const roleLabel = ROLE_LABELS[role] ?? "Access defined by assigned role.";

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Account</h1>
        <p className="mt-1 text-sm text-slate-500">
          Your account details and workspace membership.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Account details</h2>
        <dl className="mt-4 divide-y divide-slate-100 text-sm">
          <div className="flex items-center justify-between py-3">
            <dt className="text-slate-500">Email address</dt>
            <dd className="font-medium text-slate-900">{email}</dd>
          </div>
          <div className="flex items-center justify-between py-3">
            <dt className="text-slate-500">Workspace</dt>
            <dd className="font-mono text-slate-700">{tenantId}</dd>
          </div>
          <div className="flex items-start justify-between py-3">
            <dt className="text-slate-500">Role</dt>
            <dd className="text-right">
              <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-800">
                {displayRole}
              </span>
              {assignedRoles.length > 0 && (
                <div className="mt-1 flex flex-wrap justify-end gap-1">
                  {assignedRoles.map((r) => (
                    <span key={r} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                      {r}
                    </span>
                  ))}
                </div>
              )}
              <p className="mt-1 text-xs text-slate-500">{roleLabel}</p>
            </dd>
          </div>
        </dl>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Preferences</h2>
        <p className="mt-1 text-sm text-slate-500">
          Manage security, plan, and privacy settings from the links below.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Link
            href="/settings/security"
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm font-medium text-slate-900 transition hover:border-indigo-300 hover:bg-indigo-50"
          >
            <span className="text-base">🔐</span>
            <div>
              <p className="font-semibold">Security</p>
              <p className="text-xs font-normal text-slate-500">Password, MFA, access role</p>
            </div>
          </Link>
          <Link
            href="/admin/plan"
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm font-medium text-slate-900 transition hover:border-indigo-300 hover:bg-indigo-50"
          >
            <span className="text-base">📋</span>
            <div>
              <p className="font-semibold">Plan</p>
              <p className="text-xs font-normal text-slate-500">Current tier, usage, upgrade</p>
            </div>
          </Link>
          <Link
            href="/admin/privacy"
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm font-medium text-slate-900 transition hover:border-indigo-300 hover:bg-indigo-50"
          >
            <span className="text-base">🔒</span>
            <div>
              <p className="font-semibold">Privacy</p>
              <p className="text-xs font-normal text-slate-500">Data export, consent, deletion</p>
            </div>
          </Link>
          <Link
            href="/admin/audit"
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm font-medium text-slate-900 transition hover:border-indigo-300 hover:bg-indigo-50"
          >
            <span className="text-base">📜</span>
            <div>
              <p className="font-semibold">Audit trail</p>
              <p className="text-xs font-normal text-slate-500">Your activity in this workspace</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
