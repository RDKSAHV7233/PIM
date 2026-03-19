import { translateError } from "@/lib/errors";

interface ProductDetailStatusAlertsProps {
  updateStatus: string;
  conflictVersion: string;
  deleteStatus: string;
  deleteError: string;
}

export function ProductDetailStatusAlerts({
  updateStatus,
  conflictVersion,
  deleteStatus,
  deleteError,
}: ProductDetailStatusAlertsProps) {
  return (
    <>
      {updateStatus === "updated" && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          Product updated successfully.
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
    </>
  );
}
