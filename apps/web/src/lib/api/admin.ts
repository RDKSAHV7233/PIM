import type { AccessScopeAssignment, AccessScopeAssignmentAction, AccessScopeAssignmentScopeType, AccessScopeAssignmentSubjectType, ApiAccessKey, ApiClientScope, ApiRequestOptions, AppRole, CreatedApiAccessKey, OutboundWebhookDelivery, OutboundWebhookEndpoint, TenantAuthPolicy, WorkspaceUser } from "./core";
import { fetchJson, patchJson, postJson } from "./core";

export async function getTenantAuthPolicy(options?: ApiRequestOptions) {
  return fetchJson<TenantAuthPolicy>("/admin/auth-policy", undefined, options);
}

// ── OIDC tenant configuration ────────────────────────────────────────────────
// Backend lives at /auth/oidc-config (not /admin/...) because the OIDC controller
// is part of the auth module. The admin role gate is enforced at the controller.

export interface OidcConfigView {
  issuer: string;
  clientId: string;
  callbackUrl: string;
  scopes: string[];
  claimsMapping: Record<string, unknown>;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertOidcConfigInput {
  issuer: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  scopes?: string[];
  claimsMapping?: Record<string, unknown>;
}

export async function getOidcConfig(options?: ApiRequestOptions) {
  return fetchJson<OidcConfigView | null>("/auth/oidc-config", undefined, options);
}

export async function upsertOidcConfig(dto: UpsertOidcConfigInput, options?: ApiRequestOptions) {
  return postJson<OidcConfigView>("/auth/oidc-config", dto, options);
}

export async function deleteOidcConfig(options?: ApiRequestOptions) {
  return fetchJson<{ deleted: true }>(
    "/auth/oidc-config",
    { method: "DELETE" },
    options,
  );
}

export async function updateTenantAuthPolicy(
  dto: {
    externalIdentityMode?: boolean;
    mfaRequired?: boolean;
    mfaGracePeriodDays?: number;
    sessionTimeoutMinutes?: number;
    allowedAuthMethods?: Array<"password" | "oidc">;
  },
  options?: ApiRequestOptions,
) {
  return patchJson<TenantAuthPolicy>("/admin/auth-policy", dto, options);
}

export interface RoleCapabilityDescription {
  role: AppRole;
  description: string;
}

export interface RolePermissionMatrixEntry {
  role: string;
  catalog: string;
  channels: string;
  ops: string;
  quality: string;
  admin: string;
}

export interface RoleCapabilitiesResponse {
  descriptions: RoleCapabilityDescription[];
  matrix: readonly RolePermissionMatrixEntry[];
  planTier: string;
  availableRoles: readonly AppRole[];
}

export async function getRoleCapabilities(options?: ApiRequestOptions) {
  return fetchJson<RoleCapabilitiesResponse>("/admin/workspace/users/role-capabilities", undefined, options);
}

export async function getWorkspaceUsers(options?: ApiRequestOptions) {
  return fetchJson<WorkspaceUser[]>("/admin/workspace/users", undefined, options);
}

export interface WorkspaceUserStats {
  adminUsers: number;
  activeUsers: number;
  lockedUsers: number;
  mfaEnrolledCount: number;
}

// Unbounded count from the backend — unlike getWorkspaceUsers() above, which
// caps at 1,000 rows for display, this can't silently undercount admins in a
// tenant with more identities than that. Use this for the Admin Coverage
// governance metric, not workspaceUsers.filter(...).
export async function getWorkspaceUserStats(options?: ApiRequestOptions) {
  return fetchJson<WorkspaceUserStats>("/admin/workspace/users/stats", undefined, options);
}

// Direct, uncapped lookup by exact userId — bypasses getWorkspaceUsers()'s
// 1,000-row page. Use this to find/manage a specific known user (e.g. the
// tenant's own root admin) that the roster table may not be showing.
export async function getWorkspaceUserLookup(userId: string, options?: ApiRequestOptions) {
  return fetchJson<{ user: WorkspaceUser | null }>(
    `/admin/workspace/users/lookup?userId=${encodeURIComponent(userId)}`,
    undefined,
    options,
  );
}

export async function createWorkspaceUser(
  dto: { userId: string; role: AppRole; password?: string },
  options?: ApiRequestOptions,
) {
  return postJson<WorkspaceUser>("/admin/workspace/users", dto, options);
}

export async function updateWorkspaceUserRole(
  userId: string,
  dto: { role: AppRole },
  options?: ApiRequestOptions,
) {
  return patchJson<WorkspaceUser>(`/admin/workspace/users/${encodeURIComponent(userId)}/role`, dto, options);
}

export async function lockWorkspaceUser(
  userId: string,
  dto: { durationMinutes?: number; reason?: string },
  options?: ApiRequestOptions,
) {
  return postJson<WorkspaceUser>(`/admin/workspace/users/${encodeURIComponent(userId)}/lock`, dto, options);
}

export async function unlockWorkspaceUser(userId: string, options?: ApiRequestOptions) {
  return postJson<WorkspaceUser>(`/admin/workspace/users/${encodeURIComponent(userId)}/unlock`, {}, options);
}

export async function deactivateWorkspaceUser(userId: string, options?: ApiRequestOptions) {
  return postJson<WorkspaceUser>(`/admin/workspace/users/${encodeURIComponent(userId)}/deactivate`, {}, options);
}

export async function getAccessScopeAssignments(options?: ApiRequestOptions) {
  return fetchJson<AccessScopeAssignment[]>("/admin/workspace/access-scopes", undefined, options);
}

export async function createAccessScopeAssignment(
  dto: {
    subjectType: AccessScopeAssignmentSubjectType;
    subjectId: string;
    scopeType: AccessScopeAssignmentScopeType;
    categoryId?: string;
    connectorInstallationId?: string;
    scopeValue?: string;
    actions?: AccessScopeAssignmentAction[];
  },
  options?: ApiRequestOptions,
) {
  return postJson<AccessScopeAssignment>("/admin/workspace/access-scopes", dto, options);
}

export async function deleteAccessScopeAssignment(assignmentId: string, options?: ApiRequestOptions) {
  return fetchJson<{ id: string; deleted: true }>(
    `/admin/workspace/access-scopes/${encodeURIComponent(assignmentId)}`,
    { method: "DELETE" },
    options,
  );
}

export async function getApiAccessKeys(options?: ApiRequestOptions) {
  return fetchJson<ApiAccessKey[]>("/admin/api-keys", undefined, options);
}

export async function createApiAccessKey(
  dto: { label: string; role: AppRole; expiresAt?: string; scopes?: ApiClientScope[] },
  options?: ApiRequestOptions,
) {
  return postJson<CreatedApiAccessKey>("/admin/api-keys", dto, options);
}

export async function revokeApiAccessKey(keyId: string, options?: ApiRequestOptions) {
  return postJson<ApiAccessKey>(`/admin/api-keys/${encodeURIComponent(keyId)}/revoke`, {}, options);
}

export async function getOutboundWebhookEndpoints(options?: ApiRequestOptions) {
  return fetchJson<OutboundWebhookEndpoint[]>("/admin/webhooks", undefined, options);
}

export async function createOutboundWebhookEndpoint(
  dto: {
    name: string;
    eventType: OutboundWebhookEndpoint["eventType"];
    targetUrl: string;
    signingSecret: string;
    isActive?: boolean;
  },
  options?: ApiRequestOptions,
) {
  return postJson<OutboundWebhookEndpoint>("/admin/webhooks", dto, options);
}

export async function updateOutboundWebhookEndpoint(
  endpointId: string,
  dto: {
    name?: string;
    targetUrl?: string;
    signingSecret?: string;
    isActive?: boolean;
  },
  options?: ApiRequestOptions,
) {
  return patchJson<OutboundWebhookEndpoint>(`/admin/webhooks/${encodeURIComponent(endpointId)}`, dto, options);
}

export async function deleteOutboundWebhookEndpoint(endpointId: string, options?: ApiRequestOptions) {
  return fetchJson<{ id: string; deleted: true }>(
    `/admin/webhooks/${encodeURIComponent(endpointId)}`,
    { method: "DELETE" },
    options,
  );
}

export async function sendOutboundWebhookTest(endpointId: string, options?: ApiRequestOptions) {
  return postJson<OutboundWebhookDelivery>(`/admin/webhooks/${encodeURIComponent(endpointId)}/test`, {}, options);
}

export async function retryOutboundWebhookDelivery(deliveryId: string, options?: ApiRequestOptions) {
  return postJson<OutboundWebhookDelivery>(`/admin/webhooks/deliveries/${encodeURIComponent(deliveryId)}/retry`, {}, options);
}

export async function getOutboundWebhookDeliveries(
  input?: { endpointId?: string; status?: OutboundWebhookDelivery["status"]; limit?: number },
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  if (input?.endpointId) {
    params.set("endpointId", input.endpointId);
  }
  if (input?.status) {
    params.set("status", input.status);
  }
  if (typeof input?.limit === "number") {
    params.set("limit", String(input.limit));
  }
  const query = params.toString();
  return fetchJson<OutboundWebhookDelivery[]>(`/admin/webhooks/deliveries${query ? `?${query}` : ""}`, undefined, options);
}
