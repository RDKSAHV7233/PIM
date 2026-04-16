import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ProductReadinessSummaryBar } from "@/components/channel/product-readiness-summary-bar";
import { PageHeader } from "@/components/ui/page-header";
import { PlanLimitModal } from "@/components/ui/plan-limit-modal";
import { StatusChip } from "@/components/ui/status-chip";
import {
  ApiHttpError,
  evaluateConnectorPublishReadiness,
  getCategoryAttributes,
  getInstalledConnectors,
  getMarketplaceChannelMapping,
  getMarketplaceChannels,
  getMarketplaceExportJobs,
  getMarketplaceSimulation,
  getMarketplaceTemplates,
  getProduct,
  getProductVariants,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { canEditWorkspace } from "@/lib/role-capabilities";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";
import { ActivityTab } from "./_components/activity-tab";
import { ChannelsTab } from "./_components/channels-tab";
import { ContentTab } from "./_components/content-tab";
import { MediaTab } from "./_components/media-tab";
import { OverviewTab } from "./_components/overview-tab";
import { ProductDetailSideRail } from "./_components/product-detail-side-rail";
import { ProductDetailStatusAlerts } from "./_components/product-detail-status-alerts";
import { asRecord, DETAIL_TABS, mapMarketplaceChannelToConnectorSlug, normalizeChannel, normalizeDetailTab, normalizeTemplateId } from "./_components/product-detail-shared";
import type { DetailTab, ProductDetailPageData } from "./_components/product-detail-types";
import { QualityTab } from "./_components/quality-tab";
import { VariantsTab } from "./_components/variants-tab";

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

  const [variants, channels, installedConnectors, exportJobs, templates, mapping, simulation, categoryAttributes, readiness] = await Promise.all([
    variantsPromise,
    channelsPromise,
    installedConnectorsPromise,
    exportJobsPromise,
    getMarketplaceTemplates(product.categoryId, selectedChannel, { role: actorRole, authHeader }),
    getMarketplaceChannelMapping(selectedChannel, product.categoryId, selectedTemplateId, { role: actorRole, authHeader }),
    getMarketplaceSimulation(id, selectedChannel, selectedTemplateId, { role: actorRole, authHeader }),
    getCategoryAttributes(product.categoryId, { role: actorRole, authHeader }),
    evaluateConnectorPublishReadiness(mapMarketplaceChannelToConnectorSlug(selectedChannel), { categoryScope: product.categoryId, productId: id, fallbackAcknowledged: false }, { role: actorRole, authHeader }),
  ]);

  const publishCapableConnectorSlugs = new Set(installedConnectors.filter((connector) => connector.status === "ACTIVE" && connector.capabilities.some((capability) => capability === "PUBLISH")).map((connector) => connector.slug));
  const publishableChannels = channels.filter((channel) => publishCapableConnectorSlugs.has(mapMarketplaceChannelToConnectorSlug(channel.channel)));
  const defaultExportChannel = publishableChannels.find((channel) => channel.channel === selectedChannel)?.channel ?? publishableChannels[0]?.channel ?? selectedChannel;
  const mappingManagerInstallation = installedConnectors.find((connector) => connector.status === "ACTIVE" && connector.slug === mapMarketplaceChannelToConnectorSlug(selectedChannel)) ?? null;
  const tabHref = (tab: DetailTab): string => {
    const params = new URLSearchParams();
    params.set("tab", tab);
    if (selectedChannel) params.set("channel", selectedChannel);
    if (selectedTemplateId) params.set("templateId", selectedTemplateId);
    if (returnTo) params.set("returnTo", returnTo);
    return `/products/${encodeURIComponent(id)}?${params.toString()}`;
  };

  const pageData: ProductDetailPageData = {
    productId: id, product, variants, channels, installedConnectors, exportJobs, templates, mapping, simulation, categoryAttributes, readiness,
    actorRole, canWrite, activeTab, selectedChannel, selectedTemplateId, returnTo, tabHref,
    productAttributes: asRecord(product.attributes),
    productAttributeDefinitions: categoryAttributes.filter((definition) => definition.appliesTo !== "variant"),
    publishableChannels, defaultExportChannel, mappingManagerInstallation,
    requiredFieldsDefault: JSON.stringify(mapping.requiredFields, null, 2), fieldMapDefault: JSON.stringify(mapping.fieldMap, null, 2),
    blockingIssueCount: product.validationIssues?.filter((issue) => issue.severity === "error").length ?? 0,
    warningIssueCount: product.validationIssues?.filter((issue) => issue.severity === "warning").length ?? 0,
    recentJobs: exportJobs.slice(0, 5), readinessBlockers: readiness.blockers ?? [], readinessWarnings: readiness.warnings ?? [],
    fallbackAckRequired: (readiness.blockers ?? []).includes("fallback_ack_required"),
    canQueueExportWithAck: (readiness.blockers ?? []).filter((item) => item !== "fallback_ack_required").length === 0,
    deleteConfirmToken: (variants.find((variant) => variant.skuCode)?.skuCode ?? product.id).trim(),
  };
  const sellerSku = (() => {
    const attributes = asRecord(product.attributes);
    const rawSku = attributes.sku;
    return typeof rawSku === "string" && rawSku.trim().length > 0 ? rawSku.trim() : "";
  })();

  return (
    <div className="space-y-5">
      <PlanLimitModal isOpen={showPlanLimitModal} resource={String(query.planResource ?? "").trim()} limit={Number(query.planLimitValue)} current={Number(query.planCurrent)} upgradeUrl={String(query.planUpgrade ?? "").trim()} dismissHref={dismissPlanLimitHref} />
      <PageHeader
        className="sticky top-[4.5rem] z-20"
        title={product.title}
        description={`${sellerSku ? `SKU ${sellerSku}` : product.id.slice(0, 8)} | ${product.category?.path ?? product.categoryId}`}
        breadcrumb={<><Link href="/dashboard" className="hover:underline">Dashboard</Link> / <Link href="/catalog/products" className="hover:underline">Catalog</Link> / <span className="font-semibold text-slate-700">Product Detail</span></>}
        actions={<>{returnTo ? <Link href={returnTo} className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Back to inbox</Link> : null}<StatusChip label={product.status} tone={product.status === "active" ? "success" : "neutral"} /><StatusChip label={`${product.completenessScore ?? 0}% complete`} tone="info" />{canWrite ? <button type="submit" form="product-edit-form" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Save</button> : null}{canWrite ? <button type="submit" form="product-validate-form" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">Validate</button> : null}{canWrite ? <Link href={tabHref("channels")} className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Submit</Link> : null}</>}
      />
      <div className="relative">
        <nav aria-label="Product detail tabs" className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-2 shadow-sm"><ul className="flex min-w-max gap-2">{DETAIL_TABS.map((tab) => <li key={tab.key}><Link href={tabHref(tab.key)} className={`inline-flex rounded-md px-3 py-2 text-sm font-medium transition ${activeTab === tab.key ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}>{tab.label}</Link></li>)}</ul></nav>
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-xl bg-gradient-to-l from-white/80 to-transparent sm:hidden" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_290px]">
        <div className="space-y-5">
          <ProductDetailStatusAlerts updateStatus={updateStatus} conflictVersion={conflictVersion} deleteStatus={deleteStatus} deleteError={deleteError} />
          {activeTab === "overview" && <OverviewTab data={pageData} />}
          {(activeTab === "overview" || activeTab === "channels" || activeTab === "quality") && (
            <ProductReadinessSummaryBar productId={id} role={actorRole} />
          )}
          {(activeTab === "content" || activeTab === "attributes") && <ContentTab data={pageData} />}
          {activeTab === "variants" && <VariantsTab data={pageData} />}
          {activeTab === "media" && <MediaTab data={pageData} />}
          {activeTab === "channels" && <ChannelsTab data={pageData} />}
          {activeTab === "quality" && <QualityTab data={pageData} />}
          {activeTab === "activity" && <ActivityTab data={pageData} />}
        </div>
        <ProductDetailSideRail data={pageData} />
      </div>
    </div>
  );
}
