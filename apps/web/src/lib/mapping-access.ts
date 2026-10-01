// A signed-in user whose role cannot open the mapping wizard gets a 403 from the API. The page used to send every
// 401/403 to /login?reason=forbidden, and /login bounces a signed-in user straight to /dashboard, so the operator
// landed on the dashboard with no explanation (DEF-28). Only a 401 means "sign in again"; a 403 is a permission
// answer and belongs on the page. TENANT_SUSPENDED is the one 403 that still leaves the app. Import-free so tests
// can execute it.

export const MAPPING_ACCESS_ROLE_LABELS = ["Admin", "Editor", "Channel manager"] as const;
const MAPPING_ACCESS_ROLES = new Set(["admin", "editor", "channel_manager"]);

export type MappingLoadFailure = "sign_in" | "access_denied" | "other";

function errorCode(body: unknown): string {
  return body && typeof body === "object" ? String((body as { error?: unknown }).error ?? "").trim().toUpperCase() : "";
}

export function classifyMappingLoadFailure(error: unknown): MappingLoadFailure {
  if (!error || typeof error !== "object") {
    return "other";
  }
  const status = Number((error as { status?: unknown }).status ?? 0);
  if (status === 401) {
    return "sign_in";
  }
  if (status !== 403) {
    return "other";
  }
  // A suspended tenant is not a role problem; the login-redirect helper routes it to /account-suspended.
  return errorCode((error as { body?: unknown }).body) === "TENANT_SUSPENDED" ? "sign_in" : "access_denied";
}

export function describeMappingAccessDenied(role: string, body?: unknown): { title: string; body: string } {
  const roleKey = String(role ?? "").trim().toLowerCase();
  const roleLabel = roleKey.replace(/_/g, " ") || "current";
  if (MAPPING_ACCESS_ROLES.has(roleKey)) {
    // The role is one that may use mappings, so the refusal came from a narrower permission on some part of the
    // page (for example the review step's readiness check). Saying the role has no access would be wrong.
    const reason =
      body && typeof body === "object" && String((body as { reason?: unknown }).reason ?? "").trim()
        ? ` (${String((body as { reason?: unknown }).reason).trim()})`
        : "";
    return {
      title: "This mapping step needs a permission your account does not have",
      body: `You are signed in with the ${roleLabel} role, which can use channel mappings, but the server refused part of this page${reason}. Ask a workspace admin to check your permissions.`,
    };
  }
  return {
    title: "Your role cannot open channel mappings",
    body: `Channel mappings are available to the ${MAPPING_ACCESS_ROLE_LABELS.join(", ")} roles. You are signed in with the ${roleLabel} role. Ask a workspace admin if you need this access.`,
  };
}

// Shown on the review step when the readiness evaluations were refused for this role (see page.tsx). The versions
// list and the Validate / Publish actions still work; only the readiness checklist is unavailable.
export const READINESS_RESTRICTED_NOTICE = {
  title: "Readiness checks are not available for your role",
  body: "The server did not run the publish-readiness checks for your account, so the checklist below cannot confirm that this channel is ready. You can still validate and publish mapping versions. Product exports stay blocked until readiness passes, and a workspace admin can review it.",
} as const;
