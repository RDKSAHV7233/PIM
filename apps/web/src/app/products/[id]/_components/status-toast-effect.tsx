"use client";

import { useEffect, useRef } from "react";
import { toast } from "@/components/ui/toast";

// Params that carry one-shot status information. All are removed from the URL
// once consumed so that a hard-refresh does not re-show stale messages.
const EPHEMERAL_PARAMS = [
  "updateStatus",
  "statusAt",
  "currentVersion",
  "deleteStatus",
  "deleteError",
] as const;

interface StatusToastEffectProps {
  updateStatus: string;
}

export function StatusToastEffect({ updateStatus }: StatusToastEffectProps) {
  const lastStatusRef = useRef("");

  useEffect(() => {
    // Strip all ephemeral params from the URL without triggering a navigation.
    const url = new URL(window.location.href);
    let changed = false;
    for (const key of EPHEMERAL_PARAMS) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (changed) {
      window.history.replaceState({}, "", url.toString());
    }

    if (!updateStatus || lastStatusRef.current === updateStatus) {
      return;
    }
    lastStatusRef.current = updateStatus;

    if (updateStatus === "updated") {
      toast.success("Product updated");
      return;
    }
    if (updateStatus === "validated") {
      toast.success("Validation complete");
      return;
    }
    if (updateStatus === "export-queued") {
      toast.success("Export job queued successfully.");
      return;
    }
    if (updateStatus === "export-processed") {
      toast.success("Export job processing started.");
      return;
    }
    if (updateStatus === "export-requeued") {
      toast.success("Export job requeued.");
      return;
    }
    if (updateStatus === "export-forbidden") {
      toast.error("Your role does not have permission to publish to channels.");
      return;
    }
    if (updateStatus === "error" || updateStatus === "conflict") {
      toast.error("Update failed");
      return;
    }
    if (updateStatus === "validate-error") {
      toast.error("Validation failed");
    }
  }, [updateStatus]);

  return null;
}
