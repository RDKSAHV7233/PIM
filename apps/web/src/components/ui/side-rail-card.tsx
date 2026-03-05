import type { ReactNode } from "react";

interface SideRailCardProps {
  title: string;
  children: ReactNode;
}

export function SideRailCard({ title, children }: SideRailCardProps) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      <div className="mt-2 space-y-2 text-sm text-slate-700">{children}</div>
    </section>
  );
}
