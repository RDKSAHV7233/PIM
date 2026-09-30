import { cn } from "@/lib/utils";

type StepTone = "complete" | "current" | "pending" | "rejected";

export interface WorkflowStep {
  label: string;
  tone: StepTone;
  description?: string;
}

export function WorkflowStepper({ steps, className }: { steps: WorkflowStep[]; className?: string }) {
  return (
    <div
      className={cn("rounded-xl border border-slate-200 bg-white p-4 shadow-sm", className)}
      aria-label="Workflow progress"
    >
      <ol className="flex" aria-label="Workflow steps">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          const isCurrent = step.tone === "current" || step.tone === "rejected";
          const statusLabel =
            step.tone === "complete"
              ? "Complete"
              : step.tone === "current"
                ? "Current"
                : step.tone === "rejected"
                  ? "Needs changes"
                  : "Pending";
          return (
            <li
              key={step.label}
              className={cn("flex items-start", !isLast && "flex-1")}
              aria-current={isCurrent ? "step" : undefined}
            >
              <div className="flex flex-col items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold",
                    step.tone === "complete" && "bg-emerald-700 text-white",
                    step.tone === "current" && "bg-slate-900 text-white",
                    step.tone === "pending" && "border-2 border-slate-200 text-slate-400",
                    step.tone === "rejected" && "bg-rose-500 text-white",
                  )}
                >
                  {step.tone === "complete" ? "\u2713" : step.tone === "rejected" ? "\u2717" : index + 1}
                </span>
                <div className="max-w-[7rem] text-center">
                  <span className="sr-only">{statusLabel}: </span>
                  <span
                    className={cn(
                      "block text-xs leading-tight",
                      step.tone === "complete" && "text-emerald-700",
                      step.tone === "current" && "font-semibold text-slate-900",
                      step.tone === "pending" && "text-slate-500",
                      step.tone === "rejected" && "font-semibold text-rose-700",
                    )}
                  >
                    {step.label}
                  </span>
                  {step.description ? (
                    <span className="mt-1 block text-[11px] leading-tight text-slate-500">
                      {step.description}
                    </span>
                  ) : null}
                </div>
              </div>
              {!isLast ? (
                <div
                  aria-hidden="true"
                  className={cn(
                    "mt-3.5 h-px flex-1",
                    step.tone === "complete" ? "bg-emerald-300" : "bg-slate-200",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
