"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { PimLocale } from "@/lib/locale";
import { BrandLogo } from "@/components/ui/brand-logo";
import { getAuthCopy } from "./auth-copy";

interface PasswordResetPageClientProps {
  locale: PimLocale;
  initialEmail: string;
  initialToken: string;
  initialWorkspaceSlug: string;
}

export function PasswordResetPageClient({
  locale,
  initialEmail,
  initialToken,
  initialWorkspaceSlug,
}: PasswordResetPageClientProps) {
  const authCopy = getAuthCopy(locale);
  const [email, setEmail] = useState(initialEmail);
  const [token] = useState(initialToken);
  const [workspaceSlug, setWorkspaceSlug] = useState(initialWorkspaceSlug);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const isConfirmMode = token.trim().length > 0;
  const loginHref = useMemo(() => {
    const params = new URLSearchParams({ lang: locale });
    if (workspaceSlug.trim()) {
      params.set("workspace", workspaceSlug.trim());
    }
    if (email.trim()) {
      params.set("email", email.trim());
    }
    return `/login?${params.toString()}`;
  }, [email, locale, workspaceSlug]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    setError("");
    try {
      if (isConfirmMode) {
        if (password.trim().length < 8) {
          setError(authCopy.resetError);
          return;
        }
        if (password !== confirmPassword) {
          setError(authCopy.resetPasswordMismatch);
          return;
        }
        const response = await fetch("/api/auth/password-reset/confirm", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            token,
            password,
          }),
          signal: AbortSignal.timeout(15_000),
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              workspaceSlug?: string;
              error?: string;
              message?: string;
              fields?: Array<{ field: string; constraints: string[] }>;
            }
          | null;
        if (!response.ok) {
          if (payload?.error === "VALIDATION_FAILED") {
            const invalidFields = new Set((payload.fields ?? []).map((entry) => entry.field));
            if (invalidFields.has("token")) {
              setError(authCopy.resetInvalidToken);
            } else if (payload.message?.trim()) {
              setError(payload.message);
            } else {
              setError(authCopy.resetError);
            }
            return;
          }
          setError(payload?.error === "PASSWORD_RESET_TOKEN_INVALID" ? authCopy.resetInvalidToken : authCopy.resetError);
          return;
        }
        if (payload?.workspaceSlug) {
          setWorkspaceSlug(String(payload.workspaceSlug));
        }
        setMessage(authCopy.resetCompleteSuccess);
        setPassword("");
        setConfirmPassword("");
        return;
      }

      const response = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: email.trim(),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        setError(authCopy.resetError);
        return;
      }
      setMessage(authCopy.resetSuccess);
    } catch {
      setError(authCopy.resetError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative mx-auto max-w-md overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/95 p-6 shadow-[0_28px_70px_rgba(148,163,184,0.18)] backdrop-blur">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.18),_rgba(255,255,255,0)_60%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.12),_rgba(255,255,255,0)_52%)]" />
      <div className="relative space-y-5">
      <header className="space-y-4 rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(248,250,252,0.92))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
        <BrandLogo variant="lockup" className="mb-0" />
        <div className="space-y-2">
          <h1 className="text-[2rem] font-semibold tracking-tight text-slate-950">{authCopy.resetTitle}</h1>
          <p className="text-sm leading-6 text-slate-600">{isConfirmMode ? authCopy.resetTokenSubtitle : authCopy.resetSubtitle}</p>
        </div>
      </header>

      <form className="space-y-4" onSubmit={onSubmit}>
        {!isConfirmMode ? (
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {authCopy.emailLabel}
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-xl border border-slate-300/90 bg-white px-3 py-3 text-sm text-slate-900 shadow-[inset_0_1px_2px_rgba(15,23,42,0.03)] outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
            />
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {authCopy.newPasswordLabel}
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl border border-slate-300/90 bg-white px-3 py-3 text-sm text-slate-900 shadow-[inset_0_1px_2px_rgba(15,23,42,0.03)] outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="confirmPassword" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {authCopy.confirmPasswordLabel}
              </label>
              <input
                id="confirmPassword"
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="w-full rounded-xl border border-slate-300/90 bg-white px-3 py-3 text-sm text-slate-900 shadow-[inset_0_1px_2px_rgba(15,23,42,0.03)] outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
              />
            </div>
          </>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-slate-900 px-3 py-3 text-sm font-semibold text-white shadow-[0_18px_36px_rgba(15,23,42,0.22)] transition hover:bg-slate-800 disabled:opacity-60"
        >
          {submitting
            ? isConfirmMode
              ? authCopy.resetConfirming
              : authCopy.resetSubmitting
            : isConfirmMode
              ? authCopy.resetConfirmSubmit
              : authCopy.resetSubmit}
        </button>

        {message && (
          <p className="rounded-xl border border-green-300/80 bg-green-50 px-4 py-3 text-sm text-green-800 shadow-[0_10px_24px_rgba(34,197,94,0.08)]">
            {message}
          </p>
        )}
        {error && (
          <p className="rounded-xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-[0_10px_24px_rgba(239,68,68,0.08)]">
            {error}
          </p>
        )}
      </form>

      <Link
        href={loginHref}
        className="inline-flex text-sm font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-4"
      >
        {authCopy.backToLogin}
      </Link>
      </div>
    </div>
  );
}
