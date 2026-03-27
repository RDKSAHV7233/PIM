import type { ApiRequestOptions, AuditEventListResponse, AuditEventsQuery, CatalogStatus, IssueInboxResolveResult, IssueInboxResponse, IssueInboxSeverity, Product } from "./core";
import { fetchJson, postJson } from "./core";

export async function getAuditEvents(input?: AuditEventsQuery, options?: ApiRequestOptions) {
  const params = new URLSearchParams();
  if (input?.actorId?.trim()) {
    params.set("actorId", input.actorId.trim());
  }
  if (input?.action?.trim()) {
    params.set("action", input.action.trim());
  }
  if (input?.resourceId?.trim()) {
    params.set("resourceId", input.resourceId.trim());
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
