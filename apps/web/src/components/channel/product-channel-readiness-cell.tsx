"use client";

import { memo, useEffect, useMemo } from "react";
import { ChannelReadinessBadge } from "@/components/channel/channel-readiness-badge";
import type { MarketplaceChannel } from "@/lib/api";
import {
  bestChannelReadinessStatus,
  buildLoadingReadiness,
  readyChannelCount,
  READINESS_CHANNELS,
  type ChannelReadinessResult,
  type ReadinessStatus,
} from "@/lib/channel-readiness";

interface ProductChannelReadinessCellProps {
  readiness?: Partial<Record<MarketplaceChannel, ChannelReadinessResult>>;
  onResolvedStatus?: (status: ReadinessStatus) => void;
}

export const ProductChannelReadinessCell = memo(function ProductChannelReadinessCell({
  readiness,
  onResolvedStatus,
}: ProductChannelReadinessCellProps) {
  const channelResults = useMemo(
    () => READINESS_CHANNELS.map((channel) => readiness?.[channel]),
    [readiness],
  );

  const overallStatus = useMemo(
    () => bestChannelReadinessStatus(channelResults),
    [channelResults],
  );

  const readyCount = useMemo(
    () => readyChannelCount(channelResults),
    [channelResults],
  );

  useEffect(() => {
    if (!onResolvedStatus || overallStatus === "loading") {
      return;
    }
    onResolvedStatus(overallStatus);
  }, [onResolvedStatus, overallStatus]);

  const badges = useMemo(
    () =>
      READINESS_CHANNELS.map((channel) => {
        const current = readiness?.[channel] ?? buildLoadingReadiness(channel);
        return (
          <ChannelReadinessBadge
            key={channel}
            channel={channel}
            status={current.status}
            errorCount={current.errorCount}
            warningCount={current.warningCount}
          />
        );
      }),
    [readiness],
  );

  return (
    <div className="flex flex-wrap items-center gap-1">
      {badges}
      {overallStatus !== "loading" && readyCount > 0 ? (
        <span className="ml-1 text-xs text-emerald-700" aria-label={`${readyCount} of ${READINESS_CHANNELS.length} channels ready`}>{readyCount}/{READINESS_CHANNELS.length}</span>
      ) : null}
    </div>
  );
});
