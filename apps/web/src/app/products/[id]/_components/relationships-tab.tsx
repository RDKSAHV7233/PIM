"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
  ProductRelationship,
  ProductRelationshipsResponse,
  CreateRelationshipInput,
  ProductRelationshipType,
} from "@/lib/api/catalog";

interface RelationshipsTabProps {
  productId: string;
  productTitle: string;
  canWrite: boolean;
  hidden: boolean;
}

const REL_TYPES: Array<{ value: ProductRelationshipType; label: string }> = [
  { value: "bundle_component", label: "Bundle component" },
  { value: "accessory", label: "Accessory" },
  { value: "substitute", label: "Substitute" },
  { value: "upsell", label: "Upsell" },
];

function RelTypeBadge({ type }: { type: string }) {
  const colours: Record<string, string> = {
    bundle_component: "bg-blue-50 border-blue-200 text-blue-700",
    accessory: "bg-emerald-50 border-emerald-200 text-emerald-700",
    substitute: "bg-amber-50 border-amber-200 text-amber-700",
    upsell: "bg-purple-50 border-purple-200 text-purple-700",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        colours[type] ?? "bg-slate-50 border-slate-200 text-slate-600",
      )}
    >
      {type.replace(/_/g, " ")}
    </span>
  );
}

function RelationshipRow({
  rel,
  direction,
  canDelete,
  onDelete,
}: {
  rel: ProductRelationship;
  direction: "outgoing" | "incoming";
  canDelete: boolean;
  onDelete: (id: string) => void;
}) {
  const linked =
    direction === "outgoing" ? rel.targetProduct : rel.sourceProduct;
  const label = linked?.title ?? (direction === "outgoing" ? rel.targetProductId : rel.sourceProductId);

  return (
    <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-slate-800">{label}</p>
        {rel.quantityInParent != null && rel.quantityInParent > 0 ? (
          <p className="text-xs text-slate-500">qty {rel.quantityInParent}</p>
        ) : null}
      </div>
      <RelTypeBadge type={rel.type} />
      {canDelete && direction === "outgoing" ? (
        <button
          type="button"
          aria-label={`Remove relationship to ${label}`}
          onClick={() => onDelete(rel.id)}
          className="ml-1 rounded p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
            aria-hidden
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      ) : (
        <div className="w-6" />
      )}
    </div>
  );
}

export function RelationshipsTab({
  productId,
  canWrite,
  hidden,
}: RelationshipsTabProps) {
  const [data, setData] = useState<ProductRelationshipsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetInput, setTargetInput] = useState("");
  const [relType, setRelType] = useState<ProductRelationshipType>("bundle_component");
  const [qty, setQty] = useState(1);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const loadRelationships = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/catalog/products/${encodeURIComponent(productId)}/relationships`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ProductRelationshipsResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load relationships");
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    if (!hidden) {
      void loadRelationships();
    }
  }, [hidden, loadRelationships]);

  const handleDelete = useCallback(
    async (relId: string) => {
      try {
        const res = await fetch(`/api/catalog/relationships/${encodeURIComponent(relId)}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await loadRelationships();
      } catch {
        /* silent — row stays, user can retry */
      }
    },
    [loadRelationships],
  );

  const handleAdd = useCallback(async () => {
    const target = targetInput.trim();
    if (!target) return;
    setAdding(true);
    setAddError(null);
    try {
      const input: CreateRelationshipInput = {
        targetProductId: target,
        type: relType,
        quantityInParent: qty > 0 ? qty : undefined,
      };
      const res = await fetch(
        `/api/catalog/products/${encodeURIComponent(productId)}/relationships`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      if (res.status === 409) throw new Error("Relationship already exists");
      if (res.status === 400) throw new Error("Invalid target — check the product ID is from the same workspace");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTargetInput("");
      setQty(1);
      await loadRelationships();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add relationship");
    } finally {
      setAdding(false);
    }
  }, [targetInput, relType, qty, productId, loadRelationships]);

  return (
    <Card hidden={hidden}>
      <CardTitle>Relationships</CardTitle>
      <p className="mb-4 mt-1 text-sm text-slate-600">
        Link this product to related items — bundle components, accessories, substitutes. Relationships
        are directional: outgoing ones originate here; incoming ones were created from another product.
      </p>

      {loading && (
        <p className="text-sm text-slate-500" role="status">
          Loading relationships…
        </p>
      )}
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {data && (
        <div className="space-y-6">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
              Outgoing — this product links to
            </h3>
            {data.outgoing.length === 0 ? (
              <p className="text-sm text-slate-400">No outgoing relationships.</p>
            ) : (
              <div className="space-y-2">
                {data.outgoing.map((rel) => (
                  <RelationshipRow
                    key={rel.id}
                    rel={rel}
                    direction="outgoing"
                    canDelete={canWrite}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )}

            {canWrite && (
              <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-xs font-semibold text-slate-600">Add relationship</p>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex-1 min-w-[160px]">
                    <label
                      htmlFor="rel-target-id"
                      className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-slate-500"
                    >
                      Target product ID
                    </label>
                    <input
                      id="rel-target-id"
                      type="text"
                      value={targetInput}
                      onChange={(e) => setTargetInput(e.target.value)}
                      placeholder="Paste product UUID…"
                      className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="rel-type-select"
                      className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-slate-500"
                    >
                      Type
                    </label>
                    <select
                      id="rel-type-select"
                      value={relType}
                      onChange={(e) => setRelType(e.target.value as ProductRelationshipType)}
                      className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400"
                    >
                      {REL_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ width: 72 }}>
                    <label
                      htmlFor="rel-qty"
                      className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-slate-500"
                    >
                      Qty
                    </label>
                    <input
                      id="rel-qty"
                      type="number"
                      min={1}
                      value={qty}
                      onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
                      className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleAdd}
                    disabled={adding || !targetInput.trim()}
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
                  >
                    {adding ? "Adding…" : "Add"}
                  </button>
                </div>
                {addError && (
                  <p className="mt-2 text-xs text-red-600" role="alert">
                    {addError}
                  </p>
                )}
                <p className="mt-2 text-[11px] text-slate-400">
                  409 on duplicate · 400 on self-link · cross-tenant blocked
                </p>
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
              Incoming — other products link to this
            </h3>
            {data.incoming.length === 0 ? (
              <p className="text-sm text-slate-400">No incoming relationships.</p>
            ) : (
              <div className="space-y-2">
                {data.incoming.map((rel) => (
                  <RelationshipRow
                    key={rel.id}
                    rel={rel}
                    direction="incoming"
                    canDelete={false}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )}
            <p className="mt-2 text-[11px] text-slate-400">
              Incoming relationships can only be removed from the source product.
            </p>
          </section>
        </div>
      )}
    </Card>
  );
}
