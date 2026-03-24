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
        });
        const payload = (await response.json().catch(() => null)) as { workspaceSlug?: string; error?: string } | null;
        if (!response.ok) {
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
    <div className="mx-auto max-w-md space-y-5 rounded-lg border border-slate-200 bg-white p-6">
      <header className="space-y-1">
        <BrandLogo variant="lockup" className="mb-3" />
        <h1 className="text-2xl font-semibold text-slate-900">{authCopy.resetTitle}</h1>
        <p className="text-sm text-slate-600">{isConfirmMode ? authCopy.resetTokenSubtitle : authCopy.resetSubtitle}</p>
      </header>

      <form className="space-y-4" onSubmit={onSubmit}>
        {!isConfirmMode ? (
          <div className="space-y-1">
            <label htmlFor="email" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {authCopy.emailLabel}
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <label htmlFor="password" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {authCopy.newPasswordLabel}
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="confirmPassword" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {authCopy.confirmPasswordLabel}
              </label>
              <input
                id="confirmPassword"
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {submitting
            ? isConfirmMode
              ? authCopy.resetConfirming
              : authCopy.resetSubmitting
            : isConfirmMode
              ? authCopy.resetConfirmSubmit
              : authCopy.resetSubmit}
        </button>

        {message && <p className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{message}</p>}
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      </form>

      <Link href={loginHref} className="inline-flex text-sm font-medium text-slate-700 underline">
        {authCopy.backToLogin}
      </Link>
    </div>
  );
}
