"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { PimLocale } from "@/lib/locale";

interface LocaleSwitcherProps {
  locale: PimLocale;
}

export function LocaleSwitcher({ locale }: LocaleSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, setPending] = useState(false);

  async function onChange(nextLocale: PimLocale) {
    if (nextLocale === locale || pending) {
      return;
    }
    setPending(true);
    try {
      await fetch("/api/locale", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ locale: nextLocale }),
      });

      const params = new URLSearchParams(searchParams.toString());
      params.set("lang", nextLocale);
      const query = params.toString();
      const nextUrl = query.length > 0 ? `${pathname}?${query}` : pathname;
      router.replace(nextUrl);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <label className="inline-flex items-center gap-2 text-xs text-slate-600" htmlFor="locale-switcher">
      Lang
      <select
        id="locale-switcher"
        value={locale}
        disabled={pending}
        onChange={(event) => void onChange(event.target.value as PimLocale)}
        className="rounded border border-slate-300 bg-white px-1 py-0.5 text-xs text-slate-700"
      >
        <option value="en">EN</option>
        <option value="hi">HI</option>
      </select>
    </label>
  );
}
