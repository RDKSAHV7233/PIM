"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { PimLocale } from "@/lib/locale";
import { BrandLogo } from "@/components/ui/brand-logo";
import { getAuthCopy } from "./auth-copy";

interface SignupVerifyPageClientProps {
  locale: PimLocale;
  initialToken: string;
  initialEmail: string;
  initialWorkspaceSlug: string;
}

type VerifyState = "idle" | "verifying" | "success" | "invalid";

export function SignupVerifyPageClient({
  locale,
  initialToken,
  initialEmail,
  initialWorkspaceSlug,
}: SignupVerifyPageClientProps) {
  const authCopy = getAuthCopy(locale);
  const [verifyState, setVerifyState] = useState<VerifyState>(initialToken ? "verifying" : "invalid");
  const [email, setEmail] = useState(initialEmail);
  const [workspaceSlug, setWorkspaceSlug] = useState(initialWorkspaceSlug);
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const verificationStarted = useRef(false);

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

  useEffect(() => {
    if (!initialToken || verificationStarted.current) {
      if (!initialToken) {
        setVerifyState("invalid");
      }
      return;
    }
    verificationStarted.current = true;

    void (async () => {
      setVerifyState("verifying");
      setError("");
      try {
        const response = await fetch("/api/signup/verify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            token: initialToken,
          }),
        });
        const payload = (await response.json().catch(() => null)) as
          | { workspaceSlug?: string; userId?: string; error?: string }
          | null;
        if (!response.ok) {
          setVerifyState("invalid");
          setError(authCopy.signupVerifyInvalid);
          return;
        }
        if (payload?.workspaceSlug) {
          setWorkspaceSlug(String(payload.workspaceSlug));
        }
        if (payload?.userId) {
          setEmail(String(payload.userId));
        }
        setVerifyState("success");
      } catch {
        setVerifyState("invalid");
        setError(authCopy.networkError);
      }
    })();
  }, [authCopy.networkError, authCopy.signupVerifyInvalid, initialToken]);

  async function onResend() {
    setResending(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/signup/resend-verification", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          adminEmail: email.trim().toLowerCase(),
        }),
      });
      if (!response.ok) {
        setError(authCopy.signupResendError);
        return;
      }
      setMessage(authCopy.signupResendSuccess);
    } catch {
      setError(authCopy.signupResendError);
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="relative mx-auto max-w-[28rem] overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/95 p-6 shadow-[0_28px_70px_rgba(148,163,184,0.18)] backdrop-blur">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.18),_rgba(255,255,255,0)_60%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.12),_rgba(255,255,255,0)_52%)]" />
      <div className="relative space-y-5">
      <header className="space-y-4 rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(248,250,252,0.92))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
        <BrandLogo variant="lockup" className="mb-0" />
        <div className="space-y-2">
          <h1 className="text-[1.95rem] font-semibold tracking-tight text-slate-950">{authCopy.signupVerifyTitle}</h1>
          <p className="text-sm leading-6 text-slate-600">{authCopy.signupVerifySubtitle}</p>
        </div>
      </header>

      {verifyState === "verifying" ? (
        <p className="rounded-xl border border-slate-200/80 bg-slate-50/90 px-4 py-3 text-sm text-slate-700 shadow-[0_10px_24px_rgba(148,163,184,0.08)]">
          {authCopy.signupVerifyInProgress}
        </p>
      ) : null}

      {verifyState === "success" ? (
        <div className="space-y-4">
          <p className="rounded-xl border border-green-300/80 bg-green-50 px-4 py-3 text-sm text-green-800 shadow-[0_10px_24px_rgba(34,197,94,0.08)]">
            {authCopy.signupVerifySuccess}
          </p>
          <div className="rounded-xl border border-slate-200/90 bg-slate-50/90 px-4 py-4 text-sm leading-6 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
            <p>
              <strong>{authCopy.workspaceLabel}:</strong> {workspaceSlug || "Pending workspace"}
            </p>
            <p>
              <strong>{authCopy.emailLabel}:</strong> {email || "Pending email"}
            </p>
          </div>
          <Link href={loginHref} className="inline-flex rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-[0_18px_36px_rgba(15,23,42,0.22)]">
            {authCopy.signIn}
          </Link>
        </div>
      ) : null}

      {verifyState === "invalid" ? (
        <div className="space-y-4">
          <p className="rounded-xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-[0_10px_24px_rgba(239,68,68,0.08)]">
            {error || authCopy.signupVerifyInvalid}
          </p>
          <div className="space-y-3">
            <p className="text-sm leading-6 text-slate-600">{authCopy.signupResendPrompt}</p>
            <div className="space-y-1.5">
              <label htmlFor="resend-email" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {authCopy.emailLabel}
              </label>
              <input
                id="resend-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-xl border border-slate-300/90 bg-white px-3 py-3 text-sm text-slate-900 shadow-[inset_0_1px_2px_rgba(15,23,42,0.03)] outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
              />
            </div>
            <button
              type="button"
              onClick={() => void onResend()}
              disabled={resending || !email.trim()}
              className="w-full rounded-xl bg-slate-900 px-3 py-3 text-sm font-semibold text-white shadow-[0_18px_36px_rgba(15,23,42,0.22)] transition hover:bg-slate-800 disabled:opacity-60"
            >
              {resending ? authCopy.signupResendSubmitting : authCopy.signupResendSubmit}
            </button>
            {message ? (
              <p className="rounded-xl border border-green-300/80 bg-green-50 px-4 py-3 text-sm text-green-800 shadow-[0_10px_24px_rgba(34,197,94,0.08)]">
                {message}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

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
