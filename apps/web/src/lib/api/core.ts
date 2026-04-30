import type { MarketplaceChannel } from "../marketplace-channels";

export type CatalogStatus = "draft" | "in_review" | "approved" | "rejected" | "active" | "archived";
export type RuleSeverity = "error" | "warning";
export type { MarketplaceChannel };
export type AppRole = "admin" | "editor" | "reviewer" | "viewer";

const APP_ROLES: readonly AppRole[] = ["admin", "editor", "reviewer", "viewer"];

export function normalizeAppRole(value: FormDataEntryValue | string | null | undefined): AppRole {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (APP_ROLES.includes(normalized as AppRole)) {
    return normalized as AppRole;
  }
  const envDefault = String(process.env.PIM_DEFAULT_ROLE ?? "").trim().toLowerCase();
  if (APP_ROLES.includes(envDefault as AppRole)) {
    return envDefault as AppRole;
  }
  return "viewer";
}

export interface ValidationIssue {
  id: string;
  productId: string;
  variantId: string | null;
  ruleId: string | null;
  severity: RuleSeverity;
  ruleCode: string;
  message: string;
  fieldPath: string | null;
  status: "open" | "resolved";
  createdAt: string;
  updatedAt: string;
}

export type IssueInboxSeverity = "BLOCKING" | "WARNING";

export interface IssueInboxItem {
  issueId: string;
  productId: string;
  productName: string;
  sku: string;
  productStatus: CatalogStatus;
  categoryId: string;
  categoryName: string;
  fieldPath: string | null;
  severity: IssueInboxSeverity;
  sellerMessage: string;
  suggestedFix: string;
  detectedAt: string;
}

export interface IssueInboxResponse {
  items: IssueInboxItem[];
  nextCursor: string | null;
  limit: number;
  resolvedToday: number;
  resolvedYesterday: number;
  trend: "up" | "down" | "flat";
}

export interface IssueInboxResolveResult {
  requested: number;
  resolved: number;
  skippedBlocked: number;
  skippedAlreadyResolved: number;
  skippedMissing: number;
}

