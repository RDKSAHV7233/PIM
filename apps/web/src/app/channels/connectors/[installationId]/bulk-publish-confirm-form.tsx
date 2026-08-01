"use client";

import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";

interface BulkPublishConfirmFormProps {
  installationId: string;
  channel?: string;
  returnTo: string;
  action: (formData: FormData) => void | Promise<void>;
}

export function BulkPublishConfirmForm({
  installationId,
  channel,
  returnTo,
  action,
}: BulkPublishConfirmFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <>
      <form ref={formRef} action={action} className="mt-3 flex flex-wrap items-center gap-3">
        <input type="hidden" name="installationId" value={installationId} />
        {channel ? <input type="hidden" name="channel" value={channel} /> : null}
        <input type="hidden" name="returnTo" value={returnTo} />
        <PendingSubmitButton
          type="button"
          idleLabel="Submit bulk feed"
          className="bg-amber-600 hover:bg-amber-700 text-white"
          onClick={() => setShowConfirm(true)}
        />
      </form>
      <ConfirmDialog
        open={showConfirm}
        title="Submit bulk publish feed?"
        description="This will submit all approved products as a single feed to the marketplace. Each product gets an individual submission record. This action cannot be undone."
        confirmLabel="Submit feed"
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
