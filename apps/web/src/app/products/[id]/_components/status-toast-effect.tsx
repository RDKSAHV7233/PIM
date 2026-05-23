"use client";

import { useEffect, useRef } from "react";
import { toast } from "@/components/ui/toast";

// Params that carry one-shot status information. All are removed from the URL
// once consumed so that a hard-refresh does not re-show stale messages.
const EPHEMERAL_PARAMS = [
  "updateStatus",
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
    if (updateStatus === "export-queued") {
      toast.success("Export job queued successfully.");
      return;
    }
    if (updateStatus === "error" || updateStatus === "conflict") {
      toast.error("Update failed");
    }
  }, [updateStatus]);

  return null;
}
