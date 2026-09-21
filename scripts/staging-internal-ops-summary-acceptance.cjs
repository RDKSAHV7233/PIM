#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const CARD_KEYS = ["jobs", "imports", "publishing", "connectors", "errors", "mediaIntegrity"];
const CARD_LABELS = ["Jobs", "Imports", "Publishing", "Connectors", "Readiness Health", "Errors", "Media Integrity"];
const AVAILABILITY = new Set(["available", "unavailable"]);
const READINESS_AVAILABILITY = new Set(["available", "partial", "unavailable"]);
const READINESS_IMPACT = new Set(["BLOCKER", "WARNING", "STATUS"]);
const RULE_FAMILY_LIMIT = 10;
const SAFE_RULE_FAMILIES = new Set([
  "GST_HSN_REQUIRED",
  "GST_HSN_FORMAT",
  "GST_RATE_REQUIRED",
  "GST_RATE_UNCOMMON",
  "PRICING_NO_DEFAULT_PRICES",
  "PRICING_INCOMPLETE",
  "ATTR_REQUIRED_*",
  "ATTR_TYPE_*",
  "ATTR_ALLOWED_*",
  "CUSTOM_RULE",
]);
const CONNECTOR_STATUS_IMPACT = {
  ACTIVE: "STATUS",
  PAUSED: "WARNING",
  CREDENTIAL_EXPIRED: "BLOCKER",
  DISABLED: "STATUS",
};

function requireEnv(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name) {
  return String(process.env[name] ?? "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(url, options = {}) {
  const retries = Number(options.retries ?? 0);
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: options.method ?? "GET",
        headers: options.headers ?? {},
        body: options.body ? JSON.stringify(options.body) : undefined,
        redirect: options.redirect ?? "follow",
        signal: AbortSignal.timeout(Number(options.timeoutMs ?? 20_000)),
      });
      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = text;
      }
      if ([502, 503, 504].includes(response.status) && attempt < retries) {
        await sleep(1_000 * (attempt + 1));
        continue;
      }
      return {
        status: response.status,
        payload,
        text,
        url: response.url,
        headers: response.headers,
        setCookie:
          typeof response.headers.getSetCookie === "function"
            ? response.headers.getSetCookie()
            : response.headers.get("set-cookie")
              ? [response.headers.get("set-cookie")]
              : [],
      };
    } catch (error) {
      lastError = error;
      if (attempt >= retries) {
        throw error;
      }
      await sleep(750 * (attempt + 1));
    }
  }
  throw lastError ?? new Error(`Request failed: ${url}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertStatus(result, expected, label) {
  const statuses = Array.isArray(expected) ? expected : [expected];
  if (!statuses.includes(result.status)) {
    throw new Error(`${label} expected HTTP ${statuses.join("/")}, got ${result.status}; payload=${safeJson(result.payload)}`);
  }
}

function safeJson(value) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "string" && item.length > 180) {
      return `${item.slice(0, 180)}...`;
    }
    return item;
  });
}

function cookieHeader(setCookieHeaders) {
  return setCookieHeaders
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .map((value) => value.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

function extractToken(loginPayload) {
  return String(loginPayload?.accessToken ?? loginPayload?.token ?? "").trim();
}

async function loginApi(apiBase, workspaceSlug, userId, password, label = "API login") {
  const login = await request(`${apiBase}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: {
      workspaceSlug,
      userId,
      password,
      expiresInMinutes: 30,
    },
    retries: 2,
  });
  assertStatus(login, 201, label);
  const token = extractToken(login.payload);
  assert(token, `${label} response did not include an access token`);
  return token;
}

