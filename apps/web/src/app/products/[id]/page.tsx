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
import { ProductDetailStatusAlerts } from "./_components/product-detail-status-alerts";
import {
  DETAIL_TABS,
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

  const [variants, channels, installedConnectors, exportJobs] = await Promise.all([
    variantsPromise,
    channelsPromise,
    installedConnectorsPromise,
    exportJobsPromise,
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

  return (
    <div className="space-y-5">
      <PlanLimitModal isOpen={showPlanLimitModal} resource={String(query.planResource ?? "").trim()} limit={Number(query.planLimitValue)} current={Number(query.planCurrent)} upgradeUrl={String(query.planUpgrade ?? "").trim()} dismissHref={dismissPlanLimitHref} />
      <PageHeader
        className="sticky top-[4.5rem] z-20"
        title={product.title}
        description={`${sellerSku ? `SKU ${sellerSku}` : product.id.slice(0, 8)} | ${product.category?.path ?? product.categoryId}`}
        breadcrumb={<><Link href="/dashboard" className="hover:underline">Dashboard</Link> / <Link href="/catalog/products" className="hover:underline">Catalog</Link> / <span className="font-semibold text-slate-700">Product Detail</span></>}
        actions={<>{returnTo ? <Link href={returnTo} className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Back to inbox</Link> : null}<StatusChip label={product.status} tone={product.status === "active" ? "success" : "neutral"} /><StatusChip label={`${product.completenessScore ?? 0}% complete`} tone="info" />{canWrite ? <button type="submit" form="product-edit-form" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Save</button> : null}{canWrite ? <button type="submit" form="product-validate-form" className={cn(buttonVariants({ variant: "dark" }))}>Validate</button> : null}{canWrite ? <Link href={tabHref("channels")} className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Submit</Link> : null}</>}
      />
      <div className="relative">
        <nav aria-label="Product detail tabs" className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-2 shadow-sm"><ul className="flex min-w-max gap-2">{DETAIL_TABS.map((tab) => <li key={tab.key}><Link href={tabHref(tab.key)} className={`inline-flex rounded-md px-3 py-2 text-sm font-medium transition ${activeTab === tab.key ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}>{tab.label}</Link></li>)}</ul></nav>
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-xl bg-gradient-to-l from-white/80 to-transparent sm:hidden" />
      </div>
      <StatusToastEffect updateStatus={updateStatus} />
      <ProductDetailStatusAlerts updateStatus={updateStatus} conflictVersion={conflictVersion} deleteStatus={deleteStatus} deleteError={deleteError} />
      {activeTab === "overview" || activeTab === "channels" || activeTab === "quality" ? <ProductReadinessSummaryBar productId={id} role={actorRole} /> : null}
      <Suspense fallback={<ProductDetailDeferredLoading />}>
        <ProductDetailDeferredSection
          productId={id}
          product={product}
          variants={variants}
          channels={channels}
          installedConnectors={installedConnectors}
          exportJobs={exportJobs}
          selectedChannel={selectedChannel}
          selectedTemplateId={selectedTemplateId}
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
