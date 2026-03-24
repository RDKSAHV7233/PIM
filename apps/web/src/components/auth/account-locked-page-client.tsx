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
    return unlockAt.toLocaleTimeString();
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
    <div className="mx-auto max-w-md space-y-5 rounded-lg border border-red-200 bg-white p-6">
      <header className="space-y-2">
        <BrandLogo variant="lockup" className="mb-3" />
        <h1 className="text-2xl font-semibold text-slate-900">{authCopy.lockedTitle}</h1>
        <p className="text-sm text-slate-700">
          <strong>{maskedEmail}</strong> {authCopy.lockedBodyPrefix}.
        </p>
        {lockedUntilText && (
          <p className="text-sm text-slate-600">
            {authCopy.lockedUntilPrefix} <strong>{lockedUntilText}</strong>.
          </p>
        )}
      </header>

      <div className="space-y-3">
        <button
          type="button"
          disabled={submitting}
          onClick={resendUnlock}
          className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {authCopy.resendUnlock}
        </button>
        {message && <p className="text-sm text-slate-700">{message}</p>}
      </div>

      <Link
        href={`/login?lang=${encodeURIComponent(locale)}&workspace=${encodeURIComponent(workspaceSlug)}`}
        className="inline-flex text-sm font-medium text-slate-700 underline"
      >
        {authCopy.backToLogin}
      </Link>
    </div>
  );
}
