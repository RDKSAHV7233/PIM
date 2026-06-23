"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { PimLocale } from "@/lib/locale";
import { BrandLogo } from "@/components/ui/brand-logo";
import { getAuthCopy } from "./auth-copy";

interface SignupPageClientProps {
  locale: PimLocale;
  initialWorkspaceSlug: string;
  initialEmail: string;
}

type AvailabilityState = "idle" | "checking" | "available" | "taken";

function normalizeWorkspaceSlugInput(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function isValidWorkspaceSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length >= 3 && value.length <= 32;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function SignupPageClient({ locale, initialWorkspaceSlug, initialEmail }: SignupPageClientProps) {
  const authCopy = getAuthCopy(locale);
  const [displayName, setDisplayName] = useState("");
  const [workspaceSlug, setWorkspaceSlug] = useState(initialWorkspaceSlug);
  const [adminEmail, setAdminEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [availability, setAvailability] = useState<AvailabilityState>("idle");
  const [availabilityMessage, setAvailabilityMessage] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loginHref = useMemo(() => {
    const params = new URLSearchParams({ lang: locale });
    if (workspaceSlug.trim()) {
      params.set("workspace", workspaceSlug.trim());
    }
    if (adminEmail.trim()) {
      params.set("email", adminEmail.trim());
    }
    return `/login?${params.toString()}`;
  }, [adminEmail, locale, workspaceSlug]);

  async function checkAvailability(nextSlug?: string) {
    const normalizedWorkspaceSlug = normalizeWorkspaceSlugInput(nextSlug ?? workspaceSlug);
    if (!isValidWorkspaceSlug(normalizedWorkspaceSlug)) {
      setAvailability("idle");
      setAvailabilityMessage(authCopy.workspaceInvalid);
      return;
    }

    setAvailability("checking");
    setAvailabilityMessage(authCopy.workspaceChecking);
    try {
      const response = await fetch(
        `/api/signup/workspace/availability?workspaceSlug=${encodeURIComponent(normalizedWorkspaceSlug)}`,
        {
          method: "GET",
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        },
      );
      const payload = (await response.json().catch(() => null)) as { available?: boolean; reason?: string; error?: string } | null;
      if (!response.ok) {
        setAvailability("idle");
        setAvailabilityMessage(payload?.error === "WORKSPACE_SLUG_INVALID" ? authCopy.workspaceInvalid : authCopy.genericLoginFailure);
        return;
      }
      if (payload?.available) {
        setAvailability("available");
        setAvailabilityMessage(authCopy.workspaceAvailable);
        return;
      }
      setAvailability("taken");
      setAvailabilityMessage(authCopy.workspaceTaken);
    } catch {
      setAvailability("idle");
      setAvailabilityMessage(authCopy.networkError);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedWorkspaceSlug = normalizeWorkspaceSlugInput(workspaceSlug);
    const normalizedEmail = adminEmail.trim().toLowerCase();

    setWorkspaceSlug(normalizedWorkspaceSlug);
    setAdminEmail(normalizedEmail);
    setError("");
    setSuccess("");

    if (!displayName.trim()) {
      setError(authCopy.signupDisplayNameRequired);
      return;
    }
    if (!isValidWorkspaceSlug(normalizedWorkspaceSlug)) {
      setError(authCopy.workspaceInvalid);
      return;
    }
    if (!isValidEmail(normalizedEmail)) {
      setError(authCopy.signupEmailInvalid);
      return;
    }
    if (password.trim().length < 8) {
      setError(authCopy.signupPasswordHelp);
      return;
    }
    if (password !== confirmPassword) {
      setError(authCopy.signupPasswordMismatch);
      return;
    }
    if (!acceptedTerms) {
      setError(authCopy.signupTermsLabel);
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/signup/workspace", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          displayName: displayName.trim(),
          workspaceSlug: normalizedWorkspaceSlug,
          adminEmail: normalizedEmail,
          password,
          acceptedTerms,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const payload = (await response.json().catch(() => null)) as
        | { status?: string; error?: string; retryAfterSeconds?: number }
        | null;

      if (response.ok) {
        setSuccess(authCopy.signupSuccess);
        setAvailability("idle");
        setAvailabilityMessage("");
        setPassword("");
        setConfirmPassword("");
        return;
      }

      if (response.status === 409) {
        if (payload?.error === "ADMIN_EMAIL_ALREADY_REGISTERED") {
          setError(authCopy.signupDuplicateEmail);
          return;
        }
        if (payload?.error === "SIGNUP_VERIFICATION_ALREADY_PENDING") {
          setError(authCopy.signupPendingVerification);
          return;
        }
        if (payload?.error === "WORKSPACE_SLUG_ALREADY_ASSIGNED" || payload?.error === "WORKSPACE_SLUG_ALREADY_PENDING") {
          setError(authCopy.workspaceTaken);
          setAvailability("taken");
          setAvailabilityMessage(authCopy.workspaceTaken);
          return;
        }
      }

      if (response.status === 429) {
        setError(
          payload?.retryAfterSeconds
            ? `${authCopy.rateLimitedBody} ${authCopy.rateLimitedRetryIn} ${payload.retryAfterSeconds}s.`
            : authCopy.rateLimitedBody,
        );
        return;
      }

      if (payload?.error === "TERMS_ACCEPTANCE_REQUIRED") {
        setError(authCopy.signupTermsLabel);
        return;
      }
      if (payload?.error === "PASSWORD_TOO_SHORT") {
        setError(authCopy.signupPasswordHelp);
        return;
      }
      if (payload?.error === "WORKSPACE_SLUG_INVALID") {
        setError(authCopy.workspaceInvalid);
        return;
      }
      if (payload?.error === "SIGNUP_VERIFICATION_SEND_FAILED" || payload?.error === "EMAIL_PROVIDER_MISCONFIGURED") {
        setError(authCopy.signupVerificationSendFailed);
        return;
      }
      setError(authCopy.genericLoginFailure);
    } catch {
      setError(authCopy.networkError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative mx-auto max-w-[44rem] overflow-hidden rounded-[32px] border border-slate-200/80 bg-white/95 p-6 md:p-7 shadow-[0_32px_82px_rgba(148,163,184,0.18)] backdrop-blur">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.18),_rgba(255,255,255,0)_58%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.14),_rgba(255,255,255,0)_50%)]" />
      <div className="relative space-y-6">
      <header className="space-y-4 rounded-[26px] border border-slate-200/80 bg-[linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(248,250,252,0.92))] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
        <BrandLogo variant="lockup" className="mb-0" />
        <div className="space-y-2">
          <h1 className="text-[2.15rem] font-semibold tracking-tight text-slate-950">{authCopy.signupTitle}</h1>
          <p className="max-w-2xl text-sm leading-6 text-slate-600">{authCopy.signupSubtitle}</p>
        </div>
      </header>

      {success ? (
        <div className="space-y-4">
          <p className="rounded-xl border border-green-300/80 bg-green-50 px-4 py-3 text-sm text-green-800 shadow-[0_10px_24px_rgba(34,197,94,0.08)]">
            {success}
          </p>
          <div className="rounded-xl border border-slate-200/90 bg-slate-50/90 px-4 py-4 text-sm leading-6 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
            <p>
              <strong>{authCopy.emailLabel}:</strong> {adminEmail}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Click the link in the email to verify your account. Check your spam folder if it doesn{"'"}t arrive within a minute.
            </p>
          </div>
          <Link
            href={loginHref}
            className="inline-flex w-full justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-[0_18px_36px_rgba(15,23,42,0.22)] transition hover:bg-slate-800"
          >
            Go to sign in
          </Link>
        </div>
      ) : (
        <form className="space-y-5" onSubmit={onSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="display-name" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {authCopy.displayNameLabel}
            </label>
            <input
              id="display-name"
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
              className="w-full rounded-xl border border-slate-300/90 bg-white px-3 py-3 text-sm text-slate-900 shadow-[inset_0_1px_2px_rgba(15,23,42,0.03)] outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="admin-email" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {authCopy.emailLabel}
            </label>
            <input
              id="admin-email"
              type="email"
              value={adminEmail}
              onChange={(event) => setAdminEmail(event.target.value)}
              required
              className="w-full rounded-xl border border-slate-300/90 bg-white px-3 py-3 text-sm text-slate-900 shadow-[inset_0_1px_2px_rgba(15,23,42,0.03)] outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
            />
          </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="workspace" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {authCopy.workspaceLabel}
            </label>
            <input
              id="workspace"
              type="text"
              value={workspaceSlug}
              onChange={(event) => {
                setWorkspaceSlug(normalizeWorkspaceSlugInput(event.target.value));
                setAvailability("idle");
                setAvailabilityMessage("");
              }}
              onBlur={() => void checkAvailability()}
              required
              placeholder={authCopy.workspacePlaceholder}
              className="w-full rounded-xl border border-slate-300/90 bg-white px-3 py-3 text-sm text-slate-900 shadow-[inset_0_1px_2px_rgba(15,23,42,0.03)] outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
            />
            {availabilityMessage ? (
              <p
                className={`text-xs leading-5 ${
                  availability === "available"
                    ? "text-green-700"
                    : availability === "taken"
                      ? "text-red-700"
                      : "text-slate-600"
                }`}
              >
                {availabilityMessage}
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {authCopy.passwordLabel}
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                required
                className="w-full rounded-xl border border-slate-300/90 bg-white px-3 py-3 text-sm text-slate-900 shadow-[inset_0_1px_2px_rgba(15,23,42,0.03)] outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
              />
              <p className="text-xs leading-5 text-slate-600">{authCopy.signupPasswordHelp}</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="confirm-password" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {authCopy.confirmPasswordLabel}
              </label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={8}
                required
                className="w-full rounded-xl border border-slate-300/90 bg-white px-3 py-3 text-sm text-slate-900 shadow-[inset_0_1px_2px_rgba(15,23,42,0.03)] outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px] md:items-end">
            <label className="flex items-start gap-3 rounded-xl border border-slate-200/90 bg-slate-50/90 px-4 py-3 text-sm leading-6 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(event) => setAcceptedTerms(event.target.checked)}
                className="mt-0.5"
              />
              <span>{authCopy.signupTermsLabel}</span>
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-slate-900 px-3 py-3 text-sm font-semibold text-white shadow-[0_18px_36px_rgba(15,23,42,0.22)] transition hover:bg-slate-800 disabled:opacity-60"
            >
              {submitting ? authCopy.signupSubmitting : authCopy.signupSubmit}
            </button>
          </div>

          {error ? (
            <p className="rounded-xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-[0_10px_24px_rgba(239,68,68,0.08)]">
              {error}
            </p>
          ) : null}
        </form>
      )}

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
