"use client";

import Link from "@/components/ui/app-link";
import { useRouter } from "next/navigation";
import { type MouseEvent, useState } from "react";
import { retrySubmissionInlineAction } from "@/app/actions";
import { AppDrawer } from "@/components/ui/app-drawer";
import { StatusChip } from "@/components/ui/status-chip";
import type { ConnectorSubmission } from "@/lib/api";
import { describeError, extractErrorCode } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";

function normalizeStatus(status: string): string {
  return String(status ?? "").trim().toUpperCase() || "UNKNOWN";
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  const normalized = normalizeStatus(status);
  if (normalized === "SUCCESS") return "success";
  if (normalized === "PENDING" || normalized === "RETRYING") return "warning";
  if (normalized === "REJECTED" || normalized === "ERROR" || normalized === "DEAD_LETTER") return "danger";
  return "neutral";
}

// Fields that live on the content tab rather than the attributes tab
const CONTENT_TAB_FIELDS = new Set([
  "title", "description", "brand",
  "hsnCode", "gstRate", "taxCodes",
]);

function fieldPathToEditHref(productId: string, fieldPath: string | null): string | null {
  if (!fieldPath) return null;
  // Map known field paths to product editor tab anchors.
  // e.g. "variants[0].barcode" → /products/{id}?tab=attributes#barcode
  // e.g. "taxCodes"            → /products/{id}?tab=content#taxCodes
  const root = fieldPath
    .replace(/\[\d+\]/g, "")    // strip array indices
    .replace(/^variants\./, "") // strip variants prefix
    .split(".").pop() ?? "";    // take leaf segment
  if (!root) return null;
  const tab = CONTENT_TAB_FIELDS.has(root) ? "content" : "attributes";
  return `/products/${encodeURIComponent(productId)}?tab=${tab}#${encodeURIComponent(root)}`;
}

interface SubmissionsGridProps {
  submissions: ConnectorSubmission[];
  canRetrySubmission: boolean;
}

