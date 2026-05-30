"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PimLocale } from "@/lib/locale";
import { BrandLogo } from "@/components/ui/brand-logo";
import { getAuthCopy } from "./auth-copy";

interface AccountLockedPageClientProps {
  workspaceSlug: string;
  email: string;
  maskedEmail: string;
  unlockAtIso: string;
  locale: PimLocale;
}

export function AccountLockedPageClient({
  workspaceSlug,
  email,
  maskedEmail,
  unlockAtIso,
  locale,
}: AccountLockedPageClientProps) {
  const authCopy = getAuthCopy(locale);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const lockedUntilText = useMemo(() => {
    const unlockAt = new Date(unlockAtIso);
    if (Number.isNaN(unlockAt.getTime())) {
      return "";
    }
    const minutesLeft = Math.max(0, Math.ceil((unlockAt.getTime() - Date.now()) / 60_000));
    const timeStr = unlockAt.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" });
    return minutesLeft > 0 ? `${timeStr} (${minutesLeft} min remaining)` : timeStr;
  }, [unlockAtIso]);

  async function resendUnlock() {
    if (!email) {
      setMessage(authCopy.resendNeedsEmail);
      return;
    }
    if (!workspaceSlug) {
      setMessage(authCopy.workspaceInvalid);
      return;
    }
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/resend-unlock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, workspaceSlug }),
      });
      if (!response.ok) {
        setMessage(authCopy.resendFailed);
        return;
      }
      const payload = (await response.json().catch(() => null)) as { note?: string } | null;
      setMessage(payload?.note || authCopy.resendSent);
    } catch {
      setMessage(authCopy.resendFailed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative mx-auto max-w-md overflow-hidden rounded-[28px] border border-red-200/80 bg-white/95 p-6 shadow-[0_28px_70px_rgba(148,163,184,0.18)] backdrop-blur">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-[radial-gradient(circle_at_top_left,_rgba(248,113,113,0.16),_rgba(255,255,255,0)_58%),radial-gradient(circle_at_top_right,_rgba(251,191,36,0.12),_rgba(255,255,255,0)_52%)]" />
      <div className="relative space-y-5">
      <header className="space-y-4 rounded-[24px] border border-red-100/80 bg-[linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(254,242,242,0.9))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
        <BrandLogo variant="lockup" className="mb-0" />
        <div className="space-y-2">
        <h1 className="text-[2rem] font-semibold tracking-tight text-slate-950">{authCopy.lockedTitle}</h1>
        <p className="text-sm leading-6 text-slate-700">
          <strong>{maskedEmail}</strong> {authCopy.lockedBodyPrefix}.
        </p>
        {lockedUntilText && (
          <p className="text-sm leading-6 text-slate-600">
            {authCopy.lockedUntilPrefix} <strong>{lockedUntilText}</strong>.
          </p>
        )}
        </div>
      </header>

      <div className="space-y-3">
        <button
          type="button"
          disabled={submitting}
          onClick={resendUnlock}
          className="w-full rounded-xl bg-slate-900 px-3 py-3 text-sm font-semibold text-white shadow-[0_18px_36px_rgba(15,23,42,0.22)] transition hover:bg-slate-800 disabled:opacity-60"
        >
          {authCopy.resendUnlock}
        </button>
        {message ? (
          <p className="rounded-xl border border-slate-200/80 bg-slate-50/90 px-4 py-3 text-sm leading-6 text-slate-700 shadow-[0_10px_24px_rgba(148,163,184,0.08)]">
            {message}
          </p>
        ) : null}
      </div>

      <Link
        href={`/login?lang=${encodeURIComponent(locale)}&workspace=${encodeURIComponent(workspaceSlug)}`}
        className="inline-flex text-sm font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-4"
      >
        {authCopy.backToLogin}
      </Link>
      </div>
    </div>
  );
}
