import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string | number;
  helper?: string;
  tone?: "default" | "success" | "warning" | "danger" | "info";
  action?: ReactNode;
}

const toneStyles: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  default: "border-slate-200",
  success: "border-emerald-200",
  warning: "border-amber-200",
  danger: "border-red-200",
  info: "border-blue-200",
};

export function KpiCard({ label, value, helper, tone = "default", action }: KpiCardProps) {
  return (
    <article className={cn("rounded-xl border bg-white p-4 shadow-sm", toneStyles[tone])}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      {helper ? <p className="mt-1 text-xs text-slate-600">{helper}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </article>
  );
}
