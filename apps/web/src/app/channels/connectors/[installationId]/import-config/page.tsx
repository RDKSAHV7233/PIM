"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { importShopifyConfigAction } from "@/app/actions";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

type StepStatus = "idle" | "loading" | "done" | "error";

function StepCard({
  label,
  status,
  count,
  description,
}: {
  label: string;
  status: StepStatus;
  count?: number;
  description?: string;
}) {
  const icon =
    status === "loading" ? (
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
    ) : status === "done" ? (
      <span className="text-green-600">✓</span>
    ) : status === "error" ? (
      <span className="text-red-600">✗</span>
    ) : (
      <span className="inline-block h-4 w-4 rounded-full border-2 border-slate-300" />
    );

  return (
    <div className="flex items-start gap-3 rounded-md border border-slate-200 bg-white px-4 py-3">
      <div className="mt-0.5 text-sm">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800">{label}</p>
        {status === "loading" && (
          <p className="mt-0.5 text-xs text-slate-500">Fetching from Shopify…</p>
        )}
        {status === "done" && count !== undefined && (
          <p className="mt-0.5 text-xs text-slate-500">
            {count} {description}
          </p>
        )}
        {status === "error" && (
          <p className="mt-0.5 text-xs text-red-600">Failed</p>
        )}
      </div>
    </div>
  );
}

export default function ImportConfigPage() {
  const params = useParams<{ installationId: string }>();
  const installationId = params.installationId;
  const router = useRouter();

  const [phase, setPhase] = useState<"start" | "importing" | "done" | "error">("start");
  const [counts, setCounts] = useState<{ metafields: number; collections: number; taxonomy: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const stepStatus = (step: "metafields" | "collections" | "taxonomy"): StepStatus => {
    if (phase === "start") return "idle";
    if (phase === "importing") return "loading";
    if (phase === "done") return "done";
    return "error";
  };

  async function runImport() {
    setPhase("importing");
    setErrorMessage(null);
    try {
      const result = await importShopifyConfigAction(installationId);
      setCounts({ metafields: result.metafields, collections: result.collections, taxonomy: result.taxonomy });
      setPhase("done");
    } catch (err) {
      setPhase("error");
      setErrorMessage("Import failed. Check your Shopify credentials and try again.");
    }
  }

  const returnHref = `/channels/connectors/${encodeURIComponent(installationId)}`;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Import Shopify Configuration"
        description="Fetches metafield definitions, collections, and product taxonomy from your Shopify store and caches them for use in the mapping editor."
        breadcrumb={
          <>
            Dashboard / Channels / Connections /{" "}
            <Link href={returnHref} className="hover:underline text-slate-700">
              Connector
            </Link>{" "}
            / <span className="font-semibold text-slate-700">Import Config</span>
          </>
        }
      />

      <Card>
        <CardTitle>Configuration Import</CardTitle>
        <p className="mt-2 text-sm text-slate-600">
          Fetches live data from your Shopify Admin API and caches it in Vexa. No changes are made to your Shopify store.
          The cached config enables metafield mapping and collection assignment in the mapping editor.
        </p>

        <div className="mt-4 space-y-3">
          <StepCard
            label="Metafield definitions"
            status={stepStatus("metafields")}
            count={counts?.metafields}
            description="product metafield definitions imported"
          />
          <StepCard
            label="Collections"
            status={stepStatus("collections")}
            count={counts?.collections}
            description="Shopify collections imported"
          />
          <StepCard
            label="Product taxonomy"
            status={stepStatus("taxonomy")}
            count={counts?.taxonomy}
            description="taxonomy nodes imported"
          />
        </div>

        {errorMessage ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-3">
          {phase === "done" ? (
            <>
              <button
                type="button"
                onClick={runImport}
                className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Re-import
              </button>
              <button
                type="button"
                onClick={() => router.push(`${returnHref}?tab=mappings`)}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Continue to mapping
              </button>
            </>
          ) : phase === "error" ? (
            <>
              <button
                type="button"
                onClick={runImport}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Retry import
              </button>
              <Link
                href={returnHref}
                className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Back
              </Link>
            </>
          ) : (
            <button
              type="button"
              onClick={runImport}
              disabled={phase === "importing"}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {phase === "importing" ? "Importing…" : "Start import"}
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}
