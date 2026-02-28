"use client";

import type { Channel } from "@/lib/design-tokens";
import { channelConfig } from "@/lib/design-tokens";
import type { ReadinessStatus } from "@/lib/channel-readiness";

interface ChannelReadinessBadgeProps {
  channel: Channel;
  status: ReadinessStatus;
  errorCount?: number;
  warningCount?: number;
  onClick?: () => void;
}

function badgeContent(
  channel: Channel,
  status: ReadinessStatus,
  errorCount: number,
  warningCount: number,
): string {
  const label = channelConfig[channel].label;
  if (status === "ready") {
    return `[OK] ${label}`;
  }
  if (status === "warnings") {
    return `[!] ${label} ${warningCount}`;
  }
  if (status === "errors") {
    return `[X] ${label} ${errorCount}`;
  }
  if (status === "loading") {
    return `${label}...`;
  }
  return `[?] ${label}`;
}

function badgeStyle(status: ReadinessStatus) {
  if (status === "ready") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (status === "warnings") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (status === "errors") {
    return "border-red-200 bg-red-50 text-red-800";
  }
  if (status === "loading") {
    return "animate-pulse border-slate-200 bg-slate-100 text-slate-400";
  }
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function ChannelReadinessBadge({
  channel,
  status,
  errorCount = 0,
  warningCount = 0,
  onClick,
}: ChannelReadinessBadgeProps) {
  const className = `inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium ${badgeStyle(status)}`;
  const content = badgeContent(channel, status, errorCount, warningCount);

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        {content}
      </button>
    );
  }

  return <span className={className}>{content}</span>;
}
