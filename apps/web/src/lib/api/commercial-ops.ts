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
    starterTenants: number;
    growthTenants: number;
    enterpriseTenants: number;
    trialTenants: number;
    paidTenants: number;
    pastDueTenants: number;
    suspendedTenants: number;
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
  currentBillingStatus: string;
  requestedBy: string;
  notes: string | null;
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

export function isOpsTokenConfigured(): boolean {
  return String(process.env.PIM_COMMERCIAL_OPS_TOKEN ?? "").trim().length > 0;
}
