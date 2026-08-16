import type { AppRole, MarketplaceChannel } from "@/lib/api";
import { formatDateTime as fmtDT } from "@/lib/format";
import { READINESS_CHANNELS } from "@/lib/channel-readiness";
import {
  DEFAULT_MARKETPLACE_CHANNEL,
  mapMarketplaceChannelToConnectorSlug,
  normalizeMarketplaceChannel,
} from "@/lib/marketplace-channels";
import type { DetailTab } from "./product-detail-types";

export { mapMarketplaceChannelToConnectorSlug };

const BLOCKER_MESSAGES: Record<string, string> = {
  connector_not_active: "Shopify connector is not active. Visit Connections to check the installation.",
  no_active_connector: "No active connector is installed for this channel.",
  product_blocking_issues_open:
    "Product has blocking quality issues - fix them on the Quality tab before queuing.",
  fallback_ack_required:
    "A fallback mapping is in use. Check 'Acknowledge fallback mapping usage' in the export form below before queuing.",
  no_mapping_for_category:
    "No channel mapping exists for this category. Visit Channel Mappings to configure one.",
  product_not_approved: "Product must be approved before it can be queued for export.",
  credentials_expired: "Connector credentials have expired. Re-authenticate on the Credentials tab.",
  category_scope_mismatch: "This product's category does not match the mapping scope.",
};

// Publish-readiness blocker/warning codes that are genuinely about the channel
// field mapping itself (apps/api/src/marketplace/connector-mapping.service.ts).
// Everything else evaluateConnectorPublishReadiness returns — approval status,
// connector installation/credentials, quality blockers — is already surfaced by
// its own dedicated readiness card (Approval status, Connector readiness, Product
// readiness). Without this filter, the "Mapping readiness" card shows "Blocked"
// for e.g. an unapproved product even though the mapping itself is fine, which
// sends operators back to fix mapping data that was never actually the problem.
const MAPPING_BLOCKER_CODES = new Set([
  "mapping_compatibility_blocked",
  "mapping_remap_required",
  "field_mappings_missing",
  "fallback_ack_required",
  "required_attribute_mapping_missing",
  "product_category_scope_mismatch",
]);

const MAPPING_WARNING_CODES = new Set([
  "using_system_default_mapping",
  "mapping_deprecated",
  "fallback_mapping_applied",
]);

export function isMappingBlockerCode(code: string): boolean {
  return MAPPING_BLOCKER_CODES.has(code);
}

export function isMappingWarningCode(code: string): boolean {
  return MAPPING_WARNING_CODES.has(code);
}

/**
 * VEXA-202: Shopify's managed-install path creates the installation row as
 * status "ACTIVE" before the OAuth handshake completes — metadata.shopId is
 * only written once fetchShopIdentity succeeds. Without this check, a
 * freshly-installed-but-unauthorized Shopify connector reads as "Connected"
 * everywhere a plain `status === 'ACTIVE'` check is used. Other connectors
 * don't use this two-phase metadata pattern, so this is a no-op for them.
 */
export function isConnectorReadyToPublish(connector: {
  slug: string;
  status: string;
  metadata?: Record<string, unknown>;
  credentialsValidated?: boolean;
}): boolean {
  if (connector.status !== "ACTIVE") {
    return false;
  }
  if (connector.slug === "shopify") {
    const shopId = connector.metadata?.shopId;
    return typeof shopId === "string" && shopId.trim().length > 0;
  }
  // VEXA-301-SPIKE: Flipkart/Amazon can reach status 'ACTIVE' with zero credentials
  // ever validated (blank-credentials install path skips validateCredentials()
  // entirely) — credentialsValidated is false in exactly that case, true otherwise.
  if (connector.slug === "flipkart" || connector.slug === "amazon-in") {
    return connector.credentialsValidated !== false;
  }
  return true;
}

export const DETAIL_TABS: Array<{ key: DetailTab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "content", label: "Content" },
  { key: "attributes", label: "Attributes" },
  { key: "variants", label: "Variants" },
  { key: "media", label: "Media" },
  { key: "pricing", label: "Pricing" },
  { key: "channels", label: "Channels" },
  { key: "quality", label: "Quality" },
  { key: "activity", label: "Activity" },
  { key: "relationships", label: "Relationships" },
];

export function normalizeDetailTab(value: string | undefined): DetailTab {
  const normalized = String(value ?? "").trim().toLowerCase();
  const matched = DETAIL_TABS.find((tab) => tab.key === normalized);
  return matched?.key ?? "overview";
}

export function normalizeChannel(value: string | undefined): MarketplaceChannel {
  return normalizeMarketplaceChannel(
    value,
    READINESS_CHANNELS,
    READINESS_CHANNELS[0] ?? DEFAULT_MARKETPLACE_CHANNEL,
  );
}

export function normalizeTemplateId(value: string | undefined): string | undefined {
  const trimmed = String(value ?? "").trim();
  return trimmed || undefined;
}

export function translateReadinessBlocker(code: string): string {
  return BLOCKER_MESSAGES[code] ?? code;
}

export function lifecycleStatusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  const normalized = status.toLowerCase();
  if (normalized === "active" || normalized === "ready" || normalized === "accepted" || normalized === "completed") {
    return "success";
  }
  if (normalized === "failed" || normalized === "dead_letter" || normalized === "rejected") {
    return "danger";
  }
  if (normalized === "retrying" || normalized === "queued" || normalized === "in_review" || normalized === "skipped") {
    return "warning";
  }
  if (normalized === "draft") {
    return "info";
  }
  return "neutral";
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function getAllowedValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter((item) => item.length > 0);
  }
  if (value && typeof value === "object" && "values" in value && Array.isArray((value as { values: unknown[] }).values)) {
    return (value as { values: unknown[] }).values
      .map((item) => String(item ?? "").trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

export function formatDateTime(value: string): string {
  return fmtDT(value);
}

export function formatAttributeLabel(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

export function formatAttributeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

// Attribute keys already present on the product but not covered by the category's
// formal attribute schema (e.g. legacy import data, or a category whose attribute
// definitions haven't been configured yet). Surfaced read-only so existing data is
// never invisible just because there's no formal type/allowed-values info for it.
export function getUndefinedAttributeEntries(
  productAttributes: Record<string, unknown>,
  definitions: { key: string }[],
): Array<[string, unknown]> {
  const definedKeys = new Set(definitions.map((definition) => definition.key));
  return Object.entries(productAttributes).filter(([key, value]) => {
    if (definedKeys.has(key)) return false;
    if (key === "mainImageUrl") return false;
    if (value === null || value === undefined) return false;
    if (typeof value === "object") return false;
    return true;
  });
}
