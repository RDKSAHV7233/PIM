"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { PimLocale } from "@/lib/locale";
import { BrandLogo } from "@/components/ui/brand-logo";
import { getAuthCopy } from "./auth-copy";

interface MfaEnrollPageClientProps {
  enrollmentToken: string;
  maskedEmail: string;
  workspaceSlug: string;
  locale: PimLocale;
}

type EnrollStep = "loading" | "setup" | "backup" | "error";

interface EnrollData {
  otpauthUri: string;
  manualEntryKey: string;
  secretPreview: string;
}

export function MfaEnrollPageClient({
  enrollmentToken,
  maskedEmail,
  workspaceSlug,
  locale,
}: MfaEnrollPageClientProps) {
  const authCopy = getAuthCopy(locale);
  const [step, setStep] = useState<EnrollStep>("loading");
  const [enrollData, setEnrollData] = useState<EnrollData | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const loginHref = `/login?workspace=${encodeURIComponent(workspaceSlug)}&lang=${encodeURIComponent(locale)}`;

  useEffect(() => {
    let cancelled = false;
    async function startEnrollment() {
      try {
        const response = await fetch("/api/auth/mfa/enroll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enrollmentToken }),
        });
        if (cancelled) return;
        if (!response.ok) {
          setStep("error");
          return;
        }
        const data = (await response.json()) as {
          otpauthUri?: string;
          manualEntryKey?: string;
          secretPreview?: string;
        };
        if (!data.manualEntryKey) {
          setStep("error");
          return;
        }
        setEnrollData({
          otpauthUri: data.otpauthUri ?? "",
          manualEntryKey: data.manualEntryKey,
          secretPreview: data.secretPreview ?? data.manualEntryKey,
        });
        setStep("setup");
      } catch {
        if (!cancelled) setStep("error");
      }
    }
    void startEnrollment();
    return () => {
      cancelled = true;
    };
  }, [enrollmentToken]);

  async function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/auth/mfa/verify-enrollment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrollmentToken, code: code.trim().replace(/\s/g, "") }),
      });

      if (response.ok) {
        const data = (await response.json().catch(() => ({}))) as { backupCodes?: string[] };
        setBackupCodes(Array.isArray(data.backupCodes) ? data.backupCodes : []);
        setStep("backup");
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.status === 401) {
        if (payload.error === "MFA_CODE_INVALID") {
          setErrorMessage(authCopy.mfaEnrollInvalidCode);
          return;
        }
        setErrorMessage(authCopy.mfaChallengeExpiredSession);
        return;
      }

      setErrorMessage(authCopy.genericLoginFailure);
    } catch {
      setErrorMessage(authCopy.networkError);
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "loading") {
    return (
      <div className="relative mx-auto max-w-[26rem] rounded-[28px] border border-slate-200/80 bg-white/95 p-6 shadow-[0_28px_70px_rgba(148,163,184,0.18)]">
        <BrandLogo variant="lockup" className="mb-4" />
        <p className="text-sm text-slate-500">Setting up two-factor authentication…</p>
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="relative mx-auto max-w-[26rem] rounded-[28px] border border-slate-200/80 bg-white/95 p-6 shadow-[0_28px_70px_rgba(148,163,184,0.18)]">
        <BrandLogo variant="lockup" className="mb-4" />
        <p className="mb-4 rounded-xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-800">
          {authCopy.mfaEnrollLoadError}
        </p>
        <Link href={loginHref} className="text-sm font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-4">
          {authCopy.backToLogin}
        </Link>
      </div>
    );
  }

  if (step === "backup") {
    return (
      <div className="relative mx-auto max-w-[26rem] overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/95 p-5 md:p-6 shadow-[0_28px_70px_rgba(148,163,184,0.18)]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.18),_rgba(255,255,255,0)_60%)]" />
        <div className="relative space-y-5">
          <header className="space-y-3 rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(248,250,252,0.92))] p-4 md:p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
            <BrandLogo variant="lockup" className="mb-0" />
            <h1 className="text-[1.6rem] font-semibold tracking-tight text-slate-950">{authCopy.mfaEnrollBackupCodesTitle}</h1>
            <p className="text-sm text-slate-600">{authCopy.mfaEnrollBackupCodesSubtitle}</p>
          </header>
          {backupCodes.length > 0 && (
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
              {backupCodes.map((bc) => (
                <code key={bc} className="text-center font-mono text-sm font-semibold text-slate-800">
                  {bc}
                </code>
              ))}
            </div>
          )}
          <Link
            href={loginHref}
            className="block w-full rounded-xl bg-slate-900 px-3 py-3 text-center text-sm font-semibold text-white shadow-[0_18px_36px_rgba(15,23,42,0.22)] transition hover:bg-slate-800"
          >
            {authCopy.mfaEnrollContinue}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative mx-auto max-w-[26rem] overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/95 p-5 md:p-6 shadow-[0_28px_70px_rgba(148,163,184,0.18)] backdrop-blur"
      suppressHydrationWarning
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.18),_rgba(255,255,255,0)_60%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.12),_rgba(255,255,255,0)_52%)]" />
      <div className="relative space-y-5">
        <header className="space-y-3 rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(248,250,252,0.92))] p-4 md:p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
          <BrandLogo variant="lockup" className="mb-0" />
          <div>
            <h1 className="text-[1.6rem] font-semibold tracking-tight text-slate-950">{authCopy.mfaEnrollTitle}</h1>
            <p className="mt-1 text-sm text-slate-600">{authCopy.mfaEnrollSubtitle}</p>
            {maskedEmail && <p className="mt-1 text-sm font-medium text-slate-700">{maskedEmail}</p>}
          </div>
        </header>

        {enrollData && (
          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs text-slate-600">{authCopy.mfaEnrollScanInstruction}</p>
            {enrollData.otpauthUri && (
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">TOTP URI</p>
                <code className="block break-all rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-700">
                  {enrollData.otpauthUri}
                </code>
              </div>
            )}
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {authCopy.mfaEnrollSecretLabel}
              </p>
              <code className="block rounded-lg border border-slate-200 bg-white p-2 text-center font-mono text-sm font-semibold tracking-widest text-slate-800">
                {enrollData.manualEntryKey}
              </code>
            </div>
          </div>
        )}

        <form className="space-y-4" onSubmit={onVerify} suppressHydrationWarning>
          <div className="space-y-1.5">
            <label
              htmlFor="enroll-code"
              className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500"
            >
              {authCopy.mfaEnrollCodeLabel}
            </label>
            <input
              id="enroll-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,8}"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              suppressHydrationWarning
              className="w-full rounded-xl border border-slate-300/90 bg-white px-3 py-3 text-center text-lg tracking-widest text-slate-900 shadow-[inset_0_1px_2px_rgba(15,23,42,0.03)] outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            suppressHydrationWarning
            className="w-full rounded-xl bg-slate-900 px-3 py-3 text-sm font-semibold text-white shadow-[0_18px_36px_rgba(15,23,42,0.22)] transition hover:bg-slate-800 disabled:opacity-60"
          >
            {submitting ? authCopy.mfaEnrollSubmitting : authCopy.mfaEnrollSubmit}
          </button>

          {errorMessage && (
            <p className="rounded-xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-[0_10px_24px_rgba(239,68,68,0.08)]">
              {errorMessage}
            </p>
          )}
        </form>

        <p className="text-center text-xs text-slate-500">
          <Link href={loginHref} className="font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-4">
            {authCopy.backToLogin}
          </Link>
        </p>
      </div>
    </div>
  );
}
