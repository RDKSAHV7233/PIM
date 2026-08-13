"use client";

import { useState } from "react";
import { deleteProductAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

interface ArchiveProductButtonProps {
  productId: string;
}

export function ArchiveProductButton({ productId }: ArchiveProductButtonProps) {
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  return (
    <form
      // deleteProductAction's return type is widened (BUG-AUTH-STALE-SESSION-001 A2b) to let its
      // other caller (products-tab.tsx, invoked via startTransition) read a session-expiry signal.
      // This native form binding never reads that value — React discards whatever a form action
      // returns unless it's wired through useActionState, which this isn't.
      action={deleteProductAction as unknown as (formData: FormData) => Promise<void>}
      className="mt-3 flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="returnTo" value="/catalog/products" />
      {confirmingArchive ? (
        <>
          <span className="text-xs text-slate-700">
            Are you sure? This will move the product to archived status.
          </span>
          <input type="hidden" name="confirmDelete" value="yes" />
          <Button type="submit" variant="destructive">
            Confirm archive
          </Button>
          <button
            type="button"
            onClick={() => setConfirmingArchive(false)}
            className="text-sm font-medium text-slate-600 hover:text-slate-900 hover:underline"
          >
            Cancel
          </button>
        </>
      ) : (
        <Button type="button" variant="destructive" onClick={() => setConfirmingArchive(true)}>
          Archive product
        </Button>
      )}
    </form>
  );
}