async function loginWeb(webBase, workspaceSlug, userId, password, label = "Web login") {
  const login = await request(`${webBase}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: {
      workspaceSlug,
      userId,
      password,
    },
    retries: 2,
  });
  assertStatus(login, [200, 201, 303, 307], label);
  const cookies = cookieHeader(login.setCookie);
  assert(cookies.includes("pim_access_token="), `${label} did not set pim_access_token cookie`);
  return cookies;
}

async function createTemporaryViewer(apiBase, adminToken, workspaceSlug) {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`.toLowerCase();
  const userId = `ops-summary-viewer-${suffix}@pim1.test`;
  const password = `VexaTmp!${randomUUID().replace(/-/g, "").slice(0, 12)}#1a`;
  const headers = {
    authorization: `Bearer ${adminToken}`,
    "content-type": "application/json",
  };

  const created = await request(`${apiBase}/api/v1/admin/workspace/users`, {
    method: "POST",
    headers,
    body: { userId, role: "viewer", password },
    retries: 2,
  });
  assertStatus(created, 201, "create temporary viewer");

  const passwordSet = await request(`${apiBase}/api/v1/admin/workspace/users/${encodeURIComponent(userId)}/password`, {
    method: "POST",
    headers,
    body: { password },
    retries: 2,
  });
  assertStatus(passwordSet, 200, "set temporary viewer password");

  return { workspaceSlug, userId, password };
}

async function deactivateUser(apiBase, adminToken, userId) {
  await request(`${apiBase}/api/v1/admin/workspace/users/${encodeURIComponent(userId)}/deactivate`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}` },
    retries: 1,
  }).catch(() => null);
  // F-002: deactivating alone leaves a permanent "inactive" AuthIdentity row behind.
  // This script runs on every push to main (deploy-staging.yml), so those rows
  // accumulated indefinitely with no cleanup. Purge removes the row once it's
  // deactivated (the API requires deactivate-before-purge; see workspace-users.service.ts).
  await request(`${apiBase}/api/v1/admin/workspace/users/${encodeURIComponent(userId)}/purge`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${adminToken}` },
    retries: 1,
  }).catch(() => null);
}

