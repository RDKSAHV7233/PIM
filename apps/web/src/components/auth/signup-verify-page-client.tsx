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
    <div className="mx-auto max-w-md space-y-5 rounded-lg border border-slate-200 bg-white p-6">
      <header className="space-y-1">
        <BrandLogo variant="lockup" className="mb-3" />
        <h1 className="text-2xl font-semibold text-slate-900">{authCopy.signupVerifyTitle}</h1>
        <p className="text-sm text-slate-600">{authCopy.signupVerifySubtitle}</p>
      </header>

      {verifyState === "verifying" ? (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {authCopy.signupVerifyInProgress}
        </p>
      ) : null}

      {verifyState === "success" ? (
        <div className="space-y-4">
          <p className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
            {authCopy.signupVerifySuccess}
          </p>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
            <p>
              <strong>{authCopy.workspaceLabel}:</strong> {workspaceSlug || "Pending workspace"}
            </p>
            <p>
              <strong>{authCopy.emailLabel}:</strong> {email || "Pending email"}
            </p>
          </div>
          <Link href={loginHref} className="inline-flex rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
            {authCopy.signIn}
          </Link>
        </div>
      ) : null}

      {verifyState === "invalid" ? (
        <div className="space-y-4">
          <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error || authCopy.signupVerifyInvalid}
          </p>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">{authCopy.signupResendPrompt}</p>
            <div className="space-y-1">
              <label htmlFor="resend-email" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {authCopy.emailLabel}
              </label>
              <input
                id="resend-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={() => void onResend()}
              disabled={resending || !email.trim()}
              className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {resending ? authCopy.signupResendSubmitting : authCopy.signupResendSubmit}
            </button>
            {message ? <p className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{message}</p> : null}
          </div>
        </div>
      ) : null}

      <Link href={loginHref} className="inline-flex text-sm font-medium text-slate-700 underline">
        {authCopy.backToLogin}
      </Link>
    </div>
  );
}
