"use client";

import { useCallback } from "react";
import { cn } from "@/lib/utils";
import type { Category } from "@/lib/api";
import type { AdvancedSearchQuery } from "@/lib/api/catalog";

interface ActiveFacet {
  key: keyof AdvancedSearchQuery;
  label: string;
  value: string;
}

interface FacetedFilterPanelProps {
  /** Categories for the category dropdown — pass getCategoryTree result */
  categories: Category[];
  /** Current facet values */
  value: AdvancedSearchQuery;
  /** Called when any facet changes */
  onChange: (next: AdvancedSearchQuery) => void;
  /** Whether the expand panel is visible */
  open: boolean;
  /** Toggle open/close */
  onToggle: () => void;
  className?: string;
}

function ActiveFacetChip({
  facet,
  onRemove,
}: {
  facet: ActiveFacet;
  onRemove: (key: keyof AdvancedSearchQuery) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
      {facet.label}
      <button
        type="button"
        aria-label={`Remove ${facet.label} filter`}
        onClick={() => onRemove(facet.key)}
        className="ml-0.5 text-amber-600 hover:text-amber-900"
      >
        ×
      </button>
    </span>
  );
}

export function FacetedFilterToggle({
  open,
  onToggle,
  activeCount,
}: {
  open: boolean;
  onToggle: () => void;
  activeCount: number;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls="faceted-filter-panel"
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition-colors",
        open
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5 shrink-0"
        aria-hidden
      >
        <path d="M5 6h14" />
        <path d="M8 12h8" />
        <path d="M11 18h2" />
      </svg>
      Faceted
      {activeCount > 0 && !open ? (
        <span className="ml-0.5 rounded-full bg-blue-600 px-1.5 text-[10px] font-bold text-white">
          {activeCount}
        </span>
      ) : (
        <span className="text-[10px] opacity-60">{open ? "▲" : "▼"}</span>
      )}
    </button>
  );
}

export function FacetedFilterPanel({
  categories,
  value,
  onChange,
  open,
  className,
}: Omit<FacetedFilterPanelProps, "onToggle">) {
  const update = useCallback(
    (patch: Partial<AdvancedSearchQuery>) => onChange({ ...value, ...patch }),
    [value, onChange],
  );

  const clearFacet = useCallback(
    (key: keyof AdvancedSearchQuery) => onChange({ ...value, [key]: undefined, cursor: undefined }),
    [value, onChange],
  );

  const activeFacets: ActiveFacet[] = [
    value.categoryId
      ? {
          key: "categoryId" as keyof AdvancedSearchQuery,
          label: `Category: ${categories.find((c) => c.id === value.categoryId)?.name ?? value.categoryId}`,
          value: value.categoryId,
        }
      : null,
    value.brand
      ? { key: "brand" as keyof AdvancedSearchQuery, label: `Brand: ${value.brand}`, value: value.brand }
      : null,
    value.status
      ? { key: "status" as keyof AdvancedSearchQuery, label: `Status: ${value.status}`, value: value.status }
      : null,
  ].filter(Boolean) as ActiveFacet[];

  return (
    <div className={cn("space-y-2", className)}>
      {open && (
        <div
          id="faceted-filter-panel"
          role="region"
          aria-label="Faceted search filters"
          className="grid grid-cols-3 gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
        >
          <div>
            <label
              htmlFor="facet-category"
              className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500"
            >
              Category
            </label>
            <select
              id="facet-category"
              value={value.categoryId ?? ""}
              onChange={(e) =>
                update({ categoryId: e.target.value || undefined, cursor: undefined })
              }
              className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 shadow-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            >
              <option value="">All categories</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="facet-brand"
              className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500"
            >
              Brand
            </label>
            <input
              id="facet-brand"
              type="text"
              value={value.brand ?? ""}
              onChange={(e) => update({ brand: e.target.value || undefined, cursor: undefined })}
              placeholder="Filter by brand…"
              className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 shadow-sm outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <div>
            <label
              htmlFor="facet-status"
              className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500"
            >
              Status
            </label>
            <select
              id="facet-status"
              value={value.status ?? ""}
              onChange={(e) =>
                update({ status: e.target.value || undefined, cursor: undefined })
              }
              className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 shadow-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            >
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="in_review">In review</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </div>

          <div className="col-span-3 flex items-center gap-2 border-t border-slate-100 pt-2">
            <button
              type="button"
              onClick={() => onChange({ q: value.q })}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
            >
              Clear facets
            </button>
            <span className="text-[11px] text-slate-400">
              Applies to{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">
                /catalog/products/advanced-search
              </code>
            </span>
          </div>
        </div>
      )}

      {activeFacets.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-slate-500">
          <span>Active:</span>
          {activeFacets.map((facet) => (
            <ActiveFacetChip key={facet.key} facet={facet} onRemove={clearFacet} />
          ))}
          <button
            type="button"
            onClick={() => onChange({ q: value.q })}
            className="text-blue-600 font-medium hover:underline"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
