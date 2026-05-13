import { cn } from "@/lib/utils";

export interface TimelineItem {
  id: string;
  title: string;
  description?: string;
  meta?: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}

interface TimelineProps {
  items: TimelineItem[];
  className?: string;
}

const dotToneClasses: Record<NonNullable<TimelineItem["tone"]>, string> = {
  neutral: "border-slate-300 bg-slate-100",
  success: "border-emerald-300 bg-emerald-100",
  warning: "border-amber-300 bg-amber-100",
  danger: "border-rose-300 bg-rose-100",
  info: "border-blue-300 bg-blue-100",
};

export function Timeline({ items, className }: TimelineProps) {
  return (
    <ol className={cn("space-y-3", className)}>
      {items.map((item, index) => {
        const tone = item.tone ?? "neutral";
        const isLast = index === items.length - 1;

        return (
          <li key={item.id} className="grid grid-cols-[1.25rem_1fr] gap-3">
            <div className="flex flex-col items-center">
              <span className={cn("mt-1 h-3 w-3 rounded-full border", dotToneClasses[tone])} aria-hidden="true" />
              {!isLast ? <span className="mt-1 min-h-6 w-px flex-1 bg-slate-200" aria-hidden="true" /> : null}
            </div>
            <div className="space-y-1 pb-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-slate-900">{item.title}</p>
                {item.meta ? <span className="text-xs text-slate-500">{item.meta}</span> : null}
              </div>
              {item.description ? <p className="text-sm text-slate-600">{item.description}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
