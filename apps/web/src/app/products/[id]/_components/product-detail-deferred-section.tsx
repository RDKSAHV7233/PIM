import {
  evaluateConnectorPublishReadiness,
  getCategoryAttributes,
  getMarketplaceChannelMapping,
  getMarketplaceSimulation,
  getMarketplaceTemplates,
  getProductActivity,
  getSubmissions,
  type AppRole,
  type ConnectorInstallation,
  type MarketplaceChannel,
  type MarketplaceChannelConfig,
  type MarketplaceExportJob,
  type MediaAsset,
  type Product,
  type Variant,
} from "@/lib/api";
import { ActivityTab } from "./activity-tab";
import { RelationshipsTab } from "./relationships-tab";
import { ChannelsTab } from "./channels-tab";
import { ContentTab } from "./content-tab";
import { MediaTab } from "./media-tab";
import { OverviewTab } from "./overview-tab";
import { ProductDetailSideRail } from "./product-detail-side-rail";
import {
  asRecord,
  isConnectorReadyToPublish,
  mapMarketplaceChannelToConnectorSlug,
} from "./product-detail-shared";
import type { DetailTab, ProductDetailPageData } from "./product-detail-types";
import { QualityTab } from "./quality-tab";
import { VariantsTab } from "./variants-tab";
import { PricingTab } from "./pricing-tab";
import { canEditPricing } from "@/lib/role-capabilities";

interface ProductDetailDeferredSectionProps {
  productId: string;
  product: Product;
  variants: Variant[];
  channels: MarketplaceChannelConfig[];
  installedConnectors: ConnectorInstallation[];
  exportJobs: MarketplaceExportJob[];
  mediaAssets: MediaAsset[];
  selectedChannel: MarketplaceChannel;
  selectedTemplateId: string | undefined;
  actorRole: AppRole;
  authHeader: string | undefined;
  canWrite: boolean;
  canPublish: boolean;
  activeTab: DetailTab;
  showChannelDiagnostics: boolean;
  returnTo: string;
  tabHref: (tab: DetailTab) => string;
}

