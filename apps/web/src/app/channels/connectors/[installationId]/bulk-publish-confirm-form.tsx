"use client";

import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";

interface BulkPublishConfirmFormProps {
  installationId: string;
  channel?: string;
  productIds: string[];
  returnTo: string;
  action: (formData: FormData) => void | Promise<void>;
}

export function BulkPublishConfirmForm({
  installationId,
  channel,
  productIds,
  returnTo,
  action,
}: BulkPublishConfirmFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const productCount = productIds.length;
  const productIdsValue = productIds.join(",");
  const hasProducts = productCount > 0;

  return (
    <>
      <form ref={formRef} action={action} className="mt-3 flex flex-wrap items-center gap-3">
        <input type="hidden" name="installationId" value={installationId} />
        {channel ? <input type="hidden" name="channel" value={channel} /> : null}
        <input type="hidden" name="productIds" value={productIdsValue} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <PendingSubmitButton
          type="button"
          idleLabel={hasProducts ? "Submit bulk publish" : "No approved products"}
          className="bg-amber-600 hover:bg-amber-700 text-white"
          disabled={!hasProducts}
          onClick={() => {
            if (hasProducts) {
              setShowConfirm(true);
            }
          }}
        />
        <span className="text-xs text-amber-800">
          {hasProducts
            ? `${productCount} approved product${productCount === 1 ? "" : "s"} selected from this connector workspace.`
            : "Approve at least one product before bulk publish."}
        </span>
      </form>
      <ConfirmDialog
        open={showConfirm}
        title="Submit bulk publish feed?"
        description={`This will submit ${productCount} approved product${productCount === 1 ? "" : "s"} to the marketplace. Native feed connectors send one batch; other publish connectors queue one export job per product. Track results in the Jobs workspace.`}
        confirmLabel="Submit publish"
        destructive={false}
        onConfirm={() => {
          setShowConfirm(false);
          formRef.current?.requestSubmit();
        }}
        onCancel={() => setShowConfirm(false)}
      />
    </>
  );
}
