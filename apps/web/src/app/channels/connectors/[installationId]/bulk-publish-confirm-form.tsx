"use client";

import { useEffect, useRef, useState } from "react";
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const productCount = productIds.length;
  const productIdsValue = productIds.join(",");
  const hasProducts = productCount > 0;

  const openConfirm = () => {
    if (hasProducts) {
      setShowConfirm(true);
    }
  };

  // QA found this button's confirmation dialog intermittently never opens on the very first
  // click after navigating to the page: the button renders looking fully interactive, but for
  // a real (measured, not just theoretical) span after paint, NOTHING is listening to its clicks
  // yet — confirmed by attaching a plain native addEventListener via this same useEffect and
  // finding it *also* misses that first click, and by reproducing identically in a genuine `next
  // build && next start` production server (ruling out a dev-only Strict Mode artifact). Whatever
  // the exact upstream cause (this page's data load is heavier than most — submissions, recovery
  // banner, credential health all render before this control), the fix is to stop presenting the
  // control as clickable before it demonstrably is: gate it behind a mounted flag that starts
  // false on both the server render and the initial client render (so there's no hydration
  // mismatch), and only flips true from inside this effect. A click literally cannot reach a
  // disabled native <button>, so this closes the window instead of racing it.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const node = buttonRef.current;
    if (!node) return;
    const handleNativeClick = () => openConfirm();
    node.addEventListener("click", handleNativeClick);
    return () => node.removeEventListener("click", handleNativeClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasProducts]);

  return (
    <>
      <form ref={formRef} action={action} className="mt-3 flex flex-wrap items-center gap-3">
        <input type="hidden" name="installationId" value={installationId} />
        {channel ? <input type="hidden" name="channel" value={channel} /> : null}
        <input type="hidden" name="productIds" value={productIdsValue} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <PendingSubmitButton
          ref={buttonRef}
          type="button"
          idleLabel={!mounted ? "Preparing…" : hasProducts ? "Submit bulk publish" : "No approved products"}
          className="bg-amber-600 hover:bg-amber-700 text-white"
          disabled={!mounted || !hasProducts}
          onClick={openConfirm}
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