export async function ProductDetailDeferredSection({
  productId,
  product,
  variants,
  channels,
  installedConnectors,
  exportJobs,
  mediaAssets,
  selectedChannel,
  selectedTemplateId,
  actorRole,
  authHeader,
  canWrite,
  canPublish,
  activeTab,
  showChannelDiagnostics,
  returnTo,
  tabHref,
}: ProductDetailDeferredSectionProps) {
  const [templates, mapping, simulation, categoryAttributes, readiness, submissionsRaw, activity] = await Promise.all([
    getMarketplaceTemplates(product.categoryId, selectedChannel, { role: actorRole, authHeader }).catch(
      () => [] as Awaited<ReturnType<typeof getMarketplaceTemplates>>,
    ),
    getMarketplaceChannelMapping(selectedChannel, product.categoryId, selectedTemplateId, undefined, {
      role: actorRole,
      authHeader,
    }).catch(
      () =>
        ({
          channel: selectedChannel,
          displayName: selectedChannel,
          requiredFields: [] as string[],
          fieldMap: {} as Record<string, string>,
          source: "system_pack" as const,
          templateId: null,
          templateName: null,
        }) satisfies Awaited<ReturnType<typeof getMarketplaceChannelMapping>>,
    ),
    getMarketplaceSimulation(productId, selectedChannel, selectedTemplateId, { role: actorRole, authHeader }).catch(
      () =>
        ({
          productId,
          channel: selectedChannel,
          displayName: selectedChannel,
          exportReady: false,
          riskScore: 0,
          riskBand: "low" as const,
          requiredFields: [] as string[],
          missingFields: [] as string[],
          channelIssues: [],
          complianceSummary: { errorCount: 0, warningCount: 0 },
          mappingSource: "system_pack" as const,
          templateId: null,
          templateName: null,
          mappedPayload: {},
          suggestions: [],
        }) satisfies Awaited<ReturnType<typeof getMarketplaceSimulation>>,
    ),
    getCategoryAttributes(product.categoryId, { role: actorRole, authHeader, revalidateSeconds: 60 }).catch(
      () => [] as Awaited<ReturnType<typeof getCategoryAttributes>>,
    ),
    evaluateConnectorPublishReadiness(
      mapMarketplaceChannelToConnectorSlug(selectedChannel),
      { categoryScope: product.categoryId, productId, fallbackAcknowledged: false },
      { role: actorRole, authHeader },
    ).catch(
      () =>
        ({
          ok: false,
          blockers: [] as string[],
          warnings: [] as string[],
          checks: {},
        }) satisfies Awaited<ReturnType<typeof evaluateConnectorPublishReadiness>>,
    ),
    getSubmissions({ productId, limit: 20 }, { role: actorRole, authHeader }).catch(() => null),
    getProductActivity(productId, 50, { role: actorRole, authHeader }).catch(() => null),
  ]);
  const connectorSubmissions = (() => {
    if (!submissionsRaw) return [];
    if (Array.isArray(submissionsRaw)) return submissionsRaw;
    return Array.isArray(submissionsRaw.items) ? submissionsRaw.items : [];
  })();

  const publishCapableConnectorSlugs = new Set(
    installedConnectors
      .filter((connector) => isConnectorReadyToPublish(connector) && connector.capabilities.some((capability) => capability === "PUBLISH"))
      .map((connector) => connector.slug),
  );
  const publishableChannels = channels.filter((channel) =>
    publishCapableConnectorSlugs.has(mapMarketplaceChannelToConnectorSlug(channel.channel)),
  );
  const defaultExportChannel =
    publishableChannels.find((channel) => channel.channel === selectedChannel)?.channel ??
    publishableChannels[0]?.channel ??
    selectedChannel;
  const mappingManagerInstallation =
    installedConnectors.find(
      (connector) =>
        isConnectorReadyToPublish(connector) &&
        connector.slug === mapMarketplaceChannelToConnectorSlug(selectedChannel),
    ) ?? null;

  const publishableInstallations = installedConnectors
    .filter(c => isConnectorReadyToPublish(c) && c.capabilities.some(cap => cap === "PUBLISH"))
    .map(c => ({ id: c.id, accountAlias: c.accountAlias, slug: c.slug }));

  const pageData: ProductDetailPageData = {
    productId,
    product,
    variants,
    channels,
    installedConnectors,
    exportJobs,
    templates,
    mapping,
    simulation,
    categoryAttributes,
    readiness,
    mediaAssetCount: mediaAssets.length,
    imageAssetCount: mediaAssets.filter((asset) => asset.mimeType.startsWith("image/")).length,
    actorRole,
    canWrite,
    canPublish,
    canEditPricing: canEditPricing(actorRole),
    activeTab,
    showChannelDiagnostics,
    selectedChannel,
    selectedTemplateId,
    returnTo,
    tabHref,
    productAttributes: asRecord(product.attributes),
    productAttributeDefinitions: categoryAttributes.filter((definition) => definition.appliesTo !== "variant"),
    publishableChannels,
    defaultExportChannel,
    mappingManagerInstallation,
    publishableInstallations,
    requiredFieldsDefault: JSON.stringify(mapping.requiredFields, null, 2),
    fieldMapDefault: JSON.stringify(mapping.fieldMap, null, 2),
    blockingIssueCount:
      product.validationIssues?.filter((issue) => issue.severity === "error").length ?? 0,
    warningIssueCount:
      product.validationIssues?.filter((issue) => issue.severity === "warning").length ?? 0,
    recentJobs: exportJobs.slice(0, 5),
    activityEvents: activity?.events ?? [],
    readinessBlockers: readiness.blockers ?? [],
    readinessWarnings: readiness.warnings ?? [],
    fallbackAckRequired: (readiness.blockers ?? []).includes("fallback_ack_required"),
    canQueueExportWithAck:
      (readiness.blockers ?? []).filter((item) => item !== "fallback_ack_required").length === 0,
    deleteConfirmToken: (variants.find((variant) => variant.skuCode)?.skuCode ?? product.id).trim(),
    connectorSubmissions,
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_290px]">
      <div className="space-y-5">
        {activeTab === "overview" && <OverviewTab data={pageData} />}
        {(activeTab === "content" || activeTab === "attributes") && <ContentTab data={pageData} />}
        {activeTab === "variants" && <VariantsTab data={pageData} />}
        {activeTab === "pricing" && (
          <PricingTab
            productId={productId}
            variants={variants}
            canWrite={canWrite}
          />
        )}
        {activeTab === "media" && <MediaTab data={pageData} />}
        {activeTab === "channels" && <ChannelsTab data={pageData} />}
        {activeTab === "quality" && <QualityTab data={pageData} />}
        {activeTab === "activity" && <ActivityTab data={pageData} />}
        {activeTab === "relationships" && (
          <RelationshipsTab
            productId={productId}
            productTitle={product.title}
            canWrite={canWrite}
            hidden={false}
          />
        )}
      </div>
      <ProductDetailSideRail data={pageData} />
    </div>
  );
}
