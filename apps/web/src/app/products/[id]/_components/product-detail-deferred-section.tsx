import {
  getCategoryAttributes,
  getMarketplaceChannelMapping,
  getMarketplaceSimulation,
  getMarketplaceTemplates,
  type AppRole,
  type ConnectorPublishReadiness,
  type ConnectorInstallation,
  type MarketplaceChannel,
  type MarketplaceChannelConfig,
  type MarketplaceExportJob,
  type MediaAsset,
  type Product,
  type Variant,
} from "@/lib/api";
import { ActivityTab } from "./activity-tab";
import { ChannelsTab } from "./channels-tab";
import { ContentTab } from "./content-tab";
import { MediaTab } from "./media-tab";
import { OverviewTab } from "./overview-tab";
import { ProductDetailSideRail } from "./product-detail-side-rail";
import {
  asRecord,
  mapMarketplaceChannelToConnectorSlug,
} from "./product-detail-shared";
import type { DetailTab, ProductDetailPageData } from "./product-detail-types";
import { QualityTab } from "./quality-tab";
import { VariantsTab } from "./variants-tab";

interface ProductDetailDeferredSectionProps {
  productId: string;
  product: Product;
  variants: Variant[];
  channels: MarketplaceChannelConfig[];
  installedConnectors: ConnectorInstallation[];
  exportJobs: MarketplaceExportJob[];
  mediaAssets: MediaAsset[];
  readiness: ConnectorPublishReadiness;
  selectedChannel: MarketplaceChannel;
  selectedTemplateId: string | undefined;
  actorRole: AppRole;
  authHeader: string | undefined;
  canWrite: boolean;
  activeTab: DetailTab;
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
  readiness,
  selectedChannel,
  selectedTemplateId,
  actorRole,
  authHeader,
  canWrite,
  activeTab,
  returnTo,
  tabHref,
}: ProductDetailDeferredSectionProps) {
  const [templates, mapping, simulation, categoryAttributes] = await Promise.all([
    getMarketplaceTemplates(product.categoryId, selectedChannel, { role: actorRole, authHeader }),
    getMarketplaceChannelMapping(selectedChannel, product.categoryId, selectedTemplateId, {
      role: actorRole,
      authHeader,
    }),
    getMarketplaceSimulation(productId, selectedChannel, selectedTemplateId, { role: actorRole, authHeader }),
    getCategoryAttributes(product.categoryId, { role: actorRole, authHeader }),
  ]);

  const publishCapableConnectorSlugs = new Set(
    installedConnectors
      .filter((connector) => connector.status === "ACTIVE" && connector.capabilities.some((capability) => capability === "PUBLISH"))
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
        connector.status === "ACTIVE" &&
        connector.slug === mapMarketplaceChannelToConnectorSlug(selectedChannel),
    ) ?? null;

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
    activeTab,
    selectedChannel,
    selectedTemplateId,
    returnTo,
    tabHref,
    productAttributes: asRecord(product.attributes),
    productAttributeDefinitions: categoryAttributes.filter((definition) => definition.appliesTo !== "variant"),
    publishableChannels,
    defaultExportChannel,
    mappingManagerInstallation,
    requiredFieldsDefault: JSON.stringify(mapping.requiredFields, null, 2),
    fieldMapDefault: JSON.stringify(mapping.fieldMap, null, 2),
    blockingIssueCount:
      product.validationIssues?.filter((issue) => issue.severity === "error").length ?? 0,
    warningIssueCount:
      product.validationIssues?.filter((issue) => issue.severity === "warning").length ?? 0,
    recentJobs: exportJobs.slice(0, 5),
    readinessBlockers: readiness.blockers ?? [],
    readinessWarnings: readiness.warnings ?? [],
    fallbackAckRequired: (readiness.blockers ?? []).includes("fallback_ack_required"),
    canQueueExportWithAck:
      (readiness.blockers ?? []).filter((item) => item !== "fallback_ack_required").length === 0,
    deleteConfirmToken: (variants.find((variant) => variant.skuCode)?.skuCode ?? product.id).trim(),
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_290px]">
      <div className="space-y-5">
        {activeTab === "overview" && <OverviewTab data={pageData} />}
        {(activeTab === "content" || activeTab === "attributes") && <ContentTab data={pageData} />}
        {activeTab === "variants" && <VariantsTab data={pageData} />}
        {activeTab === "media" && <MediaTab data={pageData} />}
        {activeTab === "channels" && <ChannelsTab data={pageData} />}
        {activeTab === "quality" && <QualityTab data={pageData} />}
        {activeTab === "activity" && <ActivityTab data={pageData} />}
      </div>
      <ProductDetailSideRail data={pageData} />
    </div>
  );
}
