"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AppDialog } from "@/components/ui/app-dialog";

interface PlanLimitDialogShellProps {
  title: string;
  description: string;
  dismissHref: string;
  children: ReactNode;
}

// The only client-side part of PlanLimitModal: the dialog itself and closing it.
// PlanLimitModal stays a server component so it can check its links against
// server-only configuration before they ever reach the browser.
export function PlanLimitDialogShell({ title, description, dismissHref, children }: PlanLimitDialogShellProps) {
  const router = useRouter();
  return (
    <AppDialog open title={title} description={description} onClose={() => router.push(dismissHref)} size="md">
      {children}
    </AppDialog>
  );
}
