import type { ApiRequestOptions, NotificationListResponse, StepUpResponse } from "./core";
import { fetchJson, patchJson, postJson } from "./core";

// OIDC config management (UpsertOidcConfigInput, getOidcConfig, upsertOidcConfig,
// deleteOidcConfig) is exported from admin.ts to keep admin-only functions grouped
// with the rest of the admin API surface. Import from @/lib/api as usual.

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
  // F-009: pagination=cursor must always be sent, not just when a cursor value is
  // already present — the API's non-cursor fallback hardcodes nextCursor: null
  // regardless of how many notifications actually exist, which meant callers could
  // never advance past their first page on the very first request (no cursor exists
  // yet then). Cursor mode with no cursor value still correctly returns page 1 with a
  // real computed nextCursor, so there's no downside to requesting it unconditionally.
  const params = new URLSearchParams({ pagination: "cursor" });
  if (typeof input?.limit === "number" && Number.isFinite(input.limit)) {
    params.set("limit", String(Math.max(1, Math.floor(input.limit))));
  }
  if (input?.cursor) {
    params.set("cursor", input.cursor);
  }
  const query = `?${params.toString()}`;
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