function findProhibitedKeys(value) {
  const exactKeys = new Set([
    "authorization",
    "cookie",
    "cookies",
    "headers",
    "password",
    "token",
    "secret",
    "credential",
    "credentials",
    "encryptedValue",
    "mappingRules",
    "metadata",
    "requestBody",
    "responseBody",
    "requestPayload",
    "responsePayload",
    "connectorPayload",
    "productPayload",
    "importPayload",
    "rawBody",
    "rawRows",
    "rawValidationPayload",
    "payload",
    "payloadSnapshot",
    "exportPayload",
    "sourceFileKey",
    "sourceName",
    "storagePath",
    "checksum",
    "title",
    "description",
    "tenantKey",
    "tenantName",
    "workspaceName",
    "customerName",
    "attributeValues",
    "normalizedFrames",
    "stack",
    "frames",
    "queryString",
  ]);
  const keys = new Set();

  function walk(node) {
    if (!node || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    for (const [key, nested] of Object.entries(node)) {
      if (exactKeys.has(key)) {
        keys.add(key);
      }
      walk(nested);
    }
  }

  walk(value);
  return Array.from(keys).sort();
}

function findProhibitedText(text) {
  const lower = String(text ?? "").toLowerCase();
  return [
    "authorization:",
    "bearer ",
    "pim_access_token",
    "set-cookie",
    "request payload",
    "response payload",
    "connector payload",
    "product payload",
    "raw import",
    "raw validation",
    "mappingrules",
    "tenant name",
    "customer name",
    "tenantkey",
    "encryptedvalue",
    "sourcefilekey",
    "storagepath",
    "normalizedframes",
  ].filter((fragment) => lower.includes(fragment));
}

function assertNumber(value, label) {
  assert(Number.isFinite(value), `${label} must be a finite number`);
  assert(value >= 0, `${label} must be non-negative`);
}

function assertNullableMetric(value, label) {
  assert(value === null, `${label} must be null when the readiness source is unavailable`);
}

function assertIsoDate(value, label) {
  assert(typeof value === "string" && value.length > 0, `${label} must be present`);
  const timestamp = Date.parse(value);
  assert(Number.isFinite(timestamp), `${label} must be a valid date`);
}

function assertStatusCounts(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  value.forEach((row, index) => {
    assert(typeof row?.status === "string" && row.status.length > 0, `${label}[${index}].status must be a string`);
    assertNumber(row?.count, `${label}[${index}].count`);
  });
}

function assertAvailability(card, label) {
  assert(AVAILABILITY.has(card?.availability), `${label}.availability must be available or unavailable`);
  if (card.availability === "unavailable") {
    assert(typeof card.errorMessage === "string" && card.errorMessage.length > 0, `${label} unavailable state must include errorMessage`);
  }
}

function assertMediaIntegrityLatestRun(value) {
  if (value === null) {
    return;
  }
  assert(value && typeof value === "object" && !Array.isArray(value), "mediaIntegrity.latestRun must be null or an object");
  assert(typeof value.runId === "string" && value.runId.length > 0, "mediaIntegrity.latestRun.runId must be present");
  assert(typeof value.status === "string" && value.status.length > 0, "mediaIntegrity.latestRun.status must be present");
  assertIsoDate(value.startedAt, "mediaIntegrity.latestRun.startedAt");
  if (value.completedAt !== null) {
    assertIsoDate(value.completedAt, "mediaIntegrity.latestRun.completedAt");
  }
  assert(typeof value.coverageComplete === "boolean", "mediaIntegrity.latestRun.coverageComplete must be boolean");
  assertNumber(value.rowsExamined, "mediaIntegrity.latestRun.rowsExamined");
  if (value.rowsEligible !== null) {
    assertNumber(value.rowsEligible, "mediaIntegrity.latestRun.rowsEligible");
  }
  assert(typeof value.continuationPending === "boolean", "mediaIntegrity.latestRun.continuationPending must be boolean");
  for (const key of ["missing", "invalidPath", "unverifiable", "storageErrors"]) {
    assertNumber(value.totals?.[key], `mediaIntegrity.latestRun.totals.${key}`);
  }
  for (const key of ["affectedTenantCount", "activeProductImpactCount"]) {
    assertNumber(value.impact?.[key], `mediaIntegrity.latestRun.impact.${key}`);
  }
}

function assertReadinessSourceAvailability(source, label) {
  assert(AVAILABILITY.has(source?.availability), `${label}.availability must be available or unavailable`);
}

function assertRuleFamilies(value, label) {
  assert(Array.isArray(value), `${label} must be an array when productData is available`);
  assert(value.length <= RULE_FAMILY_LIMIT, `${label} must contain at most ${RULE_FAMILY_LIMIT} items`);
  value.forEach((row, index) => {
    const ruleFamily = String(row?.ruleFamily ?? "");
    const impact = String(row?.impact ?? "");
    assert(SAFE_RULE_FAMILIES.has(ruleFamily), `${label}[${index}].ruleFamily is not allowlisted: ${ruleFamily}`);
    assert(impact === "BLOCKER" || impact === "WARNING", `${label}[${index}].impact must be BLOCKER or WARNING`);
    assertNumber(row?.count, `${label}[${index}].count`);
    assert(!/^ATTR_REQUIRED_[A-Z0-9]/.test(ruleFamily), `${label}[${index}] leaked a raw ATTR_REQUIRED rule code`);
    assert(!/^ATTR_TYPE_[A-Z0-9]/.test(ruleFamily), `${label}[${index}] leaked a raw ATTR_TYPE rule code`);
    assert(!/^ATTR_ALLOWED_[A-Z0-9]/.test(ruleFamily), `${label}[${index}] leaked a raw ATTR_ALLOWED rule code`);
    assert(ruleFamily === "CUSTOM_RULE" || !/^CUSTOM(ER)?_[A-Z0-9_]+/.test(ruleFamily), `${label}[${index}] leaked a raw custom rule code`);
  });
}

function assertMappingSignals(signals) {
  assert(signals && typeof signals === "object" && !Array.isArray(signals), "readiness.mapping.signals must be an object");
  assertNumber(signals.compatibilityBlocked, "readiness.mapping.signals.compatibilityBlocked");
  assertNumber(signals.remapRequired, "readiness.mapping.signals.remapRequired");
  assertNumber(signals.fallbackAckRequired, "readiness.mapping.signals.fallbackAckRequired");
  assertNumber(signals.deprecated, "readiness.mapping.signals.deprecated");
}

function assertConnectorStatuses(value, label) {
  assert(Array.isArray(value), `${label} must be an array when connector is available`);
  value.forEach((row, index) => {
    const status = String(row?.status ?? "");
    const expectedImpact = CONNECTOR_STATUS_IMPACT[status];
    assert(expectedImpact, `${label}[${index}].status is not allowlisted: ${status}`);
    assert(row?.impact === expectedImpact, `${label}[${index}].impact expected ${expectedImpact}, got ${row?.impact}`);
    assert(READINESS_IMPACT.has(row?.impact), `${label}[${index}].impact must be a known readiness impact`);
    assertNumber(row?.count, `${label}[${index}].count`);
  });
}

function assertReadinessShape(readiness) {
  assert(readiness && typeof readiness === "object" && !Array.isArray(readiness), "Summary missing readiness card");
  assert(READINESS_AVAILABILITY.has(readiness.availability), "readiness.availability must be available, partial, or unavailable");
  assertIsoDate(readiness.asOf, "readiness.asOf");
  assert(readiness.productData && typeof readiness.productData === "object", "readiness.productData must be present");
  assert(readiness.mapping && typeof readiness.mapping === "object", "readiness.mapping must be present");
  assert(readiness.connector && typeof readiness.connector === "object", "readiness.connector must be present");

  assertReadinessSourceAvailability(readiness.productData, "readiness.productData");
  if (readiness.productData.availability === "available") {
    assertNumber(readiness.productData.blockedProducts, "readiness.productData.blockedProducts");
    assertNumber(readiness.productData.blockingIssues, "readiness.productData.blockingIssues");
    assertNumber(readiness.productData.warningIssues, "readiness.productData.warningIssues");
    assertNumber(readiness.productData.affectedTenants, "readiness.productData.affectedTenants");
    assertRuleFamilies(readiness.productData.topRuleFamilies, "readiness.productData.topRuleFamilies");
  } else {
    assertNullableMetric(readiness.productData.blockedProducts, "readiness.productData.blockedProducts");
    assertNullableMetric(readiness.productData.blockingIssues, "readiness.productData.blockingIssues");
    assertNullableMetric(readiness.productData.warningIssues, "readiness.productData.warningIssues");
    assertNullableMetric(readiness.productData.affectedTenants, "readiness.productData.affectedTenants");
    assert(readiness.productData.topRuleFamilies === null, "readiness.productData.topRuleFamilies must be null when unavailable");
  }

  assertReadinessSourceAvailability(readiness.mapping, "readiness.mapping");
  if (readiness.mapping.availability === "available") {
    assertNumber(readiness.mapping.blockingMappings, "readiness.mapping.blockingMappings");
    assertNumber(readiness.mapping.warningMappings, "readiness.mapping.warningMappings");
    assertNumber(readiness.mapping.affectedTenants, "readiness.mapping.affectedTenants");
    assertMappingSignals(readiness.mapping.signals);
  } else {
    assertNullableMetric(readiness.mapping.blockingMappings, "readiness.mapping.blockingMappings");
    assertNullableMetric(readiness.mapping.warningMappings, "readiness.mapping.warningMappings");
    assertNullableMetric(readiness.mapping.affectedTenants, "readiness.mapping.affectedTenants");
    assert(readiness.mapping.signals && typeof readiness.mapping.signals === "object", "readiness.mapping.signals must be present when unavailable");
    assertNullableMetric(readiness.mapping.signals.compatibilityBlocked, "readiness.mapping.signals.compatibilityBlocked");
    assertNullableMetric(readiness.mapping.signals.remapRequired, "readiness.mapping.signals.remapRequired");
    assertNullableMetric(readiness.mapping.signals.fallbackAckRequired, "readiness.mapping.signals.fallbackAckRequired");
    assertNullableMetric(readiness.mapping.signals.deprecated, "readiness.mapping.signals.deprecated");
  }

  assertReadinessSourceAvailability(readiness.connector, "readiness.connector");
  if (readiness.connector.availability === "available") {
    assertNumber(readiness.connector.blockingInstallations, "readiness.connector.blockingInstallations");
    assertNumber(readiness.connector.warningInstallations, "readiness.connector.warningInstallations");
    assertNumber(readiness.connector.affectedTenants, "readiness.connector.affectedTenants");
    assertConnectorStatuses(readiness.connector.byStatus, "readiness.connector.byStatus");
  } else {
    assertNullableMetric(readiness.connector.blockingInstallations, "readiness.connector.blockingInstallations");
    assertNullableMetric(readiness.connector.warningInstallations, "readiness.connector.warningInstallations");
    assertNullableMetric(readiness.connector.affectedTenants, "readiness.connector.affectedTenants");
    assert(readiness.connector.byStatus === null, "readiness.connector.byStatus must be null when unavailable");
  }
}

function assertSummaryShape(summary) {
  assert(summary && typeof summary === "object" && !Array.isArray(summary), "Summary payload must be an object");
  assert(typeof summary.asOf === "string" && summary.asOf.length > 0, "Summary asOf must be present");
  assert(summary.windows && typeof summary.windows === "object", "Summary windows must be present");
  assert(typeof summary.windows.operational?.dateFrom === "string", "Operational window dateFrom must be present");
  assert(typeof summary.windows.operational?.dateTo === "string", "Operational window dateTo must be present");
  assert(typeof summary.windows.inventory?.dateFrom === "string", "Inventory window dateFrom must be present");
  assert(typeof summary.windows.inventory?.dateTo === "string", "Inventory window dateTo must be present");
  assertNumber(summary.windows.stuckThresholdHours, "windows.stuckThresholdHours");
  assertNumber(summary.windows.queryTimeoutMs, "windows.queryTimeoutMs");

  for (const key of CARD_KEYS) {
    assert(summary[key] && typeof summary[key] === "object", `Summary missing ${key} card`);
    assertAvailability(summary[key], key);
  }
  assertReadinessShape(summary.readiness);

  assertNumber(summary.jobs.active, "jobs.active");
  assertNumber(summary.jobs.stuck, "jobs.stuck");
  assertNumber(summary.jobs.failed, "jobs.failed");
  assertNumber(summary.jobs.deadLetter, "jobs.deadLetter");
  assertStatusCounts(summary.jobs.marketplaceExportJobs, "jobs.marketplaceExportJobs");
  assertStatusCounts(summary.jobs.bulkImportJobs, "jobs.bulkImportJobs");

  assertNumber(summary.imports.activeRuns, "imports.activeRuns");
  assertNumber(summary.imports.failedRows, "imports.failedRows");
  assertNumber(summary.imports.dlqRows, "imports.dlqRows");
  assertNumber(summary.imports.runFailedRows, "imports.runFailedRows");
  assertNumber(summary.imports.jobFailedRows, "imports.jobFailedRows");
  assertNumber(summary.imports.runDlqRows, "imports.runDlqRows");
  assertNumber(summary.imports.jobDlqRows, "imports.jobDlqRows");

  assertNumber(summary.publishing.exports?.success, "publishing.exports.success");
  assertNumber(summary.publishing.exports?.failed, "publishing.exports.failed");
  assertNumber(summary.publishing.exports?.successRate, "publishing.exports.successRate");
  assertNumber(summary.publishing.submissions?.success, "publishing.submissions.success");
  assertNumber(summary.publishing.submissions?.failed, "publishing.submissions.failed");
  assertNumber(summary.publishing.submissions?.successRate, "publishing.submissions.successRate");

  assertNumber(summary.connectors.totalInstallations, "connectors.totalInstallations");
  assertStatusCounts(summary.connectors.byStatus, "connectors.byStatus");

  assertNumber(summary.errors.p0p1OpenCount, "errors.p0p1OpenCount");
  assert(typeof summary.errors.storageAvailable === "boolean", "errors.storageAvailable must be boolean");
  assert(summary.errors.href === "/internal/ops/errors", "errors.href must link to /internal/ops/errors");

  assertNumber(summary.mediaIntegrity.totalAssets, "mediaIntegrity.totalAssets");
  assert(Object.prototype.hasOwnProperty.call(summary.mediaIntegrity, "latestRun"), "mediaIntegrity.latestRun must be present");
  assertMediaIntegrityLatestRun(summary.mediaIntegrity.latestRun);
  assert(summary.mediaIntegrity.orphanDetectionIncluded === false, "mediaIntegrity.orphanDetectionIncluded must remain false");
}

function summarizeCards(summary) {
  return {
    jobs: {
      availability: summary.jobs.availability,
      active: summary.jobs.active,
      stuck: summary.jobs.stuck,
      failed: summary.jobs.failed,
      deadLetter: summary.jobs.deadLetter,
    },
    imports: {
      availability: summary.imports.availability,
      activeRuns: summary.imports.activeRuns,
      failedRows: summary.imports.failedRows,
      dlqRows: summary.imports.dlqRows,
    },
    publishing: {
      availability: summary.publishing.availability,
      exportSuccessRate: summary.publishing.exports.successRate,
      exportFailures: summary.publishing.exports.failed,
      submissionFailures: summary.publishing.submissions.failed,
    },
    connectors: {
      availability: summary.connectors.availability,
      totalInstallations: summary.connectors.totalInstallations,
      statusBuckets: summary.connectors.byStatus.length,
    },
    errors: {
      availability: summary.errors.availability,
      p0p1OpenCount: summary.errors.p0p1OpenCount,
      storageAvailable: summary.errors.storageAvailable,
    },
    mediaIntegrity: {
      availability: summary.mediaIntegrity.availability,
      totalAssets: summary.mediaIntegrity.totalAssets,
      latestRunStatus: summary.mediaIntegrity.latestRun?.status ?? null,
      latestRunRowsExamined: summary.mediaIntegrity.latestRun?.rowsExamined ?? null,
      latestRunDefects: summary.mediaIntegrity.latestRun
        ? summary.mediaIntegrity.latestRun.totals.missing +
          summary.mediaIntegrity.latestRun.totals.invalidPath +
          summary.mediaIntegrity.latestRun.totals.unverifiable +
          summary.mediaIntegrity.latestRun.totals.storageErrors
        : null,
      orphanDetectionIncluded: summary.mediaIntegrity.orphanDetectionIncluded,
    },
    readiness: {
      availability: summary.readiness.availability,
      productData: {
        availability: summary.readiness.productData.availability,
        blockedProducts: summary.readiness.productData.blockedProducts,
        blockingIssues: summary.readiness.productData.blockingIssues,
        warningIssues: summary.readiness.productData.warningIssues,
        affectedTenants: summary.readiness.productData.affectedTenants,
        topRuleFamilyCount: Array.isArray(summary.readiness.productData.topRuleFamilies)
          ? summary.readiness.productData.topRuleFamilies.length
          : null,
      },
      mapping: {
        availability: summary.readiness.mapping.availability,
        blockingMappings: summary.readiness.mapping.blockingMappings,
        warningMappings: summary.readiness.mapping.warningMappings,
        affectedTenants: summary.readiness.mapping.affectedTenants,
      },
      connector: {
        availability: summary.readiness.connector.availability,
        blockingInstallations: summary.readiness.connector.blockingInstallations,
        warningInstallations: summary.readiness.connector.warningInstallations,
        affectedTenants: summary.readiness.connector.affectedTenants,
        statusBuckets: Array.isArray(summary.readiness.connector.byStatus)
          ? summary.readiness.connector.byStatus.length
          : null,
      },
    },
  };
}

async function main() {
  const apiBase = requireEnv("STAGING_BASE_URL").replace(/\/+$/, "");
  const webBase = requireEnv("STAGING_WEB_URL").replace(/\/+$/, "");
  const workspaceSlug = requireEnv("STAGING_SMOKE_WORKSPACE").toLowerCase();
  const userId = requireEnv("STAGING_SMOKE_USER");
  const password = requireEnv("STAGING_SMOKE_PASSWORD");
  const expectedRelease = optionalEnv("GITHUB_SHA");
  const runId = optionalEnv("GITHUB_RUN_ID") || `local-${Date.now()}`;
  const artifactPath = optionalEnv("OPS_SUMMARY_ACCEPTANCE_OUTPUT") || `.run-logs/internal-ops-summary-acceptance-${runId}.json`;
  const checks = [];
  let viewer = null;
  let adminToken = "";

  function pass(name, extra = {}) {
    checks.push({ name, result: "pass", ...extra });
  }

  try {
    const health = await request(`${apiBase}/api/v1/health`, { retries: 3 });
    assertStatus(health, 200, "API health");
    assert(health.payload?.status === "ok", `API health was not ok: ${safeJson(health.payload)}`);
    pass("api_health_ok", { env: health.payload?.env ?? null });

    adminToken = await loginApi(apiBase, workspaceSlug, userId, password, "admin API login");
    pass("admin_api_login");

    const summary = await request(`${apiBase}/api/v1/internal/ops/summary`, {
      headers: { authorization: `Bearer ${adminToken}` },
      retries: 2,
    });
    assertStatus(summary, 200, "admin internal ops summary API");
    assertSummaryShape(summary.payload);
    const prohibitedKeys = findProhibitedKeys(summary.payload);
    assert(prohibitedKeys.length === 0, `Internal ops summary payload exposed prohibited keys: ${prohibitedKeys.join(", ")}`);
    const cards = summarizeCards(summary.payload);
    pass("admin_summary_api_succeeds", {
      asOf: summary.payload.asOf,
      unavailableCards: CARD_KEYS.filter((key) => summary.payload[key].availability === "unavailable"),
    });
    pass("six_summary_cards_present", { cards: CARD_KEYS });
    pass("readiness_backend_contract_present", {
      availability: summary.payload.readiness.availability,
      sourceAvailability: {
        productData: summary.payload.readiness.productData.availability,
        mapping: summary.payload.readiness.mapping.availability,
        connector: summary.payload.readiness.connector.availability,
      },
    });
    pass("summary_safe_fields", { prohibitedKeys });

    const pageCookie = await loginWeb(webBase, workspaceSlug, userId, password, "admin web login");
    pass("admin_web_login_sets_session");
    const page = await request(`${webBase}/internal/ops`, {
      headers: { cookie: pageCookie },
      retries: 2,
    });
    assertStatus(page, 200, "admin internal ops web page");
    assert(String(page.text).includes("Internal Ops"), "Internal Ops page did not render title");
    for (const label of CARD_LABELS) {
      assert(String(page.text).includes(label), `Internal Ops page did not render ${label} card`);
    }
    assert(String(page.text).includes("Operational Signals"), "Internal Ops page did not render operational signals section");
    assert(!String(page.text).includes("System admin access required"), "Admin saw system-admin access boundary");
    const prohibitedPageText = findProhibitedText(page.text);
    assert(prohibitedPageText.length === 0, `Internal Ops page rendered prohibited text: ${prohibitedPageText.join(", ")}`);
    pass("admin_web_internal_ops_visible", { cards: CARD_LABELS });

    viewer = await createTemporaryViewer(apiBase, adminToken, workspaceSlug);
    const viewerToken = await loginApi(apiBase, viewer.workspaceSlug, viewer.userId, viewer.password, "viewer API login");
    const viewerDenied = await request(`${apiBase}/api/v1/internal/ops/summary`, {
      headers: { authorization: `Bearer ${viewerToken}` },
      retries: 1,
    });
    assertStatus(viewerDenied, 403, "viewer internal ops summary API denied");
    pass("viewer_summary_api_denied", { status: viewerDenied.status });

    const viewerCookie = await loginWeb(webBase, viewer.workspaceSlug, viewer.userId, viewer.password, "viewer web login");
    const viewerPage = await request(`${webBase}/internal/ops`, {
      headers: { cookie: viewerCookie },
      retries: 1,
    });
    assertStatus(viewerPage, 200, "viewer internal ops web page denied card");
    assert(String(viewerPage.text).toLowerCase().includes("system admin"), "viewer did not see system-admin access boundary");
    for (const label of CARD_LABELS) {
      assert(!String(viewerPage.text).includes(label), `viewer page exposed ${label} card`);
    }
    assert(!String(viewerPage.text).includes("Operational Signals"), "viewer page exposed operational signals section");
    assert(!String(viewerPage.text).includes("All cards available"), "viewer page exposed summary availability text");
    pass("viewer_web_internal_ops_denied_no_leakage");

    const unauth = await request(`${apiBase}/api/v1/internal/ops/summary`, { retries: 1 });
    assertStatus(unauth, [401, 403], "unauthenticated internal ops summary API denied");
    pass("unauthenticated_summary_api_denied", { status: unauth.status });

    const artifact = {
      status: "ok",
      suite: "INTERNAL_OPS_SUMMARY_STAGING_ACCEPTANCE",
      capturedAt: nowIso(),
      runId,
      expectedRelease,
      apiBase,
      webHost: new URL(webBase).host,
      checks,
      evidence: {
        asOf: summary.payload.asOf,
        cards,
        unavailableCards: CARD_KEYS.filter((key) => summary.payload[key].availability === "unavailable"),
      },
    };
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log(JSON.stringify(artifact, null, 2));
  } finally {
    if (viewer && adminToken) {
      await deactivateUser(apiBase, adminToken, viewer.userId);
    }
  }
}

main().catch((error) => {
  console.error("Internal Ops Summary staging acceptance failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
