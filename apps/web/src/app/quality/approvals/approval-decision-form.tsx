"use client";

import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { buttonVariants } from "@/components/ui/button";

interface ApprovalDecisionFormProps {
  productId: string;
  productTitle: string;
  returnTo: string;
  canApprove: boolean;
  action: (formData: FormData) => void | Promise<void>;
}

export function ApprovalDecisionForm({
  productId,
  productTitle,
  returnTo,
  canApprove,
  action,
}: ApprovalDecisionFormProps) {
  const submitRef = useRef<HTMLButtonElement>(null);
  const [pendingDecision, setPendingDecision] = useState<"approved" | "rejected" | null>(null);

  function handleClick(decision: "approved" | "rejected") {
    setPendingDecision(decision);
  }

  function handleConfirm() {
    if (!submitRef.current || !pendingDecision) return;
    submitRef.current.value = pendingDecision;
    submitRef.current.click();
    setPendingDecision(null);
  }

  return (
    <>
      <form action={action} className="space-y-2">
        <input type="hidden" name="productId" value={productId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <button ref={submitRef} type="submit" name="status" value="" className="hidden" aria-hidden="true" tabIndex={-1} />
        <label className="block space-y-1 text-xs text-slate-600">
          <span className="font-medium text-slate-700">Reviewer note</span>
          <textarea
            name="note"
            rows={3}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Capture approval context or rejection rationale."
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <PendingSubmitButton
            type="button"
            disabled={!canApprove}
            variant="dark"
            className="bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900"
            idleLabel="Approve"
            pendingLabel="Approving..."
            onClick={() => handleClick("approved")}
          />
          <PendingSubmitButton
            type="button"
            className={buttonVariants({ variant: "secondary" })}
            idleLabel="Reject"
            pendingLabel="Rejecting..."
            onClick={() => handleClick("rejected")}
          />
        </div>
      </form>
      {!canApprove ? (
        <p className="text-xs text-slate-500">Clear blocking issues before approving.</p>
      ) : null}
      <ConfirmDialog
        open={pendingDecision !== null}
        title={pendingDecision === "approved" ? "Approve product?" : "Reject product?"}
        description={
          pendingDecision === "approved"
            ? `Approve "${productTitle}" — this records a final approval decision and cannot be undone from this page.`
            : `Reject "${productTitle}" — the editor will need to address feedback and resubmit for review.`
        }
        confirmLabel={pendingDecision === "approved" ? "Approve" : "Reject"}
        destructive={pendingDecision === "rejected"}
        onConfirm={handleConfirm}
        onCancel={() => setPendingDecision(null)}
      />
    </>
  );
}
