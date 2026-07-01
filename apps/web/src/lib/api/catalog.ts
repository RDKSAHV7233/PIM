import { cache } from "react";
import type { ApiRequestOptions, AttributeDefinition, BulkImportValidationSummary, CatalogSearchResult, CatalogStats, Category, CategoryListQuery, PaginatedResponse, Product, ProductListItem, ProductListQuery, ProductRevision, ValidationIssue, Variant, ApprovalComment, ProductActivityResponse } from "./core";
import { fetchJson, postJson } from "./core";

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

/**
 * Per-request React cache wrapper for getCategoryTree.
 *
 * Use getCachedCategoryTree instead of getCategoryTree when called from multiple
 * Server Components in the same render tree — React cache() deduplicates to a
 * single fetch within a request at zero TTL cost.
 *
 * Note: this does NOT replace the revalidateSeconds option; the underlying fetchJson
 * still populates the Next.js Data Cache. getCachedCategoryTree adds deduplication
 * on top of that.
 */
export const getCachedCategoryTree = cache(
  (inputOrOptions?: CategoryListQuery | ApiRequestOptions, maybeOptions?: ApiRequestOptions) =>
    getCategoryTree(inputOrOptions, maybeOptions),
);

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
  return Array.isArray(response) ? response : (response.items ?? []);
}

export async function getCategoryCounts(options?: ApiRequestOptions) {
  return fetchJson<Array<{ categoryId: string; childCount: number; productCount: number }>>(
    "/taxonomy/categories/counts",
    undefined,
    options,
  );
}

export async function getProductList(
  inputOrOptions?: ProductListQuery | ApiRequestOptions,
  maybeOptions?: ApiRequestOptions,
) {
  const response = await getProductListPage(inputOrOptions, maybeOptions);
  return response.items;
}

