import type { ApiRequestOptions, NotificationListResponse, StepUpResponse } from "./core";
import { fetchJson, patchJson, postJson } from "./core";

export interface MfaStatus {
  enrollmentStatus: "active" | "pending_enrollment";
  secretPreview: string | null;
  lastUsedAt: string | null;
  backupCodesRemaining: number;
}

export interface RegenerateMfaBackupCodesResult {
  backupCodes: string[];
}

export async function getNotifications(
  input?: { limit?: number; cursor?: string | null },
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  if (typeof input?.limit === "number" && Number.isFinite(input.limit)) {
    params.set("limit", String(Math.max(1, Math.floor(input.limit))));
  }
  if (input?.cursor) {
    params.set("cursor", input.cursor);
    params.set("pagination", "cursor");
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return fetchJson<NotificationListResponse>(`/notifications${query}`, undefined, options);
}

export async function markNotificationRead(notificationId: string, options?: ApiRequestOptions) {
  return patchJson<{ id: string; read: true }>(`/notifications/${encodeURIComponent(notificationId)}/read`, {}, options);
}

export async function markAllNotificationsRead(options?: ApiRequestOptions) {
  return patchJson<{ updated: number }>("/notifications/read-all", {}, options);
}

export async function issueStepUp(
  body: { password: string; scope: string },
  options?: ApiRequestOptions,
) {
  return postJson<StepUpResponse>("/auth/step-up", body, options);
}

export async function getMfaStatus(options?: ApiRequestOptions) {
  return fetchJson<MfaStatus>("/auth/mfa", undefined, options);
}

export async function regenerateMfaBackupCodes(
  body: { code: string },
  options?: ApiRequestOptions,
) {
  return postJson<RegenerateMfaBackupCodesResult>("/auth/mfa/backup-codes/regenerate", body, options);
}
