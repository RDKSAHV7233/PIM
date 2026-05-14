"use client";

import { useTransition, useState, useRef } from "react";
import { createExportJobAction } from "@/app/actions";
import { AppDrawer } from "@/components/ui/app-drawer";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { MarketplaceChannelConfig, ShopifyProductPreview, ShopifyProductChangeItem } from "@/lib/api";

const RISK_COLORS: Record<ShopifyProductChangeItem["riskLevel"], string> = {
  low:    "bg-slate-50 text-slate-700",
  medium: "bg-amber-50 text-amber-800",
  high:   "bg-red-50 text-red-800",
};

const CHANGE_TYPE_LABEL: Record<ShopifyProductChangeItem["changeType"], string> = {
  add:    "New",
  update: "Changed",
  remove: "Removed",
};

interface ExportWithPreviewFormProps {
  productId: string;
  actorRole: string;
  publishableChannels: MarketplaceChannelConfig[];
  templates: Array<{ id: string; name: string; isDefault: boolean }>;
  defaultExportChannel: string;
  selectedTemplateId: string | undefined;
  fallbackAckRequired: boolean;
  canQueueExportWithAck: boolean;
  /** installationId of the Shopify installation — enables change preview when present */
  shopifyInstallationId: string | null;
}

export function ExportWithPreviewForm({
  productId,
  actorRole,
  publishableChannels,
  templates,
  defaultExportChannel,
  selectedTemplateId,
  fallbackAckRequired,
  canQueueExportWithAck,
  shopifyInstallationId,
}: ExportWithPreviewFormProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [isPending, startTransition] = useTransition();
  const [preview, setPreview] = useState<ShopifyProductPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pendingFormData, setPendingFormData] = useState<FormData | null>(null);
  const [publishAnyway, setPublishAnyway] = useState(false);

  const channelValue = (): string => {
    const form = formRef.current;
    if (!form) return defaultExportChannel;
    const fd = new FormData(form);
    return String(fd.get("channel") ?? defaultExportChannel);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    // Only run preview for Shopify with a known installation
    const isShopify = String(fd.get("channel") ?? "").toLowerCase() === "shopify";
    if (!shopifyInstallationId || !isShopify) {
      startTransition(() => createExportJobAction(fd));
      return;
    }

    setPreviewLoading(true);
    setPreviewError(null);
    setPendingFormData(fd);

    try {
      const res = await fetch(
        `/api/marketplace/preview-changes?installationId=${encodeURIComponent(shopifyInstallationId)}&productId=${encodeURIComponent(productId)}`,
        { method: "POST" },
      );
      if (!res.ok) {
        // If preview fails (e.g. no prior submission), proceed directly
        startTransition(() => createExportJobAction(fd));
        return;
      }
      const data = (await res.json()) as ShopifyProductPreview;
      // If this is a new product (no existing Shopify listing), skip preview
      if (!data.hasExistingProduct) {
        startTransition(() => createExportJobAction(fd));
        return;
      }
      setPreview(data);
      setPublishAnyway(false);
    } catch {
      // Network error — proceed without preview
      startTransition(() => createExportJobAction(fd));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleConfirm = () => {
    if (!pendingFormData) return;
    setPreview(null);
    startTransition(() => createExportJobAction(pendingFormData));
  };

  const handleCancel = () => {
    setPreview(null);
    setPendingFormData(null);
  };

  const isLoading = isPending || previewLoading;
  const hasChanges = preview && !preview.noChanges;

  return (
    <>
      <form ref={formRef} onSubmit={handleSubmit} className="grid gap-3 md:grid-cols-4">
        <input type="hidden" name="role" value={actorRole} />
        <input type="hidden" name="productId" value={productId} />
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="epf-channel">
            Channel
          </label>
          <Select id="epf-channel" name="channel" defaultValue={defaultExportChannel}>
            {publishableChannels.map((ch) => (
              <option key={ch.channel} value={ch.channel}>
                {ch.displayName}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="epf-template-id">
            Mapping
          </label>
          <Select id="epf-template-id" name="templateId" defaultValue={selectedTemplateId ?? ""}>
            <option value="">Live mapping</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}{t.isDefault ? " (default)" : ""}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="epf-max-retries">
            Max Retries
          </label>
          <Input id="epf-max-retries" name="maxRetries" type="number" min={1} max={10} defaultValue={3} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="epf-fallback-ack">
            Fallback confirmation
          </label>
          <Select id="epf-fallback-ack" name="fallbackAcknowledged" defaultValue={fallbackAckRequired ? "false" : "true"}>
            <option value="false">Not acknowledged</option>
            <option value="true">Acknowledge fallback usage</option>
          </Select>
        </div>
        <button
          type="submit"
          disabled={isLoading || !canQueueExportWithAck}
          className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {previewLoading ? "Checking for changes…" : isPending ? "Queuing export…" : "Queue channel export"}
        </button>
        {previewError ? (
          <p className="col-span-4 text-xs text-red-600">{previewError}</p>
        ) : null}
      </form>

      {preview ? (
        <AppDrawer
          open={true}
          width="lg"
          title={preview.noChanges ? "No changes detected" : `${preview.changes.length} field${preview.changes.length !== 1 ? "s" : ""} will change`}
          description={
            preview.noChanges
              ? "Shopify already has this product data. Publishing again will re-send the same payload."
              : "Review what will change in Shopify before queuing the export."
          }
          onClose={handleCancel}
        >
          <div className="space-y-5">
            {preview.noChanges ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm text-slate-700">
                  The current Vexa payload matches what is already live in Shopify. No fields will be updated.
                </p>
                <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={publishAnyway}
                    onChange={(e) => setPublishAnyway(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  Publish anyway (re-send identical payload)
                </label>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="pb-2 pr-3 font-medium">Field</th>
                      <th className="pb-2 pr-3 font-medium">Current (Shopify)</th>
                      <th className="pb-2 pr-3 font-medium">New (Vexa)</th>
                      <th className="pb-2 pr-3 font-medium">Type</th>
                      <th className="pb-2 font-medium">Risk</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.changes.map((change, i) => (
                      <tr key={i} className="align-top">
                        <td className="py-2 pr-3 font-mono text-slate-700">{change.field}</td>
                        <td className="py-2 pr-3 text-slate-500 max-w-[12rem] truncate" title={change.currentValue ?? "—"}>
                          {change.currentValue ?? <span className="italic text-slate-400">—</span>}
                        </td>
                        <td className="py-2 pr-3 text-slate-900 max-w-[12rem] truncate" title={change.newValue ?? "—"}>
                          {change.newValue ?? <span className="italic text-slate-400">—</span>}
                        </td>
                        <td className="py-2 pr-3">
                          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-slate-600">
                            {CHANGE_TYPE_LABEL[change.changeType]}
                          </span>
                        </td>
                        <td className="py-2">
                          <span className={`rounded-full px-1.5 py-0.5 font-medium capitalize ${RISK_COLORS[change.riskLevel]}`}>
                            {change.riskLevel}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={handleConfirm}
                disabled={preview.noChanges && !publishAnyway}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {hasChanges ? "Confirm and queue export" : "Queue export"}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </AppDrawer>
      ) : null}
    </>
  );
}
