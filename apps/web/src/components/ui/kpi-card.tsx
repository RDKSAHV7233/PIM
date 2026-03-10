import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string | number;
  helper?: string;
  tone?: "default" | "success" | "warning" | "danger" | "info";
  action?: ReactNode;
  href?: string;
}

const toneStyles: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  default: "border-slate-200 bg-white",
  success: "border-emerald-200 bg-emerald-50/70",
  warning: "border-amber-200 bg-amber-50/80",
  danger: "border-red-200 bg-red-50/80",
  info: "border-blue-200 bg-blue-50/80",
};

export function KpiCard({ label, value, helper, tone = "default", action, href }: KpiCardProps) {
  return (
    <article className={cn("rounded-xl border bg-white p-4 shadow-sm", toneStyles[tone])}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      {href ? (
        <Link
          href={href}
          className="mt-2 inline-flex text-2xl font-semibold text-slate-900 underline-offset-4 hover:text-slate-700 hover:underline"
        >
          {value}
        </Link>
      ) : (
        <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      )}
      {helper ? <p className="mt-1 text-xs text-slate-600">{helper}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </article>
  );
}
