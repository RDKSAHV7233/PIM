export type CatalogStatus = "draft" | "active" | "archived";
export type RuleSeverity = "error" | "warning";
export type MarketplaceChannel = "amazon" | "flipkart" | "meesho";

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
  categoryId: string;
  hsnCode: string | null;
  gstRate: number | null;
  attributes: Record<string, unknown>;
  status: CatalogStatus;
  category?: Category;
  variants?: Variant[];
  validationIssues?: ValidationIssue[];
  createdAt: string;
  updatedAt: string;
}

export interface CatalogStats {
  categories: number;
  products: number;
  variants: number;
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
  message: string;
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
  createdAt: string;
  updatedAt: string;
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
  template?: ChannelMappingTemplate | null;
  createdAt: string;
  updatedAt: string;
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

const API_BASE_URL = process.env.PIM_API_BASE_URL ?? "http://localhost:4000/api";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with status ${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export async function getCategories() {
  return fetchJson<Category[]>("/taxonomy/categories");
}

export async function getProducts() {
  return fetchJson<Product[]>("/catalog/products");
}

export async function getProduct(productId: string) {
  return fetchJson<Product>(`/catalog/products/${productId}`);
}

export async function getProductVariants(productId: string) {
  return fetchJson<Variant[]>(`/catalog/products/${productId}/variants`);
}

export async function getStats() {
  return fetchJson<CatalogStats>("/catalog/stats");
}

export async function getCategoryAttributes(categoryId: string) {
  return fetchJson<AttributeDefinition[]>(`/taxonomy/categories/${categoryId}/attributes`);
}

export async function getProductIssues(productId: string) {
  return fetchJson<ValidationIssue[]>(`/compliance/products/${productId}/issues`);
}

export async function getMarketplaceChannels() {
  return fetchJson<MarketplaceChannelConfig[]>("/marketplace/channels");
}

export async function getMarketplaceChannelMapping(
  channel: MarketplaceChannel,
  categoryId?: string,
  templateId?: string,
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
  );
}

export async function getMarketplaceTemplates(categoryId: string, channel?: MarketplaceChannel) {
  const query = channel ? `?channel=${encodeURIComponent(channel)}` : "";
  return fetchJson<ChannelMappingTemplate[]>(
    `/marketplace/categories/${categoryId}/templates${query}`,
  );
}

export async function getMarketplaceSimulation(
  productId: string,
  channel: MarketplaceChannel,
  templateId?: string,
) {
  const params = new URLSearchParams();
  params.set("channel", channel);
  if (templateId) {
    params.set("templateId", templateId);
  }
  return fetchJson<MarketplaceSimulation>(
    `/marketplace/products/${productId}/simulate?${params.toString()}`,
  );
}

export async function getMarketplaceExportJobs(productId: string) {
  return fetchJson<MarketplaceExportJob[]>(
    `/marketplace/export-jobs?productId=${encodeURIComponent(productId)}`,
  );
}

export async function getBulkImportJobs() {
  return fetchJson<BulkImportJob[]>("/bulk-import/jobs");
}

export async function getBulkImportJobRows(jobId: string, status?: BulkImportRowStatus, limit = 100) {
  const params = new URLSearchParams();
  if (status) {
    params.set("status", status);
  }
  params.set("limit", String(limit));
  return fetchJson<BulkImportRow[]>(
    `/bulk-import/jobs/${encodeURIComponent(jobId)}/rows?${params.toString()}`,
  );
}

export async function getBulkImportMappingSuggestion(headers: string[]) {
  return postJson<BulkImportMappingSuggestion>("/bulk-import/mapping-suggestions", {
    headers,
  });
}

export async function getBulkEditPreview(scope: BulkEditScope, updates: BulkEditUpdates) {
  return postJson<BulkEditPreview>("/bulk-edit/preview", {
    scope,
    updates,
  });
}

export async function applyBulkEdit(scope: BulkEditScope, updates: BulkEditUpdates) {
  return postJson<BulkEditOperation>("/bulk-edit/apply", {
    scope,
    updates,
  });
}

export async function getBulkEditOperations(limit = 20) {
  return fetchJson<BulkEditOperation[]>(`/bulk-edit/operations?limit=${encodeURIComponent(String(limit))}`);
}

export async function getBulkEditOperation(operationId: string) {
  return fetchJson<BulkEditOperation>(`/bulk-edit/operations/${encodeURIComponent(operationId)}`);
}

export async function postJson<T>(path: string, body: unknown) {
  return fetchJson<T>(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function patchJson<T>(path: string, body: unknown) {
  return fetchJson<T>(path, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteJson(path: string) {
  return fetchJson<void>(path, { method: "DELETE" });
}


