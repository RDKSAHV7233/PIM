#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "users", "page.tsx");
const ACTIONS = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "users", "actions.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PAGE, "utf8");
  const actionsSource = fs.readFileSync(ACTIONS, "utf8");

  assert(
    source.includes("const authHeader = await getServerAuthHeader();") &&
      source.includes("const claims = await getServerSessionClaims();"),
    "Admin users must derive shared auth and session claims before loading workspace access data.",
  );
  assert(
    source.includes('const status = String(query.status ?? "").trim();') &&
      source.includes('const showInvite = String(query.showInvite ?? "").trim() === "true";') &&
      source.includes("const canManageUsers = Boolean(authHeader);"),
    "Admin users must normalize page status and invite query state while deriving write access from the shared authenticated session.",
  );
  assert(
    source.includes("const [usage, connectorPermissions, workspaceUsers] = await Promise.all([") &&
      source.includes("getBillingUsage({ authHeader })") &&
      source.includes("getConnectorPermissions(undefined, { authHeader })") &&
      source.includes("getWorkspaceUsers({ authHeader })"),
    "Admin users must load billing usage, connector overrides, and workspace users together through the shared authenticated API context.",
  );
  assert(
    source.includes("const byPrincipalType = connectorPermissions.reduce<Record<string, number>>") &&
      source.includes('label="User Limit"') &&
      source.includes('label="Connector Overrides"') &&
      source.includes('label="User Principals"') &&
      source.includes('helper={`Role principals: ${byPrincipalType.role ?? 0}`}'),
    "Admin users must derive top-line access metrics from live billing and connector permission data.",
  );
  assert(
    source.includes("<CardTitle>Workspace Access Management</CardTitle>") &&
      source.includes("Admin role is required to invite users, change roles, or change account access state.") &&
      source.includes("workspace users, the role matrix, and connector overrides below."),
    "Admin users must explain the read-only fallback clearly when the current role cannot manage workspace access.",
  );
  assert(
    source.includes('href={showInvite ? "/admin/users" : "/admin/users?showInvite=true"}') &&
      source.includes("form action={createWorkspaceUserAction}") &&
      source.includes('<option value="editor">Editor</option>') &&
      source.includes('<option value="reviewer">Reviewer</option>') &&
      source.includes('<option value="viewer">Viewer</option>'),
    "Admin users must keep invite entry points and allowed invite roles explicit at the page contract level.",
  );
  assert(
    source.includes('status === "user-created"') &&
      source.includes('status === "user-error"') &&
      source.includes('message={errorMessage || "Unable to update workspace user."}') &&
      source.includes('status === "role-updated"') &&
      source.includes('status === "user-locked"') &&
      source.includes('status === "user-unlocked"') &&
      source.includes('status === "user-deactivated"') &&
      source.includes('message="Workspace user role updated."') &&
      source.includes('message="Workspace user locked."') &&
      source.includes('message="Workspace user unlocked."') &&
      source.includes('message="Workspace user deactivated."'),
    "Admin users must surface invite, error, role change, lock, unlock, and deactivate outcomes through page-level status banners.",
  );
  assert(
    source.includes("const isSelf = user.userId === currentUserId;") &&
      source.includes("form action={updateWorkspaceUserRoleAction}") &&
      source.includes("form action={lockWorkspaceUserAction}") &&
      source.includes("form action={unlockWorkspaceUserAction}") &&
      source.includes("form action={deactivateWorkspaceUserAction}") &&
      source.includes("disabled={isSelf}") &&
      source.includes("disabled={isSelf || !user.isActive}") &&
      source.includes('<span className="text-xs text-slate-500">Read-only</span>'),
    "Admin users must enforce self-protection on role and lifecycle actions while preserving a read-only fallback for non-admin operators.",
  );
  assert(
    source.includes("<CardTitle>Role Matrix</CardTitle>") &&
      source.includes("<CardTitle>Connector Permission Overrides</CardTitle>") &&
      source.includes('No connector-specific overrides are configured.') &&
      source.includes('href="/admin/connectors"'),
    "Admin users must keep the role matrix and connector override visibility linked into connector access management.",
  );
  assert(
    source.includes('const errorMessage = String(query.message ?? "").trim();') &&
      source.includes('<input type="hidden" name="errorRedirectTo" value="/admin/users?showInvite=true" />') &&
      actionsSource.includes('redirectWithError(error instanceof Error ? error.message : "Unable to invite workspace user.", errorRedirectTo);') &&
      actionsSource.includes('redirectWithError(error instanceof Error ? error.message : "Unable to update workspace user.");'),
    "Admin users must keep invite errors inline and preserve the invite state instead of surfacing opaque server-action failures.",
  );
  assert(
    source.includes('redirect(buildLoginRedirect("/admin/users", error));'),
    "Admin users must redirect expired or forbidden sessions through the shared login helper.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "admin_users_route_uses_shared_auth_role_and_session_context",
          "admin_users_route_normalizes_status_and_invite_query_state",
          "admin_users_route_fetches_usage_permissions_and_users_in_parallel",
          "admin_users_route_derives_access_kpis_from_live_data",
          "admin_users_route_explains_read_only_access_honestly",
          "admin_users_route_keeps_invite_flow_and_roles_explicit",
          "admin_users_route_surfaces_user_lifecycle_status_banners",
          "admin_users_route_keeps_error_feedback_inline",
          "admin_users_route_enforces_self_protection_and_read_only_fallback",
          "admin_users_route_surfaces_role_matrix_and_connector_overrides",
          "admin_users_route_redirects_auth_failures",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

try {
  run();
} catch (error) {
  console.error("Admin users route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
