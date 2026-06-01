import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type InlineAlertTone = "success" | "error" | "info" | "warning";

const toneClass: Record<InlineAlertTone, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  error: "border-red-200 bg-red-50 text-red-900",
  info: "border-blue-200 bg-blue-50 text-blue-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
};

interface InlineAlertProps {
  tone: InlineAlertTone;
  message: string;
  title?: string;
  action?: ReactNode;
  className?: string;
}

export function InlineAlert({ tone, message, title, action, className }: InlineAlertProps) {
  return (
    <div
      className={cn("rounded-lg border px-4 py-3 text-sm", toneClass[tone], className)}
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          {title ? <p className="font-semibold">{title}</p> : null}
          <p>{message}</p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}
