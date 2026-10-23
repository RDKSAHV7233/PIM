import Link from "@/components/ui/app-link";
import { buttonVariants } from "@/components/ui/button";
import { PlanLimitDialogShell } from "@/components/ui/plan-limit-dialog-shell";
import { safeContactHref, safeUpgradeHref } from "@/lib/plan-limit-links";
import { cn } from "@/lib/utils";

interface PlanLimitModalProps {
  isOpen: boolean;
  resource: string;
  limit: number;
  current: number;
  upgradeUrl: string;
  contactUrl?: string | null;
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
  if (normalized === "users") {
    return "user";
  }
  if (normalized === "connectors_installations") {
    return "connector installation";
  }
  if (normalized === "connector_accounts") {
    return "connector account";
  }
  if (normalized === "api_keys") {
    return "API key";
  }
  if (normalized === "outbound_webhooks") {
    return "outbound webhook";
  }
  return resource;
}

export function PlanLimitModal({
  isOpen,
  resource,
  limit,
  current,
  upgradeUrl,
  contactUrl,
  dismissHref,
}: PlanLimitModalProps) {
  if (!isOpen) {
    return null;
  }

  const resourceLabel = normalizeResourceLabel(resource);
  // This modal opens from URL query params, so neither link is trusted as-is: the
  // upgrade link must stay on this origin, and the contact link must match the
  // server-configured commercial contact URL (the one the API itself reports).
  const upgradeHref = safeUpgradeHref(upgradeUrl);
  const contactHref = safeContactHref(contactUrl, process.env.PIM_COMMERCIAL_CONTACT_URL);
  const isSkuLimit = resource.toLowerCase() === "skus";

  return (
    <PlanLimitDialogShell
      title={`You reached your ${resourceLabel} limit`}
      description={`Your current plan includes ${limit} ${resourceLabel}${limit === 1 ? "" : "s"}. You are currently using ${current}.`}
      dismissHref={dismissHref}
    >
      {isSkuLimit ? (
        <p className="mb-4 text-sm text-slate-500">
          A simple product counts as 1 SKU. A product with multiple variants counts once per sellable variant. Draft, archived, deleted, and parent-only product records don't count.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link href={dismissHref} className={cn(buttonVariants({ variant: "secondary" }))}>
          Maybe later
        </Link>
        {contactHref ? (
          <a
            href={contactHref}
            className={cn(buttonVariants({ variant: "dark" }))}
            target="_blank"
            rel="noreferrer"
          >
            Contact us to upgrade
          </a>
        ) : (
          <Link href={upgradeHref} className={cn(buttonVariants({ variant: "dark" }))}>
            Request upgrade
          </Link>
        )}
      </div>
    </PlanLimitDialogShell>
  );
}
