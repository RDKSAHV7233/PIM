import { translateError } from "@/lib/errors";

interface ProductDetailStatusAlertsProps {
  updateStatus: string;
  conflictVersion: string;
  deleteStatus: string;
  deleteError: string;
  /**
   * Names of sections that failed to load and are showing a fallback/empty
   * state as a result (e.g. "Channels", "Media"). CTO review remediation
   * (CODE-005): the page previously swallowed these failures into empty
   * arrays with no user-facing signal, which reads as "nothing here" rather
   * than "we couldn't load this" — risking wrong publish decisions made on
   * incomplete data.
   */
  degradedSections?: string[];
}

export function ProductDetailStatusAlerts({
  updateStatus,
  conflictVersion,
  deleteStatus,
  deleteError,
  degradedSections = [],
}: ProductDetailStatusAlertsProps) {
  return (
    <div aria-live="polite" aria-atomic="true" className="space-y-3">
      {degradedSections.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {degradedSections.length === 1
            ? `${degradedSections[0]} data couldn't be loaded right now — that section is showing a fallback/empty state, not the real data. `
            : `${degradedSections.join(", ")} data couldn't be loaded right now — those sections are showing a fallback/empty state, not the real data. `}
          Reload the page before making a publish decision based on what's shown here.
        </div>
      )}
      {updateStatus === "updated" && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          Product updated successfully.
        </div>
      )}
      {updateStatus === "validated" && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          Validation finished. Review any updated blockers before publishing.
        </div>
      )}
      {updateStatus === "conflict" && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {translateError("VERSION_CONFLICT").title}. {translateError("VERSION_CONFLICT").description}
          {conflictVersion ? ` Latest version is ${conflictVersion}.` : ""}
        </div>
      )}
      {updateStatus === "error" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Product update failed. Retry after reloading current data.
        </div>
      )}
      {updateStatus === "validate-error" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Product validation failed. Retry after reloading current data.
        </div>
      )}
      {deleteStatus === "deleted" && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          Product archived successfully.
        </div>
      )}
      {deleteStatus === "purged" && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          Product permanently deleted.
        </div>
      )}
      {deleteError ? (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          Product delete failed: {deleteError}
        </div>
      ) : null}
    </div>
  );
}
