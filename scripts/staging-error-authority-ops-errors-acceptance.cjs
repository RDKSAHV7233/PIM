#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

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

async function requestJson(url, options = {}) {
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

function assertStatus(result, expected, label) {
  const statuses = Array.isArray(expected) ? expected : [expected];
  if (!statuses.includes(result.status)) {
    throw new Error(`${label} expected HTTP ${statuses.join("/")}, got ${result.status}; payload=${safeJson(result.payload)}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
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

function findProhibitedKeys(value) {
  const keys = new Set();
  const prohibited = new Set([
    "authorization",
    "cookie",
    "cookies",
    "headers",
    "requestBody",
    "rawBody",
    "queryString",
    "password",
    "credential",
    "credentials",
    "token",
    "secret",
    "normalizedFrames",
  ]);

  function walk(node) {
    if (!node || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    for (const [key, nested] of Object.entries(node)) {
      if (prohibited.has(key)) {
        keys.add(key);
      }
      walk(nested);
    }
  }

  walk(value);
  return Array.from(keys).sort();
}

function issueHasExpectedShape(issue) {
  const requiredKeys = [
    "id",
    "fingerprint",
    "runtime",
    "service",
    "environment",
    "category",
    "severity",
    "state",
    "safeTitle",
    "firstSeenAt",
    "lastSeenAt",
    "occurrenceCount",
    "affectedTenantCount",
  ];
  return requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(issue, key));
}

function occurrenceHasExpectedShape(occurrence) {
  const requiredKeys = [
    "id",
    "issueId",
    "occurredAt",
    "environment",
    "runtime",
    "service",
    "category",
    "safeMessage",
    "sourceEventId",
  ];
  return requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(occurrence, key));
}

function extractToken(loginPayload) {
  return String(loginPayload?.accessToken ?? loginPayload?.token ?? "").trim();
}

async function loginApi(apiBase, workspaceSlug, userId, password) {
  const login = await requestJson(`${apiBase}/api/v1/auth/login`, {
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
  assertStatus(login, 201, "API admin login");
  const token = extractToken(login.payload);
  assert(token, "API admin login response did not include an access token");
  return token;
}

async function loginWeb(webBase, workspaceSlug, userId, password) {
  const login = await requestJson(`${webBase}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: {
      workspaceSlug,
      userId,
      password,
    },
    retries: 2,
  });
  assertStatus(login, [200, 201, 303, 307], "Web admin login");
  const cookies = cookieHeader(login.setCookie);
  assert(cookies.includes("pim_access_token="), "Web admin login did not set pim_access_token cookie");
  return cookies;
}

async function createTemporaryViewer(apiBase, adminToken, workspaceSlug) {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`.toLowerCase();
  const userId = `ops-errors-viewer-${suffix}@pim1.test`;
  const password = `VexaTmp!${randomUUID().replace(/-/g, "").slice(0, 12)}#1a`;
  const adminJsonHeaders = {
    authorization: `Bearer ${adminToken}`,
    "content-type": "application/json",
  };

  const created = await requestJson(`${apiBase}/api/v1/admin/workspace/users`, {
    method: "POST",
    headers: adminJsonHeaders,
    body: { userId, role: "viewer", password },
    retries: 2,
  });
  assertStatus(created, 201, "create temporary viewer");

  const passwordSet = await requestJson(`${apiBase}/api/v1/admin/workspace/users/${encodeURIComponent(userId)}/password`, {
    method: "POST",
    headers: adminJsonHeaders,
    body: { password },
    retries: 2,
  });
  assertStatus(passwordSet, 200, "set temporary viewer password");

  return { workspaceSlug, userId, password };
}

async function deactivateUser(apiBase, adminToken, userId) {
  await requestJson(`${apiBase}/api/v1/admin/workspace/users/${encodeURIComponent(userId)}/deactivate`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}` },
    retries: 1,
  }).catch(() => null);
  // F-002: deactivating alone leaves a permanent "inactive" AuthIdentity row behind.
  // This script runs on every push to main (deploy-staging.yml), so those rows
  // accumulated indefinitely with no cleanup. Purge requires deactivate-before-purge
  // (already satisfied above) — see workspace-users.service.ts.
  await requestJson(`${apiBase}/api/v1/admin/workspace/users/${encodeURIComponent(userId)}/purge`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${adminToken}` },
    retries: 1,
  }).catch(() => null);
}

