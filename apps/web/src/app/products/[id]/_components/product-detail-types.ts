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
  MediaAsset,
  Product,
  ProductActivityEvent,
  Variant,
} from "@/lib/api";

export type DetailTab =
  | "overview"
  | "content"
  | "attributes"
  | "variants"
  | "media"
  | "pricing"
  | "channels"
  | "quality"
  | "activity"
  | "relationships";

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
  mediaAssets: MediaAsset[];
  mediaAssetCount: number;
  imageAssetCount: number;
  actorRole: AppRole;
  canWrite: boolean;
  canPublish: boolean;
  canEditPricing: boolean;
  activeTab: DetailTab;
  showChannelDiagnostics: boolean;
  selectedChannel: MarketplaceChannel;
  selectedTemplateId: string | undefined;
  returnTo: string;
  productAttributes: Record<string, unknown>;
  productAttributeDefinitions: AttributeDefinition[];
  publishableChannels: MarketplaceChannelConfig[];
  defaultExportChannel: MarketplaceChannel;
  mappingManagerInstallation: ConnectorInstallation | null;
  /** All ACTIVE installations with PUBLISH capability across all connectors. Keyed by connector slug so the form can filter by selected channel. */
  publishableInstallations: Array<{ id: string; accountAlias: string; slug: string }>;
  requiredFieldsDefault: string;
  fieldMapDefault: string;
  blockingIssueCount: number;
  warningIssueCount: number;
  recentJobs: MarketplaceExportJob[];
  activityEvents: ProductActivityEvent[];
  readinessBlockers: string[];
  readinessWarnings: string[];
  fallbackAckRequired: boolean;
  canQueueExportWithAck: boolean;
  deleteConfirmToken: string;
  connectorSubmissions: ConnectorSubmission[];
  tabHref: (tab: DetailTab) => string;
};
