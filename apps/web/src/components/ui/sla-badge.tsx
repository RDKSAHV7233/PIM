import { cn } from "@/lib/utils";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type SlaStatus = "overdue" | "at-risk" | "ok" | null;

export function getSlaStatus(slaDeadlineAt: string | null | undefined): SlaStatus {
  if (!slaDeadlineAt) return null;
  const deadline = Date.parse(slaDeadlineAt);
  if (Number.isNaN(deadline)) return null;
  const now = Date.now();
  const msRemaining = deadline - now;
  if (msRemaining < 0) return "overdue";
  if (msRemaining < MS_PER_DAY) return "at-risk";
  return "ok";
}

function formatSlaLabel(slaDeadlineAt: string): string {
  const deadline = Date.parse(slaDeadlineAt);
  const now = Date.now();
  const msRemaining = deadline - now;
  if (msRemaining < 0) {
    const daysOverdue = Math.ceil(Math.abs(msRemaining) / MS_PER_DAY);
    return daysOverdue === 1 ? "1 day overdue" : `${daysOverdue} days overdue`;
  }
  const hoursRemaining = Math.floor(msRemaining / (60 * 60 * 1000));
  if (hoursRemaining < 24) {
    return hoursRemaining <= 1 ? "< 1h left" : `${hoursRemaining}h left`;
  }
  const daysRemaining = Math.ceil(msRemaining / MS_PER_DAY);
  return `${daysRemaining} days left`;
}

interface SlaBadgeProps {
  slaDeadlineAt?: string | null;
  className?: string;
}

export function SlaBadge({ slaDeadlineAt, className }: SlaBadgeProps) {
  const status = getSlaStatus(slaDeadlineAt);

  if (!status || status === "ok") return null;

  const isOverdue = status === "overdue";
  const label = slaDeadlineAt ? formatSlaLabel(slaDeadlineAt) : "";

  return (
    <span
      role="status"
      aria-label={isOverdue ? `SLA overdue: ${label}` : `SLA at risk: ${label}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-bold whitespace-nowrap",
        isOverdue
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-amber-200 bg-amber-50 text-amber-700",
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3 w-3 shrink-0"
        aria-hidden
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      {label}
    </span>
  );
}
