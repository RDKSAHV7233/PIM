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

function presentBlockingReason(reason: string): string {
  if (reason === "fallback_ack_required") {
    return "Fallback acknowledgement required";
  }
  if (reason === "required_attribute_mapping_missing") {
    return "Required attribute mappings missing";
  }
  if (reason === "field_mappings_missing") {
    return "Field mappings missing";
  }
  if (reason === "connector_not_installed") {
    return "Connector not installed";
  }
  if (reason === "connector_credentials_expired") {
    return "Connector credentials expired";
  }
  if (reason === "mapping_compatibility_blocked") {
    return "Mapping compatibility blocked";
  }
  if (reason === "mapping_remap_required") {
    return "Mapping remap required";
  }
  return reason.replace(/_/g, " ");
}

export function MappingWorkflowHeader({
  product,
  productId,
  channel,
  categoryPath,
  publishCategory,
  connectorSlug,
  connectorAccountLabel,
  connectorAccountDetail,
  priorityBlockers,
  requiredCount,
  mappedRequiredCount,
  missingRequiredCount,
}: {
  product: Product | null;
  productId?: string;
  channel: string;
  categoryPath: string;
  publishCategory: string;
  connectorSlug: string;
  connectorAccountLabel?: string;
  connectorAccountDetail?: string;
  priorityBlockers: string[];
  requiredCount: number;
  mappedRequiredCount: number;
  missingRequiredCount: number;
}) {
  const productLabel = product?.title ?? (productId ? `product ${productId.slice(0, 8)}` : null);

  return (
    <Card>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mapping workflow</p>
            <h2 className="text-2xl font-semibold text-slate-950">
              {productLabel
                ? `Build a publish-ready mapping for ${productLabel}`
                : `Build a publish-ready ${presentChannel(channel)} mapping`}
            </h2>
            <p className="max-w-3xl text-sm text-slate-600">
              {productLabel
                ? `This ${presentChannel(channel)} mapping is blocking publish for ${productLabel}. Confirm the scope, build the draft, then validate and promote the version that clears readiness.`
                : `Confirm the scope for this ${presentChannel(channel)} category, build the draft around the required fields, then validate and publish the version that clears readiness.`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {contextPill("Channel", presentChannel(channel))}
            {contextPill("Connector", connectorSlug)}
            {connectorAccountLabel ? contextPill("Connector account", connectorAccountLabel) : null}
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
          {connectorAccountDetail ? (
            <p className="text-xs text-slate-500">
              Connector account context: {connectorAccountDetail}
            </p>
          ) : null}
          {priorityBlockers.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-amber-900">Top publish blockers</p>
                <a href="#mapping-readiness" className="text-xs font-medium text-amber-900 underline underline-offset-2">
                  Open readiness details
                </a>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {priorityBlockers.map((blocker) => (
                  <StatusChip key={blocker} label={presentBlockingReason(blocker)} tone="warning" />
                ))}
              </div>
            </div>
          ) : null}
          {productId ? (
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/products/${productId}`}
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Back to product
              </Link>
            </div>
          ) : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-3 xl:w-[420px]">
          <a href="#mapping-scope" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-left hover:bg-slate-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Step 1</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">Choose scope</p>
            <p className="mt-1 text-xs text-slate-500">Lock in the channel, category, product, and connector account. Mapping readiness depends on this account.</p>
          </a>
          <a href="#mapping-draft" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-left hover:bg-slate-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Step 2</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">Build draft</p>
            <p className="mt-1 text-xs text-slate-500">Map the required fields and save the draft version.</p>
          </a>
          <a href="#mapping-history" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-left hover:bg-slate-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Step 3</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">Validate and publish</p>
            <p className="mt-1 text-xs text-slate-500">Validate in history, then clear readiness and promote the version.</p>
          </a>
        </div>
      </div>
    </Card>
  );
}

export function MappingContextSummaryCard({
  product,
  productId,
  channel,
  categoryPath,
  publishCategory,
  connectorAccountLabel,
  connectorAccountDetail,
  compatibilityLabel,
  matchedVersions,
  draftAccountMismatch,
}: {
  product: Product | null;
  productId?: string;
  channel: string;
  categoryPath: string;
  publishCategory: string;
  connectorAccountLabel?: string;
  connectorAccountDetail?: string;
  compatibilityLabel: string;
  matchedVersions: number;
  draftAccountMismatch?: boolean;
}) {
  return (
    <Card>
      <CardTitle>Context</CardTitle>
      <dl className="grid gap-3 text-sm text-slate-700">
        {product || productId ? (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Product</dt>
            <dd className="mt-1 font-medium text-slate-900">{product?.title ?? "Product context available"}</dd>
            <dd className="text-xs text-slate-500">{product?.id ?? productId}</dd>
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
        {connectorAccountLabel ? (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Connector account</dt>
            <dd className="mt-1 font-medium text-slate-900">{connectorAccountLabel}</dd>
            {connectorAccountDetail ? <dd className="text-xs text-slate-500">{connectorAccountDetail}</dd> : null}
          </div>
        ) : null}
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
      {draftAccountMismatch ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-semibold text-amber-900">Account mismatch</p>
          <p className="mt-1 text-xs text-amber-800">
            This draft was created with a different connector account than the one currently selected.
            Publish will be blocked until the account matches.
          </p>
        </div>
      ) : null}
      <p className="mt-3 text-xs text-slate-500">
        Saving a draft does not publish anything. Validate the version in history, then review the publish gate before promoting it live.
      </p>
    </Card>
  );
}
