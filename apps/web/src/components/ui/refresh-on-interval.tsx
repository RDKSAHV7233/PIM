"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface RefreshOnIntervalProps {
  enabled?: boolean;
  intervalMs?: number;
}

export function RefreshOnInterval({ enabled = true, intervalMs = 30_000 }: RefreshOnIntervalProps) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }
      router.refresh();
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [enabled, intervalMs, router]);

  return null;
}
