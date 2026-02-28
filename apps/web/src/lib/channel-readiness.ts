import type { MarketplaceChannel, MarketplaceSimulation } from "@/lib/api";

export type ReadinessStatus = "ready" | "warnings" | "errors" | "loading" | "unknown";

export interface ChannelReadinessResult {
  channel: MarketplaceChannel;
  status: ReadinessStatus;
  errorCount: number;
  warningCount: number;
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
