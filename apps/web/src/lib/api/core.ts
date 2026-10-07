import type { MarketplaceChannel } from "../marketplace-channels";
import { getApiBaseUrl } from "../api-base-url";

export type CatalogStatus = "draft" | "in_review" | "approved" | "rejected" | "active" | "archived";
export type RuleSeverity = "error" | "warning";
export type { MarketplaceChannel };
export type AppRole =
  | "admin"
  | "editor"
  | "publisher"
  | "approver"
  | "channel_manager"
  | "connector_admin"
  | "reviewer"
  | "viewer";
export type ApiClientScope =
  | "catalog.read"
  | "catalog.write"
  | "bulk_import.read"
  | "media.read"
  | "compliance.read"
  | "issues.read"
  | "rejection_intelligence.read"
  | "auto_suggestions.read"
  | "taxonomy.read";

const APP_ROLES: readonly AppRole[] = ["admin", "editor", "publisher", "approver", "channel_manager", "connector_admin", "reviewer", "viewer"];

export function normalizeAppRole(value: FormDataEntryValue | string | null | undefined): AppRole | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (APP_ROLES.includes(normalized as AppRole)) {
    return normalized as AppRole;
  }
  return null;
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
export type IssueInboxFieldFamily = "PRICING" | "GST_TAX" | "ATTRIBUTES" | "CORE" | "MEDIA";

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

