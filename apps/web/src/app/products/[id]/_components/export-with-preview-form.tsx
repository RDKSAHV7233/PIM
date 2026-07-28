"use client";

import { useTransition, useState, useRef, useCallback } from "react";
import { createExportJobAction } from "@/app/actions";
import { AppDrawer } from "@/components/ui/app-drawer";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { MarketplaceChannelConfig, ShopifyProductPreview, ShopifyProductChangeItem } from "@/lib/api";
import { mapMarketplaceChannelToConnectorSlug, type MarketplaceChannel } from "@/lib/marketplace-channels";

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
  returnTo: string;
  fallbackAckRequired: boolean;
  canQueueExportWithAck: boolean;
  previewInstallationId: string | null;
  publishableInstallations: Array<{ id: string; accountAlias: string; slug: string }>;
}

export function ExportWithPreviewForm({
  productId,
  actorRole,
  publishableChannels,
  templates,
  defaultExportChannel,
  selectedTemplateId,
  returnTo,
  fallbackAckRequired,
  canQueueExportWithAck,
  previewInstallationId,
  publishableInstallations,
}: ExportWithPreviewFormProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [isPending, startTransition] = useTransition();
  const [selectedChannel, setSelectedChannel] = useState(defaultExportChannel);
  const [preview, setPreview] = useState<ShopifyProductPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pendingFormData, setPendingFormData] = useState<FormData | null>(null);
  const [publishAnyway, setPublishAnyway] = useState(false);
  const [canonicalInstallationId, setCanonicalInstallationId] = useState<string | null>(null);
  // "preview": Shopify's richer field-diff drawer below. "simple": a plain
  // destination-confirmation drawer for every other channel, which previously
  // had no confirmation step at all and queued the export the instant the
  // button was clicked.
  const [confirmMode, setConfirmMode] = useState<"preview" | "simple" | null>(null);

  const [destinationKey, setDestinationKey] = useState(0);

  const channelSlug = mapMarketplaceChannelToConnectorSlug(selectedChannel as MarketplaceChannel);
  const channelInstallations = publishableInstallations.filter(i => i.slug === channelSlug);

  // Stale-response protection: monotonic generation counter + abort controller.
  // When the destination changes, the generation increments and any in-flight
  // request is aborted.  Responses whose generation differs from the current
  // generation are silently discarded.
  const previewGenerationRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const resetPreviewState = useCallback(() => {
    // Abort any in-flight preview fetch
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // Increment generation so any response that still arrives is stale
    previewGenerationRef.current += 1;
    setPreview(null);
    setPendingFormData(null);
    setPreviewError(null);
    setPreviewLoading(false);
    setPublishAnyway(false);
    setCanonicalInstallationId(null);
    setConfirmMode(null);
    setDestinationKey((k) => k + 1);
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    const isShopify = String(fd.get("channel") ?? "").toLowerCase() === "shopify";
    const formInstallationId = String(fd.get("installationId") ?? "").trim();
    const effectiveInstallationId = formInstallationId || previewInstallationId;
    if (!effectiveInstallationId || !isShopify) {
      // Every other channel (and Shopify with no resolvable destination) gets
      // the plain confirmation drawer below instead of queuing immediately.
      setPendingFormData(fd);
      setConfirmMode("simple");
      return;
    }

    // Abort previous in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Snapshot the generation at request time
    previewGenerationRef.current += 1;
    const requestGeneration = previewGenerationRef.current;
    const requestChannel = String(fd.get("channel") ?? "");
    const requestInstallationId = effectiveInstallationId;

    setPreviewLoading(true);
    setPreviewError(null);
    setPendingFormData(fd);
    setConfirmMode("preview");

    try {
      const res = await fetch(
        `/api/marketplace/preview-changes?installationId=${encodeURIComponent(effectiveInstallationId)}&productId=${encodeURIComponent(productId)}`,
        { method: "POST", signal: controller.signal },
      );

      // Stale-response guard: discard if destination changed while awaiting
      if (requestGeneration !== previewGenerationRef.current) {
        return;
      }

      // Any failure to compute a real diff still gets a confirmation step —
      // just the plain one, instead of silently queuing the export.
      if (!res.ok) {
        setConfirmMode("simple");
        return;
      }
      const data = (await res.json()) as ShopifyProductPreview;

      // Second stale guard after JSON parse
      if (requestGeneration !== previewGenerationRef.current) {
        return;
      }

      if (!data.hasExistingProduct) {
        setConfirmMode("simple");
        return;
      }

      // Verify the response matches the current destination
      const form = formRef.current;
      if (form) {
        const currentFd = new FormData(form);
        const currentChannel = String(currentFd.get("channel") ?? "");
        const currentInstId = String(currentFd.get("installationId") ?? "").trim() || previewInstallationId;
        if (currentChannel !== requestChannel || currentInstId !== requestInstallationId) {
          return;
        }
      }

      setCanonicalInstallationId(data.resolvedInstallationId ?? requestInstallationId);
      setPreview(data);
      setPublishAnyway(false);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      // Stale guard in catch path
      if (requestGeneration !== previewGenerationRef.current) {
        return;
      }
      setConfirmMode("simple");
    } finally {
      // Only clear loading if this request is still current
      if (requestGeneration === previewGenerationRef.current) {
        setPreviewLoading(false);
      }
    }
  };

  const handleConfirm = () => {
    if (!pendingFormData) return;
    if (canonicalInstallationId) {
      pendingFormData.set("installationId", canonicalInstallationId);
    }
    setPreview(null);
    setConfirmMode(null);
    startTransition(() => createExportJobAction(pendingFormData));
  };

  const handleCancel = () => {
    setPreview(null);
    setPendingFormData(null);
    setConfirmMode(null);
  };

  const isLoading = isPending || previewLoading;
  const hasChanges = preview && !preview.noChanges;

  return (
    <>
      <form ref={formRef} onSubmit={handleSubmit} className="grid gap-3 md:grid-cols-4">
        <input type="hidden" name="role" value={actorRole} />
        <input type="hidden" name="productId" value={productId} />
        {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="epf-channel">
            Channel
          </label>
          <Select id="epf-channel" name="channel" defaultValue={defaultExportChannel} onChange={(e) => { setSelectedChannel(e.target.value); resetPreviewState(); }}>
            {publishableChannels.map((ch) => (
              <option key={ch.channel} value={ch.channel}>
                {ch.displayName}
              </option>
            ))}
          </Select>
        </div>
        {channelInstallations.length === 1 ? (
          <>
            <input type="hidden" name="installationId" value={channelInstallations[0].id} />
            <div className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">Destination</span>
              <p className="text-sm text-slate-700">{channelInstallations[0].accountAlias || channelInstallations[0].id}</p>
            </div>
          </>
        ) : null}
        {channelInstallations.length > 1 ? (
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="epf-installation-id">
              Destination <span className="text-red-500">*</span>
            </label>
            <Select key={destinationKey} id="epf-installation-id" name="installationId" defaultValue="" required onChange={resetPreviewState}>
              <option value="" disabled>Select a destination</option>
              {channelInstallations.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {inst.accountAlias || inst.id}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
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
          <Select key={destinationKey} id="epf-fallback-ack" name="fallbackAcknowledged" defaultValue={fallbackAckRequired ? "false" : "true"}>
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

      {confirmMode === "preview" && preview ? (
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

      {confirmMode === "simple" && pendingFormData ? (
        (() => {
          const confirmChannel = String(pendingFormData.get("channel") ?? "");
          const confirmInstallationId = String(pendingFormData.get("installationId") ?? "").trim();
          const channelLabel =
            publishableChannels.find((ch) => ch.channel === confirmChannel)?.displayName ?? confirmChannel;
          const destinationLabel =
            publishableInstallations.find((inst) => inst.id === confirmInstallationId)?.accountAlias ||
            confirmInstallationId ||
            "Default account for this channel";
          return (
            <AppDrawer
              open={true}
              width="sm"
              title="Confirm this export"
              description="This queues a real export job — review the destination before continuing."
              onClose={handleCancel}
            >
              <div className="space-y-4">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Channel</dt>
                    <dd className="mt-1 text-slate-900">{channelLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Destination</dt>
                    <dd className="mt-1 text-slate-900">{destinationLabel}</dd>
                  </div>
                </dl>
                <p className="text-sm text-slate-600">
                  Once queued, track its progress in the Jobs workspace or the export result summary above.
                </p>
              </div>
              <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-4 mt-4">
                <button
                  type="button"
                  onClick={handleConfirm}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                  Confirm and queue export
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </AppDrawer>
          );
        })()
      ) : null}
    </>
  );
}
