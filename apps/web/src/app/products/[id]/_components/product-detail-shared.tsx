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
    "A fallback mapping is in use. Select 'Acknowledge fallback usage' in the form below.",
  no_mapping_for_category:
    "No channel mapping exists for this category. Visit Channel Mappings to configure one.",
  product_not_approved: "Product must be approved before it can be queued for export.",
  credentials_expired: "Connector credentials have expired. Re-authenticate on the Credentials tab.",
  category_scope_mismatch: "This product's category does not match the mapping scope.",
};

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
  if (normalized === "active" || normalized === "ready" || normalized === "accepted") {
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
