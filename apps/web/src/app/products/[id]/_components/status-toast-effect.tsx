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
  "error",
  "errorMessage",
] as const;

interface StatusToastEffectProps {
  updateStatus: string;
  actionError?: string;
  actionErrorMessage?: string;
}

export function StatusToastEffect({ updateStatus, actionError, actionErrorMessage }: StatusToastEffectProps) {
  const lastStatusRef = useRef("");
  const lastErrorRef = useRef("");

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

    if (actionError && lastErrorRef.current !== actionError) {
      lastErrorRef.current = actionError;
      toast.error(actionErrorMessage || "Action failed");
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
    if (updateStatus === "reverted-to-draft") {
      toast.success("Product reverted to draft");
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
    if (updateStatus === "error") {
      toast.error(actionErrorMessage || "Update failed");
      return;
    }
    if (updateStatus === "conflict") {
      toast.error("Update failed");
      return;
    }
    if (updateStatus === "validate-error") {
      toast.error("Validation failed");
    }
  }, [updateStatus, actionError, actionErrorMessage]);

  return null;
}
