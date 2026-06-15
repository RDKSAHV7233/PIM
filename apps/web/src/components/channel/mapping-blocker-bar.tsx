import { describeReadinessCode } from "@/lib/channel-mappings";

export function MappingBlockerBar({
  blockers,
  warnings,
}: {
  blockers: string[];
  warnings: string[];
}) {
  if (blockers.length === 0) {
    return null;
  }

  return (
    <div
      role="alert"
      className="sticky top-16 z-20 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-3">
        <p
          className="text-xs font-semibold text-amber-900"
          title="These items must be resolved before publish can clear. Click any blocker to jump to the fix."
        >
          {blockers.length} blocker{blockers.length !== 1 ? "s" : ""}
          {warnings.length > 0 ? ` · ${warnings.length} warning${warnings.length !== 1 ? "s" : ""}` : ""}
          {" "}blocking publish
        </p>
        <div className="flex flex-wrap gap-2">
          {blockers.slice(0, 3).map((code) => (
            <a
              key={code}
              href="#mapping-readiness"
              className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
            >
              {describeReadinessCode(code)}
            </a>
          ))}
          {blockers.length > 3 ? (
            <a
              href="#mapping-readiness"
              className="rounded-md border border-amber-200 bg-white px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
            >
              +{blockers.length - 3} more
            </a>
          ) : null}
        </div>
        <a
          href="#mapping-readiness"
          className="ml-auto text-xs font-medium text-amber-900 underline underline-offset-2 hover:text-amber-700"
        >
          View all →
        </a>
      </div>
    </div>
  );
}
