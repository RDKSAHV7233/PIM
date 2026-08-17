"use client";

import { useCallback, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";

interface BulkPublishConfirmFormProps {
  installationId: string;
  channel?: string;
  productIds: string[];
  returnTo: string;
  action: (formData: FormData) => void | Promise<void>;
  /**
   * Copy overrides (PIM#595). Defaults preserve the original connector Sync-tab wording,
   * where `productIds` is an auto-computed "every approved product in this workspace" list.
   * The Products workbench reuses this same form for an explicit operator-selected batch and
   * passes its own copy so the count doesn't read as auto-derived when it wasn't.
   */
  idleLabelWhenEmpty?: string;
  hintWhenEmpty?: string;
  summaryLabel?: (count: number) => string;
  confirmDescription?: (count: number) => string;
}

export function BulkPublishConfirmForm({
  installationId,
  channel,
  productIds,
  returnTo,
  action,
  idleLabelWhenEmpty = "No approved products",
  hintWhenEmpty = "Approve at least one product before bulk publish.",
  summaryLabel = (count) =>
    `${count} approved product${count === 1 ? "" : "s"} selected from this connector workspace.`,
  confirmDescription = (count) =>
    `This will submit ${count} approved product${count === 1 ? "" : "s"} to the marketplace. Native feed connectors send one batch; other publish connectors queue one export job per product. Track results in the Jobs workspace.`,
}: BulkPublishConfirmFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const confirmedRef = useRef(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const productCount = productIds.length;
  const productIdsValue = productIds.join(",");
  const hasProducts = productCount > 0;

  // Progressive enhancement: pre-hydration the button is type="submit" so
  // clicking it submits the form directly to the server action (which
  // validates everything server-side). Post-hydration this handler
  // intercepts the submit and shows the confirmation dialog first.
  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      if (confirmedRef.current) {
        confirmedRef.current = false;
        return;
      }
      e.preventDefault();
      if (hasProducts) {
        setShowConfirm(true);
      }
    },
    [hasProducts],
  );

  return (
    <>
      <form
        ref={formRef}
        action={action}
        onSubmit={handleSubmit}
        className="mt-3 flex flex-wrap items-center gap-3"
      >
        <input type="hidden" name="installationId" value={installationId} />
        {channel ? <input type="hidden" name="channel" value={channel} /> : null}
        <input type="hidden" name="productIds" value={productIdsValue} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <PendingSubmitButton
          idleLabel={hasProducts ? "Submit bulk publish" : idleLabelWhenEmpty}
          className="bg-amber-600 hover:bg-amber-700 text-white"
          disabled={!hasProducts}
        />
        <span className="text-xs text-amber-800">
          {hasProducts ? summaryLabel(productCount) : hintWhenEmpty}
        </span>
      </form>
      <ConfirmDialog
        open={showConfirm}
        title="Submit bulk publish feed?"
        description={confirmDescription(productCount)}
        confirmLabel="Submit publish"
        destructive={false}
        onConfirm={() => {
          setShowConfirm(false);
          confirmedRef.current = true;
          formRef.current?.requestSubmit();
        }}
        onCancel={() => setShowConfirm(false)}
      />
    </>
  );
}
