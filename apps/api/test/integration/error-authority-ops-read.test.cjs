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
      !controller.includes("@Patch(") &&
      !controller.includes("@Delete("),
    "Error Authority ops API's read routes must remain GET-only; no PATCH/DELETE mutation surface.",
  );

  // PIM#766 Part 1 (PO-approved Option C: manual resolve + auto-resolve sweep):
  // the ops API is no longer read-only in the strict MVP sense — it gains exactly
  // one bounded mutation (resolve), decorated identically to the read routes above
  // (class-level @DisallowApiClient/@AuthenticatedReadRoute/@AdminBoundaryAccess
  // already asserted above, plus its own @Roles("admin") + the same
  // assertAdminAppRole request-role check) and @HttpCode(200) since it's an
  // idempotent state transition, not a resource-creation POST.
  assert(
    controller.includes('@Post("issues/:issueId/resolve")') &&
      controller.includes("@HttpCode(200)") &&
      controller.includes("resolveIssue(") &&
      controller.includes("ERROR_ISSUE_RESOLVED"),
    "Error Authority ops API must expose exactly the PIM#766 manual-resolve mutation, decorated like the " +
      "read routes and recording an explicit ERROR_ISSUE_RESOLVED audit entry.",
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
          "api_read_routes_get_only",
          "api_resolve_mutation_present",
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
