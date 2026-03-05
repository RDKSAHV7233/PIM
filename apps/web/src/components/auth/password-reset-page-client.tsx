"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { PimLocale } from "@/lib/locale";
import { getAuthCopy } from "./auth-copy";

interface PasswordResetPageClientProps {
  locale: PimLocale;
  initialEmail: string;
}

export function PasswordResetPageClient({ locale, initialEmail }: PasswordResetPageClientProps) {
  const authCopy = getAuthCopy(locale);
  const [email, setEmail] = useState(initialEmail);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    setError("");
    try {
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
        <h1 className="text-2xl font-semibold text-slate-900">{authCopy.resetTitle}</h1>
        <p className="text-sm text-slate-600">{authCopy.resetSubtitle}</p>
      </header>

      <form className="space-y-4" onSubmit={onSubmit}>
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

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {submitting ? authCopy.resetSubmitting : authCopy.resetSubmit}
        </button>

        {message && <p className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{message}</p>}
        {error && <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      </form>

      <Link href={`/login?lang=${encodeURIComponent(locale)}`} className="inline-flex text-sm font-medium text-slate-700 underline">
        {authCopy.backToLogin}
      </Link>
    </div>
  );
}
