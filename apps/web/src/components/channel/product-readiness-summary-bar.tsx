"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChannelReadinessBadge } from "@/components/channel/channel-readiness-badge";
import { Button } from "@/components/ui/button";
import type { AppRole, MarketplaceChannel } from "@/lib/api";
import { READINESS_CHANNELS, type ChannelReadinessResult } from "@/lib/channel-readiness";

function relativeTime(from: Date | null): string {
  if (!from) {
    return "not checked";
  }
  const seconds = Math.max(0, Math.floor((Date.now() - from.getTime()) / 1000));
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

interface ProductReadinessSummaryBarProps {
  productId: string;
  role: AppRole;
}

export function ProductReadinessSummaryBar({ productId, role }: ProductReadinessSummaryBarProps) {
  const buildResults = useCallback(
    (status: "loading" | "unknown"): Partial<Record<MarketplaceChannel, ChannelReadinessResult>> =>
      Object.fromEntries(
        READINESS_CHANNELS.map((channel) => [
          channel,
          { channel, status, errorCount: 0, warningCount: 0 },
        ]),
      ) as Partial<Record<MarketplaceChannel, ChannelReadinessResult>>,
    [],
  );
  const [results, setResults] = useState<Partial<Record<MarketplaceChannel, ChannelReadinessResult>>>(() =>
    buildResults("loading"),
  );
  const [checking, setChecking] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [lastCheckedLabel, setLastCheckedLabel] = useState("not checked");

  const runCheck = useCallback(async () => {
    setChecking(true);
    setResults(buildResults("loading"));

    const settled = await Promise.allSettled(
      READINESS_CHANNELS.map(async (channel) => {
        const response = await fetch(
          `/api/marketplace/readiness?productId=${encodeURIComponent(productId)}&channel=${encodeURIComponent(
            channel,
          )}`,
          {
            method: "GET",
            cache: "no-store",
          },
        );
        if (!response.ok) {
          throw new Error("readiness request failed");
        }
        return (await response.json()) as ChannelReadinessResult;
      }),
    );

    const next = buildResults("unknown");

    READINESS_CHANNELS.forEach((channel, index) => {
      const item = settled[index];
      if (item.status === "fulfilled") {
        next[channel] = item.value;
      }
    });

    setResults(next);
    const checkedAt = new Date();
    setLastCheckedAt(checkedAt);
    setLastCheckedLabel(relativeTime(checkedAt));
    setChecking(false);
  }, [buildResults, productId, role]);

  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  useEffect(() => {
    if (!lastCheckedAt) {
      setLastCheckedLabel("not checked");
      return;
    }
    setLastCheckedLabel(relativeTime(lastCheckedAt));
    const intervalId = window.setInterval(() => {
      setLastCheckedLabel(relativeTime(lastCheckedAt));
    }, 30000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [lastCheckedAt]);

  const badges = useMemo(
    () =>
      READINESS_CHANNELS.map((channel) => {
        const item = results[channel] ?? {
          channel,
          status: "unknown" as const,
          errorCount: 0,
          warningCount: 0,
        };
        return (
          <ChannelReadinessBadge
            key={channel}
            channel={channel}
            status={item.status}
            errorCount={item.errorCount}
            warningCount={item.warningCount}
            onClick={() => {
              document
                .getElementById("channel-simulator-section")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          />
        );
      }),
    [results],
  );

  return (
    <div className="sticky top-2 z-10 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-800">Channel Readiness:</span>
          {badges}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={() => void runCheck()} disabled={checking}>
            {checking ? "Running..." : "Run Check"}
          </Button>
          <span className="text-xs text-slate-500">Last checked {lastCheckedLabel}</span>
        </div>
      </div>
    </div>
  );
}