export interface AttributeDefinition {
  id: string;
  categoryId: string;
  key: string;
  name: string;
  dataType: "text" | "number" | "boolean" | "select" | "json";
  required: boolean;
  allowedValues: unknown;
  appliesTo: "product" | "variant";
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  path: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Variant {
  id: string;
  productId: string;
  skuCode: string;
  attributes: Record<string, unknown>;
  mrp: number | null;
  sellingPrice: number | null;
  inventoryQty: number;
  status: CatalogStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  title: string;
  description: string;
  brand: string;
  version: number;
  categoryId: string;
  hsnCode: string | null;
  gstRate: number | null;
  attributes: Record<string, unknown>;
  status: CatalogStatus;
  category?: Category;
  variants?: Variant[];
  validationIssues?: ValidationIssue[];
  completenessScore?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductListItem {
  id: string;
  title: string;
  brand: string;
  categoryId: string;
  categoryName?: string;
  categoryPath?: string;
  status: CatalogStatus;
  completenessScore?: number;
  variantCount: number;
  openValidationErrorCount: number;
  openValidationWarningCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogStats {
  categories: number;
  products: number;
  variants: number;
  pendingApprovals: number;
  redactedSections?: string[];
}

export interface ConnectorInstallation {
  id: string;
  tenantKey: string;
  connectorId: string;
  slug: string;
  displayName: string;
  accountAlias: string;
  externalAccountRef: string | null;
  status: "ACTIVE" | "PAUSED" | "CREDENTIAL_EXPIRED" | "DISABLED" | string;
  capabilities: string[];
  implementationStatus?: "full" | "partial" | "stub";
  launchStage: "live" | "manual" | "planned";
  launchNote: string | null;
  metadata: Record<string, unknown>;
  installedAt: string;
  installedBy: string;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
  actions?: ConnectorActionMatrix;
}

export interface ConnectorDefinition {
  id: string;
  slug: string;
  displayName: string;
  authType: string;
  capabilities: string[];
  implementationStatus?: "full" | "partial" | "stub";
  launchStage: "live" | "manual" | "planned";
  launchNote: string | null;
  marketplaceId: string | null;
  connectorVersion: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  actions?: ConnectorActionMatrix;
}

export interface ConnectorActionRule {
  allowed: boolean;
  reason: string | null;
}

export interface ConnectorActionMatrix {
  install: ConnectorActionRule;
  reconnect: ConnectorActionRule;
  uninstall: ConnectorActionRule;
}

export interface ConnectorPermission {
  id: string;
  tenantKey: string;
  principalType: "user" | "role";
  principalId: string;
  connectorSlug: string;
  accountAlias: string;
  action: "install" | "reconnect" | "uninstall";
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorPublicationTarget {
  id: string;
  name: string;
  selected: boolean;
  catalogId?: string | null;
  catalogTitle?: string | null;
  catalogType?: string | null;
}

export interface ConnectorPublicationTargetsUpdateResponse {
  id: string;
  publicationTargets: ConnectorPublicationTarget[];
  updatedAt: string;
}

export interface WorkspaceUser {
  id: string;
  userId: string;
  role: AppRole;
  isActive: boolean;
  lockedUntil: string | null;
  isLocked: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AccessScopeAssignmentSubjectType = "user" | "role";
export type AccessScopeAssignmentScopeType = "category" | "brand" | "channel" | "connector_account";
export type AccessScopeAssignmentAction =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "archive"
  | "approve"
  | "reject"
  | "publish"
  | "unpublish"
  | "import"
  | "export"
  | "bulk_edit"
  | "preview_connector_payload"
  | "manage_connector"
  | "manage_users"
  | "manage_settings"
  | "view_audit_logs";

export interface AccessScopeAssignment {
  id: string;
  tenantKey: string;
  subjectType: AccessScopeAssignmentSubjectType;
  subjectId: string;
  scopeType: AccessScopeAssignmentScopeType;
  categoryId: string | null;
  connectorInstallationId: string | null;
  scopeValue: string | null;
  actions: AccessScopeAssignmentAction[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  categoryPath?: string | null;
  connectorAccountAlias?: string | null;
  connectorSlug?: string | null;
}

export interface ApiAccessKey {
  id: string;
  label: string;
  role: AppRole;
  keyPrefix: string;
  isActive: boolean;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedApiAccessKey extends ApiAccessKey {
  plainTextKey: string;
}

export interface OutboundWebhookEndpoint {
  id: string;
  name: string;
  eventType: "import_completed" | "import_failed" | "publish_succeeded" | "publish_failed" | "approval_decision";
  targetUrl: string;
  isActive: boolean;
  createdBy: string | null;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OutboundWebhookDelivery {
  id: string;
  endpointId: string;
  endpointName: string | null;
  eventType: "import_completed" | "import_failed" | "publish_succeeded" | "publish_failed" | "approval_decision";
  eventId: string;
  status: "queued" | "delivered" | "failed" | "skipped";
  attemptCount: number;
  responseStatus: number | null;
  errorMessage: string | null;
  attemptedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  nextCursor: string | null;
  limit: number;
}

export type AuditEntityType =
  | "product"
  | "category"
  | "mapping"
  | "connector"
  | "user"
  | "plan"
  | "privacy"
  | "auth"
  | "import"
  | "job"
  | "other";

export interface AuditEventRecord {
  id: string;
  actorId: string;
  actorRole: AppRole | string;
  action: string;
  resource: string;
  resourceId: string | null;
  entityType: AuditEntityType;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditEventListResponse {
  items: AuditEventRecord[];
  nextCursor: string | null;
  limit: number;
}

export type ProductListQuery = {
  slim?: boolean;
  cursor?: string;
  limit?: number;
};

export type CategoryListQuery = {
  all?: boolean;
  cursor?: string;
  limit?: number;
};

export type AuditEventsQuery = {
  actorId?: string;
  action?: string;
  resourceId?: string;
  entityType?: AuditEntityType;
  dateFrom?: string;
  dateTo?: string;
  cursor?: string;
  limit?: number;
};

export type ExportJobListQuery = {
  templateSummary?: boolean;
  cursor?: string;
  limit?: number;
};

export interface PlanUsageResponse {
  planTier: "STARTER" | "GROWTH" | "ENTERPRISE" | string;
  billingStatus: "trial" | "active_paid" | "past_due" | "cancelled" | string;
  accessStatus: "active" | "suspended" | string;
  month: string;
  billingCycleResetAt: string;
  skus: { current: number; limit: number };
  submissions: { current: number; limit: number };
  storageGb: { current: number; limit: number };
  users: { current: number; limit: number };
  connectorsInstallations: { current: number; limit: number };
  connectorAccounts: { current: number; limit: number };
  profile: {
    tenantKey: string;
    planTier: "STARTER" | "GROWTH" | "ENTERPRISE" | string;
    billingStatus: "trial" | "active_paid" | "past_due" | "cancelled" | string;
    accessStatus: "active" | "suspended" | string;
    effectiveFrom: string | null;
    trialEndsAt: string | null;
    paidThroughAt: string | null;
    graceEndsAt: string | null;
    cancelledAt: string | null;
    suspendedAt: string | null;
    suspensionReason: string | null;
    billingContactEmail: string | null;
    updatedBy: string | null;
    createdAt: string;
    updatedAt: string;
  };
}

export interface PlanUpgradeRequest {
  id: string;
  tenantKey: string;
  workspaceSlug: string | null;
  displayName: string | null;
  requestType: "upgrade" | string;
  status: "open" | "acknowledged" | "resolved" | "cancelled" | string;
  requestedBy: string;
  requesterRole: AppRole | string;
  currentPlanTier: "STARTER" | "GROWTH" | "ENTERPRISE" | string;
  currentBillingStatus: "trial" | "active_paid" | "past_due" | "cancelled" | string;
  currentAccessStatus: "active" | "suspended" | string;
  notes: string | null;
  source: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlanUpgradeRequestLookupResponse {
  item: PlanUpgradeRequest | null;
}

export interface PlanUpgradeRequestCreateResponse {
  created: boolean;
  item: PlanUpgradeRequest;
}

export interface CommercialRequestListResponse {
  items: PlanUpgradeRequest[];
  count: number;
}

export interface DashboardHealthSnapshot {
  capturedAt: string;
  totalSkus: number;
  completeSkus: number;
  incompleteSkus: number;
  publishReadyByConnector: Record<string, number>;
  blockedByConnector: Record<string, number>;
  rejectionRiskHigh: number;
  openIssuesBlocking: number;
  openIssuesWarning: number;
}

export interface DashboardHealthResponse {
  snapshot: DashboardHealthSnapshot;
  trend: DashboardHealthSnapshot[];
  asOf: string;
  pendingApprovals: number;
  publishReadyTotal?: number;
  blockedTotal?: number;
  redactedSections?: string[];
}

export interface DashboardOperationsSummaryResponse {
  activeConnectors: number;
  installedConnectors: number;
  failedImportJobs: number;
  failedSubmissionJobs: number;
  deadLetterJobs: number;
  jobsNeedingRetry: number;
  asOf: string;
}

export interface KpiTrendPoint {
  date: string;
  value: number;
}

export interface KpiConnectorTrendPoint extends KpiTrendPoint {
  connectorSlug: string;
}

export interface KpiTrendsResponse {
  tenantId: string;
  rangeDays: number;
  generatedAt: string;
  readinessAccuracy: KpiTrendPoint[];
  throughput: KpiConnectorTrendPoint[];
  rejectionRate: KpiConnectorTrendPoint[];
  reliabilityDuplicatePreventionRate: KpiConnectorTrendPoint[];
  mappingCompletionRate: KpiConnectorTrendPoint[];
  firstPublishSuccessRate: KpiConnectorTrendPoint[];
  setupTimeToFirstPublishHours: KpiConnectorTrendPoint[];
  signupRequests: KpiTrendPoint[];
  signupVerifications: KpiTrendPoint[];
  signupVerificationRate: KpiTrendPoint[];
  signupMedianTimeToVerifyHours: KpiTrendPoint[];
  blockerResolutionRate: KpiTrendPoint[];
  medianBlockerResolutionHours: KpiTrendPoint[];
}

export interface PlanLimitExceededPayload {
  error: "PLAN_LIMIT_EXCEEDED";
  resource: string;
  limit: number;
  current: number;
  upgrade_url: string;
}

export interface MarketplaceChannelConfig {
  channel: MarketplaceChannel;
  displayName: string;
  requiredFields: string[];
}

export interface MarketplaceSimulationIssue {
  severity: RuleSeverity;
  code: string;
  fieldPath: string;
  sellerMessage: string;
  message?: string;
}

export interface MarketplaceSuggestion {
  fieldPath: string;
  fix: string;
}

export interface MarketplaceSimulation {
  productId: string;
  channel: MarketplaceChannel;
  displayName: string;
  exportReady: boolean;
  riskScore: number;
  riskBand: "low" | "medium" | "high";
  requiredFields: string[];
  missingFields: string[];
  channelIssues: MarketplaceSimulationIssue[];
  complianceSummary: {
    errorCount: number;
    warningCount: number;
  };
  validationSource?: "local_rules" | "amazon_sp_api";
  validationWarnings?: string[];
  mappingSource: "system_pack" | "saved_template";
  templateId: string | null;
  templateName: string | null;
  mappedPayload: Record<string, unknown>;
  suggestions: MarketplaceSuggestion[];
}

export interface MarketplaceChannelMapping {
  channel: MarketplaceChannel;
  displayName: string;
  requiredFields: string[];
  fieldMap: Record<string, string>;
  source: "system_pack" | "saved_template";
  templateId: string | null;
  templateName: string | null;
}

export interface ChannelMappingTemplate {
  id: string;
  name: string;
  categoryId: string;
  channel: MarketplaceChannel;
  requiredFields: string[];
  fieldMap: Record<string, string>;
  isDefault: boolean;
  isSystemPack?: boolean;
  createdBy?: string | null;
  version?: number;
  parentTemplateId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogSearchResult {
  id: string;
  title: string;
  status: CatalogStatus;
  updatedAt: string;
  categoryName: string | null;
  matchedSku: string | null;
}

export type NotificationEventType =
  | "import_completed"
  | "import_failed"
  | "publish_succeeded"
  | "publish_failed"
  | "approval_decision";

export interface NotificationItem {
  id: string;
  eventType: NotificationEventType;
  title: string;
  message: string;
  actionUrl: string | null;
  actionLabel: string | null;
  metadata: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListResponse {
  items: NotificationItem[];
  unreadCount: number;
  limit: number;
  nextCursor: string | null;
}

export type ConnectorMappingLevel =
  | "connector_default_template"
  | "tenant_connector_default"
  | "tenant_connector_category_mapping";
export type ConnectorMappingLifecycle =
  | "draft"
  | "validated"
  | "published"
  | "superseded"
  | "archived";
export type ConnectorMappingCompatibility = "compatible" | "deprecated" | "remap_required" | "blocked";

export interface ConnectorMappingVersion {
  id: string;
  tenantKey: string;
  connectorSlug: string;
  categoryScope: string;
  mappingLevel: ConnectorMappingLevel;
  lifecycleState: ConnectorMappingLifecycle;
  connectorDefinitionId: string;
  connectorDefinitionVersion: string;
  compatibilityState: ConnectorMappingCompatibility;
  mappingRules: Record<string, unknown>;
  fallbackPolicy: Record<string, unknown>;
  fallbackAckRequired: boolean;
  publishedAt: string | null;
  supersededBy: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface ConnectorMappingResolved {
  connectorSlug: string;
  categoryScope: string;
  matched: ConnectorMappingVersion[];
  resolvedMapping: Record<string, unknown>;
  fallbackPolicy: Record<string, unknown>;
  fallbackAckRequired: boolean;
  compatibilityState: ConnectorMappingCompatibility;
}

export interface ConnectorMappingPreflight {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  compatibilityState: ConnectorMappingCompatibility;
  fallbackApplied: boolean;
  fallbackAckRequired: boolean;
  matchedVersionIds: string[];
}

export interface ConnectorPublishReadiness {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  checks: Record<string, unknown>;
}

export interface ConnectorTaxonomyItem {
  id: string;
  label: string;
  path: string;
  parentId: string | null;
  leaf: boolean;
  requiredAttributes: string[];
}

export interface ConnectorPayloadPreviewResponse {
  installationId: string;
  connectorSlug: string;
  channel: MarketplaceChannel;
  templateId: string | null;
  templateName: string | null;
  mappingSource: "system_pack" | "saved_template";
  exportReady: boolean;
  validationSource: "local_rules" | "amazon_sp_api";
  missingFields: string[];
  channelIssues: MarketplaceSimulationIssue[];
  mappedPayload: Record<string, unknown>;
}

export type ExportJobStatus =
  | "queued"
  | "processing"
  | "retrying"
  | "skipped"
  | "completed"
  | "failed"
  | "dead_letter";

export interface MarketplaceExportJob {
  id: string;
  productId: string;
  categoryId: string;
  channel: MarketplaceChannel;
  templateId: string | null;
  status: ExportJobStatus;
  retryCount: number;
  maxRetries: number;
  failureReason: string | null;
  dlqReason: string | null;
  payload: Record<string, unknown> | null;
  exportPayload: Record<string, unknown> | null;
  template?:
    | ChannelMappingTemplate
    | {
        id: string;
        name: string;
        channelId: string;
      }
    | null;
  product?: {
    id: string;
    title: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorSubmissionIssue {
  code: string;
  fieldPath: string | null;
  severity: "error" | "warning";
  sellerMessage: string;
}

export interface ConnectorSubmission {
  id: string;
  productId: string;
  variantId: string | null;
  installationId: string;
  connectorSlug: string;
  connectorDisplayName: string;
  idempotencyKey: string;
  submissionType: string;
  source: "LIVE_API" | "LOCAL_RULES" | "NOT_VALIDATED" | string;
  attemptNumber: number;
  status: "PENDING" | "SUCCESS" | "REJECTED" | "SUPPRESSED" | "ERROR" | string;
  externalRef: string | null;
  payloadSnapshotUrl: string | null;
  payloadSnapshot?: Record<string, unknown> | null;
  channelErrors: ConnectorSubmissionIssue[];
  submittedAt: string;
  resolvedAt: string | null;
}

export type BulkImportJobStatus =
  | "queued"
  | "processing"
  | "retrying"
  | "completed"
  | "failed"
  | "dead_letter";

export type BulkImportRowStatus =
  | "queued"
  | "processing"
  | "success"
  | "retrying"
  | "failed"
  | "dead_letter";

export interface BulkImportRow {
  id: string;
  jobId: string;
  rowNumber: number;
  payload: Record<string, unknown>;
  status: BulkImportRowStatus;
  retryCount: number;
  errorMessage: string | null;
  productId: string | null;
  lastAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BulkImportJob {
  id: string;
  categoryId: string;
  sourceFormat: "csv" | "json";
  sourceName: string | null;
  mapping: Record<string, string>;
  chunkSize: number;
  maxRetries: number;
  status: BulkImportJobStatus;
  totalRows: number;
  processedRows: number;
  successRows: number;
  failedRows: number;
  deadLetterRows: number;
  metrics?: {
    checkpointRow: number;
    retryingRows: number;
    totalRetryAttempts: number;
    estimatedChunks: number;
    completedChunks: number;
  };
  category?: {
    id: string;
    path: string;
  };
  rows?: BulkImportRow[];
  createdAt: string;
  updatedAt: string;
}

export interface BulkImportMappingSuggestion {
  mapping: Record<string, string>;
  confidence: Record<string, number>;
  unmappedFields: string[];
  unusedHeaders: string[];
}

export interface BulkImportTemplate {
  id: string;
  tenantKey: string;
  categoryId: string;
  name: string;
  version: number;
  sourceFormat: "csv" | "json";
  mapping: Record<string, string>;
  schemaSnapshot?: {
    capturedAt: string;
    attributes: Array<{
      key: string;
      dataType: string;
      required: boolean;
      appliesTo: string;
    }>;
  } | null;
  compatibility?: {
    compatible: boolean;
    warnings: string[];
  };
  chunkSize: number;
  maxRetries: number;
  category?: {
    id: string;
    path: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface BulkEditScope {
  categoryId?: string;
  status?: CatalogStatus;
  brandContains?: string;
  productIds?: string[];
}

export interface BulkEditUpdates {
  title?: string;
  description?: string;
  brand?: string;
  status?: CatalogStatus;
  hsnCode?: string | null;
  gstRate?: number | null;
}

export interface BulkEditPreview {
  scope: BulkEditScope;
  updates: BulkEditUpdates;
  requestedCount: number;
  sampleCount: number;
  sample: Product[];
}

export interface BulkEditOperationItem {
  id: string;
  operationId: string;
  productId: string | null;
  status: "success" | "failed";
  before: Record<string, unknown>;
  after: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BulkEditOperation {
  id: string;
  status: "processing" | "completed" | "failed";
  scope: BulkEditScope;
  updates: BulkEditUpdates;
  requestedCount: number;
  appliedCount: number;
  failedCount: number;
  items?: BulkEditOperationItem[];
  createdAt: string;
  updatedAt: string;
}

export interface MediaAsset {
  id: string;
  productId: string | null;
  variantId: string | null;
  entityType: "product" | "variant";
  fileName: string;
  mimeType: string;
  storagePath: string;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  checksum: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MediaValidation {
  channel: MarketplaceChannel;
  valid: boolean;
  issues: string[];
  warnings: string[];
  checks: {
    minWidth: number;
    minHeight: number;
    aspectMin: number;
    aspectMax: number;
    fileSizeBytes: number;
  };
}

export interface BulkMediaAssociationResult {
  totalRows: number;
  successRows: number;
  failedRows: number;
  rows: Array<{
    rowNumber: number;
    skuCode: string;
    status: "success" | "failed";
    assetId?: string;
    deduplicated?: boolean;
    error?: string;
  }>;
}

export interface RejectionIntelligenceScore {
  productId: string;
  channel: MarketplaceChannel;
  riskScore: number;
  riskBand: "low" | "medium" | "high";
  summary: {
    missingCoreFields: string[];
    complianceErrors: number;
    complianceWarnings: number;
    mediaIssueCount: number;
  };
  mediaIssues: string[];
  suggestions: Array<{ field: string; suggestion: string }>;
  topPatterns: string[];
}

export interface OndcVersionInfo {
  version: string;
  status: "stable" | "preview";
}

export interface OndcMapping {
  id: string;
  name: string;
  categoryId: string;
  nodeType: "buyer_app" | "seller_app" | "gateway" | "logistics";
  version: string;
  requiredFields: string[];
  fieldMap: Record<string, string>;
  discoveryMetadata: Record<string, unknown>;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OndcSimulation {
  productId: string;
  categoryId: string;
  nodeType: string;
  version: string;
  mappingId: string;
  discoveryMetadata: Record<string, unknown>;
  publishReady: boolean;
  missingFields: string[];
  payload: Record<string, unknown>;
}

export interface AiTitleSuggestion {
  productId: string;
  originalTitle: string;
  optimizedTitle: string;
  confidence: number;
}

export interface AiAttributeEnrichment {
  productId: string;
  existingAttributes: Record<string, unknown>;
  suggestedAttributes: Record<string, unknown>;
  confidence: number;
}

export interface AiCategorySuggestion {
  productId: string;
  currentCategoryId: string;
  suggestedCategoryId: string;
  suggestedCategoryPath: string | null;
  confidence: number;
}

export interface AiRepairResult {
  productId: string;
  apply: boolean;
  patch: {
    title: string;
    categoryId: string;
    attributes: Record<string, unknown>;
  };
  note?: string;
  updated?: Product;
}

const API_BASE_URL = process.env.PIM_API_BASE_URL ?? "http://localhost:4000/api/v1";

export interface ApiRequestOptions {
  role?: AppRole;
  tenantKey?: string;
  authHeader?: string;
  headers?: Record<string, string>;
}

export class ApiHttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  static [Symbol.hasInstance](value: unknown): boolean {
    if (!value || typeof value !== "object") {
      return false;
    }
    const candidate = value as { name?: unknown; status?: unknown; body?: unknown };
    return (
      candidate.name === "ApiHttpError" &&
      typeof candidate.status === "number" &&
      "body" in candidate
    );
  }

  constructor(status: number, body: unknown, fallbackMessage: string) {
    const message =
      typeof body === "string"
        ? body
        : body && typeof body === "object"
          ? JSON.stringify(body)
          : fallbackMessage;
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
    this.body = body;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function getPlanLimitExceededPayload(error: unknown): PlanLimitExceededPayload | null {
  if (!(error instanceof ApiHttpError) || error.status !== 402) {
    return null;
  }
  if (!error.body || typeof error.body !== "object") {
    return null;
  }
  const payload = error.body as Record<string, unknown>;
  if (payload.error !== "PLAN_LIMIT_EXCEEDED") {
    return null;
  }
  const resource = String(payload.resource ?? "").trim();
  const upgradeUrl = String(payload.upgrade_url ?? "").trim();
  const limit = Number(payload.limit);
  const current = Number(payload.current);
  if (!resource || !upgradeUrl || !Number.isFinite(limit) || !Number.isFinite(current)) {
    return null;
  }
  return {
    error: "PLAN_LIMIT_EXCEEDED",
    resource,
    limit,
    current,
    upgrade_url: upgradeUrl,
  };
}

async function parseErrorBody(response: Response): Promise<unknown> {
  const contentType = String(response.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  try {
    return await response.text();
  } catch {
    return null;
  }
}

export async function fetchJson<T>(path: string, init?: RequestInit, options?: ApiRequestOptions): Promise<T> {
  const explicitAuthHeader = String(options?.authHeader ?? "").trim();
  const authHeader = explicitAuthHeader;
  const hasBody = init?.body !== undefined && init?.body !== null;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(authHeader ? { Authorization: authHeader } : {}),
      ...(options?.headers ?? {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const errorBody = await parseErrorBody(response);
    throw new ApiHttpError(response.status, errorBody, `Request failed with status ${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const contentType = String(response.headers.get("content-type") ?? "").toLowerCase();
  const rawBody = await response.text();
  if (!rawBody.trim()) {
    return undefined as T;
  }
  if (contentType.includes("application/json")) {
    return JSON.parse(rawBody) as T;
  }
  return rawBody as T;
}

export interface StepUpResponse {
  stepUpToken: string;
  expiresAt: string;
  scope: string;
}

export async function postJson<T>(path: string, body: unknown, options?: ApiRequestOptions) {
  return fetchJson<T>(path, {
    method: "POST",
    body: JSON.stringify(body),
  }, options);
}

export async function patchJson<T>(path: string, body: unknown, options?: ApiRequestOptions) {
  return fetchJson<T>(path, {
    method: "PATCH",
    body: JSON.stringify(body),
  }, options);
}

export async function deleteJson(path: string, options?: ApiRequestOptions) {
  return fetchJson<void>(path, { method: "DELETE" }, options);
}
