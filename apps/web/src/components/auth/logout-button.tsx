"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { csrfHeaders } from "@/lib/csrf";

export function LogoutButton() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function onLogout() {
    setSubmitting(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: {
          ...csrfHeaders(),
        },
        signal: AbortSignal.timeout(10_000),
      });
    } finally {
      setSubmitting(false);
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={onLogout}
      disabled={submitting}
      className="text-xs text-slate-600 underline disabled:opacity-60"
    >
      {submitting ? "Logging out..." : "Logout"}
    </button>
  );
}
