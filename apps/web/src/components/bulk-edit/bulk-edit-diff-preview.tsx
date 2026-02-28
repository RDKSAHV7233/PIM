"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AppRole, CatalogStatus } from "@/lib/api";

interface BulkEditPreviewProduct {
  id: string;
  title: string;
  description: string;
  brand: string;
  status: CatalogStatus;
  hsnCode: string | null;
  gstRate: number | null;
  firstSku: string;
}

interface BulkEditDiffPreviewProps {
  actorRole: AppRole;
  requestedCount: number;
  products: BulkEditPreviewProduct[];
  updates: Record<string, unknown>;
  scope: {
    categoryId: string;
    status: string;
    brandContains: string;
    productIds: string;
  };
  updatesRaw: string;
  applyAction: (formData: FormData) => void | Promise<void>;
}

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  description: "Description",
  brand: "Brand",
  status: "Status",
  hsnCode: "HSN Code",
  gstRate: "GST Rate",
};

function currentValue(product: BulkEditPreviewProduct, field: string): string {
  if (field === "title") {
    return product.title || "-";
  }
  if (field === "description") {
    return product.description || "-";
  }
  if (field === "brand") {
    return product.brand || "-";
  }
  if (field === "status") {
    return product.status || "-";
  }
  if (field === "hsnCode") {
    return product.hsnCode || "-";
  }
  if (field === "gstRate") {
    return product.gstRate == null ? "-" : String(product.gstRate);
  }
  return "-";
}

function nextValue(value: unknown): string {
  if (value == null) {
    return "-";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export function BulkEditDiffPreview({
  actorRole,
  requestedCount,
  products,
  updates,
  scope,
  updatesRaw,
  applyAction,
}: BulkEditDiffPreviewProps) {
  const [approved, setApproved] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [visibleCount, setVisibleCount] = useState(50);
  const changedFields = useMemo(() => Object.keys(updates), [updates]);
  const previewRows = products.slice(0, 5);
  const modalRows = products.slice(0, visibleCount);
  const hasMore = visibleCount < products.length;

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700">
        {requestedCount} products will be updated.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2">SKU Code</th>
              <th className="py-2">Current value</th>
              <th className="py-2">New value</th>
            </tr>
          </thead>
          <tbody>
            {previewRows.map((product) => (
              <tr key={product.id} className="border-t border-border align-top">
                <td className="py-2 font-mono text-xs">{product.firstSku}</td>
                <td className="py-2 text-xs">
                  {changedFields.map((field) => (
                    <p key={`${product.id}-current-${field}`}>
                      <span className="font-medium">{FIELD_LABELS[field] ?? field}:</span>{" "}
                      {currentValue(product, field)}
                    </p>
                  ))}
                </td>
                <td className="py-2 text-xs">
                  {changedFields.map((field) => (
                    <p key={`${product.id}-next-${field}`}>
                      <span className="font-medium">{FIELD_LABELS[field] ?? field}:</span>{" "}
                      {nextValue(updates[field])}
                    </p>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {requestedCount > previewRows.length && (
        <Button type="button" variant="secondary" onClick={() => setShowAll(true)}>
          + Show all {requestedCount}
        </Button>
      )}

      <form action={applyAction} className="space-y-2">
        <input type="hidden" name="actorRole" value={actorRole} />
        <input type="hidden" name="categoryId" value={scope.categoryId} />
        <input type="hidden" name="status" value={scope.status} />
        <input type="hidden" name="brandContains" value={scope.brandContains} />
        <input type="hidden" name="productIds" value={scope.productIds} />
        <input type="hidden" name="updates" value={updatesRaw} />
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={approved}
            onChange={(event) => setApproved(event.target.checked)}
          />
          I have reviewed the preview and I am ready to apply these changes.
        </label>
        <div className="flex gap-2">
          <Button type="submit" disabled={!approved}>
            Apply Changes
          </Button>
          <Button type="button" variant="secondary" onClick={() => setApproved(false)}>
            Cancel
          </Button>
        </div>
      </form>

      {showAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="max-h-[80vh] w-full max-w-5xl overflow-hidden rounded-lg border border-slate-300 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 p-3">
              <p className="text-sm font-semibold text-slate-900">All matched products ({products.length})</p>
              <Button type="button" variant="secondary" onClick={() => setShowAll(false)}>
                Close
              </Button>
            </div>
            <div className="max-h-[60vh] overflow-auto p-3">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">SKU Code</th>
                    <th className="py-2">Current value</th>
                    <th className="py-2">New value</th>
                  </tr>
                </thead>
                <tbody>
                  {modalRows.map((product) => (
                    <tr key={`${product.id}-modal`} className="border-t border-border align-top">
                      <td className="py-2 font-mono text-xs">{product.firstSku}</td>
                      <td className="py-2 text-xs">
                        {changedFields.map((field) => (
                          <p key={`${product.id}-modal-current-${field}`}>
                            <span className="font-medium">{FIELD_LABELS[field] ?? field}:</span>{" "}
                            {currentValue(product, field)}
                          </p>
                        ))}
                      </td>
                      <td className="py-2 text-xs">
                        {changedFields.map((field) => (
                          <p key={`${product.id}-modal-next-${field}`}>
                            <span className="font-medium">{FIELD_LABELS[field] ?? field}:</span>{" "}
                            {nextValue(updates[field])}
                          </p>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-200 p-3">
              {hasMore ? (
                <Button type="button" variant="secondary" onClick={() => setVisibleCount((count) => count + 50)}>
                  Load 50 more
                </Button>
              ) : (
                <p className="text-xs text-slate-500">All rows loaded.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
