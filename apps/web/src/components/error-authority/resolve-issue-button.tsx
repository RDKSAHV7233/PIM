"use client";

import { useState, useTransition } from "react";
import { resolveErrorIssueAction } from "@/app/internal/ops/errors/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface ResolveIssueButtonProps {
  issueId: string;
  state: string;
  /** Current filter/pagination context, replayed as hidden form fields so the
   *  redirect after resolving lands back on the same filtered view. */
  returnParams: Record<string, string | number | undefined>;
}

export function ResolveIssueButton({ issueId, state, returnParams }: ResolveIssueButtonProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const alreadyResolved = state === "resolved";

  function handleResolveClick(event: React.MouseEvent<HTMLButtonElement>) {
    if (alreadyResolved) {
      event.preventDefault();
      return;
    }
    setOpen(true);
  }

  function handleConfirmedResolve() {
    setOpen(false);
    const formData = new FormData();
    formData.set("issueId", issueId);
    for (const [key, value] of Object.entries(returnParams)) {
      const normalized = String(value ?? "").trim();
      if (normalized) {
        formData.set(key, normalized);
      }
    }
    startTransition(() => {
      void resolveErrorIssueAction(formData);
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={alreadyResolved || isPending}
        aria-busy={isPending}
        aria-live="polite"
        title={alreadyResolved ? "This issue is already resolved" : "Resolve this issue"}
        className={alreadyResolved ? "border-slate-200 text-slate-400" : undefined}
        onClick={handleResolveClick}
      >
        {isPending ? "Resolving..." : "Resolve"}
      </Button>
      <ConfirmDialog
        open={open}
        title="Resolve error issue"
        description="This issue will become eligible for permanent deletion after the retention window. This cannot be undone."
        confirmLabel="Resolve"
        onConfirm={handleConfirmedResolve}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
