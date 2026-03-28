import { fetchJson, postJson } from "./core";
import type { ApiRequestOptions, AppRole, CommercialRequestListResponse, PlanUpgradeRequest } from "./core";

export interface CommercialTenantSearchResult {
  tenantKey: string;
  workspaceSlug: string;
  displayName: string;
  workspaceIsActive: boolean;
  planTier: string;
  billingStatus: string;
  accessStatus: string;
  trialEndsAt: string | null;
  paidThroughAt: string | null;
  graceEndsAt: string | null;
  cancelledAt: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  billingContactEmail: string | null;
  adminEmails: string[];
}

export interface CommercialTenantSearchResponse {
  items: CommercialTenantSearchResult[];
  count: number;
  query: string;
}

export interface CommercialOverviewResponse {
  tenantOverview: {
    totalTenants: number;
    activeWorkspaces: number;
    inactiveWorkspaces: number;
    planTierCounts: {
      starter: number;
      growth: number;
      enterprise: number;
    };
    billingStatusCounts: {
      trial: number;
      activePaid: number;
      pastDue: number;
      cancelled: number;
    };
    accessStatusCounts: {
      active: number;
      suspended: number;
    };
  };
  requestOverview: {
    totalRequests: number;
    activeRequests: number;
    openRequests: number;
    acknowledgedRequests: number;
    resolvedRequests: number;
    cancelledRequests: number;
    recentRequests: number;
    recentResolvedRequests: number;
    staleOpenRequests: number;
    staleAcknowledgedRequests: number;
    attentionRequiredRequests: number;
    oldestActiveRequestCreatedAt: string | null;
  };
}

function buildQueryString(params: Record<string, string | number | undefined>) {
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

export function getCommercialOpsRequestOptions(
  operatorId: string,
  operatorRole: AppRole | string,
): ApiRequestOptions {
  const commercialOpsToken = String(process.env.PIM_COMMERCIAL_OPS_TOKEN ?? "").trim();
  if (!commercialOpsToken) {
    throw new Error("COMMERCIAL_OPS_TOKEN_NOT_CONFIGURED");
  }
  const normalizedOperatorId = String(operatorId ?? "").trim();
  const normalizedOperatorRole = String(operatorRole ?? "").trim().toLowerCase();
  if (!normalizedOperatorId) {
    throw new Error("COMMERCIAL_OPERATOR_ID_REQUIRED");
  }
  if (!normalizedOperatorRole) {
    throw new Error("COMMERCIAL_OPERATOR_ROLE_REQUIRED");
  }
  return {
    headers: {
      "x-pim-commercial-ops-token": commercialOpsToken,
      "x-pim-operator-id": normalizedOperatorId,
      "x-pim-operator-role": normalizedOperatorRole,
    },
  };
}

export async function listInternalUpgradeRequests(
  query: { tenantKey?: string; status?: string; limit?: number },
  options: ApiRequestOptions,
) {
  return fetchJson<CommercialRequestListResponse>(
    `/billing/internal/upgrade-requests${buildQueryString({
      tenantKey: query.tenantKey,
      status: query.status,
      limit: query.limit,
    })}`,
    undefined,
    options,
  );
}

export async function getCommercialOverviewInternal(options: ApiRequestOptions) {
  return fetchJson<CommercialOverviewResponse>("/billing/internal/overview", undefined, options);
}

export async function searchCommercialTenantsInternal(
  query: { q: string; limit?: number },
  options: ApiRequestOptions,
) {
  return fetchJson<CommercialTenantSearchResponse>(
    `/billing/internal/tenants/search${buildQueryString({
      q: query.q,
      limit: query.limit,
    })}`,
    undefined,
    options,
  );
}

export async function updateInternalUpgradeRequestStatus(
  body: { requestId: string; status: PlanUpgradeRequest["status"] | string },
  options: ApiRequestOptions,
) {
  return postJson<{ item: PlanUpgradeRequest }>("/billing/internal/upgrade-requests/status", body, options);
}
