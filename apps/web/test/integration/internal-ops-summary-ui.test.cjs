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

  for (const card of ["Jobs", "Imports", "Publishing", "Connectors", "Readiness Health", "Errors", "Media Integrity"]) {
    assert(page.includes(`label="${card}"`) || page.includes(`title="${card}"`), `Internal ops page must render ${card} card.`);
  }

  assert(
    page.includes("summary.jobs.availability") &&
      page.includes("summary.imports.availability") &&
      page.includes("summary.publishing.availability") &&
      page.includes("summary.connectors.availability") &&
      page.includes("summary.readiness.availability") &&
      page.includes("summary.errors.availability") &&
      page.includes("mediaIntegrity.availability") &&
      page.includes("Unavailable"),
    "Internal ops page must render dependency failure state without crashing the whole page.",
  );

  assert(
    apiClient.includes("InternalOpsAggregateAvailability") &&
      apiClient.includes('InternalOpsReadinessMetric = number | null') &&
      apiClient.includes('availability: InternalOpsAggregateAvailability') &&
      apiClient.includes("productData: {") &&
      apiClient.includes("mapping: {") &&
      apiClient.includes("connector: {"),
    "Internal ops Web client must model the accepted readiness backend contract.",
  );

  assert(
    page.includes("Persisted operational readiness signals") &&
      page.includes("<ReadinessPanel readiness={summary.readiness} />") &&
      page.includes('title="Product data"') &&
      page.includes('title="Mappings"') &&
      page.includes('title="Connectors"') &&
      page.includes("Blocked products") &&
      page.includes("Blocking issues") &&
      page.includes("Blocking mappings") &&
      page.includes("Blocking installations") &&
      page.includes("Warnings") &&
      page.includes("formatDateTime(readiness.asOf)"),
    "Readiness Health UI must render the available state with separate product-data, mapping, connector, blocker, warning, and as-of sections.",
  );

  assert(
    page.includes('availability === "partial"') &&
      page.includes("ReadinessSourceSection") &&
      page.includes('availability === "unavailable" ?') &&
      page.includes("Signals temporarily unavailable.") &&
      page.includes("Readiness signals are temporarily unavailable."),
    "Readiness Health UI must render partial and unavailable states without raw backend error text.",
  );

  assert(
    page.includes('value === null ? "Unavailable" : formatNumber(value)') &&
      page.includes("formatNumber(row.value)") &&
      page.includes("formatNumber(value)") &&
      page.includes('label={row.tone === "danger" ? "Blocker" : "Warning"}'),
    "Readiness Health UI must preserve zero as a real value, render unavailable separately from zero, and distinguish blockers from warnings.",
  );

  assert(
    !page.includes("readyProducts") &&
      !page.includes("Ready products") &&
      !page.includes("ready products") &&
      !page.includes("globalBlockedProducts") &&
      !page.includes("Total blocked") &&
      !page.includes("Combined blocked") &&
      !page.includes("topRuleFamilies") &&
      !page.includes("ruleFamily") &&
      !page.includes("affectedTenants") &&
      !page.includes("readiness.message"),
    "Readiness Health UI must not claim global readiness, combine heterogeneous blocker units, expose rule codes, expose tenant aggregates in the UI, or render raw backend messages.",
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
    "storagePath",
    "checksum",
    "externalAccountRef",
    "encryptedValue",
    "rawTenant",
  ];
  for (const field of prohibitedUiFields) {
    assert(!page.includes(field), `Internal ops summary UI must not render prohibited field ${field}.`);
  }

  for (const backendOnlyField of ["affectedTenants", "topRuleFamilies", "readiness.message"]) {
    assert(
      apiClient.includes(backendOnlyField.replace("readiness.", "")) && !page.includes(backendOnlyField),
      `Internal ops summary UI must not render backend-only field ${backendOnlyField}.`,
    );
  }

  console.log(JSON.stringify({
    status: "ok",
    validated: [
      "ui_server_session_gate",
      "ui_server_authenticated_api_client",
      "seven_cards_rendered",
      "ui_failure_state",
      "ui_empty_state",
      "ui_readiness_contract",
      "ui_readiness_available_partial_unavailable_states",
      "ui_readiness_warning_blocker_zero_unavailable_semantics",
      "ui_readiness_safe_wording",
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
