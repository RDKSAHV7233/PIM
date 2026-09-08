import type { ApiRequestOptions } from "./core";
import { fetchJson, postJson } from "./core";

export type ErrorAuthorityRuntime = "api" | "worker" | "next_server" | "browser";
export type ErrorAuthoritySeverity = "p0" | "p1" | "p2" | "p3";
export type ErrorAuthorityState = "open" | "muted" | "resolved";

export interface ErrorAuthorityIssueListItem {
  id: string;
  fingerprint: string;
  runtime: ErrorAuthorityRuntime | string;
  service: string;
  environment: string;
  errorCode: string | null;
  category: string;
  severity: ErrorAuthoritySeverity | string;
  state: ErrorAuthorityState | string;
  safeTitle: string;
  firstSeenAt: string;
  lastSeenAt: string;
  firstSeenRelease: string | null;
  lastSeenRelease: string | null;
  occurrenceCount: number;
  affectedTenantCount: number;
  latestOccurrenceId: string | null;
}

export interface ErrorAuthorityOccurrenceListItem {
  id: string;
  issueId: string;
  occurredAt: string;
  environment: string;
  release: string | null;
  runtime: ErrorAuthorityRuntime | string;
  service: string;
  requestId: string | null;
  correlationId: string | null;
  routeTemplate: string | null;
  method: string | null;
  statusCode: number | null;
  safeTenantRef: string | null;
  actorType: string | null;
  jobId: string | null;
  operationId: string | null;
  installationId: string | null;
  errorCode: string | null;
  category: string;
  safeMessage: string;
  topFrameFile: string | null;
  topFrameFunction: string | null;
  topFrameLine: number | null;
  sourceEventId: string | null;
}

export interface ErrorAuthorityListResponse<T> {
  items: T[];
  limit: number;
  nextCursor: string | null;
  storageAvailable: boolean;
  window: {
    dateFrom: string;
    dateTo: string;
  };
}

export interface ErrorAuthorityIssueQuery {
  runtime?: string;
  service?: string;
  severity?: string;
  state?: string;
  release?: string;
  errorCode?: string;
  route?: string;
  dateFrom?: string;
  dateTo?: string;
  cursor?: string;
  limit?: number;
}

export interface ErrorAuthorityOccurrenceQuery {
  dateFrom?: string;
  dateTo?: string;
  cursor?: string;
  limit?: number;
}

export async function listErrorAuthorityIssues(query: ErrorAuthorityIssueQuery, options?: ApiRequestOptions) {
  const params = buildQuery({
    runtime: query.runtime,
    service: query.service,
    severity: query.severity,
    state: query.state,
    release: query.release,
    errorCode: query.errorCode,
    route: query.route,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    cursor: query.cursor,
    limit: query.limit,
  });
  return fetchJson<ErrorAuthorityListResponse<ErrorAuthorityIssueListItem>>(
    `/error-authority/ops/issues${params}`,
    undefined,
    options,
  );
}

export async function listErrorAuthorityOccurrences(
  issueId: string,
  query: ErrorAuthorityOccurrenceQuery,
  options?: ApiRequestOptions,
) {
  const params = buildQuery({
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    cursor: query.cursor,
    limit: query.limit,
  });
  return fetchJson<ErrorAuthorityListResponse<ErrorAuthorityOccurrenceListItem>>(
    `/error-authority/ops/issues/${encodeURIComponent(issueId)}/occurrences${params}`,
    undefined,
    options,
  );
}

export interface ErrorAuthorityResolveIssueResponse {
  id: string;
  state: ErrorAuthorityState | string;
}

/**
 * PIM#766 Part 1: manual resolve. Idempotent on the API side — calling this
 * again on an already-resolved issue still returns 200 with state "resolved".
 */
export async function resolveErrorAuthorityIssue(issueId: string, options?: ApiRequestOptions) {
  return postJson<ErrorAuthorityResolveIssueResponse>(
    `/error-authority/ops/issues/${encodeURIComponent(issueId)}/resolve`,
    {},
    options,
  );
}

function buildQuery(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const normalized = String(value ?? "").trim();
    if (normalized) {
      search.set(key, normalized);
    }
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}
