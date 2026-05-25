#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const coreSource = read("apps/web/src/lib/api/core.ts");
  const sessionSource = read("apps/web/src/lib/server-session.ts");
  const capabilitiesSource = read("apps/web/src/lib/role-capabilities.ts");
  const adminNavigationSource = read("apps/web/src/lib/admin-navigation.ts");
  const sidebarSource = read("apps/web/src/components/nav/app-sidebar.tsx");
  const shellSource = read("apps/web/src/components/nav/authenticated-shell.tsx");
  const adminUsersSource = read("apps/web/src/app/admin/users/page.tsx");
  const apiKeysSource = read("apps/web/src/app/admin/api-keys/page.tsx");
  const connectorPermissionFormSource = read("apps/web/src/components/settings/connector-permission-form.tsx");

  // The shipped role surface expanded from 4 to 8 roles (admin, editor, publisher, approver,
  // channel_manager, connector_admin, reviewer, viewer). Verify all eight are declared in the
  // core type and the server-session allowlist.  Uses per-value includes() rather than an exact
  // multiline match to stay robust across different line-ending conventions.
  const EIGHT_ROLES = ["admin", "editor", "publisher", "approver", "channel_manager", "connector_admin", "reviewer", "viewer"];
  assert(
    coreSource.includes("export type AppRole =") &&
      EIGHT_ROLES.every((role) => coreSource.includes(`"${role}"`)) &&
      sessionSource.includes(
        'const APP_ROLES: readonly AppRole[] = ["admin", "editor", "publisher", "approver", "channel_manager", "connector_admin", "reviewer", "viewer"]',
      ),
    "Frontend role surface is the eight shipped web roles. No enterprise personas (product_admin, system_admin, category_manager, vendor) are first-class AppRole values.",
  );
  assert(
    !coreSource.includes("product_admin") &&
      !coreSource.includes("system_admin") &&
      !coreSource.includes("category_manager") &&
      !coreSource.includes("vendor"),
    "Unsupported enterprise persona names must not be silently accepted as first-class AppRole values.",
  );
  assert(
    // Write access stays bounded to admin + editor
    capabilitiesSource.includes('return role === "admin" || role === "editor";') &&
      // Approval decisions use the dedicated approver role
      capabilitiesSource.includes('return role === "admin" || role === "editor" || role === "approver";') &&
      // Channel management uses the dedicated channel_manager role
      capabilitiesSource.includes('"channel_manager"') &&
      // Connector management uses the dedicated connector_admin role
      capabilitiesSource.includes('"connector_admin"'),
    "Shared role capabilities must keep write access centralized to admin+editor and expose dedicated helper functions for each expanded role (approver, channel_manager, connector_admin).",
  );
  assert(
    adminNavigationSource.includes('audience === "editor_plus"') &&
      adminNavigationSource.includes('return role === "admin" || role === "editor";') &&
      adminNavigationSource.includes('return role === "admin";'),
    "Navigation visibility must distinguish editor-plus and admin-only surfaces.",
  );
  assert(
    sidebarSource.includes("canViewAdminNavigationItem(actorRole, item.visibility)") &&
      shellSource.includes('<AppSidebar actorRole={actorRole} showInternal={false} />') &&
      shellSource.includes('<AppSidebar actorRole={actorRole} showInternal={false} />'),
    "Authenticated shell must use role-filtered navigation and keep internal routes out of the customer shell.",
  );
  assert(
    adminUsersSource.includes("Pilot Role Alignment") &&
      adminUsersSource.includes("Product admin") &&
      adminUsersSource.includes("System admin") &&
      adminUsersSource.includes("Vendor") &&
      adminUsersSource.includes("Category manager") &&
      adminUsersSource.includes("API/client operations") &&
      adminUsersSource.includes("dedicated vendor, category-manager, and system-admin shells are released"),
    "Admin Users must explain how enterprise personas map to current web roles and future-scope gaps.",
  );
  assert(
    adminUsersSource.includes("Delegated Access Scopes") &&
      adminUsersSource.includes("category, brand, channel, and connector account") &&
      adminUsersSource.includes('name="subjectType"') &&
      adminUsersSource.includes('name="actions"'),
    "Admin Users must expose delegated scope review/assignment for scoped category, brand, channel, and connector access.",
  );
  assert(
    apiKeysSource.includes("Tenant-scoped machine credentials") &&
      apiKeysSource.includes('role === "admin"') &&
      apiKeysSource.includes("Admin role is required to create or revoke API keys."),
    "API/client operations UX must keep machine credentials admin-managed with a read-only fallback.",
  );
  assert(
    connectorPermissionFormSource.includes(
      'const ROLE_OPTIONS: readonly AppRole[] = ["admin", "editor", "publisher", "approver", "channel_manager", "connector_admin", "reviewer", "viewer"]',
    ) &&
      connectorPermissionFormSource.includes("Connector") &&
      connectorPermissionFormSource.includes("Role"),
    "Connector permission UI must expose all eight shipped AppRole values so operators can grant per-connector access to any role.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "frontend_role_surface_expanded_to_eight_shipped_roles",
          "unsupported_enterprise_personas_documented_not_silently_enabled",
          "role_capabilities_centralize_write_review_readonly_behavior",
          "navigation_hides_editor_plus_admin_and_internal_surfaces",
          "admin_users_explains_product_admin_system_admin_vendor_category_manager_api_client_handling",
          "delegated_scope_ui_exposes_category_brand_channel_connector_scope_review",
          "api_key_management_keeps_machine_principals_admin_managed",
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
  console.error("Role-aware frontend alignment UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
