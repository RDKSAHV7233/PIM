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
  const controller = read("apps/api/src/internal-ops/internal-ops.controller.ts");
  const service = read("apps/api/src/internal-ops/internal-ops-summary.service.ts");
  const moduleSource = read("apps/api/src/internal-ops/internal-ops.module.ts");
  const appModule = read("apps/api/src/app.module.ts");
  const types = read("apps/api/src/internal-ops/internal-ops.types.ts");
  const observability = read("apps/api/src/error-authority/observability-db.service.ts");

  assert(
    moduleSource.includes("InternalOpsController") &&
      moduleSource.includes("InternalOpsSummaryService") &&
      appModule.includes("InternalOpsModule"),
    "Internal ops summary module must be registered with controller and service.",
  );

  assert(
    controller.includes("@DisallowApiClient()") &&
      controller.includes('@AuthenticatedReadRoute({ classification: "admin_only"') &&
      controller.includes('allowedRoles: ["system_admin", "super_admin"]') &&
      controller.includes("allowLegacyAdminFallback: false") &&
      controller.includes('@Roles("admin")') &&
      controller.includes('request.pimRole !== "admin"'),
    "Internal ops summary API must enforce human-only admin plus system/super boundary access at the API layer.",
  );

  assert(
    controller.includes('@Get("summary")') &&
      !controller.includes("@Post(") &&
      !controller.includes("@Patch(") &&
      !controller.includes("@Delete("),
    "Internal ops summary API must expose one read-only summary endpoint.",
  );

  assert(
    service.includes("OPERATIONAL_WINDOW_DAYS = 7") &&
      service.includes("INVENTORY_WINDOW_DAYS = 90") &&
      service.includes("STUCK_THRESHOLD_HOURS = 6") &&
      service.includes("QUERY_TIMEOUT_MS = 2_500") &&
      service.includes("{ timeout: QUERY_TIMEOUT_MS + 500 }") &&
      service.includes("updatedAt: { gte: operationalFrom") &&
      service.includes("createdAt: { gte: inventoryFrom"),
    "Internal ops summary queries must be bounded by windows and transaction timeout.",
  );

  for (const card of ["jobs", "imports", "publishing", "connectors", "errors", "mediaIntegrity"]) {
    assert(types.includes(`${card}: {`), `Internal ops summary response must include ${card} card.`);
  }

  for (const prohibited of [
    "payload: true",
    "exportPayload: true",
    "payloadSnapshot: true",
    "channelErrors: true",
    "sourceFileKey: true",
    "sourceName: true",
    "storagePath: true",
    "checksum: true",
    "externalAccountRef: true",
    "encryptedValue: true",
  ]) {
    assert(!service.includes(prohibited), `Internal ops summary must not select prohibited field ${prohibited}.`);
  }

  assert(
    observability.includes("countOpenP0P1Issues") &&
      observability.includes('severity: { in: ["p0", "p1"] }') &&
      observability.includes('state: "open"') &&
      observability.includes("withTimeout(") &&
      observability.includes("input.timeoutMs"),
    "Errors card must use a bounded open P0/P1 aggregate from observability storage.",
  );

  console.log(JSON.stringify({
    status: "ok",
    validated: [
      "module_registered",
      "api_authorization_admin_and_boundary",
      "api_read_only_summary_endpoint",
      "bounded_windows_and_timeout",
      "six_required_cards",
      "safe_field_allowlist",
      "p0_p1_error_badge_source",
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error("Internal ops summary contract failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
