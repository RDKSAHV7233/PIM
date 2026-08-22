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
  const page = read("apps/web/src/app/internal/ops/page.tsx");
  const apiClient = read("apps/web/src/lib/api/internal-ops.ts");

  assert(
    page.includes("await getServerSession()") &&
      page.includes("isSystemAdminBoundary(adminBoundaryRoles)") &&
      page.includes('actorRole !== "admin"') &&
      page.includes("SystemAdminRequiredCard") &&
      page.includes("buildLoginRedirect(PAGE_PATH"),
    "Internal ops summary page must gate by verified server session, admin role, and system/super boundary role.",
  );

  assert(
    apiClient.includes('"/internal/ops/summary"') &&
      apiClient.includes("options?: ApiRequestOptions") &&
      page.includes("getInternalOpsSummary({ authHeader })"),
    "Internal ops summary Web client must use the server-authenticated API endpoint.",
  );

  for (const card of ["Jobs", "Imports", "Publishing", "Connectors", "Errors", "Media Integrity"]) {
    assert(page.includes(`label="${card}"`) || page.includes(`title="${card}"`), `Internal ops page must render ${card} card.`);
  }

  assert(
    page.includes("summary.jobs.availability") &&
      page.includes("summary.imports.availability") &&
      page.includes("summary.publishing.availability") &&
      page.includes("summary.connectors.availability") &&
      page.includes("summary.errors.availability") &&
      page.includes("summary.mediaIntegrity.availability") &&
      page.includes("Unavailable"),
    "Internal ops page must render dependency failure state without crashing the whole page.",
  );

  assert(
    page.includes("No connector installations in the current inventory window.") &&
      page.includes("No recent installations"),
    "Internal ops page must render empty states for zero-count summaries.",
  );

  for (const mutation of ["postJson", "patchJson", "deleteJson", 'method: "POST"', 'method: "PATCH"', 'method: "DELETE"']) {
    assert(!apiClient.includes(mutation), `Internal ops summary MVP must not expose mutation capability: ${mutation}`);
  }

  const prohibitedUiFields = [
    "payload",
    "exportPayload",
    "payloadSnapshot",
    "channelErrors",
    "sourceFileKey",
    "sourceName",
    "storagePath",
    "checksum",
    "externalAccountRef",
    "encryptedValue",
    "rawTenant",
  ];
  for (const field of prohibitedUiFields) {
    assert(!page.includes(field), `Internal ops summary UI must not render prohibited field ${field}.`);
  }

  console.log(JSON.stringify({
    status: "ok",
    validated: [
      "ui_server_session_gate",
      "ui_server_authenticated_api_client",
      "six_cards_rendered",
      "ui_failure_state",
      "ui_empty_state",
      "ui_read_only",
      "ui_no_prohibited_fields",
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error("Internal ops summary UI contract failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
