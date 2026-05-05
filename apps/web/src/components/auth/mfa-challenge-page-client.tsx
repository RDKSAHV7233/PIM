"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { sanitizeNextPath } from "@/lib/auth-redirect";
import { PimLocale } from "@/lib/locale";
import { BrandLogo } from "@/components/ui/brand-logo";
import { getAuthCopy } from "./auth-copy";

interface MfaChallengePageClientProps {
  pendingToken: string;
  maskedEmail: string;
  workspaceSlug: string;
  nextPath: string;
  locale: PimLocale;
}

export function MfaChallengePageClient({
  pendingToken,
  maskedEmail,
  workspaceSlug,
  nextPath,
  locale,
}: MfaChallengePageClientProps) {
  const authCopy = getAuthCopy(locale);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const safeNextPath = useMemo(() => sanitizeNextPath(nextPath), [nextPath]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/auth/mfa/verify-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingToken, code: code.trim().replace(/\s/g, "") }),
      });

      if (response.ok) {
        await response.json().catch(() => ({}));
        window.location.assign(safeNextPath);
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (response.status === 401) {
        if (payload.error === "MFA_PENDING_TOKEN_REQUIRED") {
          setErrorMessage(authCopy.mfaChallengeExpiredSession);
          return;
        }
        setErrorMessage(authCopy.mfaChallengeInvalidCode);
        return;
      }

      if (response.status === 503) {
        setErrorMessage(authCopy.loginServiceUnavailable);
        return;
      }

      setErrorMessage(authCopy.genericLoginFailure);
    } catch {
      setErrorMessage(authCopy.networkError);
    } finally {
      setSubmitting(false);
    }
  }

  const loginHref = `/login?workspace=${encodeURIComponent(workspaceSlug)}&lang=${encodeURIComponent(locale)}`;

  return (
    <div
      className="relative mx-auto max-w-[26rem] overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/95 p-5 md:p-6 shadow-[0_28px_70px_rgba(148,163,184,0.18)] backdrop-blur"
      suppressHydrationWarning
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.18),_rgba(255,255,255,0)_60%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.12),_rgba(255,255,255,0)_52%)]" />
      <div className="relative space-y-5">
        <header className="space-y-4 rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(248,250,252,0.92))] p-4 md:p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
          <BrandLogo variant="lockup" className="mb-0" />
          <div>
            <h1 className="text-[1.85rem] font-semibold tracking-tight text-slate-950 md:text-[2rem]">
              {authCopy.mfaChallengeTitle}
            </h1>
            <p className="mt-1 text-sm text-slate-600">{authCopy.mfaChallengeSubtitle}</p>
            {maskedEmail && (
              <p className="mt-1 text-sm font-medium text-slate-700">{maskedEmail}</p>
            )}
          </div>
        </header>

        <form className="space-y-4" onSubmit={onSubmit} suppressHydrationWarning>
          <div className="space-y-1.5">
            <label
              htmlFor="mfa-code"
              className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500"
            >
              {authCopy.mfaChallengeCodeLabel}
            </label>
            <input
              id="mfa-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,8}"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoFocus
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
            {submitting ? authCopy.mfaChallengeSubmitting : authCopy.mfaChallengeSubmit}
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
