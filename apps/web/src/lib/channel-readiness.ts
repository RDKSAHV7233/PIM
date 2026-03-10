import type { MarketplaceChannel, MarketplaceSimulation } from "@/lib/api";

export type ReadinessStatus = "ready" | "warnings" | "errors" | "loading" | "unknown";

export const READINESS_CHANNELS: MarketplaceChannel[] = ["amazon", "flipkart", "meesho"];

export interface ChannelReadinessResult {
  channel: MarketplaceChannel;
  status: ReadinessStatus;
  errorCount: number;
  warningCount: number;
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

export function summarizeSimulation(
  channel: MarketplaceChannel,
  simulation: MarketplaceSimulation,
): ChannelReadinessResult {
  const channelErrorCount = simulation.channelIssues.filter((issue) => issue.severity === "error").length;
  const channelWarningCount = simulation.channelIssues.filter((issue) => issue.severity === "warning").length;
  const errorCount = simulation.missingFields.length + simulation.complianceSummary.errorCount + channelErrorCount;
  const warningCount = simulation.complianceSummary.warningCount + channelWarningCount;

  const status: ReadinessStatus =
    errorCount > 0 ? "errors" : warningCount > 0 ? "warnings" : "ready";

  return {
    channel,
    status,
    errorCount,
    warningCount,
  };
}
