import type { ApiAccessKey, ApiRequestOptions, AppRole, CreatedApiAccessKey, OutboundWebhookDelivery, OutboundWebhookEndpoint, WorkspaceUser } from "./core";
import { fetchJson, patchJson, postJson } from "./core";

export async function getWorkspaceUsers(options?: ApiRequestOptions) {
  return fetchJson<WorkspaceUser[]>("/admin/workspace/users", undefined, options);
}

export async function createWorkspaceUser(
  dto: { userId: string; role: AppRole },
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

export async function getApiAccessKeys(options?: ApiRequestOptions) {
  return fetchJson<ApiAccessKey[]>("/admin/api-keys", undefined, options);
}

export async function createApiAccessKey(
  dto: { label: string; role: AppRole; expiresAt?: string },
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
