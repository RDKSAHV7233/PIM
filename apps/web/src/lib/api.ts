export type CatalogStatus = "draft" | "in_review" | "approved" | "rejected" | "active" | "archived";
export type RuleSeverity = "error" | "warning";
export type MarketplaceChannel = "amazon" | "flipkart" | "meesho";
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

interface PaginatedResponse<T> {
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

type ProductListQuery = {
  slim?: boolean;
  cursor?: string;
  limit?: number;
};

type CategoryListQuery = {
  all?: boolean;
  cursor?: string;
  limit?: number;
};

type AuditEventsQuery = {
  actorId?: string;
  action?: string;
  entityType?: AuditEntityType;
  dateFrom?: string;
  dateTo?: string;
  cursor?: string;
  limit?: number;
};

type ExportJobListQuery = {
  templateSummary?: boolean;
  cursor?: string;
  limit?: number;
};

export interface PlanUsageResponse {
  planTier: "STARTER" | "GROWTH" | "ENTERPRISE" | string;
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
    effectiveFrom: string | null;
    updatedBy: string | null;
    createdAt: string;
    updatedAt: string;
  };
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
  sourceFormat: "csv" | "json" | "xlsx" | "xls";
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
  sourceFormat: "csv" | "json" | "xlsx" | "xls";
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

async function fetchJson<T>(path: string, init?: RequestInit, options?: ApiRequestOptions): Promise<T> {
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

export async function getCategories(options?: ApiRequestOptions) {
  return fetchJson<Category[]>("/taxonomy/categories", undefined, options);
}

export async function getProducts(options?: ApiRequestOptions) {
  return fetchJson<Product[]>("/catalog/products", undefined, options);
}

function isApiRequestOptions(value: unknown): value is ApiRequestOptions {
  if (!value || typeof value !== "object") {
    return false;
  }
  return "role" in value || "tenantKey" in value || "authHeader" in value || "headers" in value;
}

export async function getCategoryTree(
  inputOrOptions?: CategoryListQuery | ApiRequestOptions,
  maybeOptions?: ApiRequestOptions,
) {
  const queryInput = isApiRequestOptions(inputOrOptions) || !inputOrOptions ? {} : inputOrOptions;
  const options = isApiRequestOptions(inputOrOptions) ? inputOrOptions : maybeOptions;
  const params = new URLSearchParams();
  if (queryInput.all) {
    params.set("all", "true");
  }
  if (queryInput.cursor) {
    params.set("cursor", queryInput.cursor);
    params.set("pagination", "cursor");
  }
  if (typeof queryInput.limit === "number" && Number.isFinite(queryInput.limit)) {
    params.set("limit", String(Math.max(1, Math.floor(queryInput.limit))));
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  const response = await fetchJson<PaginatedResponse<Category> | Category[]>(
    `/taxonomy/categories${query}`,
    undefined,
    options,
  );
  return Array.isArray(response) ? response : response.items;
}

export async function getProductList(
  inputOrOptions?: ProductListQuery | ApiRequestOptions,
  maybeOptions?: ApiRequestOptions,
) {
  const queryInput = isApiRequestOptions(inputOrOptions) || !inputOrOptions ? {} : inputOrOptions;
  const options = isApiRequestOptions(inputOrOptions) ? inputOrOptions : maybeOptions;
  const params = new URLSearchParams();
  if (queryInput.slim) {
    params.set("slim", "true");
  }
  if (queryInput.cursor) {
    params.set("cursor", queryInput.cursor);
    params.set("pagination", "cursor");
  }
  if (typeof queryInput.limit === "number" && Number.isFinite(queryInput.limit)) {
    params.set("limit", String(Math.max(1, Math.floor(queryInput.limit))));
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  const response = await fetchJson<PaginatedResponse<ProductListItem> | ProductListItem[]>(
    `/catalog/products${query}`,
    undefined,
    options,
  );
  return Array.isArray(response) ? response : response.items;
}

export async function getProduct(productId: string, options?: ApiRequestOptions) {
  return fetchJson<Product>(`/catalog/products/${productId}`, undefined, options);
}

export async function searchCatalogProducts(
  input: { q: string; limit?: number },
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  if (input.q.trim()) {
    params.set("q", input.q.trim());
  }
  if (typeof input.limit === "number" && Number.isFinite(input.limit)) {
    params.set("limit", String(Math.max(1, Math.floor(input.limit))));
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return fetchJson<CatalogSearchResult[]>(`/catalog/products/search${query}`, undefined, options);
}

export async function getAuditEvents(input?: AuditEventsQuery, options?: ApiRequestOptions) {
  const params = new URLSearchParams();
  if (input?.actorId?.trim()) {
    params.set("actorId", input.actorId.trim());
  }
  if (input?.action?.trim()) {
    params.set("action", input.action.trim());
  }
  if (input?.entityType) {
    params.set("entityType", input.entityType);
  }
  if (input?.dateFrom?.trim()) {
    params.set("dateFrom", input.dateFrom.trim());
  }
  if (input?.dateTo?.trim()) {
    params.set("dateTo", input.dateTo.trim());
  }
  if (input?.cursor?.trim()) {
    params.set("cursor", input.cursor.trim());
  }
  if (typeof input?.limit === "number" && Number.isFinite(input.limit)) {
    params.set("limit", String(Math.max(1, Math.floor(input.limit))));
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return fetchJson<AuditEventListResponse>(`/audit/events${query}`, undefined, options);
}

export async function getNotifications(
  input?: { limit?: number; cursor?: string | null },
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  if (typeof input?.limit === "number" && Number.isFinite(input.limit)) {
    params.set("limit", String(Math.max(1, Math.floor(input.limit))));
  }
  if (input?.cursor) {
    params.set("cursor", input.cursor);
    params.set("pagination", "cursor");
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return fetchJson<NotificationListResponse>(`/notifications${query}`, undefined, options);
}

export async function markNotificationRead(notificationId: string, options?: ApiRequestOptions) {
  return patchJson<{ id: string; read: true }>(`/notifications/${encodeURIComponent(notificationId)}/read`, {}, options);
}

export async function markAllNotificationsRead(options?: ApiRequestOptions) {
  return patchJson<{ updated: number }>("/notifications/read-all", {}, options);
}

export async function getProductVariants(productId: string, options?: ApiRequestOptions) {
  return fetchJson<Variant[]>(`/catalog/products/${productId}/variants`, undefined, options);
}

export async function getStats(options?: ApiRequestOptions) {
  return fetchJson<CatalogStats>("/catalog/stats", undefined, options);
}

export async function getBillingUsage(options?: ApiRequestOptions) {
  return fetchJson<PlanUsageResponse>("/billing/usage", undefined, options);
}

export async function getBillingPlanProfile(options?: ApiRequestOptions) {
  return fetchJson<PlanUsageResponse["profile"]>("/billing/plan-profile", undefined, options);
}

export async function setBillingPlanTier(
  planTier: "STARTER" | "GROWTH" | "ENTERPRISE",
  options?: ApiRequestOptions,
) {
  return postJson<PlanUsageResponse["profile"]>("/billing/plan-tier", { planTier }, options);
}

export async function getDashboardHealth(options?: ApiRequestOptions) {
  return fetchJson<DashboardHealthResponse>("/dashboard/health", undefined, options);
}

export async function getDashboardOperationsSummary(options?: ApiRequestOptions) {
  return fetchJson<DashboardOperationsSummaryResponse>(
    "/dashboard/operations-summary",
    undefined,
    options,
  );
}

export async function getCategoryAttributes(categoryId: string, options?: ApiRequestOptions) {
  return fetchJson<AttributeDefinition[]>(
    `/taxonomy/categories/${categoryId}/attributes`,
    undefined,
    options,
  );
}

export async function getProductIssues(productId: string, options?: ApiRequestOptions) {
  return fetchJson<ValidationIssue[]>(`/compliance/products/${productId}/issues`, undefined, options);
}

export async function getIssueInbox(
  filters?: {
    severity?: IssueInboxSeverity;
    installationId?: string;
    categoryId?: string;
    productStatus?: CatalogStatus;
    limit?: number;
    cursor?: string;
  },
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  params.set("pagination", "cursor");
  if (filters?.severity) {
    params.set("severity", filters.severity);
  }
  if (filters?.installationId) {
    params.set("installationId", filters.installationId);
  }
  if (filters?.categoryId) {
    params.set("categoryId", filters.categoryId);
  }
  if (filters?.productStatus) {
    params.set("productStatus", filters.productStatus);
  }
  if (typeof filters?.limit === "number" && Number.isFinite(filters.limit)) {
    params.set("limit", String(Math.max(1, Math.floor(filters.limit))));
  }
  if (filters?.cursor) {
    params.set("cursor", filters.cursor);
  }
  return fetchJson<IssueInboxResponse>(`/issues/inbox?${params.toString()}`, undefined, options);
}

export async function resolveIssueInboxWarnings(issueIds: string[], options?: ApiRequestOptions) {
  return postJson<IssueInboxResolveResult>("/issues/inbox/resolve", { issueIds }, options);
}

export async function decideProductReview(
  productId: string,
  body: { status: "approved" | "rejected"; note?: string },
  options?: ApiRequestOptions,
) {
  return postJson<Product>(
    `/catalog/products/${encodeURIComponent(productId)}/review-decision`,
    body,
    options,
  );
}

export async function getMarketplaceChannels(options?: ApiRequestOptions) {
  return fetchJson<MarketplaceChannelConfig[]>("/marketplace/channels", undefined, options);
}

export async function getInstalledConnectors(options?: ApiRequestOptions) {
  const response = await fetchJson<PaginatedResponse<ConnectorInstallation> | ConnectorInstallation[]>(
    "/connectors/installed?limit=200",
    undefined,
    options,
  );
  if (Array.isArray(response)) {
    return response;
  }
  return response.items ?? [];
}

export async function getConnectorDefinitions(options?: ApiRequestOptions) {
  return fetchJson<ConnectorDefinition[]>("/connectors/definitions", undefined, options);
}

export async function getConnectorPermissions(
  connectorSlug?: string,
  options?: ApiRequestOptions,
) {
  const query = connectorSlug
    ? `?connectorSlug=${encodeURIComponent(connectorSlug)}`
    : "";
  return fetchJson<ConnectorPermission[]>(`/connectors/permissions${query}`, undefined, options);
}

export async function grantConnectorPermission(
  body: {
    principalType: "user" | "role";
    principalId: string;
    connectorSlug: string;
    accountAlias?: string;
    action: "install" | "reconnect" | "uninstall";
  },
  options?: ApiRequestOptions,
) {
  return postJson<ConnectorPermission>("/connectors/permissions", body, options);
}

export async function revokeConnectorPermission(permissionId: string, options?: ApiRequestOptions) {
  return deleteJson(`/connectors/permissions/${encodeURIComponent(permissionId)}`, options);
}

export async function getMarketplaceChannelMapping(
  channel: MarketplaceChannel,
  categoryId?: string,
  templateId?: string,
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  if (categoryId) {
    params.set("categoryId", categoryId);
  }
  if (templateId) {
    params.set("templateId", templateId);
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return fetchJson<MarketplaceChannelMapping>(
    `/marketplace/channels/${encodeURIComponent(channel)}/mapping${query}`,
    undefined,
    options,
  );
}

export async function getMarketplaceTemplates(
  categoryId: string,
  channel?: MarketplaceChannel,
  options?: ApiRequestOptions,
) {
  const query = channel ? `?channel=${encodeURIComponent(channel)}` : "";
  return fetchJson<ChannelMappingTemplate[]>(
    `/marketplace/categories/${categoryId}/templates${query}`,
    undefined,
    options,
  );
}

export async function getConnectorMappingVersions(
  connectorSlug: string,
  input?: { categoryScope?: string; includeArchived?: boolean },
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  if (input?.categoryScope) {
    params.set("categoryScope", input.categoryScope);
  }
  if (typeof input?.includeArchived === "boolean") {
    params.set("includeArchived", String(input.includeArchived));
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return fetchJson<ConnectorMappingVersion[]>(
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/versions${query}`,
    undefined,
    options,
  );
}

export async function createConnectorMappingVersion(
  connectorSlug: string,
  body: {
    categoryScope: string;
    mappingLevel: "tenant_connector_default" | "tenant_connector_category_mapping";
    connectorDefinitionId: string;
    connectorDefinitionVersion: string;
    compatibilityState?: ConnectorMappingCompatibility;
    mappingRules: Record<string, unknown>;
    fallbackPolicy?: Record<string, unknown>;
    fallbackAckRequired?: boolean;
  },
  options?: ApiRequestOptions,
) {
  return postJson<ConnectorMappingVersion>(
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/versions`,
    body,
    options,
  );
}

export async function validateConnectorMappingVersion(
  connectorSlug: string,
  versionId: string,
  options?: ApiRequestOptions,
) {
  return postJson<ConnectorMappingVersion>(
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/versions/${encodeURIComponent(versionId)}/validate`,
    {},
    options,
  );
}

export async function publishConnectorMappingVersion(
  connectorSlug: string,
  versionId: string,
  body: { confirm: boolean },
  options?: ApiRequestOptions,
) {
  return postJson<ConnectorMappingVersion>(
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/versions/${encodeURIComponent(versionId)}/publish`,
    body,
    options,
  );
}

export async function archiveConnectorMappingVersion(
  connectorSlug: string,
  versionId: string,
  body: { reason: string },
  options?: ApiRequestOptions,
) {
  return postJson<ConnectorMappingVersion>(
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/versions/${encodeURIComponent(versionId)}/archive`,
    body,
    options,
  );
}

export interface StepUpResponse {
  stepUpToken: string;
  expiresAt: string;
  scope: string;
}

export async function issueStepUp(
  body: { password: string; scope: string },
  options?: ApiRequestOptions,
) {
  return postJson<StepUpResponse>("/auth/step-up", body, options);
}

export async function rollbackConnectorMappingVersion(
  connectorSlug: string,
  versionId: string,
  body: { confirm: boolean; reason: string },
  options?: ApiRequestOptions,
) {
  return postJson<{
    published: ConnectorMappingVersion;
    superseded: string[];
    rollbackSourceVersionId: string;
  }>(
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/versions/${encodeURIComponent(versionId)}/rollback`,
    body,
    options,
  );
}

export async function resolveConnectorMapping(
  connectorSlug: string,
  categoryScope: string,
  options?: ApiRequestOptions,
) {
  const query = new URLSearchParams({ categoryScope }).toString();
  return fetchJson<ConnectorMappingResolved>(
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/resolve?${query}`,
    undefined,
    options,
  );
}

export async function evaluateConnectorMappingPreflight(
  connectorSlug: string,
  body: { categoryScope: string; fallbackAcknowledged?: boolean },
  options?: ApiRequestOptions,
) {
  return postJson<ConnectorMappingPreflight>(
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/preflight`,
    body,
    options,
  );
}

export async function searchConnectorTaxonomy(
  connectorSlug: string,
  input?: { q?: string; limit?: number },
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  if (input?.q) {
    params.set("q", input.q);
  }
  if (typeof input?.limit === "number" && Number.isFinite(input.limit)) {
    params.set("limit", String(Math.max(1, Math.floor(input.limit))));
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return fetchJson<ConnectorTaxonomyItem[]>(
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/taxonomy/search${query}`,
    undefined,
    options,
  );
}

export async function getUnmappedConnectorTaxonomy(connectorSlug: string, options?: ApiRequestOptions) {
  return fetchJson<Array<{ id: string; path: string; requiredAttributes: string[] }>>(
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/taxonomy/unmapped`,
    undefined,
    options,
  );
}

export async function evaluateConnectorPublishReadiness(
  connectorSlug: string,
  body: { categoryScope: string; fallbackAcknowledged?: boolean; productId?: string },
  options?: ApiRequestOptions,
) {
  return postJson<ConnectorPublishReadiness>(
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/publish-readiness`,
    body,
    options,
  );
}

export async function getMarketplaceTemplate(templateId: string, options?: ApiRequestOptions) {
  return fetchJson<ChannelMappingTemplate>(
    `/marketplace/templates/${encodeURIComponent(templateId)}`,
    undefined,
    options,
  );
}

export async function updateMarketplaceTemplate(
  templateId: string,
  body: {
    name?: string;
    channel?: MarketplaceChannel;
    requiredFields?: string[];
    fieldMap?: Record<string, string>;
    isDefault?: boolean;
    version?: number;
  },
  options?: ApiRequestOptions,
) {
  return patchJson<ChannelMappingTemplate>(
    `/marketplace/templates/${encodeURIComponent(templateId)}`,
    body,
    options,
  );
}

export async function cloneMarketplaceTemplate(
  templateId: string,
  body?: { name?: string; isDefault?: boolean },
  options?: ApiRequestOptions,
) {
  return postJson<ChannelMappingTemplate>(
    `/marketplace/templates/${encodeURIComponent(templateId)}/clone`,
    body ?? {},
    options,
  );
}

export async function deleteMarketplaceTemplate(templateId: string, options?: ApiRequestOptions) {
  return deleteJson(`/marketplace/templates/${encodeURIComponent(templateId)}`, options);
}

export async function getConnectorPayloadPreview(
  installationId: string,
  body: {
    productId: string;
    templateId?: string;
    channel?: MarketplaceChannel;
  },
  options?: ApiRequestOptions,
) {
  return postJson<ConnectorPayloadPreviewResponse>(
    `/connectors/${encodeURIComponent(installationId)}/payload-preview`,
    body,
    options,
  );
}

export async function getMarketplaceSimulation(
  productId: string,
  channel: MarketplaceChannel,
  templateId?: string,
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  params.set("channel", channel);
  if (templateId) {
    params.set("templateId", templateId);
  }
  return fetchJson<MarketplaceSimulation>(
    `/marketplace/products/${productId}/simulate?${params.toString()}`,
    undefined,
    options,
  );
}

export async function getMarketplaceExportJobs(
  productId: string,
  inputOrOptions?: ExportJobListQuery | ApiRequestOptions,
  maybeOptions?: ApiRequestOptions,
) {
  const queryInput = isApiRequestOptions(inputOrOptions) || !inputOrOptions ? {} : inputOrOptions;
  const options = isApiRequestOptions(inputOrOptions) ? inputOrOptions : maybeOptions;
  const params = new URLSearchParams();
  params.set("productId", productId);
  if (queryInput.templateSummary) {
    params.set("templateSummary", "true");
  }
  if (queryInput.cursor) {
    params.set("cursor", queryInput.cursor);
    params.set("pagination", "cursor");
  }
  if (typeof queryInput.limit === "number" && Number.isFinite(queryInput.limit)) {
    params.set("limit", String(Math.max(1, Math.floor(queryInput.limit))));
  }
  return fetchJson<MarketplaceExportJob[]>(
    `/marketplace/export-jobs?${params.toString()}`,
    undefined,
    options,
  );
}

export async function getSubmissions(
  filters?: {
    productId?: string;
    connectorSlug?: string;
    status?: string;
    minAttempt?: number;
    cursor?: string;
    limit?: number;
  },
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  if (filters?.productId) {
    params.set("productId", filters.productId);
  }
  if (filters?.connectorSlug) {
    params.set("connectorSlug", filters.connectorSlug);
  }
  if (filters?.status) {
    params.set("status", filters.status);
  }
  if (typeof filters?.minAttempt === "number" && Number.isFinite(filters.minAttempt)) {
    params.set("minAttempt", String(Math.max(1, Math.floor(filters.minAttempt))));
  }
  if (filters?.cursor) {
    params.set("cursor", filters.cursor);
  }
  if (typeof filters?.limit === "number" && Number.isFinite(filters.limit)) {
    params.set("limit", String(Math.max(1, Math.floor(filters.limit))));
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return fetchJson<PaginatedResponse<ConnectorSubmission> | ConnectorSubmission[]>(
    `/submissions${query}`,
    undefined,
    options,
  );
}

export async function getDeadLetterSubmissions(
  filters?: { cursor?: string; limit?: number },
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  if (filters?.cursor) {
    params.set("cursor", filters.cursor);
  }
  if (typeof filters?.limit === "number" && Number.isFinite(filters.limit)) {
    params.set("limit", String(Math.max(1, Math.floor(filters.limit))));
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return fetchJson<PaginatedResponse<MarketplaceExportJob> | MarketplaceExportJob[]>(
    `/submissions/dead-letter${query}`,
    undefined,
    options,
  );
}

export async function getSubmission(submissionId: string, options?: ApiRequestOptions) {
  return fetchJson<ConnectorSubmission>(
    `/submissions/${encodeURIComponent(submissionId)}`,
    undefined,
    options,
  );
}

export async function getSubmissionIssues(submissionId: string, options?: ApiRequestOptions) {
  return fetchJson<ConnectorSubmissionIssue[]>(
    `/submissions/${encodeURIComponent(submissionId)}/issues`,
    undefined,
    options,
  );
}

export async function getBulkImportJobs(options?: ApiRequestOptions) {
  return fetchJson<BulkImportJob[]>("/bulk-import/jobs", undefined, options);
}

export async function getBulkImportTemplates(
  tenantKey: string,
  categoryId?: string,
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  params.set("tenantKey", tenantKey);
  if (categoryId) {
    params.set("categoryId", categoryId);
  }
  return fetchJson<BulkImportTemplate[]>(
    `/bulk-import/templates?${params.toString()}`,
    undefined,
    options,
  );
}

export async function getBulkImportJobRows(
  jobId: string,
  status?: BulkImportRowStatus,
  limit = 100,
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  if (status) {
    params.set("status", status);
  }
  params.set("limit", String(limit));
  return fetchJson<BulkImportRow[]>(
    `/bulk-import/jobs/${encodeURIComponent(jobId)}/rows?${params.toString()}`,
    undefined,
    options,
  );
}

export async function getBulkImportMappingSuggestion(
  headers: string[],
  options?: ApiRequestOptions,
) {
  return postJson<BulkImportMappingSuggestion>("/bulk-import/mapping-suggestions", {
    headers,
  }, options);
}

export async function getBulkEditPreview(
  scope: BulkEditScope,
  updates: BulkEditUpdates,
  options?: ApiRequestOptions,
) {
  return postJson<BulkEditPreview>("/bulk-edit/preview", {
    scope,
    updates,
  }, options);
}

export async function applyBulkEdit(
  scope: BulkEditScope,
  updates: BulkEditUpdates,
  options?: ApiRequestOptions,
) {
  return postJson<BulkEditOperation>("/bulk-edit/apply", {
    scope,
    updates,
  }, options);
}

export async function getBulkEditOperations(limit = 20, options?: ApiRequestOptions) {
  return fetchJson<BulkEditOperation[]>(
    `/bulk-edit/operations?limit=${encodeURIComponent(String(limit))}`,
    undefined,
    options,
  );
}

export async function getBulkEditOperation(operationId: string, options?: ApiRequestOptions) {
  return fetchJson<BulkEditOperation>(
    `/bulk-edit/operations/${encodeURIComponent(operationId)}`,
    undefined,
    options,
  );
}

export async function getMediaAssets(
  productId?: string,
  variantId?: string,
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  if (productId) {
    params.set("productId", productId);
  }
  if (variantId) {
    params.set("variantId", variantId);
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return fetchJson<MediaAsset[]>(`/media/assets${query}`, undefined, options);
}

export async function getMediaAssetValidation(
  assetId: string,
  channel: MarketplaceChannel,
  options?: ApiRequestOptions,
) {
  return fetchJson<MediaValidation>(
    `/media/assets/${encodeURIComponent(assetId)}/validation?channel=${encodeURIComponent(channel)}`,
    undefined,
    options,
  );
}

export async function runBulkMediaAssociation(
  payload:
    | {
        csvContent: string;
      }
    | {
        rows: Array<{
          skuCode: string;
          imageUrl?: string;
          contentBase64?: string;
          fileName?: string;
          mimeType?: string;
          width?: number;
          height?: number;
        }>;
      },
  options?: ApiRequestOptions,
) {
  return postJson<BulkMediaAssociationResult>("/media/bulk-associations", payload, options);
}

export async function getRejectionIntelligenceScore(
  productId: string,
  channel: MarketplaceChannel,
  options?: ApiRequestOptions,
) {
  return fetchJson<RejectionIntelligenceScore>(
    `/rejection-intelligence/products/${encodeURIComponent(productId)}/score?channel=${encodeURIComponent(channel)}`,
    undefined,
    options,
  );
}

export async function getOndcVersions(options?: ApiRequestOptions) {
  return fetchJson<OndcVersionInfo[]>("/ondc/versions", undefined, options);
}

export async function getOndcMappings(
  filters: { nodeType?: string; version?: string; categoryId?: string },
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  if (filters.nodeType) {
    params.set("nodeType", filters.nodeType);
  }
  if (filters.version) {
    params.set("version", filters.version);
  }
  if (filters.categoryId) {
    params.set("categoryId", filters.categoryId);
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return fetchJson<OndcMapping[]>(`/ondc/mappings${query}`, undefined, options);
}

export async function getOndcSimulation(
  productId: string,
  nodeType: string,
  version: string,
  mappingId?: string,
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  params.set("nodeType", nodeType);
  params.set("version", version);
  if (mappingId) {
    params.set("mappingId", mappingId);
  }
  return fetchJson<OndcSimulation>(
    `/ondc/products/${encodeURIComponent(productId)}/simulate?${params.toString()}`,
    undefined,
    options,
  );
}

export async function getAiTitleSuggestion(productId: string, options?: ApiRequestOptions) {
  return fetchJson<AiTitleSuggestion>(
    `/auto-suggestions/products/${encodeURIComponent(productId)}/title-suggestion`,
    undefined,
    options,
  );
}

export async function getAiAttributeEnrichment(productId: string, options?: ApiRequestOptions) {
  return fetchJson<AiAttributeEnrichment>(
    `/auto-suggestions/products/${encodeURIComponent(productId)}/attribute-enrichment`,
    undefined,
    options,
  );
}

export async function getAiCategorySuggestion(productId: string, options?: ApiRequestOptions) {
  return fetchJson<AiCategorySuggestion>(
    `/auto-suggestions/products/${encodeURIComponent(productId)}/category-suggestion`,
    undefined,
    options,
  );
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


