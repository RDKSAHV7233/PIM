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
  const router = useRouter();

  if (!isOpen) {
    return null;
  }

  const resourceLabel = normalizeResourceLabel(resource);

  return (
    <AppDialog
      open={isOpen}
      title={`You reached your ${resourceLabel} limit`}
      description={`Your current plan includes ${limit} ${resourceLabel}${limit === 1 ? "" : "s"}. You are currently using ${current}.`}
      onClose={() => router.push(dismissHref)}
      size="md"
    >
      <div className="flex items-center justify-end gap-2">
        <Link href={dismissHref} className={cn(buttonVariants({ variant: "secondary" }))}>
          Maybe later
        </Link>
        <Link href={upgradeUrl} className={cn(buttonVariants({ variant: "dark" }))}>
          Request upgrade
        </Link>
      </div>
    </AppDialog>
  );
}
