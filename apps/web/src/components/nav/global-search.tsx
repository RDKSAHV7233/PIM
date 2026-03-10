"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { StatusChip } from "@/components/ui/status-chip";
import type { CatalogSearchResult } from "@/lib/api";

const SEARCH_LIMIT = 8;

function statusTone(status: string): "success" | "warning" | "info" | "danger" | "neutral" {
  if (status === "approved" || status === "active") {
    return "success";
  }
  if (status === "in_review") {
    return "warning";
  }
  if (status === "rejected") {
    return "danger";
  }
  if (status === "draft") {
    return "info";
  }
  return "neutral";
}

export function GlobalSearch() {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/catalog/search?q=${encodeURIComponent(query.trim())}&limit=${SEARCH_LIMIT}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          setResults([]);
          setOpen(true);
          return;
        }
        const payload = (await response.json()) as CatalogSearchResult[];
        setResults(Array.isArray(payload) ? payload : []);
        setOpen(true);
        setActiveIndex(-1);
      } catch (error) {
        if ((error as { name?: string } | undefined)?.name !== "AbortError") {
          setResults([]);
          setOpen(true);
        }
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, []);

  const showDropdown = useMemo(() => open && query.trim().length > 0, [open, query]);
  const noResults = !loading && query.trim().length > 0 && results.length === 0;

  function goToProduct(result: CatalogSearchResult) {
    setOpen(false);
    setQuery("");
    setResults([]);
    setActiveIndex(-1);
    router.push(`/products/${encodeURIComponent(result.id)}`);
  }

  return (
    <div ref={rootRef} className="relative hidden min-w-[320px] flex-1 md:block">
      <input
        type="search"
        value={query}
        onFocus={() => {
          if (query.trim()) {
            setOpen(true);
          }
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (!showDropdown) {
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((current) => Math.min(current + 1, results.length - 1));
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((current) => Math.max(current - 1, 0));
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            setActiveIndex(-1);
            return;
          }
          if (event.key === "Enter") {
            if (results.length === 0) {
              return;
            }
            event.preventDefault();
            const target = activeIndex >= 0 ? results[activeIndex] : results[0];
            goToProduct(target);
          }
        }}
        placeholder="Search products by title or SKU"
        aria-label="Global product search"
        className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      />
      {showDropdown ? (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          {loading ? <p className="px-3 py-4 text-sm text-slate-500">Searching...</p> : null}
          {!loading && results.length > 0 ? (
            <ul className="space-y-1">
              {results.map((result, index) => (
                <li key={result.id}>
                  <button
                    type="button"
                    onClick={() => goToProduct(result)}
                    className={`flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left ${index === activeIndex ? "bg-blue-50" : "hover:bg-slate-50"}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{result.title}</p>
                      <p className="truncate text-xs text-slate-500">
                        {result.matchedSku ? `SKU ${result.matchedSku}` : result.categoryName ?? "Product"}
                      </p>
                    </div>
                    <StatusChip label={result.status} tone={statusTone(result.status)} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {noResults ? <p className="px-3 py-4 text-sm text-slate-500">No results for "{query.trim()}".</p> : null}
        </div>
      ) : null}
    </div>
  );
}

