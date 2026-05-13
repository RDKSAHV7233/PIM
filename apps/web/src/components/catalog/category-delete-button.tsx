"use client";

import { useRef, useState } from "react";
import { deleteCategoryAction } from "@/app/actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";

interface CategoryDeleteButtonProps {
  categoryId: string;
  categoryPath: string;
  disabledReason: string | null;
  returnTo: string;
}

export function CategoryDeleteButton({
  categoryId,
  categoryPath,
  disabledReason,
  returnTo,
}: CategoryDeleteButtonProps) {
  const disabled = Boolean(disabledReason);
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmedRef = useRef(false);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (disabled) {
      event.preventDefault();
      return;
    }
    if (confirmedRef.current) {
      confirmedRef.current = false;
      return;
    }
    event.preventDefault();
    setOpen(true);
  }

  return (
    <>
      <form ref={formRef} action={deleteCategoryAction} onSubmit={handleSubmit} className="inline-flex">
        <input type="hidden" name="categoryId" value={categoryId} />
        <input type="hidden" name="confirmDelete" value="yes" />
        <input type="hidden" name="returnTo" value={returnTo} />
        <PendingSubmitButton
          type="submit"
          variant="secondary"
          disabled={disabled}
          title={disabledReason ?? "Delete category"}
          className={disabled ? "border-slate-200 text-slate-400" : "border-red-200 text-red-700 hover:bg-red-50"}
          idleLabel="Delete"
          pendingLabel="Deleting..."
        />
      </form>
      <ConfirmDialog
        open={open}
        title="Delete category"
        description={`Delete "${categoryPath}"? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          confirmedRef.current = true;
          formRef.current?.requestSubmit();
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
