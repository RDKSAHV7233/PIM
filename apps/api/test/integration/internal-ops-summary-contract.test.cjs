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
  const constants = read("apps/api/src/internal-ops/internal-ops.constants.ts");
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
      constants.includes("INTERNAL_OPS_STUCK_THRESHOLD_HOURS = 6") &&
      service.includes("QUERY_TIMEOUT_MS = 2_500") &&
      service.includes("{ timeout: QUERY_TIMEOUT_MS + 500 }") &&
      service.includes("updatedAt: { gte: operationalFrom") &&
      service.includes("createdAt: { gte: inventoryFrom"),
    "Internal ops summary queries must be bounded by windows and transaction timeout.",
  );

  for (const card of ["jobs", "imports", "publishing", "connectors", "readiness", "errors", "mediaIntegrity"]) {
    assert(types.includes(`${card}: {`), `Internal ops summary response must include ${card} card.`);
  }

  assert(
    types.includes('InternalOpsAggregateAvailability = InternalOpsCardAvailability | "partial"') &&
      types.includes("InternalOpsReadinessMetric = number | null") &&
      types.includes('availability: InternalOpsAggregateAvailability') &&
      types.includes('productData: {') &&
      types.includes('mapping: {') &&
      types.includes('connector: {'),
    "Readiness health must expose top-level partial availability plus source-level availability.",
  );

  assert(
    service.includes("getReadinessProductData") &&
      service.includes("getReadinessMapping") &&
      service.includes("getReadinessConnector") &&
      service.includes("resolveReadinessSource") &&
      service.includes("resolveAggregateAvailability"),
    "Readiness health must isolate product-data, mapping, and connector persisted sources independently.",
  );

  assert(
    service.includes("countReadinessBlockedProducts") &&
      service.includes('COUNT(DISTINCT "productId")') &&
      service.includes("blockingIssues: Number(blockingIssues") &&
      service.includes("warningIssues: Number(warningIssues"),
    "Product-data readiness aggregates must preserve DB distinct product count versus issue row counts.",
  );

  assert(
    service.includes('COUNT(DISTINCT "tenantKey")') &&
      service.includes("COUNT(DISTINCT tenant_key)") &&
      !service.includes('distinct: ["tenantKey"]') &&
      !service.includes("select: { tenantKey: true }"),
    "Readiness affected-tenant metrics must use database distinct counts without returning tenant keys.",
  );

  assert(
    service.includes("blockedProducts: null") &&
      service.includes("blockingMappings: null") &&
      service.includes("blockingInstallations: null") &&
      service.includes("byStatus: null"),
    "Unavailable readiness sources must return nullable metrics instead of zero/healthy fallbacks.",
  );

  assert(
    service.includes("CUSTOM_RULE") &&
      service.includes("ATTR_REQUIRED_*") &&
      service.includes("ATTR_TYPE_*") &&
      service.includes("ATTR_ALLOWED_*") &&
      service.includes("SAFE_PLATFORM_RULE_CODES"),
    "Readiness health must normalize custom and dynamic ValidationIssue rule codes before returning them.",
  );

  assert(
    service.includes("CONNECTOR_STATUS_IMPACT") &&
      service.includes('ACTIVE: "STATUS"') &&
      service.includes('PAUSED: "WARNING"') &&
      service.includes('CREDENTIAL_EXPIRED: "BLOCKER"') &&
      service.includes('DISABLED: "STATUS"'),
    "Connector readiness must classify every approved installation status explicitly.",
  );

  assert(
    service.includes("compatibilityBlocked") &&
      service.includes("remapRequired") &&
      service.includes("fallbackAckRequired") &&
      service.includes("deprecated") &&
      service.includes("blockingMappings: Number(blockingMappings"),
    "Mapping readiness must expose overlapping signal counts separately from distinct mapping totals.",
  );

  assert(
    !types.includes("readyProducts") &&
      !types.includes("globalBlockedProducts") &&
      !service.includes("DashboardSnapshot") &&
      !service.includes("dashboardSnapshot") &&
      !service.includes("getBatchReadiness") &&
      !service.includes("simulateProduct") &&
      !service.includes("mappingRules: true"),
    "Readiness health must not claim global current readiness or use disallowed proxy/evaluation sources.",
  );

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
      "readiness_backend_contract",
      "seven_required_cards",
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
