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
  const page = read("apps/web/src/app/internal/ops/errors/page.tsx");
  const apiClient = read("apps/web/src/lib/api/error-authority-ops.ts");

  assert(
    page.includes("await getServerSession()") &&
      page.includes("isSystemAdminBoundary(adminBoundaryRoles)") &&
      page.includes('actorRole !== "admin"') &&
      page.includes("SystemAdminRequiredCard"),
    "Internal ops errors page must gate by verified server session, admin role, and system/super boundary role.",
  );

  assert(
    apiClient.includes("/error-authority/ops/issues") &&
      apiClient.includes("options?: ApiRequestOptions") &&
      page.includes("{ authHeader }") &&
      !apiClient.includes("ERROR_AUTHORITY_INGEST_TOKEN") &&
      !apiClient.includes("OBSERVABILITY_DATABASE_URL") &&
      !apiClient.includes("ERROR_AUTHORITY_REF_SECRET"),
    "Internal ops errors Web client must use server-authenticated API reads and no Error Authority secrets.",
  );

  assert(
    page.includes("listErrorAuthorityIssues") &&
      page.includes("listErrorAuthorityOccurrences") &&
      page.includes("runtime") &&
      page.includes("severity") &&
      page.includes("dateFrom") &&
      page.includes("dateTo"),
    "Internal ops errors page must render issue and occurrence reads with core filters.",
  );

  for (const mutation of ["@Post(", "postJson", "patchJson", "deleteJson", 'method: "POST"', 'method: "PATCH"', 'method: "DELETE"']) {
    assert(!apiClient.includes(mutation), `Internal ops errors MVP must not expose mutation capability: ${mutation}`);
  }

  const prohibitedUiFields = [
    "headers",
    "cookies",
    "requestBody",
    "rawBody",
    "queryString",
    "authorization",
    "password",
    "credential",
    "normalizedFrames",
  ];
  for (const field of prohibitedUiFields) {
    assert(!page.includes(field), `Internal ops errors UI must not render prohibited field ${field}.`);
  }

  assert(
    page.includes("safeTitle") &&
      page.includes("safeMessage") &&
      page.includes("safeTenantRef ?") &&
      !page.includes("rawTenant"),
    "Internal ops errors UI must render only safe titles/messages and hashed tenant impact indicators.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "ui_server_session_gate",
          "ui_server_authenticated_api_client",
          "ui_core_filters",
          "ui_read_only",
          "ui_no_prohibited_fields",
          "ui_safe_tenant_exposure",
        ],
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("Internal ops errors UI contract failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
