"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { AppDialog } from "@/components/ui/app-dialog";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import type { CatalogStatus } from "@/lib/api";

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

function renderValueList(product: BulkEditPreviewProduct, fields: string[]) {
  return fields.map((field) => (
    <p key={`${product.id}-current-${field}`}>
      <span className="font-medium">{FIELD_LABELS[field] ?? field}:</span> {currentValue(product, field)}
    </p>
  ));
}

function renderNextValueList(product: BulkEditPreviewProduct, fields: string[], updates: Record<string, unknown>) {
  return fields.map((field) => (
    <p key={`${product.id}-next-${field}`}>
      <span className="font-medium">{FIELD_LABELS[field] ?? field}:</span> {nextValue(updates[field])}
    </p>
  ));
}

export function BulkEditDiffPreview({
  requestedCount,
  products,
  updates,
  scope,
  updatesRaw,
  applyAction,
}: BulkEditDiffPreviewProps) {
  const [approved, setApproved] = useState(false);
  const [largeApproved, setLargeApproved] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [visibleCount, setVisibleCount] = useState(50);
  const changedFields = useMemo(() => Object.keys(updates), [updates]);
  const previewRows = products.slice(0, 5);
  const modalRows = products.slice(0, visibleCount);
  const hasMore = visibleCount < products.length;
  const columns: Column<BulkEditPreviewProduct>[] = [
    {
      key: "firstSku",
      header: "SKU Code",
      cellClassName: "font-mono text-xs",
      render: (product) => product.firstSku,
    },
    {
      key: "currentValue",
      header: "Current value",
      cellClassName: "text-xs",
      render: (product) => renderValueList(product, changedFields),
    },
    {
      key: "nextValue",
      header: "New value",
      cellClassName: "text-xs",
      render: (product) => renderNextValueList(product, changedFields, updates),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
        <p className="font-medium text-slate-900">{requestedCount} products will be updated.</p>
        <p className="mt-1">
          Review the changed fields below before applying the batch. Mobile and tablet views keep the changed values stacked so no preview action depends on horizontal scroll.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {changedFields.map((field) => (
            <span key={field} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">
              {FIELD_LABELS[field] ?? field}
            </span>
          ))}
        </div>
      </div>

      {/* Desktop table — hidden on small screens */}
      <div className="hidden sm:block overflow-x-auto">
        <DataGrid columns={columns} rows={previewRows} getRowKey={(product) => product.id} rowClassName="align-top" caption="Bulk edit preview" />
      </div>
      {/* Mobile stacked diff cards — shown below sm breakpoint */}
      <div className="flex flex-col space-y-3 sm:hidden">
        {previewRows.map((product) => (
          <div key={`mobile-${product.id}`} className="rounded-lg border border-border p-3 text-sm">
            <p className="font-mono text-xs font-semibold text-slate-700">{product.firstSku}</p>
            {changedFields.map((field) => (
              <div key={`mobile-${product.id}-${field}`} className="mt-2 space-y-1">
                <p className="text-xs font-medium text-slate-600">{FIELD_LABELS[field] ?? field}</p>
                <div className="flex flex-col gap-1 text-xs">
                  <span className="text-slate-500 line-through">{currentValue(product, field)}</span>
                  <span className="text-slate-900">→ {nextValue(updates[field])}</span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {requestedCount > previewRows.length && (
        <Button type="button" variant="secondary" onClick={() => setShowAll(true)}>
          + Show all {requestedCount}
        </Button>
      )}

      {requestedCount > 100 && (
        <div
          className={`rounded-md border p-3 text-sm ${
            requestedCount > 1000
              ? "border-red-300 bg-red-50 text-red-800"
              : "border-amber-300 bg-amber-50 text-amber-800"
          }`}
        >
          <p className="font-semibold">
            {requestedCount > 1000 ? "⚠ Very large batch update" : "⚠ Large batch update"}
          </p>
          <p className="mt-1">
            You are about to update <strong>{requestedCount.toLocaleString()}</strong> products in a
            single operation. {requestedCount > 1000
              ? "This is a significant change that may take time to process and cannot be easily reversed."
              : "Please double-check your filters and preview before applying."}
          </p>
        </div>
      )}

      <form action={applyAction} className="space-y-2">
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
        {requestedCount > 1000 && (
          <label className="flex items-center gap-2 text-sm text-red-700">
            <input
              type="checkbox"
              checked={largeApproved}
              onChange={(event) => setLargeApproved(event.target.checked)}
            />
            I understand this will modify {requestedCount.toLocaleString()} products and this action
            cannot be easily undone.
          </label>
        )}
        <div className="flex gap-2">
          <Button
            type="submit"
            disabled={!approved || (requestedCount > 1000 && !largeApproved)}
          >
            Apply Changes{requestedCount > 1000 ? ` to ${requestedCount.toLocaleString()} Products` : ""}
          </Button>
          <Button type="button" variant="secondary" onClick={() => { setApproved(false); setLargeApproved(false); }}>
            Cancel
          </Button>
        </div>
      </form>

      <AppDialog
        open={showAll}
        title={`All matched products (${products.length})`}
        description="Review the full preview list in a stacked mobile-safe layout before applying the batch."
        onClose={() => setShowAll(false)}
        size="lg"
      >
        <div className="space-y-4">
          <div className="max-h-[60vh] overflow-y-auto overflow-x-hidden">
            <DataGrid columns={columns} rows={modalRows} getRowKey={(product) => `${product.id}-modal`} rowClassName="align-top" caption="All matched products preview" />
          </div>
          <div className="flex justify-end">
            {hasMore ? (
              <Button type="button" variant="secondary" onClick={() => setVisibleCount((count) => count + 50)}>
                Load 50 more
              </Button>
            ) : (
              <p className="text-xs text-slate-500">All rows loaded.</p>
            )}
          </div>
        </div>
      </AppDialog>
    </div>
  );
}