export function SubmissionsGrid({ submissions, canRetrySubmission }: SubmissionsGridProps) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retrySuccessId, setRetrySuccessId] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);

  const selected = submissions.find((s) => s.id === selectedId) ?? null;

  function canRetry(status: string): boolean {
    const s = normalizeStatus(status);
    return s === "REJECTED" || s === "ERROR";
  }

  async function handleRetry(submissionId: string) {
    setRetryingId(submissionId);
    setRetrySuccessId(null);
    setRetryError(null);
    try {
      const result = await retrySubmissionInlineAction(submissionId);
      if (!result.ok) {
        const code = extractErrorCode(result.error);
        const copy = describeError(code);
        setRetryError(`${copy.title}: ${copy.description}${copy.action ? ` ${copy.action}` : ""}`);
        return;
      }
      setRetrySuccessId(submissionId);
      // Refresh server-rendered data after a short delay so the status change is visible
      setTimeout(() => router.refresh(), 1000);
    } catch {
      setRetryError("Retry request failed — check your connection and try again.");
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <th className="pb-2 pr-3">Submission</th>
            <th className="pb-2 pr-3">Connector</th>
            <th className="pb-2 pr-3">Product</th>
            <th className="pb-2 pr-3">Status</th>
            <th className="pb-2 pr-3">Attempts</th>
            <th className="pb-2">Submitted</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {submissions.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-8 text-center text-sm text-slate-500">
                No submissions found for the current filter scope.
              </td>
            </tr>
          ) : (
            submissions.map((submission) => {
              const hasErrors = submission.channelErrors.length > 0 &&
                submission.channelErrors.some((e) => e.severity === "error");
              return (
                <tr
                  key={submission.id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => setSelectedId(submission.id)}
                >
                  <td className="py-2 pr-3 font-mono text-xs text-slate-700">{submission.id.slice(0, 8)}…</td>
                  <td className="py-2 pr-3">{submission.connectorDisplayName}</td>
                  <td className="py-2 pr-3">
                    <Link
                      href={`/products/${encodeURIComponent(submission.productId)}`}
                      className="underline hover:text-slate-900"
                      onClick={(e: MouseEvent<HTMLAnchorElement>) => e.stopPropagation()}
                    >
                      {submission.productId.slice(0, 8)}…
                    </Link>
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <StatusChip label={normalizeStatus(submission.status)} tone={statusTone(submission.status)} />
                      {hasErrors ? (
                        <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
                          {submission.channelErrors.filter((e) => e.severity === "error").length} error{submission.channelErrors.filter((e) => e.severity === "error").length !== 1 ? "s" : ""}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="py-2 pr-3">{submission.attemptNumber}</td>
                  <td className="py-2 text-xs text-slate-600">{formatDateTime(submission.submittedAt)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {selected ? (
        <AppDrawer
          open={true}
          width="lg"
          title={`Submission ${selected.id.slice(0, 8)}…`}
          description={
            <span className="flex items-center gap-2">
              <StatusChip label={normalizeStatus(selected.status)} tone={statusTone(selected.status)} />
              <span>{selected.connectorDisplayName}</span>
              {selected.resolvedAt ? (
                <span className="text-slate-400">· resolved {formatDateTime(selected.resolvedAt)}</span>
              ) : null}
            </span>
          }
          onClose={() => setSelectedId(null)}
        >
          <div className="space-y-5">
            {/* Meta */}
            <section className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                <dt className="text-slate-500">Submission ID</dt>
                <dd className="font-mono text-slate-700 break-all">{selected.id}</dd>
                <dt className="text-slate-500">Product</dt>
                <dd>
                  <Link href={`/products/${encodeURIComponent(selected.productId)}`} className="underline text-slate-700">
                    {selected.productId}
                  </Link>
                </dd>
                <dt className="text-slate-500">Connector</dt>
                <dd className="text-slate-700">{selected.connectorDisplayName} ({selected.connectorSlug})</dd>
                <dt className="text-slate-500">Attempt</dt>
                <dd className="text-slate-700">{selected.attemptNumber}</dd>
                <dt className="text-slate-500">Submitted at</dt>
                <dd className="text-slate-700">{formatDateTime(selected.submittedAt)}</dd>
                {selected.externalRef ? (
                  <>
                    <dt className="text-slate-500">External ref</dt>
                    <dd className="font-mono text-slate-700 break-all">{selected.externalRef}</dd>
                  </>
                ) : null}
              </dl>
            </section>

            {/* Channel errors */}
            {selected.channelErrors.length > 0 ? (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Channel errors ({selected.channelErrors.length})
                </h3>
                <div className="space-y-2">
                  {selected.channelErrors.map((issue, i) => {
                    const editHref = fieldPathToEditHref(selected.productId, issue.fieldPath);
                    return (
                      <div
                        key={i}
                        className={`rounded-md border p-3 ${
                          issue.severity === "error"
                            ? "border-red-200 bg-red-50"
                            : "border-amber-200 bg-amber-50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-900">{issue.sellerMessage}</p>
                            {issue.fieldPath ? (
                              <p className="mt-0.5 font-mono text-xs text-slate-500">{issue.fieldPath}</p>
                            ) : null}
                            <p className="mt-0.5 text-xs text-slate-500">Code: {issue.code}</p>
                          </div>
                          {editHref ? (
                            <Link
                              href={editHref}
                              className="flex-shrink-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                              onClick={() => setSelectedId(null)}
                            >
                              Fix this field →
                            </Link>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : (
              <section>
                <p className="text-sm text-slate-500">No channel errors recorded for this submission.</p>
              </section>
            )}

            {/* Actions */}
            <section className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
              {canRetrySubmission && canRetry(selected.status) ? (
                retrySuccessId === selected.id ? (
                  <span className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
                    ✓ Retry queued — refreshing…
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={retryingId === selected.id}
                    onClick={() => handleRetry(selected.id)}
                    className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                  >
                    {retryingId === selected.id ? "Retrying…" : "Retry submission"}
                  </button>
                )
              ) : null}
              <Link
                href={`/products/${encodeURIComponent(selected.productId)}?tab=channels`}
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => setSelectedId(null)}
              >
                Open product channels tab
              </Link>
              <Link
                href="/operations/jobs"
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Open jobs workspace
              </Link>
              {retryError ? (
                <p className="w-full text-xs text-red-600">{retryError}</p>
              ) : null}
            </section>
          </div>
        </AppDrawer>
      ) : null}
    </>
  );
}
