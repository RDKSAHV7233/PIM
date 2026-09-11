#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");

const OPEN_SEVERITIES = new Set(["p0", "p1"]);
const ISSUE_LIMIT = 200;

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
      return { status: response.status, payload, text };
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
    throw new Error(`${label} expected HTTP ${statuses.join("/")}, got ${result.status}`);
  }
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

async function loginApi(apiBase, workspaceSlug, userId, password) {
  const login = await requestJson(`${apiBase}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: { workspaceSlug, userId, password, expiresInMinutes: 30 },
    retries: 2,
  });
  assertStatus(login, 201, "API admin login");
  const token = extractToken(login.payload);
  assert(token, "API admin login response did not include an access token");
  return token;
}

// Only the safe allowlist fields the ops errors acceptance suite already
// validates the API restricts issues to (see
// scripts/staging-error-authority-ops-errors-acceptance.cjs issueHasExpectedShape).
// No title/description/stack/tenant-identifying fields are requested or emitted.
const SAFE_ISSUE_FIELDS = [
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
  "lastSeenRelease",
  "occurrenceCount",
  "affectedTenantCount",
];

function pickSafeFields(issue) {
  const picked = {};
  for (const key of SAFE_ISSUE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(issue, key)) {
      picked[key] = issue[key];
    }
  }
  return picked;
}

async function main() {
  const apiBase = requireEnv("STAGING_BASE_URL").replace(/\/+$/, "");
  const workspaceSlug = requireEnv("STAGING_SMOKE_WORKSPACE").toLowerCase();
  const userId = requireEnv("STAGING_SMOKE_USER");
  const password = requireEnv("STAGING_SMOKE_PASSWORD");
  const expectedRelease = optionalEnv("GITHUB_SHA");
  const runId = optionalEnv("GITHUB_RUN_ID") || `local-${Date.now()}`;
  const artifactPath = optionalEnv("P0P1_OPEN_ISSUES_OUTPUT") || `.run-logs/p0p1-open-issues-${runId}.json`;

  const adminToken = await loginApi(apiBase, workspaceSlug, userId, password);
  const authHeaders = { authorization: `Bearer ${adminToken}` };

  const issuesResponse = await requestJson(`${apiBase}/api/v1/error-authority/ops/issues?limit=${ISSUE_LIMIT}`, {
    headers: authHeaders,
    retries: 2,
  });
  assertStatus(issuesResponse, 200, "ops issues read");
  assert(issuesResponse.payload?.storageAvailable === true, "Ops issues API reports storage unavailable");
  assert(Array.isArray(issuesResponse.payload?.items), "Ops issues API response items is not an array");

  const allItems = issuesResponse.payload.items;
  const truncated = Boolean(issuesResponse.payload.nextCursor);

  const p0p1Issues = allItems
    .filter((issue) => OPEN_SEVERITIES.has(String(issue.severity ?? "").toLowerCase()))
    .map(pickSafeFields);

  const byState = {};
  for (const issue of p0p1Issues) {
    const state = String(issue.state ?? "unknown");
    byState[state] = (byState[state] ?? 0) + 1;
  }

  const artifact = {
    status: "ok",
    suite: "P0P1_OPEN_ISSUES_DUMP",
    capturedAt: nowIso(),
    runId,
    expectedRelease,
    apiBase,
    fetchedIssueCount: allItems.length,
    truncated,
    note: truncated
      ? `More than ${ISSUE_LIMIT} total issues exist; increase ISSUE_LIMIT or add cursor pagination if p0/p1 issues may have been missed.`
      : undefined,
    p0p1CountBySeverityAndState: byState,
    p0p1Issues,
  };

  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify(artifact, null, 2));
}

main().catch((error) => {
  console.error("P0/P1 open issues dump failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
