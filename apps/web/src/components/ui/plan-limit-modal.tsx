"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppDialog } from "@/components/ui/app-dialog";
import { buttonVariants } from "@/components/ui/button";
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
  const router = useRouter();

  if (!isOpen) {
    return null;
  }

  const resourceLabel = normalizeResourceLabel(resource);
  const isSkuLimit = resource.toLowerCase() === "skus";

  return (
    <AppDialog
      open={isOpen}
      title={`You reached your ${resourceLabel} limit`}
      description={`Your current plan includes ${limit} ${resourceLabel}${limit === 1 ? "" : "s"}. You are currently using ${current}.`}
      onClose={() => router.push(dismissHref)}
      size="md"
    >
      {isSkuLimit ? (
        <p className="mb-4 text-sm text-slate-500">
          A SKU is one sellable product variant — parent product records aren't counted separately.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link href={dismissHref} className={cn(buttonVariants({ variant: "secondary" }))}>
          Maybe later
        </Link>
        {contactUrl ? (
          <a
            href={contactUrl}
            className={cn(buttonVariants({ variant: "dark" }))}
            target="_blank"
            rel="noreferrer"
          >
            Contact us to upgrade
          </a>
        ) : (
          <Link href={upgradeUrl} className={cn(buttonVariants({ variant: "dark" }))}>
            Request upgrade
          </Link>
        )}
      </div>
    </AppDialog>
  );
}
