"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChannelReadinessBadge } from "@/components/channel/channel-readiness-badge";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
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
  selectedTemplateId?: string;
  channelLinks?: Partial<Record<MarketplaceChannel, string>>;
  refreshSignal?: string;
  summary: {
    currentChannelLabel: string;
    cards: Array<{
      title: string;
      label: string;
      tone: "neutral" | "success" | "warning" | "danger" | "info";
      detail: string;
      href: string;
    }>;
    blockers: Array<{
      label: string;
      href: string;
    }>;
  };
}

export function ProductReadinessSummaryBar({
  productId,
  role,
  selectedTemplateId,
  channelLinks,
  refreshSignal,
  summary,
}: ProductReadinessSummaryBarProps) {
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
        const params = new URLSearchParams({
          productId,
          channel,
        });
        if (selectedTemplateId) {
          params.set("templateId", selectedTemplateId);
        }
        const response = await fetch(`/api/marketplace/readiness?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });
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
  }, [buildResults, productId, role, selectedTemplateId, refreshSignal]);

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
            href={channelLinks?.[channel]}
          />
        );
      }),
    [channelLinks, results],
  );

  return (
    <div className="sticky top-2 z-10 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-800">Channel readiness:</span>
          {badges}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={() => void runCheck()} disabled={checking}>
            {checking ? "Running..." : "Run Check"}
          </Button>
          <span className="text-xs text-slate-500">Last checked {lastCheckedLabel}</span>
        </div>
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-6">
        {summary.cards.map((card) => (
          <Link
            key={card.title}
            href={card.href}
            className="rounded-lg border border-slate-200 bg-slate-50 p-3 transition hover:border-slate-300 hover:bg-white"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{card.title}</p>
            <div className="mt-2 flex items-start justify-between gap-2">
              <StatusChip label={card.label} tone={card.tone} />
            </div>
            <p className="mt-2 text-xs text-slate-600">{card.detail}</p>
          </Link>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div>
          <p className="text-sm font-medium text-slate-900">Top blockers for {summary.currentChannelLabel}</p>
          <p className="mt-1 text-xs text-slate-500">
            Open the exact fix path before you queue an export or review publish readiness.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {summary.blockers.length > 0 ? (
            summary.blockers.map((blocker) => (
              <Link
                key={`${blocker.href}-${blocker.label}`}
                href={blocker.href}
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                {blocker.label}
              </Link>
            ))
          ) : (
            <span className="text-xs text-slate-500">No top blockers. Use the channel badges to spot marketplace-specific warnings.</span>
          )}
        </div>
      </div>
    </div>
  );
}

