import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ProductReadinessSummaryBar } from "@/components/channel/product-readiness-summary-bar";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PlanLimitModal } from "@/components/ui/plan-limit-modal";
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
import { cn } from "@/lib/utils";
import { canEditWorkspace } from "@/lib/role-capabilities";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";
import { ProductDetailDeferredSection } from "./_components/product-detail-deferred-section";
import { ProductDirtyNavigationGuard } from "./_components/product-dirty-navigation-guard";
import { ProductDetailStatusAlerts } from "./_components/product-detail-status-alerts";
import {
  DETAIL_TABS,
  mapMarketplaceChannelToConnectorSlug,
  normalizeChannel,
  normalizeDetailTab,
  normalizeTemplateId,
} from "./_components/product-detail-shared";
import type { DetailTab } from "./_components/product-detail-types";
import { StatusToastEffect } from "./_components/status-toast-effect";

interface PageProps { params: Promise<{ id: string }>; searchParams: Promise<{ channel?: string; templateId?: string; tab?: string; returnTo?: string; updateStatus?: string; currentVersion?: string; planLimit?: string; planResource?: string; planLimitValue?: string; planCurrent?: string; planUpgrade?: string; deleteStatus?: string; deleteError?: string; }>; }

export const dynamic = "force-dynamic";

