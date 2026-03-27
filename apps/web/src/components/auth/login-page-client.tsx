"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { sanitizeNextPath } from "@/lib/auth-redirect";
import { PimLocale } from "@/lib/locale";
import { BrandLogo } from "@/components/ui/brand-logo";
import { getAuthCopy } from "./auth-copy";

function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, totalSeconds);
  const minutesPart = Math.floor(seconds / 60);
  const secondsPart = seconds % 60;
  return `${minutesPart}:${String(secondsPart).padStart(2, "0")}`;
}

interface LoginPageClientProps {
  locale: PimLocale;
  reason: string;
  nextPath: string;
  initialWorkspaceSlug: string;
  signupEnabled: boolean;
}

function isValidWorkspaceSlug(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) && normalized.length >= 3 && normalized.length <= 32;
}

export function LoginPageClient({ locale, reason, nextPath, initialWorkspaceSlug, signupEnabled }: LoginPageClientProps) {
  const authCopy = getAuthCopy(locale);
  const router = useRouter();
  const [workspaceSlug, setWorkspaceSlug] = useState(initialWorkspaceSlug);
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const [rateLimitedUntilMs, setRateLimitedUntilMs] = useState<number | null>(null);
  const [rateLimitCountdown, setRateLimitCountdown] = useState<number>(0);

  useEffect(() => {
    if (!rateLimitedUntilMs) {
      setRateLimitCountdown(0);
      return;
    }
    const update = () => {
      const remaining = Math.ceil((rateLimitedUntilMs - Date.now()) / 1000);
      setRateLimitCountdown(Math.max(0, remaining));
      if (remaining <= 0) {
        setRateLimitedUntilMs(null);
      }
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [rateLimitedUntilMs]);

  const isRateLimited = rateLimitedUntilMs !== null && rateLimitCountdown > 0;
  const showRateLimitCountdown = isRateLimited && rateLimitCountdown <= 15 * 60;
  const safeNextPath = useMemo(() => sanitizeNextPath(nextPath), [nextPath]);
  const loginReasonMessage = useMemo(() => {
    if (reason === "tenant_suspended") {
      return authCopy.loginReasonTenantSuspended;
    }
    if (reason === "forbidden") {
      return authCopy.loginReasonForbidden;
    }
    if (reason === "session_expired") {
      return authCopy.loginReasonSessionExpired;
    }
    return "";
  }, [authCopy.loginReasonForbidden, authCopy.loginReasonSessionExpired, authCopy.loginReasonTenantSuspended, reason]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedWorkspaceSlug = workspaceSlug.trim().toLowerCase();
    if (!isValidWorkspaceSlug(normalizedWorkspaceSlug)) {
      setErrorMessage(authCopy.workspaceInvalid);
      setAttemptsRemaining(null);
      setRateLimitedUntilMs(null);
      return;
    }
    setSubmitting(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspaceSlug: normalizedWorkspaceSlug,
          userId: userId.trim(),
          password,
        }),
      });

      if (response.ok) {
        await response.json().catch(() => ({}));
        setAttemptsRemaining(null);
        setRateLimitedUntilMs(null);
        window.location.assign(safeNextPath);
        return;
      }

      if (response.status === 429) {
        const retryAfterHeader = response.headers.get("x-ratelimit-retry-after");
        const retryAfterSeconds = Math.max(1, Number.parseInt(retryAfterHeader ?? "60", 10) || 60);
        setRateLimitedUntilMs(Date.now() + retryAfterSeconds * 1000);
        setAttemptsRemaining(null);
        return;
      }

      if (response.status === 423) {
        const payload = (await response.json()) as { unlockAt?: string; maskedEmail?: string };
        const params = new URLSearchParams({
          workspace: normalizedWorkspaceSlug,
          email: userId.trim(),
          maskedEmail: String(payload.maskedEmail ?? "yo***@example.com"),
          unlockAt: String(payload.unlockAt ?? ""),
          lang: locale,
        });
        router.push(`/login/locked?${params.toString()}`);
        setAttemptsRemaining(null);
        return;
      }

      if (response.status === 401) {
        const payload = (await response.json().catch(() => ({}))) as { attemptsRemaining?: number };
        const remaining = Number(payload.attemptsRemaining);
        setAttemptsRemaining(Number.isFinite(remaining) ? Math.max(0, Math.trunc(remaining)) : null);
        setErrorMessage(authCopy.invalidCredentials);
        return;
      }

      if (response.status === 403) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        if (payload.error === "TENANT_SUSPENDED") {
          setAttemptsRemaining(null);
          setErrorMessage(authCopy.loginReasonTenantSuspended);
          return;
        }
      }

      if (response.status === 404) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        if (payload.error === "WORKSPACE_NOT_FOUND") {
          setAttemptsRemaining(null);
          setErrorMessage(authCopy.workspaceNotFound);
          return;
        }
      }

      setErrorMessage(authCopy.genericLoginFailure);
    } catch {
      setErrorMessage(authCopy.networkError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="mx-auto max-w-md space-y-5 rounded-lg border border-slate-200 bg-white p-6"
      suppressHydrationWarning
    >
      <header className="space-y-1">
        <BrandLogo variant="lockup" className="mb-3" />
        <h1 className="text-2xl font-semibold text-slate-900">{authCopy.loginTitle}</h1>
        <p className="text-sm text-slate-600">{authCopy.loginSubtitle}</p>
        {signupEnabled ? (
          <p className="text-sm text-slate-600">
            {authCopy.signupLinkPrompt}{" "}
            <Link href={`/signup?lang=${encodeURIComponent(locale)}`} className="font-medium underline">
              {authCopy.signupLinkCta}
            </Link>
            .
          </p>
        ) : null}
      </header>
      {loginReasonMessage ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {loginReasonMessage}
        </div>
      ) : null}

      {isRateLimited ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">{authCopy.rateLimitedTitle}</p>
          <p className="mt-1">{authCopy.rateLimitedBody}</p>
          {showRateLimitCountdown && (
            <p className="mt-1">
              {authCopy.rateLimitedRetryIn} <strong>{formatCountdown(rateLimitCountdown)}</strong>
            </p>
          )}
        </div>
      ) : (
        <form className="space-y-4" onSubmit={onSubmit} suppressHydrationWarning>
          <div className="space-y-1">
            <label htmlFor="workspace" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {authCopy.workspaceLabel}
            </label>
            <input
              id="workspace"
              type="text"
              value={workspaceSlug}
              onChange={(event) => setWorkspaceSlug(event.target.value)}
              autoComplete="organization"
              required
              placeholder={authCopy.workspacePlaceholder}
              suppressHydrationWarning
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="user-id" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {authCopy.emailLabel}
            </label>
            <input
              id="user-id"
              type="text"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              autoComplete="username"
              required
              suppressHydrationWarning
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="password" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {authCopy.passwordLabel}
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              suppressHydrationWarning
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            suppressHydrationWarning
            className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {submitting ? authCopy.signingIn : authCopy.signIn}
          </button>

          {errorMessage && (
            <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{errorMessage}</p>
          )}
          {typeof attemptsRemaining === "number" && attemptsRemaining <= 2 && (
            <p className="text-xs text-slate-600">
              {authCopy.forgotPasswordPrefix}{" "}
              <Link
                href={`/login/reset?lang=${encodeURIComponent(locale)}&email=${encodeURIComponent(userId.trim())}&workspace=${encodeURIComponent(workspaceSlug.trim().toLowerCase())}`}
                className="underline"
              >
                {authCopy.forgotPasswordSuffix}
              </Link>
              .
            </p>
          )}
        </form>
      )}
    </div>
  );
}
