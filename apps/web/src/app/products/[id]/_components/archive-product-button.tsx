"use client";

import { useState } from "react";
import { deleteProductAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import type { AppRole } from "@/lib/api";

interface ArchiveProductButtonProps {
  productId: string;
  actorRole: AppRole;
}

export function ArchiveProductButton({ productId, actorRole }: ArchiveProductButtonProps) {
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  return (
    <form action={deleteProductAction} className="mt-3 flex flex-wrap items-center gap-2">
      <input type="hidden" name="actorRole" value={actorRole} />
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
