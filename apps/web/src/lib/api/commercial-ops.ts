import { getApiBaseUrl } from "../api-base-url";

interface CommercialTenant {
  tenantKey: string;
  workspaceSlug: string;
  displayName: string;
  planTier: string | null;
  billingStatus: string | null;
  accessStatus: string | null;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
  billingContactEmail: string | null;
  adminEmails: string[];
}

interface CommercialOverview {
  tenantOverview: {
    totalTenants: number;
    planTierCounts: {
      trial: number;
      starter: number;
      growth: number;
      business: number;
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
  };
}

interface UpgradeRequest {
  id: string;
  tenantKey: string;
  status: string;
  currentPlanTier: string;
  requestedPlanTier: string | null;
  currentBillingStatus: string;
  currentAccessStatus: string;
  requestedBy: string;
  notes: string | null;
  usageSnapshot: Record<string, unknown> | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

function getOpsToken(): string {
  const token = String(process.env.PIM_COMMERCIAL_OPS_TOKEN ?? "").trim();
  if (!token) throw new Error("PIM_COMMERCIAL_OPS_TOKEN not configured");
  return token;
}

function opsHeaders(operatorId: string): Record<string, string> {
  return {
    "x-pim-commercial-ops-token": getOpsToken(),
    "x-pim-operator-id": operatorId,
    "x-pim-operator-role": "system_admin",
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function opsFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Commercial ops ${path} failed: ${response.status} ${text}`);
  }
  return response.json() as Promise<T>;
}

export async function getCommercialOverview(operatorId: string): Promise<CommercialOverview> {
  return opsFetch<CommercialOverview>("/billing/internal/overview", {
    headers: opsHeaders(operatorId),
  });
}

export async function searchCommercialTenants(query: string, operatorId: string): Promise<CommercialTenant[]> {
  const encoded = encodeURIComponent(query);
  const result = await opsFetch<{ items: CommercialTenant[] }>(
    `/billing/internal/tenants/search?q=${encoded}&limit=20`,
    { headers: opsHeaders(operatorId) },
  );
  return result.items;
}

export async function listUpgradeRequests(operatorId: string, status?: string): Promise<UpgradeRequest[]> {
  const params = status ? `?status=${encodeURIComponent(status)}&limit=50` : "?limit=50";
  const result = await opsFetch<{ items: UpgradeRequest[] }>(
    `/billing/internal/upgrade-requests${params}`,
    { headers: opsHeaders(operatorId) },
  );
  return result.items;
}

export async function setTenantPlanTier(
  tenantKey: string,
  planTier: string,
  operatorId: string,
): Promise<{ planTier: string; tenantKey: string }> {
  return opsFetch<{ planTier: string; tenantKey: string }>("/billing/internal/plan-tier", {
    method: "POST",
    headers: opsHeaders(operatorId),
    body: JSON.stringify({ tenantKey, planTier }),
  });
}

export async function updateUpgradeRequestStatus(
  requestId: string,
  status: string,
  operatorId: string,
): Promise<{ item: UpgradeRequest }> {
  return opsFetch<{ item: UpgradeRequest }>("/billing/internal/upgrade-requests/status", {
    method: "POST",
    headers: opsHeaders(operatorId),
    body: JSON.stringify({ requestId, status }),
  });
}

interface EnrichedTenant extends CommercialTenant {
  usage: {
    skuCount: number;
    userCount: number;
    submissionCount: number;
    storageGb: number;
    connectorInstallationsCount: number;
  } | null;
  connectors: Array<{ slug: string; displayName: string; accountCount: number }>;
  createdAt: string;
}

interface RecentSignup {
  id: string;
  displayName: string;
  workspaceSlug: string;
  adminEmail: string;
  status: string;
  createdAt: string;
  verifiedAt: string | null;
}

export async function listEnrichedTenants(
  operatorId: string,
  filters?: { planTier?: string; billingStatus?: string; limit?: number },
): Promise<EnrichedTenant[]> {
  const params = new URLSearchParams();
  if (filters?.planTier) params.set("planTier", filters.planTier);
  if (filters?.billingStatus) params.set("billingStatus", filters.billingStatus);
  if (filters?.limit) params.set("limit", String(filters.limit));
  const qs = params.toString();
  const result = await opsFetch<{ items: EnrichedTenant[] }>(
    `/billing/internal/tenants/list${qs ? `?${qs}` : ""}`,
    { headers: opsHeaders(operatorId) },
  );
  return result.items;
}

export async function listRecentSignups(operatorId: string, limit = 20): Promise<RecentSignup[]> {
  const result = await opsFetch<{ items: RecentSignup[] }>(
    `/billing/internal/recent-signups?limit=${limit}`,
    { headers: opsHeaders(operatorId) },
  );
  return result.items;
}

export interface TenantDetailUser {
  userId: string;
  identityType: "email" | "external_identifier" | "unknown";
  role: string;
  isActive: boolean;
  isLocked: boolean;
  lockedUntil: string | null;
  createdAt: string;
}

export interface TenantDetailConnector {
  installationId: string;
  connectorName: string;
  connectorSlug: string;
  status: string;
  createdAt: string;
}

export interface TenantDetail {
  tenant: {
    tenantKey: string;
    workspaceName: string;
    workspaceSlug: string;
    createdAt: string;
  };
  commercial: {
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
  };
  usage: {
    skuCount: number;
    userCount: number;
    submissionCount: number;
    storageBytes: number;
  };
  signup: {
    adminEmail: string;
    status: string;
    requestedAt: string;
    verifiedAt: string | null;
  } | null;
  users: {
    items: TenantDetailUser[];
    total: number;
    limit: number;
    truncated: boolean;
  };
  connectors: {
    items: TenantDetailConnector[];
    total: number;
    limit: number;
    truncated: boolean;
  };
}

export async function getTenantDetail(tenantKey: string, operatorId: string): Promise<TenantDetail> {
  const encoded = encodeURIComponent(tenantKey);
  return opsFetch<TenantDetail>(
    `/billing/internal/tenants/${encoded}`,
    { headers: opsHeaders(operatorId) },
  );
}

export function isOpsTokenConfigured(): boolean {
  return String(process.env.PIM_COMMERCIAL_OPS_TOKEN ?? "").trim().length > 0;
}
