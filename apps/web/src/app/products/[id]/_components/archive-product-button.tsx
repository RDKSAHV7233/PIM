"use client";

import { useState } from "react";
import { updateProductStatusAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

interface ArchiveProductButtonProps {
  productId: string;
  expectedVersion: number;
  /** "archive" moves the product to archived status; "restore" moves an archived product back to draft. */
  mode?: "archive" | "restore";
}

export function ArchiveProductButton({ productId, expectedVersion, mode = "archive" }: ArchiveProductButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const isArchive = mode === "archive";
  const targetStatus = isArchive ? "archived" : "draft";

  return (
    <form
      action={updateProductStatusAction as unknown as (formData: FormData) => Promise<void>}
      className="mt-3 flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      <input type="hidden" name="status" value={targetStatus} />
      {confirming ? (
        <>
          <span className="text-xs text-slate-700">
            {isArchive
              ? "Are you sure? This will move the product to archived status."
              : "Restore this product to draft? It will re-enter the normal review workflow."}
          </span>
          <Button type="submit" variant={isArchive ? "destructive" : "secondary"}>
            {isArchive ? "Confirm archive" : "Confirm restore"}
          </Button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="text-sm font-medium text-slate-600 hover:text-slate-900 hover:underline"
          >
            Cancel
          </button>
        </>
      ) : (
        <Button
          type="button"
          variant={isArchive ? "destructive" : "secondary"}
          onClick={(event) => {
            event.preventDefault();
            setConfirming(true);
          }}
        >
          {isArchive ? "Archive product" : "Restore to draft"}
        </Button>
      )}
    </form>
  );
}
