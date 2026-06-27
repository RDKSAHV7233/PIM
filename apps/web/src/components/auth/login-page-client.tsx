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
    if (!initialWorkspaceSlug) {
      try {
        const saved = localStorage.getItem("pim_last_workspace");
        if (saved) setWorkspaceSlug(saved);
      } catch {
        // localStorage unavailable (SSR guard, private browsing restrictions)
      }
    }
  }, [initialWorkspaceSlug]);

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

    // Explicit empty-field guards — React controlled inputs do not participate
    // in the browser's built-in :required constraint validation on programmatic
    // submission (e.g. via automation tools or button.click() in JS). These
    // guards make failure visible with a clear error message rather than
    // silently firing a POST with empty credentials and getting a generic 401.
    if (userId.trim() === "") {
      setErrorMessage("User ID is required.");
      setAttemptsRemaining(null);
      setRateLimitedUntilMs(null);
      return;
    }
    if (password === "") {
      setErrorMessage("Password is required.");
      setAttemptsRemaining(null);
      setRateLimitedUntilMs(null);
      return;
    }

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
        signal: AbortSignal.timeout(15_000),
      });

      if (response.ok) {
        await response.json().catch(() => ({}));
        setAttemptsRemaining(null);
        setRateLimitedUntilMs(null);
        try { localStorage.setItem("pim_last_workspace", normalizedWorkspaceSlug); } catch { /* ignore */ }
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
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          attemptsRemaining?: number;
          mfaPendingToken?: string;
          maskedEmail?: string;
        };
        if (payload.error === "MFA_REQUIRED") {
          const mfaParams = new URLSearchParams({
            email: payload.maskedEmail ?? "",
            workspace: normalizedWorkspaceSlug,
            lang: locale,
          });
          if (safeNextPath && safeNextPath !== "/dashboard") {
            mfaParams.set("next", safeNextPath);
          }
          router.push(`/login/mfa?${mfaParams.toString()}`);
          return;
        }
        const remaining = Number(payload.attemptsRemaining);
        setAttemptsRemaining(Number.isFinite(remaining) ? Math.max(0, Math.trunc(remaining)) : null);
        setErrorMessage(authCopy.invalidCredentials);
        return;
      }

      if (response.status === 403) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          enrollmentToken?: string;
          maskedEmail?: string;
          allowedMethods?: string[];
        };
        if (payload.error === "MFA_ENROLLMENT_REQUIRED") {
          const enrollParams = new URLSearchParams({
            email: payload.maskedEmail ?? "",
            workspace: normalizedWorkspaceSlug,
            lang: locale,
          });
          if (safeNextPath && safeNextPath !== "/dashboard") {
            enrollParams.set("next", safeNextPath);
          }
          router.push(`/login/enroll?${enrollParams.toString()}`);
          return;
        }
        if (payload.error === "TENANT_SUSPENDED") {
          setAttemptsRemaining(null);
          setErrorMessage(authCopy.loginReasonTenantSuspended);
          return;
        }
        if (payload.error === "AUTH_METHOD_NOT_ALLOWED") {
          setAttemptsRemaining(null);
          setErrorMessage(authCopy.authMethodNotAllowed);
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

      if (response.status === 503) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        if (payload.error === "AUTH_UPSTREAM_UNAVAILABLE") {
          setAttemptsRemaining(null);
          setErrorMessage(authCopy.loginServiceUnavailable);
          return;
        }
      }

      setErrorMessage(authCopy.genericLoginFailure);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setErrorMessage(authCopy.loginServiceUnavailable);
      } else {
        setErrorMessage(authCopy.networkError);
      }
    } finally {
      setSubmitting(false);
    }
  }

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
          <h1 className="text-[1.85rem] font-semibold tracking-tight text-slate-950 md:text-[2rem]">{authCopy.loginTitle}</h1>
        </div>
      </header>
      {loginReasonMessage ? (
        <div className="rounded-xl border border-amber-300/80 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-[0_10px_24px_rgba(245,158,11,0.08)]">
          {loginReasonMessage}
        </div>
      ) : null}

      {isRateLimited ? (
        <div className="rounded-xl border border-amber-300/80 bg-amber-50 p-4 text-sm text-amber-900 shadow-[0_10px_24px_rgba(245,158,11,0.08)]">
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
          <div className="space-y-1.5">
            <label htmlFor="workspace" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {authCopy.workspaceLabel}
            </label>
            <input
              id="workspace"
              data-testid="workspace"
              type="text"
              value={workspaceSlug}
              onChange={(event) => setWorkspaceSlug(event.target.value)}
              autoComplete="off"
              required
              placeholder={authCopy.workspacePlaceholder}
              suppressHydrationWarning
              className="w-full rounded-xl border border-slate-300/90 bg-white px-3 py-3 text-sm text-slate-900 shadow-[inset_0_1px_2px_rgba(15,23,42,0.03)] outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="user-id" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {authCopy.emailLabel}
            </label>
            <input
              id="user-id"
              data-testid="user-id"
              type="email"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              autoComplete="email"
              required
              suppressHydrationWarning
              className="w-full rounded-xl border border-slate-300/90 bg-white px-3 py-3 text-sm text-slate-900 shadow-[inset_0_1px_2px_rgba(15,23,42,0.03)] outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {authCopy.passwordLabel}
            </label>
            <input
              id="password"
              data-testid="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              suppressHydrationWarning
              className="w-full rounded-xl border border-slate-300/90 bg-white px-3 py-3 text-sm text-slate-900 shadow-[inset_0_1px_2px_rgba(15,23,42,0.03)] outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
            />
          </div>

          <button
            type="submit"
            data-testid="login-submit"
            disabled={submitting}
            suppressHydrationWarning
            className="w-full rounded-xl bg-slate-900 px-3 py-3 text-sm font-semibold text-white shadow-[0_18px_36px_rgba(15,23,42,0.22)] transition hover:bg-slate-800 disabled:opacity-60"
          >
            {submitting ? authCopy.signingIn : authCopy.signIn}
          </button>

          {errorMessage && (
            <div className="rounded-xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-[0_10px_24px_rgba(239,68,68,0.08)]">
              <p>{errorMessage}</p>
              {attemptsRemaining !== null && attemptsRemaining <= 3 && (
                <p className="mt-1 text-xs font-medium">
                  {attemptsRemaining === 1
                    ? "1 attempt remaining before your account is temporarily locked."
                    : `${attemptsRemaining} attempts remaining before your account is temporarily locked.`}
                </p>
              )}
            </div>
          )}
          <p className="text-xs leading-5 text-slate-600">
            {authCopy.forgotPasswordPrefix}{" "}
            <Link
              href={`/login/reset?lang=${encodeURIComponent(locale)}&email=${encodeURIComponent(userId.trim())}&workspace=${encodeURIComponent(workspaceSlug.trim().toLowerCase())}`}
              className="font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-4"
            >
              {authCopy.forgotPasswordSuffix}
            </Link>
            .
          </p>

          <div className="space-y-2 pt-1 text-center">
            <p className="text-xs leading-5 text-slate-500">{authCopy.loginSubtitle}</p>
            {signupEnabled ? (
              <p className="text-sm leading-6 text-slate-600">
                {authCopy.signupLinkPrompt}{" "}
                <Link
                  href={`/signup?lang=${encodeURIComponent(locale)}`}
                  className="font-semibold text-indigo-600 underline decoration-indigo-200 underline-offset-4"
                >
                  {authCopy.signupLinkCta}
                </Link>
                .
              </p>
            ) : null}
          </div>
        </form>
      )}
      </div>
    </div>
  );
}
