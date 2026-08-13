#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const REPO_ROOT = path.resolve(__dirname, "../../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

async function main() {
  const controller = read("apps/api/src/error-authority/error-authority-ops.controller.ts");
  const service = read("apps/api/src/error-authority/error-authority-ops.service.ts");
  const store = read("apps/api/src/error-authority/observability-db.service.ts");
  const moduleSource = read("apps/api/src/error-authority/error-authority.module.ts");
  const observabilitySchema = read("packages/observability-db/prisma/schema.prisma");
  const opsIndexMigration = read(
    "packages/observability-db/prisma/migrations/20260813000000_error_authority_ops_indexes/migration.sql",
  );

  assert(
    moduleSource.includes("ErrorAuthorityOpsController") &&
      moduleSource.includes("ErrorAuthorityOpsService"),
    "ErrorAuthorityModule must register the read-only ops controller and service.",
  );

  assert(
    controller.includes("@DisallowApiClient()") &&
      controller.includes('@AuthenticatedReadRoute({ classification: "admin_only"') &&
      controller.includes('allowedRoles: ["system_admin", "super_admin"]') &&
      controller.includes("allowLegacyAdminFallback: false") &&
      controller.includes('@Roles("admin")') &&
      controller.includes('request.pimRole !== "admin"'),
    "Error Authority ops API must enforce human-only admin plus system/super boundary access at the API layer.",
  );

  assert(
    controller.includes('@Get("issues")') &&
      controller.includes('@Get("issues/:issueId/occurrences")') &&
      !controller.includes("@Post(") &&
      !controller.includes("@Patch(") &&
      !controller.includes("@Delete("),
    "Error Authority ops API must be read-only in the MVP.",
  );

  assert(
    service.includes("MAX_WINDOW_DAYS = 31") &&
      service.includes("MAX_LIMIT = 100") &&
      service.includes("decodeCursor") &&
      service.includes("encodeCursor"),
    "Error Authority ops reads must enforce bounded windows, bounded limits, and cursor pagination.",
  );

  assert(
    store.includes('orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }]') &&
      store.includes('orderBy: [{ occurredAt: "desc" }, { id: "desc" }]'),
    "Error Authority ops reads must use deterministic ordering with a stable tie-breaker.",
  );

  for (const indexName of [
    "idx_error_issues_ops_filters",
    "idx_error_issues_ops_release",
    "idx_error_issues_ops_error_code",
    "idx_error_occurrences_ops_route",
    "idx_error_occurrences_ops_release",
    "idx_error_occurrences_ops_error_code",
  ]) {
    assert(observabilitySchema.includes(indexName), `Observability schema must declare ${indexName}.`);
    assert(opsIndexMigration.includes(`"${indexName}"`), `Observability migration must create ${indexName}.`);
  }

  const prohibitedApiFields = [
    "headers",
    "cookies",
    "requestBody",
    "rawBody",
    "queryString",
    "authorization",
    "password",
    "credential",
  ];
  for (const field of prohibitedApiFields) {
    assert(!store.includes(`${field}: true`), `Ops API response must not select prohibited field ${field}.`);
  }

  assert(
    store.includes("affectedTenantCount") &&
      store.includes("safeTenantRef") &&
      !store.includes("rawTenantKey"),
    "Ops API may expose aggregate tenant impact and hashed tenant refs only, never raw tenant identifiers.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "ops_controller_registered",
          "api_authorization_admin_and_boundary",
          "api_read_only",
          "bounded_query_limits",
          "cursor_ordering_stable",
          "observability_filter_indexes",
          "api_allowlisted_safe_fields",
          "tenant_exposure_control",
        ],
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("Error Authority ops read contract failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
