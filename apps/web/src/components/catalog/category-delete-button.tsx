"use client";

import { startTransition, useState } from "react";
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

  function handleDeleteClick(event: React.MouseEvent<HTMLButtonElement>) {
    if (disabled) {
      event.preventDefault();
      return;
    }
    setOpen(true);
  }

  function handleConfirmedDelete() {
    setOpen(false);
    const formData = new FormData();
    formData.set("categoryId", categoryId);
    formData.set("confirmDelete", "yes");
    formData.set("returnTo", returnTo);
    startTransition(async () => {
      await deleteCategoryAction(formData);
    });
  }

  return (
    <>
      <PendingSubmitButton
        type="button"
        variant="secondary"
        disabled={disabled}
        title={disabledReason ?? "Delete category"}
        className={disabled ? "border-slate-200 text-slate-400" : "border-red-200 text-red-700 hover:bg-red-50"}
        idleLabel="Delete"
        pendingLabel="Deleting..."
        onClick={handleDeleteClick}
      />
      <ConfirmDialog
        open={open}
        title="Delete category"
        description={`Delete "${categoryPath}"? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleConfirmedDelete}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
