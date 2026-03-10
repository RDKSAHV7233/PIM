"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface RefreshOnIntervalProps {
  intervalMs?: number;
}

export function RefreshOnInterval({ intervalMs = 30_000 }: RefreshOnIntervalProps) {
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(() => {
      router.refresh();
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [intervalMs, router]);

  return null;
}
