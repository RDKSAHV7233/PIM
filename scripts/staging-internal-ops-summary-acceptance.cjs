#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const CARD_KEYS = ["jobs", "imports", "publishing", "connectors", "errors", "mediaIntegrity"];
const CARD_LABELS = ["Jobs", "Imports", "Publishing", "Connectors", "Errors", "Media Integrity"];
const AVAILABILITY = new Set(["available", "unavailable"]);

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
    body: { userId, role: "viewer" },
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
      orphanDetectionIncluded: summary.mediaIntegrity.orphanDetectionIncluded,
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
