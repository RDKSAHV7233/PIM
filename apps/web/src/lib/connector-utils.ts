import type { ConnectorInstallation } from "@/lib/api";

export function connectorHealthTone(status: string): "neutral" | "success" | "warning" | "danger" {
  const normalized = String(status ?? "").trim().toUpperCase();
  if (normalized === "ACTIVE") return "success";
  if (normalized === "CREDENTIAL_EXPIRED" || normalized === "FAILED" || normalized === "ERROR") return "danger";
  if (normalized === "PAUSED" || normalized === "DISABLED" || normalized === "INACTIVE") return "warning";
  return "neutral";
}

export function connectorHealthLabel(status: string): string {
  const normalized = String(status ?? "").trim().toUpperCase();
  if (normalized === "ACTIVE") return "Healthy";
  if (normalized === "CREDENTIAL_EXPIRED") return "Credentials expired";
  if (normalized === "PAUSED") return "Paused";
  if (normalized === "DISABLED") return "Disabled";
  if (normalized === "FAILED" || normalized === "ERROR") return "Needs attention";
  return status || "Unknown";
}

function readMetadataValue(metadata: unknown, key: string): string | null {
  const record = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
  const value = record[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveInstallationLabel(installation: ConnectorInstallation): string {
  const shopName = readMetadataValue(installation.metadata, "shopName");
  const shopDomain = readMetadataValue(installation.metadata, "shopDomain");
  const accountContext = shopName || shopDomain || installation.externalAccountRef || installation.accountAlias;
  return `${installation.accountAlias} (${accountContext})`;
}

export function resolveInstallationContextDetail(installation: ConnectorInstallation): string {
  const shopName = readMetadataValue(installation.metadata, "shopName");
  const shopDomain = readMetadataValue(installation.metadata, "shopDomain");
  const externalRef = installation.externalAccountRef;
  const context = [shopName, shopDomain, externalRef].filter(Boolean).join(" | ");
  const prefix = context.length > 0
    ? `${installation.displayName} | ${context} | status ${installation.status}`
    : `${installation.displayName} | status ${installation.status}`;
  return `${prefix}. Readiness and publish checks now follow the selected connector account in this workbench.`;
}

// ─── Account health sync signal (PIM#584) ──────────────────────────────────
//
// `installation.lastSyncAt` (the connector_installations.last_sync_at column) is never written
// by any sync or publish code path in this codebase today. In practice it only ever reflects a
// full account/catalog-level sync (e.g. the Shopify Store Configuration import's own
// "Last imported" timestamp, stored separately in metadata), which is a distinct concept from
// individual product submissions. That means it is legitimately null for accounts that have only
// ever published products one at a time via submissions — even when those submissions are all
// SUCCESS. Treating a null lastSyncAt as "no sync ever happened" is misleading for Support, so
// callers should fall back to the most recent successful submission instead of showing a bare
// "no sync" state.

export interface SubmissionSyncSignal {
  status: string;
  submittedAt: string;
}

/**
 * Returns the most recently submitted submission with status "SUCCESS" out of the given list,
 * or null if none succeeded. Submission recency is compared by submittedAt, not array order, so
 * callers do not need to pre-sort.
 */
export function pickLatestSuccessfulSubmission<T extends SubmissionSyncSignal>(
  submissions: readonly T[],
): T | null {
  return submissions.reduce<T | null>((latest, item) => {
    if (item.status !== "SUCCESS") return latest;
    if (!latest || new Date(item.submittedAt).getTime() > new Date(latest.submittedAt).getTime()) {
      return item;
    }
    return latest;
  }, null);
}

export type AccountHealthSyncState =
  | { kind: "full_sync"; lastSyncAt: string }
  | { kind: "submissions_only"; latestSuccessfulSubmissionAt: string }
  | { kind: "none" };

// ─── Issue Snapshot dedupe (PIM#587) ────────────────────────────────────────
//
// The connector detail page's "Issue Snapshot" card shows up to 5 problem products at a
// glance. It is built from the raw `submissions` list, which has one row per submission
// *attempt* — not one row per product. When a product is submitted more than once (retry,
// resubmit after a fix attempt, etc.) and more than one of those attempts is still in a
// failed/rejected state, each attempt appears as its own row, so the same product can
// occupy more than one of the card's 5 slots — reading as two distinct problem products
// when there is really only one.

export interface ProductScopedSubmission {
  productId: string;
  submittedAt: string;
}

/**
 * Collapses a list of submissions down to at most one entry per productId, keeping only the
 * most recently submitted attempt for each product (compared by submittedAt, not array
 * order — callers do not need to pre-sort). Intended for "at a glance" surfaces like the
 * Issue Snapshot card where each product should consume at most one slot.
 */
export function dedupeSubmissionsByLatestPerProduct<T extends ProductScopedSubmission>(
  submissions: readonly T[],
): T[] {
  const latestByProductId = new Map<string, T>();
  for (const submission of submissions) {
    const current = latestByProductId.get(submission.productId);
    if (!current || new Date(submission.submittedAt).getTime() > new Date(current.submittedAt).getTime()) {
      latestByProductId.set(submission.productId, submission);
    }
  }
  return Array.from(latestByProductId.values()).sort(
    (left, right) => new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime(),
  );
}

/**
 * Decides what sync evidence to show on the Account Health card: prefer a real full-catalog
 * sync timestamp when one exists, otherwise fall back to the latest successful submission, and
 * only report "none" when there is genuinely no evidence of either.
 */
export function resolveAccountHealthSyncState(
  lastSyncAt: string | null | undefined,
  latestSuccessfulSubmission: SubmissionSyncSignal | null,
): AccountHealthSyncState {
  if (lastSyncAt) {
    return { kind: "full_sync", lastSyncAt };
  }
  if (latestSuccessfulSubmission) {
    return { kind: "submissions_only", latestSuccessfulSubmissionAt: latestSuccessfulSubmission.submittedAt };
  }
  return { kind: "none" };
}
