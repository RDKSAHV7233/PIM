/**
 * Shared bulk-publish redirect-status message resolution (PIM#595).
 *
 * `triggerBulkPublishAction` (apps/web/src/app/actions.ts) redirects back to whatever
 * `returnTo` the caller supplied, with a `status` query param plus optional count fields.
 * The connector Sync tab (channels/connectors/[installationId]/page.tsx) has its own
 * larger `connectorDetailStatusMessage` function covering many unrelated status kinds
 * (credentials, publication targets, delta sync, ...) with these same five bulk-publish
 * branches inlined. That function is intentionally left untouched here — an existing test
 * (channel-connector-detail-route-contract.test.cjs) asserts on its literal source text, so
 * refactoring it to delegate here would need to touch that test too, which is out of scope
 * for this change. This module exists so the Products workbench (catalog/products/page.tsx),
 * whose bulk-publish batches now land here via the same server action, can render the same
 * outcome copy without re-deriving it or importing the whole connector-detail page module.
 */

export type BulkPublishStatusTone = "success" | "warning" | "danger";

export interface BulkPublishStatusMessage {
  tone: BulkPublishStatusTone;
  message: string;
}

export interface BulkPublishStatusCounts {
  queuedCount?: string;
  excludedCount?: string;
  ceiling?: string;
  submittedCount?: string;
}

export function resolveBulkPublishStatusMessage(
  status: string | undefined,
  counts?: BulkPublishStatusCounts,
): BulkPublishStatusMessage | null {
  const normalized = String(status ?? "").trim().toLowerCase();

  if (normalized === "bulk-publish-queued") {
    const queuedCount = Number(counts?.queuedCount ?? "");
    const excludedCount = Number(counts?.excludedCount ?? "");
    if (Number.isFinite(queuedCount) && Number.isFinite(excludedCount) && excludedCount > 0) {
      return {
        tone: "warning",
        message: `Bulk publish submitted: ${queuedCount} queued, ${excludedCount} skipped (not approved, mapped, or publish-ready). Track queued jobs in the Jobs workspace; review skipped products before retrying.`,
      };
    }
    return {
      tone: "success",
      message: "Bulk publish submitted. Native feed connectors create one batch; other publish connectors queue one export job per product. Track results in the Jobs workspace.",
    };
  }
  if (normalized === "bulk-publish-none-eligible") {
    const excludedCount = Number(counts?.excludedCount ?? "");
    const countLabel = Number.isFinite(excludedCount) && excludedCount > 0 ? `All ${excludedCount} product(s)` : "Every product";
    return {
      tone: "danger",
      message: `${countLabel} in this batch failed the approval or publish-readiness check — nothing was queued. Review approval status and destination mapping before retrying.`,
    };
  }
  if (normalized === "bulk-publish-too-large") {
    const ceiling = Number(counts?.ceiling ?? "");
    const submittedCount = Number(counts?.submittedCount ?? "");
    const sizeLabel =
      Number.isFinite(ceiling) && Number.isFinite(submittedCount) && ceiling > 0 && submittedCount > 0
        ? `${submittedCount} products, over the ${ceiling}-product limit`
        : "too many products";
    return {
      tone: "danger",
      message: `Bulk publish batch too large: ${sizeLabel} for this connector. Split into smaller batches and retry.`,
    };
  }
  if (normalized === "bulk-publish-timeout") {
    return {
      tone: "danger",
      message: "Bulk publish timed out before completing. Nothing was queued — split into a smaller batch and retry, or try again in a moment.",
    };
  }
  if (normalized === "bulk-publish-error") {
    return {
      tone: "danger",
      message: "Bulk publish failed. Verify products are approved, mapped, publish-ready, and that the connector is healthy.",
    };
  }
  return null;
}

export function bulkPublishStatusBannerToneClass(tone: BulkPublishStatusTone): string {
  if (tone === "success") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (tone === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  return "border-red-200 bg-red-50 text-red-800";
}
