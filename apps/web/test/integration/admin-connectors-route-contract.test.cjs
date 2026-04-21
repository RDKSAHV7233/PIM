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
    source.includes("<PageHeader") &&
      source.includes("Create clear access policies for connector installs, reconnects, and disables, or review the current governance matrix if your role is read-only.") &&
      source.includes('<Link href="/dashboard" className="underline">') &&
      source.includes('<Link href="/admin" className="underline">') &&
      source.includes('<span className="font-semibold text-slate-700">Connector Access</span>'),
    "Admin connectors must use the shared page-header pattern and explain the read-only fallback honestly.",
  );
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
      source.includes('<CardTitle>Governance Visibility</CardTitle>') &&
      source.includes("Admin role is required to create or revoke connector access policies. You can still review the current governance matrix below.") &&
      source.includes('<span className="text-xs text-slate-500">Read-only</span>'),
    "Admin connectors must keep grant and revoke actions admin-only while preserving an honest read-only fallback for non-admin roles.",
  );
  assert(
    source.includes("Create clear access policies for connector installs, reconnects, and disables, or review the current governance matrix if your role is read-only.") &&
      source.includes("Create one access policy row per role or user.") &&
      source.includes('No connector access policies configured for this tenant.'),
    "Admin connectors must explain the connector action model and surface an honest empty state.",
  );
  assert(
    source.includes("formatPolicySubject(permission)") &&
      source.includes("formatPolicyScope(permission)") &&
      source.includes("formatPolicyAction(permission)") &&
      source.includes("{permission.createdBy || \"-\"}") &&
      source.includes("new Date(permission.updatedAt).toLocaleString()"),
    "Admin connectors must surface wildcard alias coverage plus audit-friendly creator and update metadata.",
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
          "admin_connectors_route_uses_shared_page_header",
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
