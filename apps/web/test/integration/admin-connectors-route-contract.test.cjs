#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "connectors", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PAGE, "utf8");

  assert(
    source.includes("const role = await getServerActorRole();") &&
      source.includes("const authHeader = await getServerAuthHeader();"),
    "Admin connectors must derive shared server auth/session context before loading connector access data.",
  );
  assert(
    source.includes('const status = String(query.status ?? "").trim();'),
    "Admin connectors must normalize page-level status query state before rendering banners.",
  );
  assert(
    source.includes("const [definitions, permissions] = await Promise.all([") &&
      source.includes("getConnectorDefinitions({ role, authHeader })") &&
      source.includes("getConnectorPermissions(undefined, { role, authHeader })"),
    "Admin connectors must load connector definitions and current permissions together through the shared auth context.",
  );
  assert(
    source.includes('status === "permission-granted"') &&
      source.includes('status === "permission-revoked"') &&
      source.includes('status === "permission-invalid-role"') &&
      source.includes('status === "permission-user-not-found"') &&
      source.includes('status === "permission-user-required"') &&
      source.includes('status === "permission-invalid-request"'),
    "Admin connectors must surface grant, revoke, and validation failures through the page-level status banner contract.",
  );
  assert(
    source.includes('role === "admin" ? (') &&
      source.includes("<ConnectorPermissionForm definitions={definitions} grantAction={grantConnectorPermissionAction} />") &&
      source.includes("form action={revokeConnectorPermissionAction}") &&
      source.includes('<CardTitle>Connector Permission Management</CardTitle>') &&
      source.includes("Admin role is required to grant or revoke connector permissions.") &&
      source.includes('<span className="text-xs text-slate-500">Read-only</span>'),
    "Admin connectors must keep grant and revoke actions admin-only while preserving an honest read-only fallback for non-admin roles.",
  );
  assert(
    source.includes("Define who can install, reconnect, or disable each connector account without exposing raw permission internals.") &&
      source.includes("Policy coverage") &&
      source.includes("Permission Builder") &&
      source.includes("Current Policies") &&
      source.includes("Create one permission row per role or user.") &&
      source.includes('No connector permissions configured for this tenant.'),
    "Admin connectors must explain the policy-builder model and surface an honest empty state.",
  );
  assert(
    source.includes('{permission.accountAlias === "*" ? "All aliases" : permission.accountAlias}') &&
      source.includes("{permission.createdBy || \"-\"}") &&
      source.includes("new Date(permission.updatedAt).toLocaleString()") &&
      source.includes("describeConnectorPermission(permission)"),
    "Admin connectors must surface readable policy summaries plus audit-friendly creator and update metadata.",
  );
  assert(
    source.includes('redirect(buildLoginRedirect("/admin/connectors", error));'),
    "Admin connectors must redirect expired or forbidden sessions through the shared login helper.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "admin_connectors_route_uses_shared_server_auth_context",
          "admin_connectors_route_normalizes_status_query_state",
          "admin_connectors_route_fetches_definitions_and_permissions_in_parallel",
          "admin_connectors_route_surfaces_status_and_validation_banners",
          "admin_connectors_route_keeps_grant_and_revoke_admin_only",
          "admin_connectors_route_explains_connector_permission_model_and_empty_state",
          "admin_connectors_route_surfaces_alias_and_audit_metadata",
          "admin_connectors_route_redirects_auth_failures",
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
  console.error("Admin connectors route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
