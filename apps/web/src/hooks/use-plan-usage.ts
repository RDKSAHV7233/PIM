"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppRole, PlanUsageResponse } from "@/lib/api";

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedUsageEntry {
  expiresAt: number;
  data: PlanUsageResponse;
}

const usageCache = new Map<string, CachedUsageEntry>();

export interface UsePlanUsageResult {
  usage: PlanUsageResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  skuUsagePercent: number | null;
}

function computeUsagePercent(current: number, limit: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(limit) || limit <= 0) {
    return null;
  }
  return Math.round((current / limit) * 100);
}

export function usePlanUsage(role: AppRole): UsePlanUsageResult {
  const [usage, setUsage] = useState<PlanUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (role !== "admin" && role !== "editor") {
      setUsage(null);
      setError(null);
      setLoading(false);
      return;
    }

    const cacheKey = role;
    const cached = usageCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      setUsage(cached.data);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/billing/usage`, {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Unable to fetch billing usage.");
      }
      const data = (await response.json()) as PlanUsageResponse;
      usageCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
      setUsage(data);
      setError(null);
    } catch (fetchError: unknown) {
      const message = fetchError instanceof Error ? fetchError.message : "Unable to fetch billing usage.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const skuUsagePercent = useMemo(() => {
    if (!usage) {
      return null;
    }
    return computeUsagePercent(usage.skus.current, usage.skus.limit);
  }, [usage]);

  return {
    usage,
    loading,
    error,
    refresh,
    skuUsagePercent,
  };
}

