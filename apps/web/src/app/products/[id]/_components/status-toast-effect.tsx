"use client";

import { useEffect, useRef } from "react";
import { toast } from "@/components/ui/toast";

interface StatusToastEffectProps {
  updateStatus: string;
}

export function StatusToastEffect({ updateStatus }: StatusToastEffectProps) {
  const lastStatusRef = useRef("");

  useEffect(() => {
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
