"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { BrandLogo } from "@/components/ui/brand-logo";
import { readCsrfCookie } from "@/lib/csrf";

export function ConsentPageClient() {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");

    try {
      const csrfToken = readCsrfCookie();
      const response = await fetch("/api/auth/consent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify({
          accepted,
          policyVersion: "dpdp-v1",
          purpose: "catalog_operations",
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        if (response.status === 401) {
          setMessage("Session expired. Please login again.");
          return;
        }
        setMessage(payload.error ?? "Unable to record consent.");
        return;
      }

      router.push("/");
    } catch {
      setMessage("Network error while recording consent.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative mx-auto max-w-xl overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/95 p-6 shadow-[0_28px_70px_rgba(148,163,184,0.18)] backdrop-blur">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.18),_rgba(255,255,255,0)_60%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.12),_rgba(255,255,255,0)_52%)]" />
      <div className="relative space-y-5">
      <header className="space-y-4 rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(248,250,252,0.92))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
        <BrandLogo variant="lockup" className="mb-0" />
        <div className="space-y-2">
        <h1 className="text-[2rem] font-semibold tracking-tight text-slate-950">Consent required</h1>
        <p className="text-sm leading-6 text-slate-600">
          Before using Vexa PIM, confirm that you agree to data processing under our DPDP policy.
        </p>
        </div>
      </header>

      <form className="space-y-4" onSubmit={onSubmit}>
        <label className="flex items-start gap-3 rounded-xl border border-slate-200/90 bg-slate-50/90 p-4 text-sm leading-6 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
            className="mt-0.5"
          />
          <span>
            I consent to processing product and catalog data for marketplace publishing, compliance validation,
            and audit logging as described in the DPDP notice.
          </span>
        </label>

        <button
          type="submit"
          disabled={submitting || !accepted}
          className="w-full rounded-xl bg-slate-900 px-3 py-3 text-sm font-semibold text-white shadow-[0_18px_36px_rgba(15,23,42,0.22)] transition hover:bg-slate-800 disabled:opacity-60"
        >
          {submitting ? "Saving consent..." : "Accept and continue"}
        </button>

        {message && (
          <p className="rounded-xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-[0_10px_24px_rgba(239,68,68,0.08)]">
            {message}{" "}
            {message.toLowerCase().includes("session") && (
              <Link href="/login" className="font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-4">
                Go to login
              </Link>
            )}
          </p>
        )}
      </form>
      </div>
    </div>
  );
}
