import type { MarketplaceChannel } from "@/lib/api";
import {
  mapConnectorSlugToMarketplaceChannel,
  MARKETPLACE_CHANNELS,
} from "@/lib/marketplace-channels";

export type ReadinessStatus = "ready" | "warnings" | "errors" | "loading" | "unknown";

// Exclude channels that are not yet live (planned/stub only) from readiness polling
const HIDDEN_READINESS_CHANNELS = new Set<MarketplaceChannel>(["meesho"]);
const BASE_READINESS_CHANNELS: MarketplaceChannel[] = MARKETPLACE_CHANNELS.filter(
  (ch) => !HIDDEN_READINESS_CHANNELS.has(ch),
);

function resolveStubReadinessChannels(): Set<MarketplaceChannel> {
  const values = String(process.env.NEXT_PUBLIC_CONNECTOR_STUB_SLUGS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  const channels = new Set<MarketplaceChannel>();
  for (const value of values) {
    const channel = mapConnectorSlugToMarketplaceChannel(value);
    if (channel) {
      channels.add(channel);
    }
  }
  return channels;
}

const stubChannels = resolveStubReadinessChannels();
export const READINESS_CHANNELS: MarketplaceChannel[] = BASE_READINESS_CHANNELS.filter(
  (channel) => !stubChannels.has(channel),
);

export interface ChannelReadinessResult {
  channel: MarketplaceChannel;
  status: ReadinessStatus;
  errorCount: number;
  warningCount: number;
  evalFailed?: boolean;
}

export interface ProductReadinessBatchItem {
  productId: string;
  readiness: ChannelReadinessResult[];
}

export interface ProductReadinessBatchResponse {
  items: ProductReadinessBatchItem[];
}

export function buildLoadingReadiness(channel: MarketplaceChannel): ChannelReadinessResult {
  return {
    channel,
    status: "loading",
    errorCount: 0,
    warningCount: 0,
  };
}

export function buildUnknownReadiness(channel: MarketplaceChannel): ChannelReadinessResult {
  return {
    channel,
    status: "unknown",
    errorCount: 0,
    warningCount: 0,
  };
}

export function aggregateReadinessStatus(results: Array<ChannelReadinessResult | undefined>): ReadinessStatus {
  const statuses = results.map((item) => item?.status ?? "loading");
  if (statuses.some((status) => status === "loading")) {
    return "loading";
  }
  if (statuses.some((status) => status === "errors")) {
    return "errors";
  }
  if (statuses.some((status) => status === "warnings")) {
    return "warnings";
  }
  if (statuses.some((status) => status === "unknown")) {
    return "unknown";
  }
  return "ready";
}

export function bestChannelReadinessStatus(results: Array<ChannelReadinessResult | undefined>): ReadinessStatus {
  const statuses = results.map((item) => item?.status ?? "loading");
  if (statuses.some((status) => status === "loading")) {
    return "loading";
  }
  if (statuses.some((status) => status === "ready")) {
    return "ready";
  }
  if (statuses.some((status) => status === "warnings")) {
    return "warnings";
  }
  if (statuses.some((status) => status === "unknown")) {
    return "unknown";
  }
  return "errors";
}

export function readyChannelCount(results: Array<ChannelReadinessResult | undefined>): number {
  return results.filter((item) => item?.status === "ready").length;
}

