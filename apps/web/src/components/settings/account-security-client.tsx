"use client";

import { FormEvent, useState } from "react";
import type { MfaStatus } from "@/lib/api";

interface AccountSecurityClientProps {
  mfaStatus: MfaStatus | null;
  mfaRequired: boolean;
}

export function AccountSecurityClient({ mfaStatus, mfaRequired }: AccountSecurityClientProps) {
  const enrolled = mfaStatus?.enrollmentStatus === "active";
  const [regenCode, setRegenCode] = useState("");
  const [regenSubmitting, setRegenSubmitting] = useState(false);
  const [regenError, setRegenError] = useState("");
  const [newBackupCodes, setNewBackupCodes] = useState<string[] | null>(null);

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

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Account Security</h1>
        <p className="mt-1 text-sm text-slate-500">Manage two-factor authentication for your account.</p>
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
            MFA is not required for this workspace, but you can enable it for extra security by setting it up at your next sign-in.
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
                  {new Date(mfaStatus.lastUsedAt).toLocaleString()}
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
