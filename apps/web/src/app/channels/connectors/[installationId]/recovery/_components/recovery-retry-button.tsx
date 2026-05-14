"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { retryConnectorRecoveryGroupAction } from "@/app/actions";

interface RecoveryRetryButtonProps {
  installationId: string;
  errorFamily: string;
  returnPath: string;
}

export function RecoveryRetryButton({ installationId, errorFamily, returnPath }: RecoveryRetryButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ queued: number } | null>(null);

  function handleClick() {
    startTransition(async () => {
      try {
        const data = await retryConnectorRecoveryGroupAction(installationId, errorFamily);
        setResult(data);
        router.push(`${returnPath}?status=retry-queued`);
      } catch {
        router.push(`${returnPath}?status=retry-failed`);
      }
    });
  }

  if (result) {
    return (
      <span className="rounded-md bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
        {result.queued} queued
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
    >
      {isPending ? "Queuing…" : "Retry all"}
    </button>
  );
}