/** One structured tax-code row returned by GET /catalog/products/:id */
export interface ProductTaxCode {
  id: string;
  /** Market code matching TaxRegime.marketCode — "IN" | "GB" | "US" | "AE" | "AU" */
  marketCode: string;
  /** Canonical key: "HSN_CODE" | "COMMODITY_CODE" | "HS_CODE" | "TAX_CATEGORY" */
  key: string;
  value: string;
  rate: number | null;
  regime?: { marketCode: string; name: string };
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
  /** Structured multi-regime tax codes. Populated by GET /catalog/products/:id only. */
  taxCodes?: ProductTaxCode[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductRevisionFieldChange {
  path: string;
  label: string;
  before: unknown;
  after: unknown;
}

export interface ProductRevision {
  productId: string;
  revisionId: string;
  action: string;
  actorId: string;
  actorLabel: string;
  actorRole: string;
  createdAt: string;
  changedFields: ProductRevisionFieldChange[];
  summary: {
    changedFieldCount: number;
    changedSectionCount: number;
  };
  decisionNote?: string | null;
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
  skuCodes?: string[];
  openValidationErrorCount: number;
  openValidationWarningCount: number;
  createdAt: string;
  updatedAt: string;
  /** Set when product transitions to in_review — null until first review cycle */
  slaDeadlineAt?: string | null;
  /** Assigned reviewer user ID — null if unassigned */
  assigneeId?: string | null;
}

export interface CatalogStats {
  categories: number;
  products: number;
  variants: number;
  pendingApprovals: number;
  redactedSections?: string[];
}

export type ConnectorValidationOutcome = "VALID" | "INVALID" | "INDETERMINATE" | "CONFIGURATION_ERROR";

export interface ConnectorValidationState {
  /** Last time authenticated validation succeeded (VALID only). */
  lastValidatedAt: string | null;
  /** Last time validation was attempted, any outcome. */
  lastAttemptAt: string | null;
  outcome: ConnectorValidationOutcome | null;
  /** Short safe code such as HTTP_503 or TOKEN_ONLY. */
  reason: string | null;
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
  launchStage: "live" | "manual" | "planned" | "under_development" | "code_complete" | "qa_validation" | "po_review" | "early_access" | "controlled_pilot" | "p1_blocker_hold" | "deprecated" | "internal_diagnostic";
  launchNote: string | null;
  metadata: Record<string, unknown>;
  installedAt: string;
  installedBy: string;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** True for every connector except flipkart/amazon-in, where it reflects whether
   *  at least one stored credential has actually passed validateCredentials(). */
  credentialsValidated: boolean;
  /** What the credential heartbeat last learned. Optional so a web build tolerates an older API. */
  validation?: ConnectorValidationState;
  actions?: ConnectorActionMatrix;
}

export interface ConnectorHealthAggregate {
  slug: string;
  displayName: string;
  ready: number;
  blocked: number;
  pending: number;
  installationCount: number;
  activeInstallationCount: number;
  notConnected?: boolean;
}

export interface ConnectorInstallationHealthRow {
  installationId: string;
  connectorId: string;
  slug: string;
  displayName: string;
  accountAlias: string;
  externalAccountRef: string | null;
  status: string;
  ready: number;
  blocked: number;
  pending: number;
  lastSubmittedAt: string | null;
}

export interface ConnectorInstallationsHealthResponse {
  connectors: ConnectorHealthAggregate[];
  installations: ConnectorInstallationHealthRow[];
  asOf: string;
}

export interface ConnectorSummaryResponse {
  connectors: ConnectorHealthAggregate[];
  totals: {
    ready: number;
    blocked: number;
    pending: number;
    installations: number;
    activeInstallations: number;
  };
  asOf: string;
}

export interface ConnectorDefinition {
  id: string;
  slug: string;
  displayName: string;
  authType: string;
  capabilities: string[];
  implementationStatus?: "full" | "partial" | "stub";
  launchStage: "live" | "manual" | "planned" | "under_development" | "code_complete" | "qa_validation" | "po_review" | "early_access" | "controlled_pilot" | "p1_blocker_hold" | "deprecated" | "internal_diagnostic";
  launchNote: string | null;
  marketplaceId: string | null;
  connectorVersion: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  actions?: ConnectorActionMatrix;
  /**
   * Internal launch-pipeline detail — only present when the caller holds an
   * admin-boundary role (see adminBoundaryRoles / AdminBoundaryRole; those
   * boundary roles are a separate governance concept from this file's
   * AppRole surface, so deliberately not named literally here — see
   * role-aware-frontend-alignment-ui.test.cjs). See the matching field on
   * the API's ConnectorDefinitionRecord (connector.types.ts) for why this is
   * gated rather than always sent.
   */
  pipelineMetadata?: {
    owner: string;
    milestone: string | null;
    blockers: string[];
    internalNotes: string | null;
  };
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
  mfaEnrolled: boolean;
  lastSignInAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TenantAuthPolicy {
  id: string | null;
  tenantKey: string;
  externalIdentityMode: boolean;
  mfaRequired: boolean;
  mfaRequiredSince: string | null;
  mfaGracePeriodDays: number;
  sessionTimeoutMinutes: number;
  allowedAuthMethods: Array<"password" | "oidc">;
  isPersisted: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  runtimeApplied: {
    sessionTimeout: boolean;
    mfaEnrollment: boolean;
    externalIdentity: boolean;
  };
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
  scopes: ApiClientScope[];
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
  eventType:
    | "import_completed"
    | "import_failed"
    | "import_repair_required"
    | "publish_succeeded"
    | "publish_failed"
    | "approval_decision"
    | "connector_down"
    | "connector_credentials_expired"
    | "scheduled_export_failed"
    | "readiness_blocker_detected"
    | "mapping_validation_failed"
    | "queue_dlq_threshold_exceeded";
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
  eventType:
    | "import_completed"
    | "import_failed"
    | "import_repair_required"
    | "publish_succeeded"
    | "publish_failed"
    | "approval_decision"
    | "connector_down"
    | "connector_credentials_expired"
    | "scheduled_export_failed"
    | "readiness_blocker_detected"
    | "mapping_validation_failed"
    | "queue_dlq_threshold_exceeded";
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

export interface ApprovalComment {
  id: string;
  tenantKey: string;
  productId: string;
  actorId: string;
  actorRole: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductActivityEvent {
  id: string;
  actorId: string;
  actorRole: string;
  action: string;
  resource: string;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ProductActivityResponse {
  productId: string;
  total: number;
  events: ProductActivityEvent[];
}

export type ProductListQuery = {
  slim?: boolean;
  cursor?: string;
  limit?: number;
  status?: string;
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
  planTier: "TRIAL" | "STARTER" | "GROWTH" | "BUSINESS" | "ENTERPRISE" | string;
  billingStatus: "trial" | "active_paid" | "past_due" | "cancelled" | "expired" | string;
  accessStatus: "active" | "suspended" | string;
  month: string;
  billingCycleResetAt: string;
  skus: { current: number; limit: number };
  submissions: { current: number; limit: number };
  storageGb: { current: number; limit: number };
  users: { current: number; limit: number };
  connectorsInstallations: { current: number; limit: number };
  connectorAccounts: { current: number; limit: number };
  apiKeys: { current: number; limit: number };
  outboundWebhooks: { current: number; limit: number };
  importRowsPerJob: { limit: number };
  profile: {
    tenantKey: string;
    planTier: "TRIAL" | "STARTER" | "GROWTH" | "BUSINESS" | "ENTERPRISE" | string;
    billingStatus: "trial" | "active_paid" | "past_due" | "cancelled" | "expired" | string;
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

export interface PlanTierResponse {
  planTier: "TRIAL" | "STARTER" | "GROWTH" | "BUSINESS" | "ENTERPRISE" | string;
  billingStatus: "trial" | "active_paid" | "past_due" | "cancelled" | "expired" | string;
  accessStatus: "active" | "suspended" | string;
}

export interface PlanMetadata {
  tier: "TRIAL" | "STARTER" | "GROWTH" | "BUSINESS" | "ENTERPRISE" | string;
  label: string;
  tagline: string;
  limits: {
    skus: number;
    submissions: number;
    users: number;
    roles: string;
    storageGb: number;
    connectorInstallations: number;
    accountsPerConnector: number;
    apiKeys: number;
    outboundWebhooks: number;
    importRowsPerJob: number;
  };
  unlimited: Record<string, boolean>;
  features: string[];
}

export interface PlanMetadataListResponse {
  items: PlanMetadata[];
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
  currentPlanTier: "STARTER" | "GROWTH" | "BUSINESS" | "ENTERPRISE" | string;
  requestedPlanTier: "STARTER" | "GROWTH" | "BUSINESS" | "ENTERPRISE" | string | null;
  currentBillingStatus: "trial" | "active_paid" | "past_due" | "cancelled" | string;
  currentAccessStatus: "active" | "suspended" | string;
  notes: string | null;
  source: string;
  usageSnapshot: Record<string, unknown> | null;
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

export interface SubmissionCountResponse {
  count: number;
}

export interface PlanLimitExceededPayload {
  error: "PLAN_LIMIT_EXCEEDED";
  resource: string;
  limit: number;
  current: number;
  upgrade_url: string;
  contact_url: string | null;
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
  mappingSource: "system_pack" | "saved_template" | "connector_mapping_version";
  templateId: string | null;
  templateName: string | null;
  mappedPayload: Record<string, unknown>;
  suggestions: MarketplaceSuggestion[];
}

export interface MarketplaceChannelMapping {
  channel: MarketplaceChannel;
  displayName: string;
  requiredFields: string[];
  fieldMap: Record<string, string | string[]>;
  source: "system_pack" | "saved_template" | "connector_mapping_version";
  templateId: string | null;
  templateName: string | null;
}

export interface ChannelMappingTemplate {
  id: string;
  name: string;
  categoryId: string;
  channel: MarketplaceChannel;
  requiredFields: string[];
  fieldMap: Record<string, string | string[]>;
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
  | "approval_decision"
  | "import_repair_required"
  | "connector_down"
  | "connector_credentials_expired"
  | "scheduled_export_failed"
  | "readiness_blocker_detected"
  | "mapping_validation_failed"
  | "queue_dlq_threshold_exceeded";

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

export interface ConnectorMappingHistoryEntry {
  actorId: string | null;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ConnectorMappingHistory {
  created?: ConnectorMappingHistoryEntry;
  validated?: ConnectorMappingHistoryEntry;
  published?: ConnectorMappingHistoryEntry;
  archived?: ConnectorMappingHistoryEntry;
  rollback?: ConnectorMappingHistoryEntry;
}

export interface ConnectorMappingVersion {
  id: string;
  tenantKey: string;
  connectorSlug: string;
  installationId?: string | null;
  draftInstallationId?: string | null;
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
  history?: ConnectorMappingHistory;
}

export interface ConnectorMappingResolved {
  resolvedMapping: Record<string, unknown>;
  matchedVersions: ConnectorMappingVersion[];
  compatibilityState: ConnectorMappingCompatibility;
  fallbackApplied: boolean;
  fallbackAckRequired: boolean;
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

export interface ShopifyMetafieldDefinition {
  id: string;
  name: string;
  namespace: string;
  key: string;
  type: string;
  description: string | null;
  required: boolean;
  ownerType: string;
}

export interface ShopifyCollectionItem {
  id: string;
  title: string;
  handle: string;
}

export interface ShopifyTaxonomyItem {
  id: string;
  name: string;
  level: number;
  isLeaf: boolean;
  parentId: string | null;
}

export interface ShopifyStoreConfig {
  metafields: ShopifyMetafieldDefinition[];
  collections: ShopifyCollectionItem[];
  taxonomy: ShopifyTaxonomyItem[];
  fetchedAt: string;
}

export interface ConnectorSyncState {
  productId: string;
  lastSyncedAt: string | null;
  lastSyncedVersion: number | null;
  lastSyncedStatus: string | null;
}

export interface ConnectorSyncSchedule {
  id: string;
  cronExpression: string;
  scope: string;
  status: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastRunOutcome: string | null;
}

export interface ConnectorCatalogScanResult {
  matched: Array<{ productId: string; productTitle: string; shopifyGid: string; shopifySku: string; matchedBy: string; confidence: string }>;
  unmatched: Array<{ productId: string; productTitle: string; sku: string }>;
  ambiguous: Array<{ productId: string; productTitle: string; matches: Array<{ shopifyGid: string; matchedBy: string }> }>;
}

export interface ConnectorProductLink {
  productId: string;
  shopifyGid: string;
  matchedBy: string;
  confirmedAt: string | null;
}

export interface ReadinessDimension {
  score: number;
  weight: number;
}

export interface ConnectorPublishReadiness {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  checks: Record<string, unknown> & {
    mappingCompleteness?: {
      missingRequiredMappings: string[];
    };
    productDataReadiness?: {
      missingRequiredProductValues: string[];
    };
  };
  overallScore?: number;
  breakdown?: {
    content:    ReadinessDimension;
    seo:        ReadinessDimension;
    media:      ReadinessDimension;
    variants:   ReadinessDimension;
    metafields: ReadinessDimension;
    compliance: ReadinessDimension;
  };
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
  runId?: string | null;
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

export interface BulkImportValidationIssue {
  rowNumber: number;
  severity: "blocking" | "warning";
  code: string;
  message: string;
  fieldPath?: string | null;
  remediation?: string | null;
}

export interface BulkImportValidationSummary {
  sourceFormat: "csv" | "json";
  sourceName: string | null;
  categoryId: string;
  categoryPath: string;
  totalRows: number;
  blockingIssueCount: number;
  warningCount: number;
  acceptedRows: number;
  failedRows: number;
  deadLetterRows: number;
  canImport: boolean;
  mapping: Record<string, string>;
  unmappedFields: string[];
  unusedHeaders: string[];
  issues: BulkImportValidationIssue[];
  sampleIssues: BulkImportValidationIssue[];
  failureCode?: string;
  failureClass?: "source_data" | "mapping" | "policy" | "storage" | "platform" | "unknown";
  failureMessage?: string;
  correlationId?: string;
  repairSummary: {
    acceptedRows: number;
    failedRows: number;
    deadLetterRows: number;
  };
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

export type BulkImportRunStatus =
  | "uploaded"
  | "validating"
  | "preflight_blocked"
  | "preflight_ready"
  | "processing"
  | "completed"
  | "repair_required"
  | "failed";

export interface BulkImportRun {
  id: string;
  tenantKey: string;
  categoryId: string;
  status: BulkImportRunStatus;
  sourceFileKey: string | null;
  sourceName: string | null;
  sourceFormat: string;
  sourceFileSizeBytes: number | null;
  sourceExpiresAt: string | null;
  totalRows: number | null;
  acceptedRows: number | null;
  failedRows: number | null;
  deadLetterRows: number | null;
  blockingIssueCount: number | null;
  warningCount: number | null;
  estimatedBatchCount: number | null;
  effectiveMode: "standard" | "large" | null;
  primaryJobId?: string | null;
  jobCount?: number;
  progress?: {
    processedRows: number;
    pendingRows: number;
    percent: number;
    needsAttentionRows: number;
  };
  preflightSummary: {
    chunkSize?: number;
    mapping?: Record<string, string>;
    unmappedFields?: string[];
    unusedHeaders?: string[];
    issues?: BulkImportValidationIssue[];
    sampleIssues?: BulkImportValidationIssue[];
    canImport?: boolean;
    skuCodeSummary?: { duplicateCount: number; collisionCount: number } | null;
    mvpCeilingExceeded?: boolean;
    failureCode?: string;
    failureClass?: "source_data" | "mapping" | "policy" | "storage" | "platform" | "unknown";
    failureMessage?: string;
    correlationId?: string;
  } | null;
  maxRetries: number;
  category?: { id: string; path: string };
  createdAt: string;
  updatedAt: string;
}

export interface BulkImportRunRow {
  id: string;
  jobId: string;
  runId: string | null;
  rowNumber: number;
  rowNumberGlobal: number | null;
  payload: Record<string, unknown>;
  status: BulkImportRowStatus;
  retryCount: number;
  errorMessage: string | null;
  productId: string | null;
  lastAttemptAt: string | null;
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
  // CTO review follow-up (PR #719, 2026-09-05): present when errorMessage is a
  // machine-classifiable failure (e.g. "PLAN_LIMIT_EXCEEDED") rather than a fallback
  // string — see getBulkEditItemPlanLimitPayload for the plan-limit case specifically.
  errorCode: string | null;
  errorDetails: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface BulkEditOperation {
  id: string;
  status: "queued" | "processing" | "completed" | "completed_with_errors" | "failed";
  scope: BulkEditScope;
  updates: BulkEditUpdates;
  requestedCount: number;
  appliedCount: number;
  failedCount: number;
  items?: BulkEditOperationItem[];
  itemsNextCursor?: string | null;
  createdAt: string;
  updatedAt: string;
}

// Bulk-Publish Goes Async, Story 7: mirrors MarketplaceBulkPublishRun/RunItem
// (packages/db/prisma/schema.prisma) — the run/item pair createBulkPublishRun and
// processBulkPublishRun operate on (apps/api/src/marketplace/marketplace.service.ts).
export interface MarketplaceBulkPublishRunItem {
  id: string;
  productId: string;
  status: "pending" | "queued" | "succeeded" | "failed" | "excluded";
  exportJobId: string | null;
  attemptCount: number;
  retryEligible: boolean;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceBulkPublishRun {
  id: string;
  installationId: string;
  connectorSlug: string;
  channel: MarketplaceChannel;
  requestedCount: number;
  succeededCount: number;
  failedCount: number;
  excludedCount: number;
  status: "queued" | "processing" | "completed" | "completed_with_errors" | "failed";
  createdBy: string | null;
  items?: MarketplaceBulkPublishRunItem[];
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
  altText: string | null;
  isMain: boolean;
  sortOrder: number;
  assetHealthStatus: "unknown" | "healthy" | "warning" | "attention" | string;
  lastCheckedAt: string | null;
  channelEligibility: string[];
  usageCount: number;
  /** Signed token for the public file route (null until the API signing key is configured). */
  fileToken?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MediaValidation {
  channel: MarketplaceChannel;
  valid: boolean;
  issues: string[];
  warnings: string[];
  assetHealthStatus: string;
  lastCheckedAt: string | null;
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

const API_BASE_URL = getApiBaseUrl();

export interface ApiRequestOptions {
  role?: AppRole;
  authHeader?: string;
  headers?: Record<string, string>;
  /**
   * Enable Next.js ISR-style Data Cache for this fetch. The response is stored
   * in the server-side Data Cache and revalidated after this many seconds.
   * Only effective when called from a Server Component or Server Action.
   * Ignored in browser-side code.
   *
   * Set to 0 to force immediate revalidation (equivalent to no-store).
   * Leave unset (default) to use `cachePolicy` or the "no-store" default.
   */
  revalidateSeconds?: number;
  /**
   * Override the default "no-store" fetch cache policy.
   * Ignored when `revalidateSeconds` is set.
   */
  cachePolicy?: RequestCache;
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
  const rawContactUrl = String(payload.contact_url ?? "").trim();
  return {
    error: "PLAN_LIMIT_EXCEEDED",
    resource,
    limit,
    current,
    upgrade_url: upgradeUrl,
    contact_url: rawContactUrl || null,
  };
}

/**
 * CTO review follow-up (PR #719, 2026-09-05): the bulk-edit equivalent of
 * getPlanLimitExceededPayload above — same validated shape, sourced from a persisted
 * BulkEditOperationItem's errorCode/errorDetails (a background job's per-item failure)
 * instead of a live ApiHttpError, since bulk edit failures are never a direct HTTP
 * response the caller can catch. Lets the bulk-edit results page show the same upgrade
 * CTA every other plan-limit flow shows for the identical condition.
 */
export function getBulkEditItemPlanLimitPayload(item: BulkEditOperationItem): PlanLimitExceededPayload | null {
  if (item.errorCode !== "PLAN_LIMIT_EXCEEDED" || !item.errorDetails) {
    return null;
  }
  const payload = item.errorDetails;
  const resource = String(payload.resource ?? "").trim();
  const upgradeUrl = String(payload.upgrade_url ?? "").trim();
  const limit = Number(payload.limit);
  const current = Number(payload.current);
  if (!resource || !upgradeUrl || !Number.isFinite(limit) || !Number.isFinite(current)) {
    return null;
  }
  const rawContactUrl = String(payload.contact_url ?? "").trim();
  return {
    error: "PLAN_LIMIT_EXCEEDED",
    resource,
    limit,
    current,
    upgrade_url: upgradeUrl,
    contact_url: rawContactUrl || null,
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

const FETCH_TIMEOUT_MS = 20_000;

export async function fetchJson<T>(path: string, init?: RequestInit, options?: ApiRequestOptions): Promise<T> {
  const explicitAuthHeader = String(options?.authHeader ?? "").trim();
  const authHeader = explicitAuthHeader;
  const hasBody = init?.body !== undefined && init?.body !== null;
  const signal = init?.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS);

  // Resolve cache policy. Priority order:
  //   1. revalidateSeconds → Next.js ISR Data Cache; forces "force-cache" so "no-store" doesn't win.
  //   2. cachePolicy option → explicit override.
  //   3. init.cache → caller-supplied cache directive (e.g. from getServerSideProps wrappers).
  //   4. "no-store" → safe default; mutations and user-data reads must never be cached.
  const hasRevalidate = options?.revalidateSeconds !== undefined && options.revalidateSeconds > 0;
  const resolvedCache: RequestCache = hasRevalidate
    ? "force-cache"
    : (options?.cachePolicy ?? init?.cache ?? "no-store");
  const nextConfig = hasRevalidate
    ? ({ next: { revalidate: options!.revalidateSeconds } } as RequestInit)
    : {};

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    ...nextConfig,
    signal,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(authHeader ? { Authorization: authHeader } : {}),
      ...(options?.headers ?? {}),
      ...(init?.headers ?? {}),
    },
    cache: resolvedCache,
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

export async function getJson<T>(path: string, options?: ApiRequestOptions) {
  return fetchJson<T>(path, { method: "GET" }, options);
}

export async function postJson<T>(path: string, body: unknown, options?: ApiRequestOptions) {
  return fetchJson<T>(path, {
    method: "POST",
    body: JSON.stringify(body),
  }, options);
}

export async function postFormData<T>(path: string, formData: FormData, options?: ApiRequestOptions) {
  const explicitAuthHeader = String(options?.authHeader ?? "").trim();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      ...(explicitAuthHeader ? { Authorization: explicitAuthHeader } : {}),
      ...(options?.headers ?? {}),
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
  const rawBody = await response.text();
  if (!rawBody.trim()) {
    return undefined as T;
  }
  return JSON.parse(rawBody) as T;
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

export interface ShopifyProductChangeItem {
  field: string;
  currentValue: string | null;
  newValue: string | null;
  changeType: "add" | "update" | "remove";
  riskLevel: "low" | "medium" | "high";
}

export interface ShopifyProductPreview {
  hasExistingProduct: boolean;
  noChanges: boolean;
  changes: ShopifyProductChangeItem[];
  resolvedInstallationId: string;
}

export interface ConnectorRecoveryGroup {
  errorFamily: string;
  affectedCount: number;
  exampleMessage: string;
  productIds: string[];
}

export interface ConnectorRecoveryRetryResult {
  queued: number;
}
