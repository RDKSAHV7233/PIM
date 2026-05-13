"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
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

interface GlobalSearchModalProps {
  open: boolean;
  onClose: () => void;
  dialogId?: string;
}

export function GlobalSearchModal({ open, onClose, dialogId }: GlobalSearchModalProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resultsListId = useId();
  const statusId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  function resetSearchState() {
    setQuery("");
    setResults([]);
    setLoading(false);
    setActiveIndex(-1);
  }

  useEffect(() => {
    if (!open) {
      setResults([]);
      setLoading(false);
      setActiveIndex(-1);
      return;
    }

    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      setActiveIndex(-1);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/catalog/search?q=${encodeURIComponent(query.trim())}&limit=${SEARCH_LIMIT}`,
          {
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          setResults([]);
          return;
        }
        const payload = (await response.json()) as CatalogSearchResult[];
        setResults(Array.isArray(payload) ? payload : []);
        setActiveIndex(-1);
      } catch (error) {
        if ((error as { name?: string } | undefined)?.name !== "AbortError") {
          setResults([]);
        }
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, query]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const noResults = useMemo(
    () => !loading && query.trim().length > 0 && results.length === 0,
    [loading, query, results],
  );
  const activeOptionId = activeIndex >= 0 && results[activeIndex] ? `${resultsListId}-option-${results[activeIndex].id}` : undefined;
  const resultSummary = loading
    ? "Searching products."
    : noResults
      ? `No results for ${query.trim()}.`
      : results.length > 0
        ? `${results.length} product results available.`
        : "Start typing to search products by title or SKU.";

  function closeSearch() {
    onClose();
    resetSearchState();
  }

  function goToProduct(result: CatalogSearchResult) {
    closeSearch();
    router.push(`/products/${encodeURIComponent(result.id)}`);
  }

  return (
    <AppDialog
      dialogId={dialogId}
      open={open}
      title="Search"
      description="Find products by title or SKU and jump directly into the product detail workflow."
      onClose={closeSearch}
      size="lg"
    >
      <div className="space-y-3">
        <p id={statusId} className="sr-only" aria-live="polite">
          {resultSummary}
        </p>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              if (results.length === 0) {
                return;
              }
              event.preventDefault();
              setActiveIndex((current) => Math.min(current + 1, results.length - 1));
              return;
            }
            if (event.key === "ArrowUp") {
              if (results.length === 0) {
                return;
              }
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              closeSearch();
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
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={results.length > 0}
          aria-controls={resultsListId}
          aria-activedescendant={activeOptionId}
          aria-describedby={statusId}
          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />

        <p className="text-xs text-slate-500">
          Use <span className="font-medium text-slate-700">↑</span> <span className="font-medium text-slate-700">↓</span> to move,
          <span className="font-medium text-slate-700"> Enter</span> to open, and
          <span className="font-medium text-slate-700"> Esc</span> to close.
        </p>

        <div
          aria-busy={loading}
          className="max-h-[24rem] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/40"
        >
          {loading ? <p className="px-3 py-4 text-sm text-slate-500">Searching...</p> : null}
          {!loading && results.length > 0 ? (
            <ul id={resultsListId} role="listbox" aria-label="Product search results" className="space-y-1 p-2">
              {results.map((result, index) => (
                <li key={result.id}>
                  <button
                    id={`${resultsListId}-option-${result.id}`}
                    type="button"
                    onClick={() => goToProduct(result)}
                    onMouseEnter={() => setActiveIndex(index)}
                    onFocus={() => setActiveIndex(index)}
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left ${index === activeIndex ? "bg-blue-50" : "hover:bg-white"}`}
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
          {!loading && !query.trim() ? (
            <p className="px-3 py-4 text-sm text-slate-500">
              Start typing to search products by title or SKU.
            </p>
          ) : null}
        </div>
      </div>
    </AppDialog>
  );
}
