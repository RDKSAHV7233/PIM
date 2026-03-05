"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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

export function LogoutButton() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function onLogout() {
    setSubmitting(true);
    try {
      const csrfToken = readCookie("pim_csrf_token");
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: {
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
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
