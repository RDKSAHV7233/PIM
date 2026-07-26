import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ProductReadinessSummaryBar } from "@/components/channel/product-readiness-summary-bar";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PlanLimitModal } from "@/components/ui/plan-limit-modal";
import { SkeletonBlock } from "@/components/ui/skeleton";
import { StatusChip } from "@/components/ui/status-chip";
import {
  ApiHttpError,
  evaluateConnectorPublishReadiness,
  getMediaAssets,
  getInstalledConnectors,
  getMarketplaceChannels,
  getMarketplaceExportJobs,
  getProduct,
  getProductVariants,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { READINESS_CHANNELS } from "@/lib/channel-readiness";
import { cn } from "@/lib/utils";
import { canEditWorkspace, canPublishToChannels } from "@/lib/role-capabilities";
import { getServerSession } from "@/lib/server-session";
import { formatDateTime } from "@/lib/format";
import { ProductDetailDeferredSection } from "./_components/product-detail-deferred-section";
import { ProductDirtyNavigationGuard } from "./_components/product-dirty-navigation-guard";
import { ProductDetailStatusAlerts } from "./_components/product-detail-status-alerts";
import {
  DETAIL_TABS,
  isMappingBlockerCode,
  isMappingWarningCode,
  mapMarketplaceChannelToConnectorSlug,
  normalizeChannel,
  normalizeDetailTab,
  normalizeTemplateId,
} from "./_components/product-detail-shared";
import type { DetailTab } from "./_components/product-detail-types";
import { StatusToastEffect } from "./_components/status-toast-effect";
import { WorkflowStepper, type WorkflowStep } from "@/components/ui/workflow-stepper";

interface PageProps { params: Promise<{ id: string }>; searchParams: Promise<{ channel?: string; templateId?: string; tab?: string; focus?: string; returnTo?: string; updateStatus?: string; statusAt?: string; currentVersion?: string; planLimit?: string; planResource?: string; planLimitValue?: string; planCurrent?: string; planUpgrade?: string; planContact?: string; deleteStatus?: string; deleteError?: string; error?: string; errorMessage?: string; }>; }

export const dynamic = "force-dynamic";

export default async function ProductPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const { authHeader, actorRole } = await getServerSession();
  const canWrite = canEditWorkspace(actorRole);
  const canPublish = canPublishToChannels(actorRole);
  const activeTab = normalizeDetailTab(query.tab);
  const selectedChannel = normalizeChannel(query.channel);
  const selectedTemplateId = normalizeTemplateId(query.templateId);
  const showChannelDiagnostics = activeTab === "channels" && String(query.focus ?? "").trim() === "simulator";
  const returnTo = ((): string => { const v = String(query.returnTo ?? "").trim(); return /^\/(?!\/)/.test(v) ? v : ""; })();
  const updateStatus = String(query.updateStatus ?? "").trim();
  const statusAt = String(query.statusAt ?? "").trim();
  const conflictVersion = String(query.currentVersion ?? "").trim();
  const deleteStatus = String(query.deleteStatus ?? "").trim();
  const deleteError = String(query.deleteError ?? "").trim();
  const actionError = String(query.error ?? "").trim();
  const actionErrorMessage = String(query.errorMessage ?? "").trim();
  const showSaveAction = canWrite && (activeTab === "content" || activeTab === "attributes");
  const showValidateAction = canWrite && activeTab === "quality";
  const showPlanLimitModal = String(query.planLimit ?? "").trim() === "1" && String(query.planResource ?? "").trim().length > 0 && Number.isFinite(Number(query.planLimitValue)) && Number.isFinite(Number(query.planCurrent)) && String(query.planUpgrade ?? "").trim().length > 0;
  const planContact = String(query.planContact ?? "").trim() || null;
  const dismissPlanLimitHref = (() => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, raw]) => {
      if (["planLimit", "planResource", "planLimitValue", "planCurrent", "planUpgrade", "planContact"].includes(key)) return;
      const value = String(raw ?? "").trim();
      if (value.length > 0) params.set(key, value);
    });
    const encoded = params.toString();
    return encoded ? `/products/${encodeURIComponent(id)}?${encoded}` : `/products/${encodeURIComponent(id)}`;
  })();

  let channelsUnavailable = false;
  let installedConnectorsUnavailable = false;
  let exportJobsUnavailable = false;
  let mediaAssetsUnavailable = false;
  let effectiveReadinessUnavailable = false;

  // Start product-independent background promises immediately so they run during
  // the sequential product + channel/connector fetches below.
  const variantsPromise = getProductVariants(id, { role: actorRole, authHeader }).catch(() => [] as Awaited<ReturnType<typeof getProductVariants>>);
  const exportJobsPromise = getMarketplaceExportJobs(id, { templateSummary: true }, { role: actorRole, authHeader }).catch(() => {
    exportJobsUnavailable = true;
    return [] as Awaited<ReturnType<typeof getMarketplaceExportJobs>>;
  });

  let product;
  try { product = await getProduct(id, { role: actorRole, authHeader }); } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) redirect(buildLoginRedirect(`/products/${encodeURIComponent(id)}`, error));
    notFound();
  }

  // Resolve tenant-stable data (channels + connectors) before the main batch so we can
  // compute the effective channel once and make a single readiness call.
  const [channels, installedConnectors] = await Promise.all([
    getMarketplaceChannels({ role: actorRole, authHeader }).catch(() => {
      channelsUnavailable = true;
      return [] as Awaited<ReturnType<typeof getMarketplaceChannels>>;
    }),
    getInstalledConnectors({ role: actorRole, authHeader }).catch(() => {
      installedConnectorsUnavailable = true;
      return [] as Awaited<ReturnType<typeof getInstalledConnectors>>;
    }),
  ]);

  const publishCapableSlugs = new Set(
    installedConnectors
      .filter(
        (connector) =>
          connector.status === "ACTIVE" &&
          connector.capabilities.some((capability) => capability === "PUBLISH"),
      )
      .map((connector) => connector.slug),
  );
  const firstPublishableChannel = channels.find((channel) =>
    publishCapableSlugs.has(mapMarketplaceChannelToConnectorSlug(channel.channel)),
  )?.channel;
  const effectiveSelectedChannel =
    !query.channel && firstPublishableChannel ? firstPublishableChannel : selectedChannel;

  effectiveReadinessUnavailable = channelsUnavailable;

  const mediaAssetsPromise = getMediaAssets(id, undefined, { role: actorRole, authHeader }).catch(() => {
    mediaAssetsUnavailable = true;
    return [] as Awaited<ReturnType<typeof getMediaAssets>>;
  });

  const [variants, exportJobs, readiness, mediaAssets] = await Promise.all([
    variantsPromise,
    exportJobsPromise,
    evaluateConnectorPublishReadiness(
      mapMarketplaceChannelToConnectorSlug(effectiveSelectedChannel),
      { categoryScope: product.categoryId, productId: id, fallbackAcknowledged: false },
      { role: actorRole, authHeader },
    ).catch(() => {
      effectiveReadinessUnavailable = true;
      return null;
    }),
    mediaAssetsPromise,
  ]);

  const effectiveReadiness = readiness;

  // CTO review remediation (CODE-005): name every section whose upstream
  // fetch failed so ProductDetailStatusAlerts can warn the user instead of
  // silently rendering the []/null fallback as if there's simply nothing there.
  const degradedSections = [
    channelsUnavailable ? "Channels" : null,
    installedConnectorsUnavailable ? "Installed connectors" : null,
    exportJobsUnavailable ? "Export history" : null,
    mediaAssetsUnavailable ? "Media" : null,
    effectiveReadinessUnavailable ? "Publish readiness" : null,
  ].filter((label): label is string => label !== null);

  const tabHref = (tab: DetailTab): string => {
    const params = new URLSearchParams();
    params.set("tab", tab);
    if (selectedChannel) params.set("channel", selectedChannel);
    if (selectedTemplateId) params.set("templateId", selectedTemplateId);
    if (returnTo) params.set("returnTo", returnTo);
    return `/products/${encodeURIComponent(id)}?${params.toString()}`;
  };
  const channelDiagnosticsHref = (channel: string): string => {
    const params = new URLSearchParams();
    params.set("tab", "channels");
    params.set("channel", channel);
    params.set("focus", "simulator");
    if (selectedTemplateId) params.set("templateId", selectedTemplateId);
    if (returnTo) params.set("returnTo", returnTo);
    return `/products/${encodeURIComponent(id)}?${params.toString()}#channel-simulator-section`;
  };
  const readinessChannelLinks = Object.fromEntries(
    READINESS_CHANNELS.map((channel) => [channel, channelDiagnosticsHref(channel)]),
  ) as Partial<Record<(typeof READINESS_CHANNELS)[number], string>>;

  const sellerSku = (() => {
    const attributes =
      product.attributes && typeof product.attributes === "object"
        ? (product.attributes as Record<string, unknown>)
        : {};
    const rawSku = attributes.sku;
    if (typeof rawSku !== "string") return "";
    const normalizedSku = rawSku.trim();
    return normalizedSku.length > 0 ? normalizedSku : "";
  })();

  const blockingIssueCount = product.validationIssues?.filter((issue) => issue.severity === "error").length ?? 0;
  const warningIssueCount = product.validationIssues?.filter((issue) => issue.severity === "warning").length ?? 0;
  const imageAssetCount = mediaAssets.filter((asset) => asset.mimeType.startsWith("image/")).length;
  const mediaIssueCount =
    product.validationIssues?.filter((issue) => {
      const fieldPath = String(issue.fieldPath ?? "").toLowerCase();
      const message = issue.message.toLowerCase();
      const ruleCode = issue.ruleCode.toLowerCase();
      return (
        fieldPath.includes("image") ||
        fieldPath.includes("media") ||
        message.includes("image") ||
        message.includes("media") ||
        ruleCode.includes("image") ||
        ruleCode.includes("media")
      );
    }).length ?? 0;
  const selectedChannelConfig =
    channels.find((channel) => channel.channel === effectiveSelectedChannel) ?? null;
  const selectedConnectorInstallation =
    installedConnectors.find(
      (connector) =>
        connector.slug === mapMarketplaceChannelToConnectorSlug(effectiveSelectedChannel),
    ) ?? null;
  const latestExportJob = [...exportJobs].sort((left, right) =>
    new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  )[0] ?? null;
  const approvalStatus = (() => {
    switch (product.status) {
      case "in_review":
        return { label: "Awaiting review", tone: "warning" as const, detail: "Reviewer decision is still pending." };
      case "approved":
        return { label: "Approved", tone: "success" as const, detail: "Catalog approval is clear." };
      case "rejected":
        return { label: "Changes requested", tone: "danger" as const, detail: "Resolve review feedback before export." };
      case "active":
        return { label: "Live", tone: "success" as const, detail: "Product is active in the catalog." };
      case "archived":
        return { label: "Archived", tone: "neutral" as const, detail: "Archived products should not be exported." };
      default:
        return { label: "Draft", tone: "info" as const, detail: "Product is still in draft workflow." };
    }
  })();
  const productReadiness = (() => {
    if (blockingIssueCount > 0) {
      return {
        label: "Blocked",
        tone: "danger" as const,
        detail: `${blockingIssueCount} blocking quality issue${blockingIssueCount === 1 ? "" : "s"} must be fixed.`,
      };
    }
    if ((product.completenessScore ?? 0) >= 100) {
      return { label: "Ready", tone: "success" as const, detail: "Core product fields are complete." };
    }
    return {
      label: "In progress",
      tone: "warning" as const,
      detail: `${product.completenessScore ?? 0}% complete with ${warningIssueCount} warning${warningIssueCount === 1 ? "" : "s"} to review.`,
    };
  })();
  const mappingReadiness = (() => {
    if (effectiveReadinessUnavailable) {
      return {
        label: "Unavailable",
        tone: "neutral" as const,
        detail: "Publish readiness could not be loaded right now. Refresh or check the channel workspace before acting on this state.",
      };
    }
    // Only codes that are actually about the field mapping itself — approval,
    // connector, and quality blockers are already tracked by their own cards
    // (Approval status, Connector readiness, Product readiness) and must not
    // make this one say "Blocked" for a mapping that's actually fine.
    const mappingBlockers = (effectiveReadiness?.blockers ?? []).filter(isMappingBlockerCode);
    const mappingWarnings = (effectiveReadiness?.warnings ?? []).filter(isMappingWarningCode);
    if (mappingBlockers.length > 0) {
      return {
        label: "Blocked",
        tone: "danger" as const,
        detail: `${mappingBlockers.length} mapping blocker${mappingBlockers.length === 1 ? "" : "s"} for ${selectedChannelConfig?.displayName ?? effectiveSelectedChannel}.`,
      };
    }
    if (mappingWarnings.length > 0) {
      return {
        label: "Warnings",
        tone: "warning" as const,
        detail: `${mappingWarnings.length} mapping warning${mappingWarnings.length === 1 ? "" : "s"} remain.`,
      };
    }
    return {
      label: "Ready",
      tone: "success" as const,
      detail: `Selected ${selectedChannelConfig?.displayName ?? effectiveSelectedChannel} mapping is clear.`,
    };
  })();
  const mediaReadiness = (() => {
    if (mediaAssetsUnavailable) {
      return {
        label: "Unavailable",
        tone: "neutral" as const,
        detail: "Media readiness could not be loaded right now.",
      };
    }
    if (imageAssetCount === 0) {
      return { label: "Blocked", tone: "danger" as const, detail: "No image assets are linked to this product." };
    }
    if (mediaIssueCount > 0) {
      return {
        label: "Warnings",
        tone: "warning" as const,
        detail: `${imageAssetCount} image${imageAssetCount === 1 ? "" : "s"} linked with ${mediaIssueCount} media issue${mediaIssueCount === 1 ? "" : "s"} to review.`,
      };
    }
    return {
      label: "Ready",
      tone: "success" as const,
      detail: `${imageAssetCount} image asset${imageAssetCount === 1 ? "" : "s"} linked for publish.`,
    };
  })();
  const connectorReadiness = (() => {
    if (installedConnectorsUnavailable) {
      return {
        label: "Unavailable",
        tone: "neutral" as const,
        detail: "Connector account status could not be loaded right now.",
      };
    }
    if (!selectedConnectorInstallation) {
      return { label: "Missing", tone: "danger" as const, detail: "Install a connector account before you export." };
    }
    if (selectedConnectorInstallation.status === "ACTIVE") {
      return {
        label: "Connected",
        tone: "success" as const,
        detail: `${selectedConnectorInstallation.displayName}: ${selectedConnectorInstallation.accountAlias}`,
      };
    }
    if (selectedConnectorInstallation.status === "CREDENTIAL_EXPIRED") {
      return { label: "Expired", tone: "danger" as const, detail: "Connector credentials need attention before export." };
    }
    return {
      label: selectedConnectorInstallation.status.replace(/_/g, " "),
      tone: "warning" as const,
      detail: `${selectedConnectorInstallation.displayName} is not currently export-ready.`,
    };
  })();
  const lastExportAttempt = latestExportJob
    ? {
        label: latestExportJob.status.replace(/_/g, " "),
        tone:
          latestExportJob.status === "completed"
            ? ("success" as const)
            : latestExportJob.status === "failed" || latestExportJob.status === "dead_letter"
              ? ("danger" as const)
              : latestExportJob.status === "queued" || latestExportJob.status === "processing" || latestExportJob.status === "retrying"
                ? ("warning" as const)
                : ("neutral" as const),
        detail: `${selectedChannelConfig?.displayName ?? latestExportJob.channel} updated ${formatDateTime(latestExportJob.updatedAt)}.`,
      }
    : exportJobsUnavailable
      ? {
          label: "Unavailable",
          tone: "neutral" as const,
          detail: "Latest export activity could not be loaded right now.",
        }
      : {
        label: "Not queued",
        tone: "neutral" as const,
        detail: "No export attempt has been queued for this product yet.",
      };
  const topBlockers = [
    ...(blockingIssueCount > 0
      ? [{ label: `Fix ${blockingIssueCount} quality blocker${blockingIssueCount === 1 ? "" : "s"}`, href: tabHref("quality") }]
      : []),
    ...((effectiveReadiness?.blockers ?? []).length > 0
      ? [{ label: `Clear ${(effectiveReadiness?.blockers ?? []).length} publish blocker${(effectiveReadiness?.blockers ?? []).length === 1 ? "" : "s"}`, href: tabHref("channels") }]
      : []),
    ...(imageAssetCount === 0 || mediaIssueCount > 0
      ? [{ label: imageAssetCount === 0 ? "Add product media" : "Review media issues", href: tabHref("media") }]
      : []),
    ...(!selectedConnectorInstallation || selectedConnectorInstallation.status !== "ACTIVE"
      ? [{ label: "Fix connector account", href: "/channels/connectors" }]
      : []),
    ...(product.status === "rejected" || product.status === "in_review"
      ? [{ label: "Review approval status", href: tabHref("quality") }]
      : []),
  ].slice(0, 4);
  const workflowSteps: WorkflowStep[] = (() => {
    switch (product.status) {
      case "in_review":
        return [
          { label: "Draft", tone: "complete" },
          { label: "In Review", tone: "current" },
          { label: "Approved", tone: "pending" },
          { label: "Active", tone: "pending" },
        ];
      case "approved":
        return [
          { label: "Draft", tone: "complete" },
          { label: "In Review", tone: "complete" },
          { label: "Approved", tone: "current" },
          { label: "Active", tone: "pending" },
        ];
      case "rejected":
        return [
          { label: "Draft", tone: "complete" },
          { label: "In Review", tone: "complete" },
          { label: "Changes Requested", tone: "rejected" },
          { label: "Active", tone: "pending" },
        ];
      case "active":
        return [
          { label: "Draft", tone: "complete" },
          { label: "In Review", tone: "complete" },
          { label: "Approved", tone: "complete" },
          { label: "Active", tone: "current" },
        ];
      case "archived":
        return [
          { label: "Draft", tone: "complete" },
          { label: "In Review", tone: "complete" },
          { label: "Approved", tone: "complete" },
          { label: "Archived", tone: "current" },
        ];
      default:
        return [
          { label: "Draft", tone: "current" },
          { label: "In Review", tone: "pending" },
          { label: "Approved", tone: "pending" },
          { label: "Active", tone: "pending" },
        ];
    }
  })();
  const nextAction = (() => {
    if (product.status === "draft") {
      if (blockingIssueCount > 0) {
        return {
          title: `Fix ${blockingIssueCount} blocking issue${blockingIssueCount === 1 ? "" : "s"} in the Quality tab`,
          detail: "Clear product-level blockers before sending this item forward for review.",
          href: tabHref("quality"),
          cta: "Open Quality tab",
          tone: "border-red-200 bg-red-50/70",
        };
      }
      return {
        title: "Submit for review - product is ready",
        detail: "Core quality blockers are clear. Review the quality checklist and move this draft forward.",
        href: tabHref("quality"),
        cta: "Review quality",
        tone: "border-emerald-200 bg-emerald-50/70",
      };
    }
    if (product.status === "in_review") {
      return {
        title: "Awaiting review decision",
        detail: "A reviewer still needs to approve or reject this product before it can move forward.",
        href: null,
        cta: null,
        tone: "border-amber-200 bg-amber-50/70",
      };
    }
    if (product.status === "rejected") {
      return {
        title: "Address reviewer feedback and resubmit",
        detail: "Review the quality feedback, make the required changes, and prepare this product for another review pass.",
        href: tabHref("quality"),
        cta: "Open Quality tab",
        tone: "border-red-200 bg-red-50/70",
      };
    }
    if (product.status === "approved") {
      if (effectiveReadinessUnavailable || installedConnectorsUnavailable || exportJobsUnavailable) {
        return {
          title: "Channel truth is temporarily unavailable",
          detail: "One or more supporting channel reads failed, so publish readiness should be rechecked before moving this product forward.",
          href: tabHref("channels"),
          cta: "Open Channels tab",
          tone: "border-slate-200 bg-slate-50/70",
        };
      }
      if ((effectiveReadiness?.blockers ?? []).length > 0 || (effectiveReadiness?.warnings ?? []).length > 0) {
        return {
          title: "Map remaining attributes to go live",
          detail: "Channel mapping still needs attention before this approved product is ready for publish and export.",
          href: tabHref("channels"),
          cta: "Open Channels tab",
          tone: "border-amber-200 bg-amber-50/70",
        };
      }
      return {
        title: "Activate this product to make it live",
        detail: "Approval and publish readiness are clear. Use the channel workflow to move this product into a live state.",
        href: tabHref("channels"),
        cta: "Open publish & export",
        tone: "border-blue-200 bg-blue-50/70",
      };
    }
    if (product.status === "active") {
      if (exportJobsUnavailable || installedConnectorsUnavailable) {
        return {
          title: "Channel status is temporarily unavailable",
          detail: "Latest connector or export status could not be loaded, so this product should not be treated as fully healthy yet.",
          href: tabHref("channels"),
          cta: "Open Channels tab",
          tone: "border-slate-200 bg-slate-50/70",
        };
      }
      const latestExportStatus = String(latestExportJob?.status ?? "").trim().toLowerCase();
      const hasConnectorErrors =
        latestExportStatus === "failed" ||
        latestExportStatus === "dead_letter" ||
        latestExportStatus === "rejected" ||
        latestExportStatus === "error" ||
        (selectedConnectorInstallation?.status ?? "ACTIVE") !== "ACTIVE";
      if (hasConnectorErrors) {
        return {
          title: "Fix connector sync errors in the Channels tab",
          detail: "This product is live, but connector health or the latest export attempt still needs attention.",
          href: tabHref("channels"),
          cta: "Open Channels tab",
          tone: "border-amber-200 bg-amber-50/70",
        };
      }
      return {
        title: "Product is live and healthy",
        detail: "Quality, media, and connector signals are currently clear for this live product.",
        href: null,
        cta: null,
        tone: "border-emerald-200 bg-emerald-50/70",
      };
    }
    if (product.status === "archived") {
      return {
        title: "Archived product",
        detail: "This product is no longer active in the catalog. Restore or duplicate it only if it needs to go live again.",
        href: null,
        cta: null,
        tone: "border-slate-200 bg-slate-50",
      };
    }
    return null;
  })();

  return (
    <div className="space-y-5">
      <PlanLimitModal isOpen={showPlanLimitModal} resource={String(query.planResource ?? "").trim()} limit={Number(query.planLimitValue)} current={Number(query.planCurrent)} upgradeUrl={String(query.planUpgrade ?? "").trim()} contactUrl={planContact} dismissHref={dismissPlanLimitHref} />
      <ProductDirtyNavigationGuard />
      <PageHeader
        className="sticky top-[4.5rem] z-20"
        title={product.title}
        description={`${sellerSku ? `SKU ${sellerSku}` : product.id.slice(0, 8)} | ${product.category?.path ?? product.categoryId}`}
        breadcrumb={<><Link href="/dashboard" className="hover:underline">Dashboard</Link> / <Link href="/catalog/products" className="hover:underline">Catalog</Link> / <span className="font-semibold text-slate-700">Product Detail</span></>}
        actions={<>{returnTo ? <Link href={returnTo} className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Back to inbox</Link> : null}<StatusChip label={product.status} tone={product.status === "active" ? "success" : "neutral"} /><StatusChip label={`${product.completenessScore ?? 0}% complete`} tone="info" />{showSaveAction ? <button type="submit" form="product-edit-form" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Save</button> : null}{showValidateAction ? <button type="submit" form="product-validate-form" className={cn(buttonVariants({ variant: "dark" }))}>Run validation</button> : null}{canPublish ? <Link href={tabHref("channels")} data-product-tab-link="true" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Open publish & export</Link> : null}</>}
      />
      <nav aria-label="Product detail tabs" className="overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-sm"><ul className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">{DETAIL_TABS.map((tab) => <li key={tab.key}><Link href={tabHref(tab.key)} data-product-tab-link="true" aria-current={activeTab === tab.key ? "page" : undefined} className={`inline-flex w-full justify-center rounded-md px-3 py-2 text-sm font-medium transition sm:w-auto ${activeTab === tab.key ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}>{tab.label}</Link></li>)}</ul></nav>
      <StatusToastEffect updateStatus={updateStatus} actionError={actionError} actionErrorMessage={actionErrorMessage} />
      <ProductDetailStatusAlerts
        updateStatus={updateStatus}
        conflictVersion={conflictVersion}
        deleteStatus={deleteStatus}
        deleteError={deleteError}
        actionError={actionError}
        actionErrorMessage={actionErrorMessage}
        degradedSections={degradedSections}
      />
      {activeTab === "overview" && nextAction ? (
        <Card className={nextAction.tone}>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next Action</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">{nextAction.title}</h2>
              <p className="mt-1 text-sm text-slate-600">{nextAction.detail}</p>
            </div>
            {nextAction.href && nextAction.cta ? (
              <Link
                href={nextAction.href}
                className="inline-flex rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-white/70"
              >
                {nextAction.cta}
              </Link>
            ) : null}
          </div>
        </Card>
      ) : null}
      {activeTab === "overview" ? <WorkflowStepper steps={workflowSteps} /> : null}
      {activeTab === "overview" || activeTab === "channels" || activeTab === "quality" ? <ProductReadinessSummaryBar productId={id} role={actorRole} selectedTemplateId={selectedTemplateId} channelLinks={readinessChannelLinks} refreshSignal={statusAt} summary={{ currentChannelLabel: selectedChannelConfig?.displayName ?? selectedChannel, cards: [{ title: "Product readiness", href: tabHref("quality"), ...productReadiness }, { title: "Mapping readiness", href: tabHref("channels"), ...mappingReadiness }, { title: "Media readiness", href: tabHref("media"), ...mediaReadiness }, { title: "Connector readiness", href: "/channels/connectors", ...connectorReadiness }, { title: "Approval status", href: tabHref("quality"), ...approvalStatus }, { title: "Last export attempt", href: tabHref("channels"), ...lastExportAttempt }], blockers: topBlockers }} /> : null}
      <Suspense fallback={<ProductDetailDeferredLoading />}>
        <ProductDetailDeferredSection
          productId={id}
          product={product}
          variants={variants}
          channels={channels}
          installedConnectors={installedConnectors}
          exportJobs={exportJobs}
          mediaAssets={mediaAssets}
          selectedChannel={effectiveSelectedChannel}
          selectedTemplateId={selectedTemplateId}
          actorRole={actorRole}
          authHeader={authHeader}
          canWrite={canWrite}
          canPublish={canPublish}
          activeTab={activeTab}
          showChannelDiagnostics={showChannelDiagnostics}
          returnTo={returnTo}
          tabHref={tabHref}
        />
      </Suspense>
    </div>
  );
}

function ProductDetailDeferredLoading() {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_290px]">
      <div className="space-y-3">
        {Array.from({ length: 8 }).map((_, index) => (
          <SkeletonBlock key={index} className="h-10 w-full" />
        ))}
      </div>
      <div className="space-y-3">
        <SkeletonBlock className="h-6 w-24" />
        <SkeletonBlock className="h-40 w-full" />
      </div>
    </div>
  );
}
