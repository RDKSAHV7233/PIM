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
        if (payload?.error === "ADMIN_EMAIL_ALREADY_REGISTERED" || payload?.error === "SIGNUP_VERIFICATION_ALREADY_PENDING") {
          setError(authCopy.signupDuplicateEmail);
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
      setError(authCopy.genericLoginFailure);
    } catch {
      setError(authCopy.networkError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-5 rounded-lg border border-slate-200 bg-white p-6">
      <header className="space-y-1">
        <BrandLogo variant="lockup" className="mb-3" />
        <h1 className="text-2xl font-semibold text-slate-900">{authCopy.signupTitle}</h1>
        <p className="text-sm text-slate-600">{authCopy.signupSubtitle}</p>
      </header>

      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="space-y-1">
          <label htmlFor="display-name" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {authCopy.displayNameLabel}
          </label>
          <input
            id="display-name"
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="workspace" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
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
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          {availabilityMessage ? (
            <p
              className={`text-xs ${
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

        <div className="space-y-1">
          <label htmlFor="admin-email" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {authCopy.emailLabel}
          </label>
          <input
            id="admin-email"
            type="email"
            value={adminEmail}
            onChange={(event) => setAdminEmail(event.target.value)}
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="password" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {authCopy.passwordLabel}
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <p className="text-xs text-slate-600">{authCopy.signupPasswordHelp}</p>
          </div>
          <div className="space-y-1">
            <label htmlFor="confirm-password" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {authCopy.confirmPasswordLabel}
            </label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={8}
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
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
          className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {submitting ? authCopy.signupSubmitting : authCopy.signupSubmit}
        </button>

        {success ? <p className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{success}</p> : null}
        {error ? <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      </form>

      <Link href={loginHref} className="inline-flex text-sm font-medium text-slate-700 underline">
        {authCopy.backToLogin}
      </Link>
    </div>
  );
}
