#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "users", "page.tsx");
const ACTIONS = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "users", "actions.ts");
const CONTENT = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "admin",
  "users",
  "_components",
  "admin-users-page-content.tsx",
);
const ACCESS_SCOPE_FORM = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "admin",
  "users",
  "_components",
  "access-scope-form.tsx",
);
const USER_SEARCH_FILTER = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "admin",
  "users",
  "_components",
  "user-search-filter.tsx",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PAGE, "utf8");
  const actionsSource = fs.readFileSync(ACTIONS, "utf8");
  const accessScopeFormSource = fs.readFileSync(ACCESS_SCOPE_FORM, "utf8");
  const userSearchFilterSource = fs.readFileSync(USER_SEARCH_FILTER, "utf8");
  const contentSource = fs.readFileSync(CONTENT, "utf8");

  // Auth setup lives in the server component (page.tsx)
  assert(
      source.includes("await getServerSession();") &&
      source.includes("const claims = await getServerSessionClaims();"),
    "Admin users must derive shared auth, actor role, and session claims before loading workspace access data.",
  );
  // Status/invite normalization is in the client content component; write-access gate is in page.tsx
  assert(
    contentSource.includes('const status = String(query.status ?? "").trim();') &&
      contentSource.includes('const showInvite = String(query.showInvite ?? "").trim() === "true";') &&
      source.includes('const canManageUsers = actorRole === "admin";'),
    "Admin users must normalize page status and invite query state while deriving write access from shared role capabilities.",
  );
  // Parallel data fetch is in the server component
  assert(
    source.includes("await Promise.all([") &&
      source.includes("getBillingUsage({ role: actorRole, authHeader })") &&
      source.includes("getConnectorPermissions(undefined, { role: actorRole, authHeader })") &&
      source.includes("getWorkspaceUsers({ role: actorRole, authHeader })") &&
      source.includes("getAccessScopeAssignments({ role: actorRole, authHeader })") &&
      source.includes("getRoleCapabilities({ role: actorRole, authHeader })"),
    "Admin users must load billing usage, connector overrides, workspace users, delegated scope assignments, and role capabilities through the shared auth context.",
  );
  // byPrincipalType reduction is in page.tsx; KPI rendering is in the content component
  assert(
    source.includes("const byPrincipalType = connectorPermissions.reduce<Record<string, number>>") &&
      contentSource.includes('label="User Limit"') &&
      contentSource.includes('label="Connector Overrides"') &&
      contentSource.includes('label="User Principals"') &&
      contentSource.includes('helper={`Role principals: ${byPrincipalType.role ?? 0}`}') &&
      contentSource.includes('label="Delegated Scopes"') &&
      contentSource.includes("value={accessScopeAssignments.length}"),
    "Admin users must derive top-line access metrics from live billing, connector permission, and delegated scope data.",
  );
  assert(
    contentSource.includes("Access Review Checklist") &&
      contentSource.includes("Confirm ownership") &&
      contentSource.includes("Constrain exceptions") &&
      contentSource.includes("Retire stale access") &&
      contentSource.includes("Run this review before major catalog launches, connector cutovers, or buyer-facing governance walkthroughs."),
    "Admin users must guide admins through a repeatable access review workflow, not just expose raw user and scope controls.",
  );
  assert(
    contentSource.includes("<CardTitle>Workspace Access Management</CardTitle>") &&
      contentSource.includes("Admin role is required to invite users, change roles, or change account access state.") &&
      contentSource.includes("workspace users, the role matrix, and connector overrides below."),
    "Admin users must explain the read-only fallback clearly when the current role cannot manage workspace access.",
  );
  assert(
    contentSource.includes('href={showInvite ? "/admin/users" : "/admin/users?showInvite=true"}') &&
      contentSource.includes("form action={createWorkspaceUserAction}") &&
      contentSource.includes("capabilities.availableRoles.map(") &&
      contentSource.includes("describeRole(role)"),
    "Admin users must render invite role options dynamically from the tenant's plan-gated availableRoles.",
  );
  assert(
    actionsSource.includes("ROLE_NOT_AVAILABLE_IN_PLAN") &&
      actionsSource.includes('normalizeAppRole(formData.get("role"))') &&
      actionsSource.includes("role === null"),
    "Admin users actions must surface ROLE_NOT_AVAILABLE_IN_PLAN and fail closed when normalizeAppRole returns null.",
  );
  assert(
    contentSource.includes('status === "user-created"') &&
      contentSource.includes('status === "user-error"') &&
      contentSource.includes('message={errorMessage || "Unable to update workspace user."}') &&
      contentSource.includes('status === "role-updated"') &&
      contentSource.includes('status === "user-locked"') &&
      contentSource.includes('status === "user-unlocked"') &&
      contentSource.includes('status === "user-deactivated"') &&
      contentSource.includes('status === "scope-created"') &&
      contentSource.includes('status === "scope-deleted"') &&
      contentSource.includes('message="Workspace user role updated."') &&
      contentSource.includes('message="Workspace user locked."') &&
      contentSource.includes('message="Workspace user unlocked."') &&
      contentSource.includes('message="Workspace user deactivated."') &&
      contentSource.includes('message="Delegated access scope assigned."') &&
      contentSource.includes('message="Delegated access scope removed."'),
    "Admin users must surface user lifecycle and delegated-scope outcomes through page-level status banners.",
  );
  // Self-protection and lifecycle actions are defined in the content component's column renderers
  assert(
    contentSource.includes("const isSelf = user.userId === currentUserId;") &&
      contentSource.includes("form action={updateWorkspaceUserRoleAction}") &&
      contentSource.includes("form action={lockWorkspaceUserAction}") &&
      contentSource.includes("form action={unlockWorkspaceUserAction}") &&
      contentSource.includes("form action={deactivateWorkspaceUserAction}") &&
      contentSource.includes("disabled={isSelf}") &&
      contentSource.includes("disabled={isSelf || !user.isActive}") &&
      contentSource.includes('<span className="text-xs text-slate-500">Read-only</span>'),
    "User search filter must enforce self-protection on role and lifecycle actions while preserving a read-only fallback for non-admin operators.",
  );
  assert(
    contentSource.includes("<CardTitle>Delegated Access Scopes</CardTitle>") &&
      contentSource.includes("Admin-only delegated scope assignments constrain non-admin access by category, brand, channel, and connector account.") &&
      accessScopeFormSource.includes("form action={createAccessScopeAssignmentAction}") &&
      accessScopeFormSource.includes('name="subjectType"') &&
      accessScopeFormSource.includes('name="subjectId"') &&
      accessScopeFormSource.includes('name="scopeType"') &&
      accessScopeFormSource.includes('field: "categoryId"') &&
      accessScopeFormSource.includes('field: "scopeValue"') &&
      accessScopeFormSource.includes('field: "connectorInstallationId"') &&
      accessScopeFormSource.includes("name={active.field}") &&
      accessScopeFormSource.includes('name="actions"') &&
      contentSource.includes("form action={deleteAccessScopeAssignmentAction}"),
    "Admin users must keep delegated scope assignment management in the admin-only users workspace.",
  );
  assert(
    contentSource.includes("<CardTitle>Role Matrix</CardTitle>") &&
      contentSource.includes("<CardTitle>Connector Permission Overrides</CardTitle>") &&
      contentSource.includes('No connector-specific overrides are configured.') &&
      contentSource.includes('href="/admin/connectors"'),
    "Admin users must keep the role matrix and connector override visibility linked into connector access management.",
  );
  assert(
    contentSource.includes('const errorMessage = String(query.message ?? "").trim();') &&
      contentSource.includes('<input type="hidden" name="errorRedirectTo" value="/admin/users?showInvite=true" />') &&
      actionsSource.includes("createAccessScopeAssignmentAction") &&
      actionsSource.includes("deleteAccessScopeAssignmentAction") &&
      actionsSource.includes("await getServerSession();") &&
      actionsSource.includes('if (actorRole !== "admin") {') &&
      actionsSource.includes('"Unable to invite workspace user."') &&
      actionsSource.includes("errorRedirectTo") &&
      actionsSource.includes('"Unable to update workspace user."') &&
      actionsSource.includes('redirectWithError(error instanceof Error ? error.message : "Unable to create scope assignment.");') &&
      actionsSource.includes('redirectWithError(error instanceof Error ? error.message : "Unable to delete scope assignment.");'),
    "Admin users must keep invite and delegated-scope errors inline while enforcing admin role checks in server actions.",
  );
  assert(
    source.includes('redirect(buildLoginRedirect("/admin/users", error));'),
    "Admin users must redirect expired or forbidden sessions through the shared login helper.",
  );

  // userSearchFilterSource kept for backwards-compat path — search/filter UI lives there
  void userSearchFilterSource;

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "admin_users_route_uses_shared_auth_role_and_session_context",
          "admin_users_route_normalizes_status_and_invite_query_state",
          "admin_users_route_fetches_usage_permissions_and_users_in_parallel",
          "admin_users_route_derives_access_kpis_from_live_data",
          "admin_users_route_guides_access_review_workflow",
          "admin_users_route_explains_read_only_access_honestly",
          "admin_users_route_keeps_invite_flow_and_roles_explicit",
          "admin_users_route_surfaces_user_lifecycle_status_banners",
          "admin_users_route_surfaces_delegated_access_scope_management",
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
