#!/usr/bin/env node
/* eslint-disable no-console */
//
// One-time #801 disposition action: resolve the 3 P0/P1 Error Authority
// records dispositioned as "fixed" / "transient, safe to resolve" in #801's
// final comment, and confirm the 4th (already suspected resolved from a
// disappearance between two staging dumps) directly via the endpoint's own
// idempotent response rather than inferring from absence.
//
// POST .../resolve is idempotent (see error-authority-ops.service.ts
// resolveIssue): calling it on an already-resolved issue returns 200 with
// `previousState: "resolved"` instead of erroring. That makes it safe to use
// as a *confirmation* probe for record 4 — if it was already resolved, this
// call changes nothing and just proves it.
//
// Safe-fields only: this script's own output never includes title/
// description/stack — only what error-authority-ops.controller.ts's
// response body actually returns (id, state) plus a caller-supplied label
// naming which #801 record each id corresponds to, and previousState from
// the same response.

const fs = require("node:fs");
const path = require("node:path");

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
    throw new Error(`${label} expected HTTP ${statuses.join("/")}, got ${result.status}: ${JSON.stringify(result.payload)}`);
  }
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

// The 4 records identified and dispositioned in #801. IDs come from the
// safe-fields staging-gate-artifacts dumps (runs 34702709276 / 34709722406),
// not from any title/description field.
const TARGET_ISSUES = [
  {
    id: "cmsojron80005lf0173ucp6o7",
    label: "#801 record 1 — prisma.category.delete() crash (fixed in PR #805)",
  },
  {
    id: "cmtv3o2ov0000qz011b9inors",
    label: "#801 record 2 — signup verification Bad Gateway (transient, 48h+ no recurrence)",
  },
  {
    id: "cmtlz8tnb00hdpt01l2a45ce0",
    label: "#801 record 3 — DB connectivity blip (transient, 4+ days no recurrence)",
  },
  {
    id: "cmtonv9gf0000mq013kpsmmyc",
    label: "#801 record 4 — WooCommerce credentials (confirmation probe only, suspected already resolved)",
  },
];

async function resolveIssue(apiBase, authHeaders, issueId) {
  const result = await requestJson(`${apiBase}/api/v1/error-authority/ops/issues/${issueId}/resolve`, {
    method: "POST",
    headers: authHeaders,
    retries: 1,
  });
  return result;
}

async function main() {
  const apiBase = requireEnv("STAGING_BASE_URL").replace(/\/+$/, "");
  const workspaceSlug = requireEnv("STAGING_SMOKE_WORKSPACE").toLowerCase();
  const userId = requireEnv("STAGING_SMOKE_USER");
  const password = requireEnv("STAGING_SMOKE_PASSWORD");
  const runId = optionalEnv("GITHUB_RUN_ID") || `local-${Date.now()}`;
  const artifactPath =
    optionalEnv("P0P1_RESOLVE_OUTPUT") || `.run-logs/p0p1-resolve-and-confirm-${runId}.json`;

  const adminToken = await loginApi(apiBase, workspaceSlug, userId, password);
  const authHeaders = { authorization: `Bearer ${adminToken}` };

  const results = [];
  for (const target of TARGET_ISSUES) {
    let entry;
    try {
      const response = await resolveIssue(apiBase, authHeaders, target.id);
      if (response.status === 404) {
        entry = { ...target, outcome: "not_found", httpStatus: 404 };
      } else {
        assertStatus(response, 200, `resolve ${target.id}`);
        const { id, state, previousState } = response.payload ?? {};
        entry = {
          ...target,
          outcome: previousState === "resolved" ? "already_resolved" : "resolved_now",
          httpStatus: 200,
          id,
          state,
          previousState,
        };
      }
    } catch (error) {
      entry = { ...target, outcome: "error", error: error instanceof Error ? error.message : String(error) };
    }
    console.log(JSON.stringify(entry, null, 2));
    results.push(entry);
  }

  const artifact = {
    status: results.every((r) => r.outcome === "resolved_now" || r.outcome === "already_resolved") ? "ok" : "partial",
    suite: "P0P1_RESOLVE_AND_CONFIRM",
    capturedAt: nowIso(),
    runId,
    apiBase,
    results,
  };

  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify(artifact, null, 2));

  if (artifact.status !== "ok") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("P0/P1 resolve-and-confirm failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