export async function getAllProductsSlim(options?: ApiRequestOptions): Promise<ProductListItem[]> {
  const all: ProductListItem[] = [];
  let cursor: string | null | undefined = undefined;
  do {
    const page = await getProductListPage({ slim: true, limit: 200, cursor: cursor ?? undefined }, options);
    all.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return all;
}

export async function getProductListPage(
  inputOrOptions?: ProductListQuery | ApiRequestOptions,
  maybeOptions?: ApiRequestOptions,
) {
  const queryInput = isApiRequestOptions(inputOrOptions) || !inputOrOptions ? {} : inputOrOptions;
  const options = isApiRequestOptions(inputOrOptions) ? inputOrOptions : maybeOptions;
  const params = new URLSearchParams();
  if (queryInput.slim) {
    params.set("slim", "true");
    // slim is only served by the cursor path — always activate it so the first page
    // isn't silently capped at 200 by the legacy non-cursor path.
    params.set("pagination", "cursor");
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
  if (Array.isArray(response)) {
    return {
      items: response,
      nextCursor: null,
      limit: queryInput.limit ?? response.length,
    };
  }
  return response;
}

export async function getProduct(productId: string, options?: ApiRequestOptions) {
  return fetchJson<Product>(`/catalog/products/${productId}`, undefined, options);
}

export async function getProductRevisions(productId: string, options?: ApiRequestOptions) {
  const response = await fetchJson<ProductRevision[] | { items: ProductRevision[] }>(
    `/catalog/products/${encodeURIComponent(productId)}/revisions`,
    undefined,
    options,
  );
  // API returns a paginated envelope { items: [...] } — extract to array
  if (response && !Array.isArray(response) && "items" in response) {
    return response.items;
  }
  return response as ProductRevision[];
}

export async function searchCatalogProducts(
  input: { q: string; limit?: number; offset?: number },
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  if (input.q.trim()) {
    params.set("q", input.q.trim());
  }
  if (typeof input.limit === "number" && Number.isFinite(input.limit)) {
    params.set("limit", String(Math.max(1, Math.floor(input.limit))));
  }
  if (typeof input.offset === "number" && input.offset > 0) {
    params.set("offset", String(Math.floor(input.offset)));
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return fetchJson<CatalogSearchResult[]>(`/catalog/products/search${query}`, undefined, options);
}

export async function getProductVariants(productId: string, options?: ApiRequestOptions) {
  const response = await fetchJson<PaginatedResponse<Variant> | Variant[]>(
    `/catalog/products/${productId}/variants`,
    undefined,
    options,
  );
  return Array.isArray(response) ? response : (response.items ?? []);
}

export async function getStats(options?: ApiRequestOptions) {
  return fetchJson<CatalogStats>("/catalog/stats", undefined, options);
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

export async function validateBulkImportPayload(
  body: {
    categoryId: string;
    sourceFormat: "csv" | "json";
    sourceName?: string;
    csvContent?: string;
    fileContentBase64?: string;
    rows?: Record<string, unknown>[];
    mapping?: Record<string, string>;
    chunkSize?: number;
    maxRetries?: number;
  },
  options?: ApiRequestOptions,
) {
  return fetchJson<BulkImportValidationSummary>("/bulk-import/validate", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
  }, options);
}

export async function getApprovalComments(productId: string, options?: ApiRequestOptions) {
  return fetchJson<ApprovalComment[]>(
    `/catalog/products/${encodeURIComponent(productId)}/review-comments`,
    undefined,
    options,
  );
}

export async function addApprovalComment(productId: string, body: string, options?: ApiRequestOptions) {
  return postJson<ApprovalComment>(
    `/catalog/products/${encodeURIComponent(productId)}/review-comments`,
    { body },
    options,
  );
}

export async function getProductActivity(productId: string, limit = 50, options?: ApiRequestOptions) {
  return fetchJson<ProductActivityResponse>(
    `/catalog/products/${encodeURIComponent(productId)}/activity?limit=${limit}`,
    undefined,
    options,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 2 additions
// ─────────────────────────────────────────────────────────────────────────────

export interface AdvancedSearchQuery {
  q?: string;
  status?: string;
  categoryId?: string;
  brand?: string;
  channelSlug?: string;
  cursor?: string;
  limit?: number;
  sort?: string;
  sortDir?: "asc" | "desc";
  offset?: number;
}

export interface AdvancedSearchPage {
  items: ProductListItem[];
  nextCursor: string | null;
  totalCount: number | null;
  limit: number;
}

export interface WorkflowSlaConfig {
  reviewTargetDays: number;
  tenantKey: string;
}

export interface OverdueCountResponse {
  count: number;
  asOf?: string;
}

export type ProductRelationshipType = "bundle_component" | "accessory" | "substitute" | "upsell";

export interface ProductRelationshipProduct {
  id: string;
  title: string;
  status: string;
}

export interface ProductRelationship {
  id: string;
  tenantKey: string;
  sourceProductId: string;
  targetProductId: string;
  type: ProductRelationshipType;
  quantityInParent: number | null;
  sortOrder: number;
  createdAt: string;
  targetProduct?: ProductRelationshipProduct;
  sourceProduct?: ProductRelationshipProduct;
}

export interface ProductRelationshipsResponse {
  outgoing: ProductRelationship[];
  incoming: ProductRelationship[];
}

export interface CreateRelationshipInput {
  targetProductId: string;
  type: ProductRelationshipType;
  quantityInParent?: number;
  sortOrder?: number;
}

export interface ChangeRequest {
  id: string;
  productId: string;
  requesterId: string;
  reason: string;
  status: "open" | "resolved";
  createdAt: string;
  updatedAt: string;
}

export interface AssigneeUpdateResponse {
  id: string;
  assigneeId: string | null;
  updatedAt: string;
}

export async function getAdvancedSearchProducts(
  query: AdvancedSearchQuery,
  options?: ApiRequestOptions,
): Promise<AdvancedSearchPage> {
  const params = new URLSearchParams();
  if (query.q?.trim()) params.set("q", query.q.trim());
  if (query.status) params.set("status", query.status);
  if (query.categoryId) params.set("categoryId", query.categoryId);
  if (query.brand) params.set("brand", query.brand);
  if (query.channelSlug) params.set("channelSlug", query.channelSlug);
  if (query.cursor) params.set("cursor", query.cursor);
  if (typeof query.limit === "number") params.set("limit", String(query.limit));
  if (typeof query.offset === "number") params.set("offset", String(query.offset));
  if (query.sort) params.set("sort", query.sort);
  if (query.sortDir) params.set("sortDir", query.sortDir);
  const qs = params.size > 0 ? `?${params.toString()}` : "";
  const response = await fetchJson<AdvancedSearchPage | ProductListItem[]>(
    `/catalog/products/advanced-search${qs}`,
    undefined,
    options,
  );
  if (Array.isArray(response)) {
    return { items: response, nextCursor: null, totalCount: null, limit: query.limit ?? response.length };
  }
  return response;
}

export async function getWorkflowSla(options?: ApiRequestOptions): Promise<WorkflowSlaConfig> {
  return fetchJson<WorkflowSlaConfig>("/catalog/workflow/sla", undefined, options);
}

export async function upsertWorkflowSla(
  reviewTargetDays: number,
  options?: ApiRequestOptions,
): Promise<WorkflowSlaConfig> {
  return fetchJson<WorkflowSlaConfig>("/catalog/workflow/sla", {
    method: "PUT",
    body: JSON.stringify({ reviewTargetDays }),
    headers: { "Content-Type": "application/json" },
  }, options);
}

export async function getOverdueCount(options?: ApiRequestOptions): Promise<OverdueCountResponse> {
  return fetchJson<OverdueCountResponse>("/catalog/workflow/sla/overdue", undefined, options);
}

export async function assignProduct(
  productId: string,
  assigneeId: string | null,
  options?: ApiRequestOptions,
): Promise<AssigneeUpdateResponse> {
  return fetchJson<AssigneeUpdateResponse>(
    `/catalog/products/${encodeURIComponent(productId)}/assignee`,
    {
      method: "PATCH",
      body: JSON.stringify({ assigneeId }),
      headers: { "Content-Type": "application/json" },
    },
    options,
  );
}

export async function getChangeRequests(
  productId: string,
  options?: ApiRequestOptions,
): Promise<ChangeRequest[]> {
  const response = await fetchJson<ChangeRequest[] | { items: ChangeRequest[] }>(
    `/catalog/products/${encodeURIComponent(productId)}/change-requests`,
    undefined,
    options,
  );
  return Array.isArray(response) ? response : (response.items ?? []);
}

export async function createChangeRequest(
  productId: string,
  reason: string,
  options?: ApiRequestOptions,
): Promise<ChangeRequest> {
  return fetchJson<ChangeRequest>(
    `/catalog/products/${encodeURIComponent(productId)}/change-requests`,
    {
      method: "POST",
      body: JSON.stringify({ reason }),
      headers: { "Content-Type": "application/json" },
    },
    options,
  );
}

export async function resolveChangeRequest(
  productId: string,
  requestId: string,
  options?: ApiRequestOptions,
): Promise<ChangeRequest> {
  return fetchJson<ChangeRequest>(
    `/catalog/products/${encodeURIComponent(productId)}/change-requests/${encodeURIComponent(requestId)}/resolve`,
    { method: "POST" },
    options,
  );
}

export async function getProductRelationships(
  productId: string,
  options?: ApiRequestOptions,
): Promise<ProductRelationshipsResponse> {
  return fetchJson<ProductRelationshipsResponse>(
    `/catalog/products/${encodeURIComponent(productId)}/relationships`,
    undefined,
    options,
  );
}

export async function createProductRelationship(
  sourceProductId: string,
  input: CreateRelationshipInput,
  options?: ApiRequestOptions,
): Promise<ProductRelationship> {
  return fetchJson<ProductRelationship>(
    `/catalog/products/${encodeURIComponent(sourceProductId)}/relationships`,
    {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
    },
    options,
  );
}

export async function deleteProductRelationship(
  relationshipId: string,
  options?: ApiRequestOptions,
): Promise<{ deleted: boolean }> {
  return fetchJson<{ deleted: boolean }>(
    `/catalog/relationships/${encodeURIComponent(relationshipId)}`,
    { method: "DELETE" },
    options,
  );
}
