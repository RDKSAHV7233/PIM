"use client";

import { useEffect, useMemo, useState } from "react";
import { ChannelReadinessBadge } from "@/components/channel/channel-readiness-badge";
import type { AppRole, MarketplaceChannel } from "@/lib/api";
import type { ChannelReadinessResult, ReadinessStatus } from "@/lib/channel-readiness";

const CHANNELS: MarketplaceChannel[] = ["amazon", "flipkart", "meesho"];
const MAX_CONCURRENT_REQUESTS = 3;

type CacheKey = string;

const readinessCache = new Map<CacheKey, ChannelReadinessResult>();

type QueueTask = () => Promise<void>;
const queue: QueueTask[] = [];
let activeRequests = 0;

function runQueue() {
  while (activeRequests < MAX_CONCURRENT_REQUESTS && queue.length > 0) {
    const task = queue.shift();
    if (!task) {
      return;
    }
    activeRequests += 1;
    task().finally(() => {
      activeRequests -= 1;
      runQueue();
    });
  }
}

function enqueue(task: QueueTask) {
  queue.push(task);
  runQueue();
}

function getCacheKey(productId: string, channel: MarketplaceChannel, role: AppRole): CacheKey {
  return `${role}:${productId}:${channel}`;
}

function toChannel(value: MarketplaceChannel): "amazon" | "flipkart" | "meesho" {
  if (value === "flipkart" || value === "meesho") {
    return value;
  }
  return "amazon";
}

type LocalReadinessState = Record<MarketplaceChannel, ChannelReadinessResult>;

function buildLoadingState(channel: MarketplaceChannel): ChannelReadinessResult {
  return {
    channel,
    status: "loading",
    errorCount: 0,
    warningCount: 0,
  };
}

function buildUnknownState(channel: MarketplaceChannel): ChannelReadinessResult {
  return {
    channel,
    status: "unknown",
    errorCount: 0,
    warningCount: 0,
  };
}

interface ProductChannelReadinessCellProps {
  productId: string;
  role: AppRole;
}

export function ProductChannelReadinessCell({ productId, role }: ProductChannelReadinessCellProps) {
  const [state, setState] = useState<LocalReadinessState>(() => ({
    amazon: buildLoadingState("amazon"),
    flipkart: buildLoadingState("flipkart"),
    meesho: buildLoadingState("meesho"),
  }));

  useEffect(() => {
    let cancelled = false;

    CHANNELS.forEach((channel) => {
      const key = getCacheKey(productId, channel, role);
      const cached = readinessCache.get(key);
      if (cached) {
        setState((previous) => ({ ...previous, [channel]: cached }));
        return;
      }

      setState((previous) => ({ ...previous, [channel]: buildLoadingState(channel) }));
      enqueue(async () => {
        try {
          const response = await fetch(
            `/api/marketplace/readiness?productId=${encodeURIComponent(productId)}&channel=${encodeURIComponent(
              channel,
            )}&role=${encodeURIComponent(role)}`,
            {
              method: "GET",
              cache: "no-store",
            },
          );
          if (!response.ok) {
            throw new Error("readiness request failed");
          }
          const result = (await response.json()) as ChannelReadinessResult;
          if (cancelled) {
            return;
          }
          readinessCache.set(key, result);
          setState((previous) => ({ ...previous, [channel]: result }));
        } catch {
          if (cancelled) {
            return;
          }
          const fallback = buildUnknownState(channel);
          readinessCache.set(key, fallback);
          setState((previous) => ({ ...previous, [channel]: fallback }));
        }
      });
    });

    return () => {
      cancelled = true;
    };
  }, [productId, role]);

  const badges = useMemo(
    () =>
      CHANNELS.map((channel) => {
        const current = state[channel];
        const status: ReadinessStatus = current?.status ?? "unknown";
        return (
          <ChannelReadinessBadge
            key={channel}
            channel={toChannel(channel)}
            status={status}
            errorCount={current?.errorCount ?? 0}
            warningCount={current?.warningCount ?? 0}
          />
        );
      }),
    [state],
  );

  return <div className="flex flex-wrap gap-1">{badges}</div>;
}
