"use client";

import { useEffect, useMemo } from "react";
import { ChannelReadinessBadge } from "@/components/channel/channel-readiness-badge";
import type { MarketplaceChannel } from "@/lib/api";
import {
  aggregateReadinessStatus,
  buildLoadingReadiness,
  READINESS_CHANNELS,
  type ChannelReadinessResult,
  type ReadinessStatus,
} from "@/lib/channel-readiness";

interface ProductChannelReadinessCellProps {
  readiness?: Partial<Record<MarketplaceChannel, ChannelReadinessResult>>;
  onResolvedStatus?: (status: ReadinessStatus) => void;
}

export function ProductChannelReadinessCell({
  readiness,
  onResolvedStatus,
}: ProductChannelReadinessCellProps) {
  const overallStatus = useMemo(
    () => aggregateReadinessStatus(READINESS_CHANNELS.map((channel) => readiness?.[channel])),
    [readiness],
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

  return <div className="flex flex-wrap gap-1">{badges}</div>;
}
