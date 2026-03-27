import type { AppRole, MarketplaceChannel } from "@/lib/api";
import { READINESS_CHANNELS } from "@/lib/channel-readiness";
import type { DetailTab } from "./product-detail-types";

export const DETAIL_TABS: Array<{ key: DetailTab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "content", label: "Content" },
  { key: "attributes", label: "Attributes" },
  { key: "variants", label: "Variants" },
  { key: "media", label: "Media" },
  { key: "channels", label: "Channels" },
  { key: "quality", label: "Quality" },
  { key: "activity", label: "Activity" },
];

export function normalizeDetailTab(value: string | undefined): DetailTab {
  const normalized = String(value ?? "").trim().toLowerCase();
  const matched = DETAIL_TABS.find((tab) => tab.key === normalized);
  return matched?.key ?? "overview";
}

export function normalizeChannel(value: string | undefined): MarketplaceChannel {
  if (value && READINESS_CHANNELS.includes(value as MarketplaceChannel)) {
    return value as MarketplaceChannel;
  }
  return READINESS_CHANNELS[0] ?? "amazon";
}

export function normalizeTemplateId(value: string | undefined): string | undefined {
  const trimmed = String(value ?? "").trim();
  return trimmed || undefined;
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

export function mapMarketplaceChannelToConnectorSlug(channel: MarketplaceChannel): string {
  if (channel === "amazon") {
    return "amazon-in";
  }
  return channel;
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
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return "-";
  }
  return timestamp.toLocaleString();
}

export function RoleHiddenInput({ role }: { role: AppRole }) {
  return <input type="hidden" name="actorRole" value={role} />;
}
