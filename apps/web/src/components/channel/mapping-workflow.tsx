import Link from "next/link";
import type { Product } from "@/lib/api";
import { Card, CardTitle } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/status-chip";

function presentChannel(channel: string): string {
  if (!channel) {
    return "Channel";
  }
  return channel.charAt(0).toUpperCase() + channel.slice(1);
}

function contextPill(label: string, value: string, tone: "info" | "success" | "warning" | "neutral" = "neutral") {
  return (
    <div className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600">
      <span className="font-semibold text-slate-900">{label}:</span>{" "}
      {tone === "neutral" ? value : <StatusChip label={value} tone={tone} />}
    </div>
  );
}

export function MappingWorkflowHeader({
  product,
  channel,
  categoryPath,
  publishCategory,
  connectorSlug,
  requiredCount,
  mappedRequiredCount,
  missingRequiredCount,
}: {
  product: Product | null;
  channel: string;
  categoryPath: string;
  publishCategory: string;
  connectorSlug: string;
  requiredCount: number;
  mappedRequiredCount: number;
  missingRequiredCount: number;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mapping workflow</p>
            <h2 className="text-2xl font-semibold text-slate-950">
              {product
                ? `Complete this mapping to publish ${product.title}`
                : `Complete this ${presentChannel(channel)} mapping`}
            </h2>
            <p className="max-w-3xl text-sm text-slate-600">
              {product
                ? `This ${presentChannel(channel)} mapping is blocking publish for ${product.title}. Start by filling the missing required fields, then validate and publish the draft version.`
                : `Start by mapping the missing required fields for this ${presentChannel(channel)} category. Validate the draft version after the required fields are mapped, then publish it.`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {contextPill("Channel", presentChannel(channel))}
            {contextPill("Connector", connectorSlug)}
            {contextPill("Category", categoryPath || "Unknown category")}
            {contextPill("Publish category", publishCategory || "Not selected")}
            {contextPill("Required fields", String(requiredCount))}
            {contextPill("Mapped", String(mappedRequiredCount), mappedRequiredCount > 0 ? "success" : "neutral")}
            {contextPill(
              "Missing",
              String(missingRequiredCount),
              missingRequiredCount > 0 ? "warning" : "success",
            )}
          </div>
          {product ? (
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/products/${product.id}`}
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Back to product
              </Link>
            </div>
          ) : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-3 xl:w-[360px]">
          <a href="#mapping-draft" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-left hover:bg-slate-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Step 1</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">Map required fields</p>
            <p className="mt-1 text-xs text-slate-500">Fix the missing required fields first.</p>
          </a>
          <a href="#mapping-history" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-left hover:bg-slate-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Step 2</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">Validate draft</p>
            <p className="mt-1 text-xs text-slate-500">Validate the saved draft version in history.</p>
          </a>
          <a href="#mapping-readiness" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-left hover:bg-slate-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Step 3</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">Review publish gate</p>
            <p className="mt-1 text-xs text-slate-500">Check blockers before publishing the validated version.</p>
          </a>
        </div>
      </div>
    </Card>
  );
}

export function MappingContextSummaryCard({
  product,
  channel,
  categoryPath,
  publishCategory,
  compatibilityLabel,
  matchedVersions,
}: {
  product: Product | null;
  channel: string;
  categoryPath: string;
  publishCategory: string;
  compatibilityLabel: string;
  matchedVersions: number;
}) {
  return (
    <Card>
      <CardTitle>Context</CardTitle>
      <dl className="grid gap-3 text-sm text-slate-700">
        {product ? (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Product</dt>
            <dd className="mt-1 font-medium text-slate-900">{product.title}</dd>
            <dd className="text-xs text-slate-500">{product.id}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Channel</dt>
          <dd className="mt-1">{presentChannel(channel)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Category scope</dt>
          <dd className="mt-1">{categoryPath || "Unknown category"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Publish category</dt>
          <dd className="mt-1">{publishCategory || "Not selected"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Compatibility</dt>
          <dd className="mt-1">
            <StatusChip
              label={compatibilityLabel}
              tone={compatibilityLabel === "Blocked" ? "danger" : compatibilityLabel === "Needs review" || compatibilityLabel === "Needs remap" ? "warning" : "success"}
            />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Matched versions</dt>
          <dd className="mt-1">{matchedVersions}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-slate-500">
        Saving a draft does not publish anything. Validate the version in history, then review the publish gate before promoting it live.
      </p>
    </Card>
  );
}
