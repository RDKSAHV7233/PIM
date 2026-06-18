import { Card, CardTitle } from "@/components/ui/card";

function ProgressBar({ pct }: { pct: number }) {
  const tone =
    pct === 0 ? "bg-red-400" : pct < 100 ? "bg-amber-400" : "bg-emerald-500";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
      <div
        className={`h-full rounded-full transition-all duration-300 ${tone}`}
        style={{ width: `${pct}%` }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${pct}% of required fields mapped`}
      />
    </div>
  );
}

export function MappingCompletionChecklist({
  requiredCount,
  mappedRequiredCount,
  unmappedRequired,
}: {
  requiredCount: number;
  mappedRequiredCount: number;
  unmappedRequired: string[];
}) {
  if (requiredCount === 0) {
    return null;
  }

  const missingCount = requiredCount - mappedRequiredCount;
  const pct = requiredCount > 0 ? Math.round((mappedRequiredCount / requiredCount) * 100) : 0;
  const allDone = missingCount === 0;

  return (
    <Card>
      <CardTitle>Required field progress</CardTitle>
      <p className="text-xs text-slate-500">
        Required fields must be mapped before the draft can clear readiness and publish.
      </p>
      <div className="mt-3 space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-2xl font-semibold text-slate-900">
            {mappedRequiredCount}
            <span className="text-sm font-normal text-slate-500"> / {requiredCount}</span>
          </p>
          <span className={`text-xs font-semibold ${allDone ? "text-emerald-700" : "text-amber-700"}`}>
            {allDone ? "All mapped" : `${missingCount} remaining`}
          </span>
        </div>
        <ProgressBar pct={pct} />
        {allDone ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            All required fields are mapped. Save the draft to proceed to validation.
          </div>
        ) : (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Still missing
            </p>
            <ul className="space-y-1">
              {unmappedRequired.slice(0, 5).map((field) => (
                <li key={field} className="flex items-center gap-2">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-amber-400 bg-white" aria-hidden="true" />
                  <a
                    href="#mapping-draft"
                    className="text-xs text-slate-700 underline-offset-2 hover:underline"
                  >
                    {field}
                  </a>
                </li>
              ))}
              {unmappedRequired.length > 5 ? (
                <li className="text-xs text-slate-500">
                  +{unmappedRequired.length - 5} more — scroll to the draft editor
                </li>
              ) : null}
            </ul>
          </div>
        )}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Scroll to <a href="#mapping-draft" className="underline underline-offset-2">Step 2</a> to map these fields.
      </p>
    </Card>
  );
}
