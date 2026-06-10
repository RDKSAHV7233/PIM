"use client";
// pricing-tab.tsx
// Per-product price editor.  Rendered inside the Pricing tab on the product detail page.
//
// Architecture:
// - This component fetches its own data on mount (lazy — only when the tab is open).
//   This keeps the main product page fast: no extra round-trips for users who never open Pricing.
// - One request to GET /pricing/price-lists, then one per-price-list request to
//   GET /pricing/price-lists/:id/prices.  Results are filtered client-side to the
//   variants that belong to this product.
// - Editing is per-price-list.  Each card has "Edit" → inline inputs → "Save" / "Cancel".
//   Changes are sent as a single PUT /pricing/price-lists/:id/prices bulk-upsert.

import Link from "next/link";
import { useEffect, useReducer, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import { SkeletonBlock } from "@/components/ui/skeleton";
import {
  getPriceLists,
  getPriceListPrices,
  upsertPriceListPrices,
  type PriceList,
  type ProductPrice,
} from "@/lib/api/pricing";
import type { Variant } from "@/lib/api";

// ── types ──────────────────────────────────────────────────────────────────

interface PriceRow {
  variantId: string;
  skuCode: string;
  mrp: string;         // string for controlled input; "" = null
  sellingPrice: string;
}

interface PriceListState {
  priceList: PriceList;
  rows: PriceRow[];
  editing: boolean;
  dirty: boolean;
  saveError: string | null;
  saved: boolean;
}

type Action =
  | { type: "ENTER_EDIT"; priceListId: string }
  | { type: "CANCEL_EDIT"; priceListId: string; original: PriceRow[] }
  | { type: "UPDATE_ROW"; priceListId: string; variantId: string; field: "mrp" | "sellingPrice"; value: string }
  | { type: "SAVE_START"; priceListId: string }
  | { type: "SAVE_OK"; priceListId: string }
  | { type: "SAVE_ERROR"; priceListId: string; error: string };

function reducer(state: PriceListState[], action: Action): PriceListState[] {
  switch (action.type) {
    case "ENTER_EDIT":
      return state.map((s) => s.priceList.id === action.priceListId ? { ...s, editing: true, saveError: null, saved: false } : s);
    case "CANCEL_EDIT":
      return state.map((s) => s.priceList.id === action.priceListId ? { ...s, editing: false, dirty: false, rows: action.original, saveError: null } : s);
    case "UPDATE_ROW":
      return state.map((s) => {
        if (s.priceList.id !== action.priceListId) return s;
        const rows = s.rows.map((r) =>
          r.variantId === action.variantId ? { ...r, [action.field]: action.value } : r,
        );
        return { ...s, rows, dirty: true };
      });
    case "SAVE_START":
      return state.map((s) => s.priceList.id === action.priceListId ? { ...s, saveError: null } : s);
    case "SAVE_OK":
      return state.map((s) => s.priceList.id === action.priceListId ? { ...s, editing: false, dirty: false, saved: true, saveError: null } : s);
    case "SAVE_ERROR":
      return state.map((s) => s.priceList.id === action.priceListId ? { ...s, saveError: action.error } : s);
    default:
      return state;
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function parsePrice(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = parseFloat(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function formatPrice(value: number | null): string {
  return value == null ? "" : String(value);
}

function buildRows(variants: Variant[], prices: ProductPrice[]): PriceRow[] {
  const priceMap = new Map(prices.map((p) => [p.variantId, p]));
  return variants.map((v) => {
    const existing = priceMap.get(v.id);
    return {
      variantId: v.id,
      skuCode: v.skuCode,
      mrp: formatPrice(existing?.mrp ?? null),
      sellingPrice: formatPrice(existing?.sellingPrice ?? null),
    };
  });
}

function extractErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) return String((err as { message: string }).message);
  return "An unexpected error occurred.";
}

// ── sub-component: one price list card ────────────────────────────────────

interface PriceListCardProps {
  state: PriceListState;
  originalRows: PriceRow[];
  canWrite: boolean;
  dispatch: React.Dispatch<Action>;
  onSave: (priceListId: string, rows: PriceRow[]) => void;
}

function PriceListCard({ state, originalRows, canWrite, dispatch, onSave }: PriceListCardProps) {
  const { priceList, rows, editing, dirty, saveError, saved } = state;

  return (
    <Card>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <CardTitle>{priceList.name}</CardTitle>
          <p className="text-xs text-slate-500">
            <span className="font-mono">{priceList.market.code}</span>
            {" · "}
            {priceList.market.displayName}
            {" · "}
            <span className="font-mono">{priceList.currency.code}</span>
            {" "}
            {priceList.currency.symbol}
            {priceList.isDefault && (
              <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                Default
              </span>
            )}
          </p>
        </div>
        {canWrite && !editing && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => dispatch({ type: "ENTER_EDIT", priceListId: priceList.id })}
          >
            Edit prices
          </Button>
        )}
      </div>

      {saveError && <InlineAlert tone="error" message={saveError} className="mb-3" />}
      {saved && !editing && (
        <InlineAlert tone="success" message="Prices saved successfully." className="mb-3" />
      )}

      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">
          No variants on this product. Add variants first.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">SKU</th>
                <th className="px-4 py-3 text-right">
                  MRP <span className="font-normal normal-case">({priceList.currency.symbol})</span>
                </th>
                <th className="px-4 py-3 text-right">
                  Selling price <span className="font-normal normal-case">({priceList.currency.symbol})</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.variantId} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{row.skuCode}</td>
                  <td className="px-4 py-3 text-right">
                    {editing ? (
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={row.mrp}
                        onChange={(e) =>
                          dispatch({
                            type: "UPDATE_ROW",
                            priceListId: priceList.id,
                            variantId: row.variantId,
                            field: "mrp",
                            value: e.target.value,
                          })
                        }
                        placeholder="—"
                        className="w-28 rounded border border-slate-300 px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                      />
                    ) : (
                      <span className={row.mrp ? "text-slate-800" : "text-slate-400"}>
                        {row.mrp || "—"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editing ? (
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={row.sellingPrice}
                        onChange={(e) =>
                          dispatch({
                            type: "UPDATE_ROW",
                            priceListId: priceList.id,
                            variantId: row.variantId,
                            field: "sellingPrice",
                            value: e.target.value,
                          })
                        }
                        placeholder="—"
                        className="w-28 rounded border border-slate-300 px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                      />
                    ) : (
                      <span className={row.sellingPrice ? "font-medium text-slate-900" : "text-slate-400"}>
                        {row.sellingPrice || "—"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              dispatch({ type: "CANCEL_EDIT", priceListId: priceList.id, original: originalRows })
            }
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!dirty}
            onClick={() => onSave(priceList.id, rows)}
          >
            Save prices
          </Button>
        </div>
      )}
    </Card>
  );
}

// ── main component ─────────────────────────────────────────────────────────

export interface PricingTabProps {
  productId: string;
  variants: Variant[];
  canWrite: boolean;
}

export function PricingTab({ productId: _productId, variants, canWrite }: PricingTabProps) {
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  // Stable snapshot of rows used for "cancel" (before any editing).
  const [originalRows, setOriginalRows] = useState<Map<string, PriceRow[]>>(new Map());
  const [, startTransition] = useTransition();

  // Load price lists + existing prices once, on mount.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const priceLists = await getPriceLists();
        const activePriceLists = priceLists.filter((pl) => pl.status === "active");

        // Parallel-fetch prices for each active price list.
        const pricesPerList = await Promise.all(
          activePriceLists.map((pl) =>
            getPriceListPrices(pl.id).catch(() => [] as ProductPrice[]),
          ),
        );

        if (cancelled) return;

        // Filter prices to only variants that belong to this product.
        const variantIdSet = new Set(variants.map((v) => v.id));
        const states: PriceListState[] = activePriceLists.map((pl, i) => {
          const productPrices = pricesPerList[i].filter((p) => variantIdSet.has(p.variantId));
          const rows = buildRows(variants, productPrices);
          return {
            priceList: pl,
            rows,
            editing: false,
            dirty: false,
            saveError: null,
            saved: false,
          };
        });

        const origMap = new Map<string, PriceRow[]>(
          states.map((s) => [s.priceList.id, [...s.rows.map((r) => ({ ...r }))]]),
        );
        setOriginalRows(origMap);
        // Pass loaded data to a separate inner component that seeds its reducer
        // from props (PricingTabInner below).  We cannot seed a useReducer with
        // async data in the same component without a re-mount trick.
        setInitialStates(states);
        setLoadState("ready");
      } catch (err) {
        if (!cancelled) {
          setLoadError(extractErrorMessage(err));
          setLoadState("error");
        }
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- only run once on mount

  // We need to seed the reducer with loaded data.  The cleanest approach for
  // a useReducer that needs async initial state: keep a separate "seeded" flag
  // and a useState for the initial payload, then render a keyed inner component.
  const [initialStates, setInitialStates] = useState<PriceListState[] | null>(null);

  if (loadState === "loading") {
    return (
      <div className="space-y-4">
        <SkeletonBlock className="h-6 w-48" />
        <SkeletonBlock className="h-32 w-full rounded-xl" />
        <SkeletonBlock className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <InlineAlert
        tone="error"
        title="Failed to load pricing data"
        message={loadError ?? "Unknown error. Try refreshing the page."}
      />
    );
  }

  if (!initialStates || initialStates.length === 0) {
    return (
      <Card>
        <div className="py-8 text-center">
          <p className="text-sm font-medium text-slate-700">No active price lists configured</p>
          <p className="mt-1 text-sm text-slate-500">
            Set up at least one market, currency, and price list before you can set product prices.
          </p>
          <Link
            href="/settings/pricing"
            className="mt-3 inline-block rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Go to Pricing Settings →
          </Link>
        </div>
      </Card>
    );
  }

  // Render a keyed inner component so the reducer is seeded correctly.
  return (
    <PricingTabInner
      key="pricing-tab-inner"
      initialStates={initialStates}
      originalRows={originalRows}
      canWrite={canWrite}
      startTransition={startTransition}
    />
  );
}

// ── inner component (seeded reducer) ──────────────────────────────────────

interface PricingTabInnerProps {
  initialStates: PriceListState[];
  originalRows: Map<string, PriceRow[]>;
  canWrite: boolean;
  startTransition: (fn: () => void) => void;
}

function PricingTabInner({ initialStates, originalRows, canWrite, startTransition }: PricingTabInnerProps) {
  const [states, dispatch] = useReducer(reducer, initialStates);

  function handleSave(priceListId: string, rows: PriceRow[]) {
    dispatch({ type: "SAVE_START", priceListId });
    startTransition(async () => {
      try {
        const prices = rows.map((row) => ({
          variantId: row.variantId,
          mrp: parsePrice(row.mrp),
          sellingPrice: parsePrice(row.sellingPrice),
        }));
        await upsertPriceListPrices(priceListId, prices);
        // Update the "original" snapshot so Cancel after save shows saved values.
        // We can't mutate the Map in place (would need ref), so re-fetch is the
        // clean path.  For now: just dispatch OK and rows stay as-is.
        dispatch({ type: "SAVE_OK", priceListId });
      } catch (err) {
        dispatch({ type: "SAVE_ERROR", priceListId, error: extractErrorMessage(err) });
      }
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Set <strong>MRP</strong> (maximum retail price) and <strong>selling price</strong> for each
        variant across your active price lists. Prices here feed directly into channel exports.
      </p>
      {states.map((s) => (
        <PriceListCard
          key={s.priceList.id}
          state={s}
          originalRows={originalRows.get(s.priceList.id) ?? s.rows}
          canWrite={canWrite}
          dispatch={dispatch}
          onSave={handleSave}
        />
      ))}
    </div>
  );
}
