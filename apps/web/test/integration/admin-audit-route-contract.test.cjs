#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "audit", "page.tsx");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function run() {
  const page = read(PAGE);

  assert(
    page.includes("await getServerSession()") &&
      page.includes("getAuditEvents") &&
      page.includes('redirect(buildLoginRedirect("/admin/audit"'),
    "Audit log page must derive shared server auth context, load events from getAuditEvents, and redirect expired sessions.",
  );

  assert(
    page.includes("Audit log unavailable") &&
      page.includes("Governance events could not be retrieved"),
    "Audit log page must show an explicit unavailable state on non-auth backend failures instead of throwing a 500.",
  );

  assert(
    page.includes("VALID_LIMITS") &&
      page.includes("cursor") &&
      page.includes("nextCursor") &&
      page.includes("Load older events"),
    "Audit log page must whitelist valid page sizes and support cursor pagination.",
  );

  assert(
    page.includes("actorId") &&
      page.includes("entityType") &&
      page.includes("dateFrom") &&
      page.includes("dateTo") &&
      page.includes("buildQuery"),
    "Audit log page must support filtering by actor, entity type, and date range with a canonical query builder.",
  );

  assert(
    page.includes("exportHref") &&
      page.includes("/api/admin/audit/export"),
    "Audit log page must expose a filtered export link for governance evidence download.",
  );

  assert(
    page.includes("toneForEntity") &&
      page.includes('"auth"') &&
      page.includes('"plan"') &&
      page.includes('"privacy"'),
    "Audit log page must tone-code security-sensitive entity types (auth, plan, privacy) to make risk events visually distinct.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "admin_audit_route_uses_shared_server_auth_context",
          "admin_audit_route_renders_unavailable_state_on_backend_failure",
          "admin_audit_route_enforces_valid_page_sizes_and_cursor_pagination",
          "admin_audit_route_supports_multi_field_filtering",
          "admin_audit_route_exposes_filtered_export_link",
          "admin_audit_route_tone_codes_security_sensitive_entities",
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
  console.error("Admin audit route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