export default async function ProductPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();
  const canWrite = canEditWorkspace(actorRole);
  const activeTab = normalizeDetailTab(query.tab);
  const selectedChannel = normalizeChannel(query.channel);
  const selectedTemplateId = normalizeTemplateId(query.templateId);
  const returnTo = String(query.returnTo ?? "").trim().startsWith("/") ? String(query.returnTo ?? "").trim() : "";
  const updateStatus = String(query.updateStatus ?? "").trim();
  const conflictVersion = String(query.currentVersion ?? "").trim();
  const deleteStatus = String(query.deleteStatus ?? "").trim();
  const deleteError = String(query.deleteError ?? "").trim();
  const showPlanLimitModal = String(query.planLimit ?? "").trim() === "1" && String(query.planResource ?? "").trim().length > 0 && Number.isFinite(Number(query.planLimitValue)) && Number.isFinite(Number(query.planCurrent)) && String(query.planUpgrade ?? "").trim().length > 0;
  const dismissPlanLimitHref = (() => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, raw]) => {
      if (["planLimit", "planResource", "planLimitValue", "planCurrent", "planUpgrade"].includes(key)) return;
      const value = String(raw ?? "").trim();
      if (value.length > 0) params.set(key, value);
    });
    const encoded = params.toString();
    return encoded ? `/products/${encodeURIComponent(id)}?${encoded}` : `/products/${encodeURIComponent(id)}`;
  })();

  const variantsPromise = getProductVariants(id, { role: actorRole, authHeader });
  const channelsPromise = getMarketplaceChannels({ role: actorRole, authHeader });
  const installedConnectorsPromise = getInstalledConnectors({ role: actorRole, authHeader });
  const exportJobsPromise = getMarketplaceExportJobs(id, { templateSummary: true }, { role: actorRole, authHeader });

  let product;
  try { product = await getProduct(id, { role: actorRole, authHeader }); } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) redirect(buildLoginRedirect(`/products/${encodeURIComponent(id)}`, error));
    notFound();
  }

  const readinessPromise = evaluateConnectorPublishReadiness(
    mapMarketplaceChannelToConnectorSlug(selectedChannel),
    { categoryScope: product.categoryId, productId: id, fallbackAcknowledged: false },
    { role: actorRole, authHeader },
  );
  const mediaAssetsPromise = getMediaAssets(id, undefined, { role: actorRole, authHeader });

  const [variants, channels, installedConnectors, exportJobs, readiness, mediaAssets] = await Promise.all([
    variantsPromise,
    channelsPromise,
    installedConnectorsPromise,
    exportJobsPromise,
    readinessPromise,
    mediaAssetsPromise,
  ]);

  const tabHref = (tab: DetailTab): string => {
    const params = new URLSearchParams();
    params.set("tab", tab);
    if (selectedChannel) params.set("channel", selectedChannel);
    if (selectedTemplateId) params.set("templateId", selectedTemplateId);
    if (returnTo) params.set("returnTo", returnTo);
    return `/products/${encodeURIComponent(id)}?${params.toString()}`;
  };

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
  const selectedChannelConfig = channels.find((channel) => channel.channel === selectedChannel) ?? null;
  const selectedConnectorInstallation =
    installedConnectors.find((connector) => connector.slug === mapMarketplaceChannelToConnectorSlug(selectedChannel)) ?? null;
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
    if ((readiness.blockers ?? []).length > 0) {
      return {
        label: "Blocked",
        tone: "danger" as const,
        detail: `${readiness.blockers.length} publish blocker${readiness.blockers.length === 1 ? "" : "s"} for ${selectedChannelConfig?.displayName ?? selectedChannel}.`,
      };
    }
    if ((readiness.warnings ?? []).length > 0) {
      return {
        label: "Warnings",
        tone: "warning" as const,
        detail: `${readiness.warnings.length} readiness warning${readiness.warnings.length === 1 ? "" : "s"} remain.`,
      };
    }
    return {
      label: "Ready",
      tone: "success" as const,
      detail: `Selected ${selectedChannelConfig?.displayName ?? selectedChannel} mapping is clear.`,
    };
  })();
  const mediaReadiness = (() => {
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
        detail: `${selectedChannelConfig?.displayName ?? latestExportJob.channel} updated ${new Date(latestExportJob.updatedAt).toLocaleString()}.`,
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
    ...((readiness.blockers ?? []).length > 0
      ? [{ label: `Clear ${readiness.blockers.length} publish blocker${readiness.blockers.length === 1 ? "" : "s"}`, href: tabHref("channels") }]
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

  return (
    <div className="space-y-5">
      <PlanLimitModal isOpen={showPlanLimitModal} resource={String(query.planResource ?? "").trim()} limit={Number(query.planLimitValue)} current={Number(query.planCurrent)} upgradeUrl={String(query.planUpgrade ?? "").trim()} dismissHref={dismissPlanLimitHref} />
      <ProductDirtyNavigationGuard />
      <PageHeader
        className="sticky top-[4.5rem] z-20"
        title={product.title}
        description={`${sellerSku ? `SKU ${sellerSku}` : product.id.slice(0, 8)} | ${product.category?.path ?? product.categoryId}`}
        breadcrumb={<><Link href="/dashboard" className="hover:underline">Dashboard</Link> / <Link href="/catalog/products" className="hover:underline">Catalog</Link> / <span className="font-semibold text-slate-700">Product Detail</span></>}
        actions={<>{returnTo ? <Link href={returnTo} className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Back to inbox</Link> : null}<StatusChip label={product.status} tone={product.status === "active" ? "success" : "neutral"} /><StatusChip label={`${product.completenessScore ?? 0}% complete`} tone="info" />{canWrite ? <button type="submit" form="product-edit-form" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Save</button> : null}{canWrite ? <button type="submit" form="product-validate-form" className={cn(buttonVariants({ variant: "dark" }))}>Validate</button> : null}{canWrite ? <Link href={tabHref("channels")} data-product-tab-link="true" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Open publish & export</Link> : null}</>}
      />
      <div className="relative">
        <nav aria-label="Product detail tabs" className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-2 shadow-sm"><ul className="flex min-w-max gap-2">{DETAIL_TABS.map((tab) => <li key={tab.key}><Link href={tabHref(tab.key)} data-product-tab-link="true" className={`inline-flex rounded-md px-3 py-2 text-sm font-medium transition ${activeTab === tab.key ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}>{tab.label}</Link></li>)}</ul></nav>
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-xl bg-gradient-to-l from-white/80 to-transparent sm:hidden" />
      </div>
      <StatusToastEffect updateStatus={updateStatus} />
      <ProductDetailStatusAlerts updateStatus={updateStatus} conflictVersion={conflictVersion} deleteStatus={deleteStatus} deleteError={deleteError} />
      {activeTab === "overview" || activeTab === "channels" || activeTab === "quality" ? <ProductReadinessSummaryBar productId={id} role={actorRole} summary={{ currentChannelLabel: selectedChannelConfig?.displayName ?? selectedChannel, cards: [{ title: "Product readiness", href: tabHref("quality"), ...productReadiness }, { title: "Mapping readiness", href: tabHref("channels"), ...mappingReadiness }, { title: "Media readiness", href: tabHref("media"), ...mediaReadiness }, { title: "Connector readiness", href: "/channels/connectors", ...connectorReadiness }, { title: "Approval status", href: tabHref("quality"), ...approvalStatus }, { title: "Last export attempt", href: tabHref("channels"), ...lastExportAttempt }], blockers: topBlockers }} /> : null}
      <Suspense fallback={<ProductDetailDeferredLoading />}>
        <ProductDetailDeferredSection
          productId={id}
          product={product}
          variants={variants}
          channels={channels}
          installedConnectors={installedConnectors}
          exportJobs={exportJobs}
          mediaAssets={mediaAssets}
          selectedChannel={selectedChannel}
          selectedTemplateId={selectedTemplateId}
          readiness={readiness}
          actorRole={actorRole}
          authHeader={authHeader}
          canWrite={canWrite}
          activeTab={activeTab}
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
          <div key={index} className="h-10 w-full animate-pulse rounded bg-slate-100" />
        ))}
      </div>
      <div className="space-y-3">
        <div className="h-6 w-24 animate-pulse rounded bg-slate-100" />
        <div className="h-40 w-full animate-pulse rounded bg-slate-100" />
      </div>
    </div>
  );
}
