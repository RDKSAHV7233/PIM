import type {
  AppRole,
  AttributeDefinition,
  ChannelMappingTemplate,
  ConnectorInstallation,
  ConnectorPublishReadiness,
  ConnectorSubmission,
  MarketplaceChannel,
  MarketplaceChannelConfig,
  MarketplaceChannelMapping,
  MarketplaceExportJob,
  MarketplaceSimulation,
  Product,
  Variant,
} from "@/lib/api";

export type DetailTab =
  | "overview"
  | "content"
  | "attributes"
  | "variants"
  | "media"
  | "channels"
  | "quality"
  | "activity";

export type ProductDetailPageData = {
  productId: string;
  product: Product;
  variants: Variant[];
  channels: MarketplaceChannelConfig[];
  installedConnectors: ConnectorInstallation[];
  exportJobs: MarketplaceExportJob[];
  templates: ChannelMappingTemplate[];
  mapping: MarketplaceChannelMapping;
  simulation: MarketplaceSimulation;
  categoryAttributes: AttributeDefinition[];
  readiness: ConnectorPublishReadiness;
  mediaAssetCount: number;
  imageAssetCount: number;
  actorRole: AppRole;
  canWrite: boolean;
  activeTab: DetailTab;
  selectedChannel: MarketplaceChannel;
  selectedTemplateId: string | undefined;
  returnTo: string;
  productAttributes: Record<string, unknown>;
  productAttributeDefinitions: AttributeDefinition[];
  publishableChannels: MarketplaceChannelConfig[];
  defaultExportChannel: MarketplaceChannel;
  mappingManagerInstallation: ConnectorInstallation | null;
  requiredFieldsDefault: string;
  fieldMapDefault: string;
  blockingIssueCount: number;
  warningIssueCount: number;
  recentJobs: MarketplaceExportJob[];
  readinessBlockers: string[];
  readinessWarnings: string[];
  fallbackAckRequired: boolean;
  canQueueExportWithAck: boolean;
  deleteConfirmToken: string;
  connectorSubmissions: ConnectorSubmission[];
  tabHref: (tab: DetailTab) => string;
};
