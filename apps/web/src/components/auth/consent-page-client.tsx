"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { BrandLogo } from "@/components/ui/brand-logo";

function readCookie(name: string): string {
  const prefix = `${name}=`;
  const parts = document.cookie.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return "";
}

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
      const csrfToken = readCookie("pim_csrf_token");
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
    <div className="mx-auto max-w-xl space-y-5 rounded-lg border border-slate-200 bg-white p-6">
      <header className="space-y-1">
        <BrandLogo variant="lockup" className="mb-3" />
        <h1 className="text-2xl font-semibold text-slate-900">Consent required</h1>
        <p className="text-sm text-slate-600">
          Before using Vexa PIM, confirm that you agree to data processing under our DPDP policy.
        </p>
      </header>

      <form className="space-y-4" onSubmit={onSubmit}>
        <label className="flex items-start gap-3 rounded-md border border-slate-200 p-3 text-sm text-slate-700">
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
          className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {submitting ? "Saving consent..." : "Accept and continue"}
        </button>

        {message && (
          <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {message}{" "}
            {message.toLowerCase().includes("session") && (
              <Link href="/login" className="underline">
                Go to login
              </Link>
            )}
          </p>
        )}
      </form>
    </div>
  );
}
