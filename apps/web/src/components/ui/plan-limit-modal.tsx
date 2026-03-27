import Link from "next/link";

interface PlanLimitModalProps {
  isOpen: boolean;
  resource: string;
  limit: number;
  current: number;
  upgradeUrl: string;
  dismissHref: string;
}

function normalizeResourceLabel(resource: string): string {
  const normalized = resource.toLowerCase();
  if (normalized === "skus") {
    return "SKU";
  }
  if (normalized === "submissions") {
    return "submission";
  }
  if (normalized === "storagegb" || normalized === "storage_gb") {
    return "storage";
  }
  return resource;
}

export function PlanLimitModal({
  isOpen,
  resource,
  limit,
  current,
  upgradeUrl,
  dismissHref,
}: PlanLimitModalProps) {
  if (!isOpen) {
    return null;
  }

  const resourceLabel = normalizeResourceLabel(resource);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">You reached your {resourceLabel} limit</h2>
        <p className="mt-2 text-sm text-slate-700">
          Your current plan includes <strong>{limit}</strong> {resourceLabel}
          {limit === 1 ? "" : "s"}. You are currently using <strong>{current}</strong>.
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Link href={dismissHref} className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700">
            Maybe later
          </Link>
          <Link
            href={upgradeUrl}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
          >
            Request upgrade
          </Link>
        </div>
      </div>
    </div>
  );
}