async function main() {
  const apiBase = requireEnv("STAGING_BASE_URL").replace(/\/+$/, "");
  const webBase = requireEnv("STAGING_WEB_URL").replace(/\/+$/, "");
  const workspaceSlug = requireEnv("STAGING_SMOKE_WORKSPACE").toLowerCase();
  const userId = requireEnv("STAGING_SMOKE_USER");
  const password = requireEnv("STAGING_SMOKE_PASSWORD");
  const ingestToken = requireEnv("ERROR_AUTHORITY_INGEST_TOKEN");
  const expectedRelease = optionalEnv("ERROR_AUTHORITY_RELEASE") || optionalEnv("GITHUB_SHA");
  const runId = optionalEnv("GITHUB_RUN_ID") || `local-${Date.now()}`;
  const sourceEventId = `next_server:ops-errors-acceptance:${runId}:${randomUUID()}`;
  const routeTemplate = "/internal/ops/errors/acceptance-proof";
  const artifactPath = optionalEnv("OPS_ERRORS_ACCEPTANCE_OUTPUT") || `.run-logs/internal-ops-errors-acceptance-${runId}.json`;
  const checks = [];
  let viewer = null;

  function pass(name, extra = {}) {
    checks.push({ name, result: "pass", ...extra });
  }

  try {
    const health = await requestJson(`${apiBase}/api/v1/health`, { retries: 3 });
    assertStatus(health, 200, "API health");
    assert(health.payload?.status === "ok", `API health was not ok: ${safeJson(health.payload)}`);
    pass("api_health_ok", { env: health.payload?.env ?? null });

    const adminToken = await loginApi(apiBase, workspaceSlug, userId, password);
    pass("admin_api_login");

    const unauth = await requestJson(`${apiBase}/api/v1/error-authority/ops/issues?limit=1`);
    assertStatus(unauth, [401, 403], "unauthenticated ops API denied");
    pass("unauthenticated_ops_api_denied", { status: unauth.status });

    const ingest = await requestJson(`${apiBase}/api/v1/error-authority/ingest/next-server`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-error-authority-ingest-token": ingestToken,
      },
      body: {
        sourceEventId,
        release: expectedRelease,
        routeTemplate,
        method: "GET",
        statusCode: 500,
        requestId: `req-${runId}`,
        errorName: "InternalOpsErrorsAcceptanceError",
        errorCode: "INTERNAL_OPS_ERRORS_ACCEPTANCE",
        category: "rendering",
        severity: "p2",
        frames: [{ file: "/srv/apps/web/src/app/internal/ops/errors/page.tsx", functionName: "InternalOpsErrorsPage", line: 90 }],
      },
      retries: 2,
    });
    assertStatus(ingest, 202, "controlled next-server ingest");
    pass("controlled_next_server_ingest_accepted");

    const authHeaders = { authorization: `Bearer ${adminToken}` };
    let issues = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      issues = await requestJson(
        `${apiBase}/api/v1/error-authority/ops/issues?runtime=next_server&errorCode=INTERNAL_OPS_ERRORS_ACCEPTANCE&route=${encodeURIComponent(routeTemplate)}&limit=25`,
        { headers: authHeaders, retries: 1 },
      );
      assertStatus(issues, 200, "ops issues read");
      if (issues.payload?.storageAvailable === true && Array.isArray(issues.payload?.items) && issues.payload.items.length > 0) {
        break;
      }
      await sleep(1_000);
    }

    assert(issues.payload?.storageAvailable === true, "Ops issues API reports storage unavailable");
    assert(Array.isArray(issues.payload?.items), "Ops issues API response items is not an array");
    assert(issues.payload.items.length > 0, "Controlled Error Authority issue was not visible through ops API");
    assert(issueHasExpectedShape(issues.payload.items[0]), "Ops issue response missing required safe allowlist fields");
    const issue = issues.payload.items.find((item) => item.errorCode === "INTERNAL_OPS_ERRORS_ACCEPTANCE") ?? issues.payload.items[0];
    assert(issue.runtime === "next_server", `Expected runtime next_server, got ${issue.runtime}`);
    assert(issue.service === "vexa-pim-web", `Expected service vexa-pim-web, got ${issue.service}`);
    assert(issue.lastSeenRelease === expectedRelease, `Expected lastSeenRelease ${expectedRelease}, got ${issue.lastSeenRelease}`);
    assert(findProhibitedKeys(issues.payload).length === 0, `Ops issue payload exposed prohibited keys: ${findProhibitedKeys(issues.payload).join(", ")}`);
    pass("ops_issues_read_safe_fields", {
      issueCount: issues.payload.items.length,
      nextCursor: Boolean(issues.payload.nextCursor),
      storageAvailable: issues.payload.storageAvailable,
    });

    const occurrences = await requestJson(`${apiBase}/api/v1/error-authority/ops/issues/${encodeURIComponent(issue.id)}/occurrences?limit=25`, {
      headers: authHeaders,
      retries: 2,
    });
    assertStatus(occurrences, 200, "ops occurrences read");
    assert(occurrences.payload?.storageAvailable === true, "Ops occurrences API reports storage unavailable");
    assert(Array.isArray(occurrences.payload?.items), "Ops occurrences response items is not an array");
    const occurrence = occurrences.payload.items.find((item) => item.sourceEventId === sourceEventId);
    assert(occurrence, "Controlled occurrence was not visible through ops occurrences API");
    assert(occurrenceHasExpectedShape(occurrence), "Ops occurrence response missing required safe allowlist fields");
    assert(occurrence.routeTemplate === routeTemplate, `Expected occurrence route ${routeTemplate}, got ${occurrence.routeTemplate}`);
    assert(occurrence.release === expectedRelease, `Expected occurrence release ${expectedRelease}, got ${occurrence.release}`);
    assert(occurrence.safeMessage === "Unexpected Next.js server error", `Unexpected safeMessage: ${occurrence.safeMessage}`);
    assert(findProhibitedKeys(occurrences.payload).length === 0, `Ops occurrence payload exposed prohibited keys: ${findProhibitedKeys(occurrences.payload).join(", ")}`);
    pass("ops_occurrences_relation_safe_fields", {
      occurrenceCount: occurrences.payload.items.length,
      nextCursor: Boolean(occurrences.payload.nextCursor),
    });

    const pageCookie = await loginWeb(webBase, workspaceSlug, userId, password);
    pass("admin_web_login_sets_session");
    const page = await requestJson(
      `${webBase}/internal/ops/errors?runtime=next_server&errorCode=INTERNAL_OPS_ERRORS_ACCEPTANCE&route=${encodeURIComponent(routeTemplate)}&limit=25`,
      {
        headers: { cookie: pageCookie },
        retries: 2,
      },
    );
    assertStatus(page, 200, "Internal Ops Errors page");
    assert(String(page.text).includes("Internal Ops Errors"), "Internal Ops Errors page did not render title");
    assert(String(page.text).includes("INTERNAL_OPS_ERRORS_ACCEPTANCE"), "Internal Ops Errors page did not render controlled issue");
    assert(!String(page.text).includes("System admin access required"), "System admin access boundary rendered for smoke admin");
    assert(!String(page.text).toLowerCase().includes("authorization"), "Internal Ops Errors page rendered prohibited authorization text");
    pass("admin_web_internal_ops_errors_visible");

    viewer = await createTemporaryViewer(apiBase, adminToken, workspaceSlug);
    const viewerToken = await loginApi(apiBase, viewer.workspaceSlug, viewer.userId, viewer.password);
    const viewerDenied = await requestJson(`${apiBase}/api/v1/error-authority/ops/issues?limit=1`, {
      headers: { authorization: `Bearer ${viewerToken}` },
      retries: 1,
    });
    assertStatus(viewerDenied, 403, "viewer ops API denied");
    pass("viewer_ops_api_denied", { status: viewerDenied.status });

    const viewerCookie = await loginWeb(webBase, viewer.workspaceSlug, viewer.userId, viewer.password);
    const viewerPage = await requestJson(`${webBase}/internal/ops/errors`, {
      headers: { cookie: viewerCookie },
      retries: 1,
    });
    assertStatus(viewerPage, 200, "viewer internal ops page denied card");
    assert(String(viewerPage.text).toLowerCase().includes("system admin"), "viewer did not see system-admin access boundary");
    assert(!String(viewerPage.text).includes("INTERNAL_OPS_ERRORS_ACCEPTANCE"), "viewer page exposed Error Authority issue content");
    pass("viewer_web_internal_ops_errors_denied");

    const filtered = await requestJson(
      `${apiBase}/api/v1/error-authority/ops/issues?runtime=next_server&errorCode=INTERNAL_OPS_ERRORS_ACCEPTANCE&route=${encodeURIComponent(routeTemplate)}&release=${encodeURIComponent(expectedRelease)}&limit=1`,
      { headers: authHeaders, retries: 1 },
    );
    assertStatus(filtered, 200, "filtered ops issue read");
    assert(filtered.payload?.items?.length === 1, `Filtered issue read expected 1 item, got ${filtered.payload?.items?.length}`);
    pass("filters_release_route_error_code_runtime");

    const artifact = {
      status: "ok",
      suite: "INTERNAL_OPS_ERRORS_STAGING_ACCEPTANCE",
      capturedAt: nowIso(),
      runId,
      expectedRelease,
      apiBase,
      webHost: new URL(webBase).host,
      checks,
      evidence: {
        issueId: issue.id,
        latestOccurrenceId: issue.latestOccurrenceId,
        sourceEventId,
        routeTemplate,
        storageAvailable: true,
      },
    };
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log(JSON.stringify(artifact, null, 2));
  } finally {
    if (viewer) {
      const adminToken = await loginApi(apiBase, workspaceSlug, userId, password).catch(() => "");
      if (adminToken) {
        await deactivateUser(apiBase, adminToken, viewer.userId);
      }
    }
  }
}

main().catch((error) => {
  console.error("Internal Ops Errors staging acceptance failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
