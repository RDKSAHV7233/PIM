import { cn } from "@/lib/utils";

type InlineAlertTone = "success" | "error" | "info" | "warning";

const toneClass: Record<InlineAlertTone, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  error: "border-rose-200 bg-rose-50 text-rose-800",
  info: "border-sky-200 bg-sky-50 text-sky-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
};

interface InlineAlertProps {
  tone: InlineAlertTone;
  message: string;
  title?: string;
  className?: string;
}

export function InlineAlert({ tone, message, title, className }: InlineAlertProps) {
  return (
    <div
      className={cn("rounded-md border px-3 py-2 text-sm", toneClass[tone], className)}
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      <p>{message}</p>
    </div>
  );
}
