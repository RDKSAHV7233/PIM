"use client";

// apps/web/src/components/ui/meesho-export-panel.tsx
//
// Client component for downloading a Meesho Supplier Panel Excel file.
// Used in the connector installation detail page when slug === "meesho".
//
// Flow:
//   1. Seller selects products (or uses all from catalog)
//   2. Click "Download Excel" → POST /api/marketplace/connectors/:id/export
//   3. Browser receives the .xlsx blob → auto-download
//   4. Post-download guide shows the 4-step Supplier Panel upload walkthrough

import { useState, useCallback } from "react";
import { readCsrfCookie } from "@/lib/csrf";

interface MeeshoExportPanelProps {
  installationId: string;
  /** Product IDs to export. If empty, exports all products attached to this connector. */
  productIds: string[];
}

export function MeeshoExportPanel({ installationId, productIds }: MeeshoExportPanelProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [downloadedFilename, setDownloadedFilename] = useState<string>("");

  const handleExport = useCallback(async () => {
    setStatus("loading");
    setErrorMessage("");
    try {
      const csrf = readCsrfCookie();
      const response = await fetch(
        `/api/marketplace/connectors/${encodeURIComponent(installationId)}/export`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(csrf ? { "x-csrf-token": csrf } : {}),
          },
          body: JSON.stringify({ productIds }),
        },
      );

      if (!response.ok) {
        let errorDetail = `Export failed (${response.status})`;
        try {
          const json = await response.json() as Record<string, unknown>;
          if (typeof json.message === "string") errorDetail = json.message;
          else if (typeof json.error === "string") errorDetail = json.error;
        } catch {
          // Non-JSON error body — use status text
          errorDetail = response.statusText || errorDetail;
        }
        setErrorMessage(errorDetail);
        setStatus("error");
        return;
      }

      // Extract filename from Content-Disposition header
      const disposition = response.headers.get("content-disposition") ?? "";
      const filenameMatch = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
      const filename = filenameMatch
        ? filenameMatch[1]?.replace(/['"]/g, "") ?? "meesho_export.xlsx"
        : "meesho_export.xlsx";

      // Trigger browser download
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      setDownloadedFilename(filename);
      setStatus("done");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unexpected export error.";
      setErrorMessage(message);
      setStatus("error");
    }
  }, [installationId, productIds]);

  return (
    <div className="space-y-4">
      {/* Export trigger */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleExport}
          disabled={status === "loading" || productIds.length === 0}
          className="rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "loading" ? "Generating…" : "Download Excel"}
        </button>
        <span className="text-xs text-slate-500">
          {productIds.length === 0
            ? "No products available to export."
            : `${productIds.length} product${productIds.length === 1 ? "" : "s"} will be exported.`}
        </span>
      </div>

      {/* Success state */}
      {status === "done" && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <p className="font-medium">✓ Excel file downloaded: {downloadedFilename}</p>
          <p className="mt-1">Now follow the steps below to upload it to Meesho Supplier Panel.</p>
        </div>
      )}

      {/* Error state */}
      {status === "error" && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-medium">Export failed</p>
          <p className="mt-1">{errorMessage}</p>
        </div>
      )}

      {/* Upload guide — always visible, not gated on success */}
      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p className="font-semibold">How to upload your Excel to Meesho Supplier Panel</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-amber-800">
          <li>
            Open{" "}
            <span className="font-medium">supplier.meesho.com</span> and log in to your seller
            account.
          </li>
          <li>
            Go to{" "}
            <span className="font-medium">Catalog → Upload Catalog</span>.
          </li>
          <li>
            Select the correct product category, then upload the downloaded Excel file.
          </li>
          <li>
            Meesho will process the file within <span className="font-medium">24–48 hours</span>.
            Check the upload results in{" "}
            <span className="font-medium">Catalog → Upload Status</span> for any rejection
            feedback.
          </li>
        </ol>
        <p className="mt-2 text-xs text-amber-700">
          Tip: If Meesho rejects with column name errors, re-download the latest template from
          Supplier Panel and compare it against the columns in your file.
        </p>
      </div>
    </div>
  );
}
