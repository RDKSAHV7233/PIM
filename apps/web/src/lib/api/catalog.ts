import type { ApiRequestOptions, AttributeDefinition, CatalogSearchResult, CatalogStats, Category, CategoryListQuery, PaginatedResponse, Product, ProductListItem, ProductListQuery, ValidationIssue, Variant, ApprovalComment, ProductActivityResponse } from "./core";
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
  const response = await getProductListPage(inputOrOptions, maybeOptions);
  return response.items;
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

export async function getProductVariants(productId: string, options?: ApiRequestOptions) {
  return fetchJson<Variant[]>(`/catalog/products/${productId}/variants`, undefined, options);
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
