import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StatusChipProps {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  icon?: ReactNode;
  "aria-label"?: string;
}

const chipTone: Record<NonNullable<StatusChipProps["tone"]>, string> = {
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  danger: "border-red-200 bg-red-50 text-red-700",
  info: "border-blue-200 bg-blue-50 text-blue-700",
};

export function StatusChip({ label, tone = "neutral", icon, "aria-label": ariaLabel }: StatusChipProps) {
  return (
    <span
      aria-label={ariaLabel}
      role={tone === "danger" || tone === "warning" ? "status" : undefined}
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
        chipTone[tone],
      )}
    >
      {icon ? <span className="mr-1 inline-flex">{icon}</span> : null}
      {label}
    </span>
  );
}
