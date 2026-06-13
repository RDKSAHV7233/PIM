"use client";

import { FormEvent, useState } from "react";
import type { MfaStatus } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

interface AccountSecurityClientProps {
  mfaStatus: MfaStatus | null;
  mfaRequired: boolean;
  role: string;
  assignedRoles: string[];
  planTier: string;
}

const ROLE_CAPABILITY_MAP: Record<string, string> = {
  admin: "Full workspace access — users, connectors, API keys, audit logs, and all content.",
  editor: "Catalog write, import, bulk edit, connector setup, and quality triage.",
  reviewer: "Read-only catalog and operations with approval/rejection authority.",
  viewer: "Read-only access across catalog, channels, and operations.",
};

export function AccountSecurityClient({ mfaStatus, mfaRequired, role, assignedRoles, planTier }: AccountSecurityClientProps) {
  const mfaAvailable = planTier !== "TRIAL" && planTier !== "STARTER";
  const enrolled = mfaStatus?.enrollmentStatus === "active";
  const [regenCode, setRegenCode] = useState("");
  const [regenSubmitting, setRegenSubmitting] = useState(false);
  const [regenError, setRegenError] = useState("");
  const [newBackupCodes, setNewBackupCodes] = useState<string[] | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwSubmitting, setPwSubmitting] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState(false);

  async function onRegenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRegenSubmitting(true);
    setRegenError("");
    setNewBackupCodes(null);

    try {
      const response = await fetch("/api/auth/mfa/backup-codes/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: regenCode.trim().replace(/\s/g, "") }),
      });

      if (response.ok) {
        const data = (await response.json()) as { backupCodes?: string[] };
        setNewBackupCodes(Array.isArray(data.backupCodes) ? data.backupCodes : []);
        setRegenCode("");
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.status === 401 && payload.error === "MFA_CODE_INVALID") {
        setRegenError("Invalid verification code. Try again.");
        return;
      }
      setRegenError("Unable to regenerate backup codes. Please try again.");
    } catch {
      setRegenError("Network error. Check your connection and try again.");
    } finally {
      setRegenSubmitting(false);
    }
  }

  async function onSetupMfa() {
    setSetupLoading(true);
    setSetupError("");
    try {
      const response = await fetch("/api/auth/mfa/request-enrollment-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        setSetupError("Unable to start MFA setup. Please try again.");
        return;
      }
      const data = (await response.json()) as { enrollmentToken?: string };
      if (!data.enrollmentToken) {
        setSetupError("Unable to start MFA setup. Please try again.");
        return;
      }
      const params = new URLSearchParams({ token: data.enrollmentToken });
      window.location.assign(`/login/enroll?${params.toString()}`);
    } catch {
      setSetupError("Network error. Check your connection and try again.");
    } finally {
      setSetupLoading(false);
    }
  }

  async function onChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPwError("");
    setPwSuccess(false);
    if (pwNew !== pwConfirm) {
      setPwError("New passwords do not match.");
      return;
    }
    if (pwNew.length < 8) {
      setPwError("New password must be at least 8 characters.");
      return;
    }
    setPwSubmitting(true);
    try {
      const response = await fetch("/api/auth/password/change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: pwCurrent, newPassword: pwNew }),
      });
      if (response.ok) {
        setPwSuccess(true);
        setPwCurrent("");
        setPwNew("");
        setPwConfirm("");
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.status === 401) {
        setPwError("Current password is incorrect.");
        return;
      }
      setPwError(payload.error ?? "Unable to change password. Please try again.");
    } catch {
      setPwError("Network error. Check your connection and try again.");
    } finally {
      setPwSubmitting(false);
    }
  }

  const roleCapability = ROLE_CAPABILITY_MAP[role] ?? "Access defined by assigned role.";
  const displayRole = role ? `${role.charAt(0).toUpperCase()}${role.slice(1)}` : "Unknown";
  const foundationRole = assignedRoles.length > 0 ? assignedRoles[0] : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Account Security</h1>
        <p className="mt-1 text-sm text-slate-500">Manage two-factor authentication and review your access role.</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Your Role &amp; Access</h2>
        <div className="mt-3 flex items-start gap-3">
          <span className="mt-0.5 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-800">
            {displayRole}
          </span>
          {foundationRole ? (
            <span className="mt-0.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
              {foundationRole}
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-sm text-slate-600">{roleCapability}</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Change Password</h2>
        <p className="mt-1 text-sm text-slate-500">Enter your current password to set a new one.</p>
        {pwSuccess ? (
          <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            Password updated successfully.
          </p>
        ) : (
          <form className="mt-4 space-y-4" onSubmit={onChangePassword}>
            <div className="space-y-1.5">
              <label htmlFor="pw-current" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Current password
              </label>
              <input
                id="pw-current"
                type="password"
                autoComplete="current-password"
                value={pwCurrent}
                onChange={(e) => setPwCurrent(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-300/90 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="pw-new" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                New password
              </label>
              <input
                id="pw-new"
                type="password"
                autoComplete="new-password"
                value={pwNew}
                onChange={(e) => setPwNew(e.target.value)}
                required
                minLength={8}
                className="w-full rounded-xl border border-slate-300/90 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="pw-confirm" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Confirm new password
              </label>
              <input
                id="pw-confirm"
                type="password"
                autoComplete="new-password"
                value={pwConfirm}
                onChange={(e) => setPwConfirm(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-300/90 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
              />
            </div>
            {pwError && (
              <p className="rounded-xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-800">{pwError}</p>
            )}
            <button
              type="submit"
              disabled={pwSubmitting}
              suppressHydrationWarning
              className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
            >
              {pwSubmitting ? "Updating…" : "Update password"}
            </button>
          </form>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Two-Factor Authentication</h2>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              enrolled
                ? "bg-emerald-100 text-emerald-800"
                : "bg-slate-100 text-slate-600"
            }`}
          >
            {enrolled ? "Active" : "Not enrolled"}
          </span>
        </div>

        {!enrolled && mfaRequired && (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Your workspace requires MFA. You will be prompted to set it up at your next sign-in.
          </p>
        )}

        {!enrolled && !mfaRequired && (
          <p className="mt-3 text-sm text-slate-500">
            MFA is not required for this workspace, but you can enable it now for extra security.
          </p>
        )}

        {!enrolled && mfaAvailable && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => { void onSetupMfa(); }}
              disabled={setupLoading}
              suppressHydrationWarning
              className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
            >
              {setupLoading ? "Starting setup…" : "Set up two-factor authentication"}
            </button>
            {setupError && (
              <p className="mt-2 text-sm text-red-700">{setupError}</p>
            )}
          </div>
        )}

        {!enrolled && !mfaAvailable && (
          <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Two-factor authentication is available on the Growth plan and above.{" "}
            <a href="/admin/plan" className="font-medium text-blue-700 hover:underline">
              View plans
            </a>
          </p>
        )}

        {enrolled && mfaStatus && (
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Backup codes remaining</dt>
              <dd className="font-medium text-slate-900">{mfaStatus.backupCodesRemaining}</dd>
            </div>
            {mfaStatus.lastUsedAt && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Last used</dt>
                <dd className="font-medium text-slate-900">
                  {formatDateTime(mfaStatus.lastUsedAt)}
                </dd>
              </div>
            )}
            {mfaStatus.secretPreview && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Device key preview</dt>
                <dd className="font-mono font-medium text-slate-900">{mfaStatus.secretPreview}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      {enrolled && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Regenerate Backup Codes</h2>
          <p className="mt-1 text-sm text-slate-500">
            Enter your current 6-digit authenticator code to generate a fresh set of backup codes.
            Your existing codes will be invalidated.
          </p>

          {newBackupCodes ? (
            <div className="mt-4 space-y-3">
              <p className="text-sm font-medium text-emerald-700">
                New backup codes generated. Store these somewhere safe — they won&apos;t be shown again.
              </p>
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                {newBackupCodes.map((bc) => (
                  <code key={bc} className="text-center font-mono text-sm font-semibold text-slate-800">
                    {bc}
                  </code>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setNewBackupCodes(null)}
                className="text-sm font-medium text-slate-500 underline underline-offset-4"
              >
                Done
              </button>
            </div>
          ) : (
            <form className="mt-4 flex items-end gap-3" onSubmit={onRegenerate}>
              <div className="flex-1 space-y-1.5">
                <label
                  htmlFor="regen-code"
                  className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500"
                >
                  Verification code
                </label>
                <input
                  id="regen-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9 ]{6,8}"
                  value={regenCode}
                  onChange={(e) => setRegenCode(e.target.value)}
                  required
                  suppressHydrationWarning
                  className="w-full rounded-xl border border-slate-300/90 bg-white px-3 py-2.5 text-center font-mono text-sm tracking-widest text-slate-900 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                />
              </div>
              <button
                type="submit"
                disabled={regenSubmitting}
                suppressHydrationWarning
                className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
              >
                {regenSubmitting ? "Regenerating…" : "Regenerate"}
              </button>
            </form>
          )}

          {regenError && (
            <p className="mt-3 rounded-xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-800">
              {regenError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
