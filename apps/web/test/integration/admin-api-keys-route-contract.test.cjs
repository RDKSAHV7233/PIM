#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "api-keys", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PAGE, "utf8");

  assert(
    source.includes("const { authHeader, actorRole: role } = await getServerSession();"),
    "Admin API keys must derive shared server auth/session context before loading data.",
  );
  assert(
    source.includes("const keys = await getApiAccessKeys({ role, authHeader });"),
    "Admin API keys must fetch tenant-scoped API keys through the shared API client and auth context.",
  );
  assert(
    source.includes('status === "api-key-revoked"') &&
      source.includes('message="API key revoked."'),
    "Admin API keys must surface revoke success through the page-level status banner contract.",
  );
  assert(
    source.includes('role === "admin" ? (') &&
      source.includes("<ApiKeyCreatePanel />") &&
      source.includes("<CardTitle>API Key Management</CardTitle>") &&
      source.includes("Admin role is required to create or revoke API keys. You can still review the issued machine credentials below.") &&
      source.includes("form action={revokeApiAccessKeyAction}") &&
      source.includes('name="keyId" value={key.id}'),
    "Admin API keys must keep creation and revocation actions admin-only while explaining the read-only fallback at the page contract level.",
  );
  assert(
    source.includes("function resolveStatus(key: ApiAccessKey)") &&
      source.includes("if (key.revokedAt) {") &&
      source.includes("if (!key.isActive && key.expiresAt) {") &&
      source.includes('return { label: "active", tone: "success" as const };'),
    "Admin API keys must derive active, expired, and revoked states from live API key fields.",
  );
  assert(
    source.includes('No API keys issued for this tenant yet.') &&
      source.includes('Created by {key.createdBy || "system"}') &&
      source.includes("formatTimestamp(key.lastUsedAt)") &&
      source.includes("formatTimestamp(key.expiresAt)"),
    "Admin API keys must surface honest empty state and audit-friendly creation/usage timestamps.",
  );
  assert(
    source.includes('{key.revokedAt ? "Revoked" : "Read-only"}') &&
      source.includes('href="/admin/webhooks"'),
    "Admin API keys must show read-only/revoked fallback actions and link operators into the webhook surface.",
  );
  assert(
    source.includes("Machine credential lifecycle") &&
      source.includes("Scope access tightly") &&
      source.includes("Track usage and expiry") &&
      source.includes("Revoke deliberately") &&
      source.includes("Pair API keys with webhook monitoring so machine access and outbound delivery behavior stay auditable together."),
    "Admin API keys must guide operators through a safe machine-credential lifecycle, not just expose raw key rows.",
  );
  assert(
    source.includes('redirect(buildLoginRedirect("/admin/api-keys", error));'),
    "Admin API keys must redirect expired or forbidden sessions through the shared login helper.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "admin_api_keys_route_uses_shared_server_auth_context",
          "admin_api_keys_route_fetches_tenant_scoped_keys",
          "admin_api_keys_route_surfaces_revoke_status_banner",
          "admin_api_keys_route_keeps_mutations_admin_only",
          "admin_api_keys_route_derives_key_status_from_live_fields",
          "admin_api_keys_route_surfaces_empty_state_and_timestamps",
          "admin_api_keys_route_shows_read_only_fallbacks_and_links_webhooks",
          "admin_api_keys_route_guides_machine_credential_lifecycle",
          "admin_api_keys_route_redirects_auth_failures",
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
  console.error("Admin API keys route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
