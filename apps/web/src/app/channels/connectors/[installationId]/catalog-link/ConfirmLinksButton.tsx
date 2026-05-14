"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { confirmCatalogLinksAction } from "@/app/actions";

interface MatchedLink {
  productId: string;
  shopifyGid: string;
  matchedBy: string;
}

interface Props {
  installationId: string;
  links: MatchedLink[];
}

export function ConfirmLinksButton({ installationId, links }: Props) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [confirmed, setConfirmed] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleConfirm() {
    setState("loading");
    setErrorMsg(null);
    try {
      const result = await confirmCatalogLinksAction(installationId, links);
      setConfirmed(result.confirmed);
      setState("done");
      router.refresh();
    } catch (err) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : "Confirm failed. Please try again.");
    }
  }

  if (state === "done") {
    return (
      <p className="text-sm text-green-700 font-medium">
        {confirmed} link{confirmed !== 1 ? "s" : ""} confirmed.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleConfirm}
        disabled={state === "loading" || links.length === 0}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
      >
        {state === "loading" ? "Confirming…" : `Confirm and link ${links.length} match${links.length !== 1 ? "es" : ""}`}
      </button>
      {errorMsg ? (
        <p className="text-xs text-red-600">{errorMsg}</p>
      ) : null}
    </div>
  );
}
