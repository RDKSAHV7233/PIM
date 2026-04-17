"use client";

import { useEffect } from "react";
import { toast } from "@/components/ui/toast";

interface StatusToastEffectProps {
  updateStatus: string;
}

export function StatusToastEffect({ updateStatus }: StatusToastEffectProps) {
  useEffect(() => {
    if (updateStatus === "updated") {
      toast.success("Product updated");
      return;
    }
    if (updateStatus === "error" || updateStatus === "conflict") {
      toast.error("Update failed");
    }
  }, [updateStatus]);

  return null;
}
