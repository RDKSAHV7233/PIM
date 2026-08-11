#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Staging account-export acceptance test — R2 private-bucket write/read path.
 *
 * Requests a real account export, polls until it completes, downloads it via
 * the app-issued presigned URL, then confirms the same object is NOT
 * reachable once the presigned signature is stripped off the URL.
 *
 * Requires env: STAGING_BASE_URL, STAGING_SMOKE_WORKSPACE,
 *               STAGING_SMOKE_USER, STAGING_SMOKE_PASSWORD
 */

function requireEnv(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

const BASE = requireEnv("STAGING_BASE_URL");
const WORKSPACE = requireEnv("STAGING_SMOKE_WORKSPACE");
const USER = requireEnv("STAGING_SMOKE_USER");
const PASSWORD = requireEnv("STAGING_SMOKE_PASSWORD");

const results = [];

function pass(label, detail) {
  results.push({ status: "PASS", label, detail });
  console.log(`  ✓ PASS  ${label}  ${detail}`);
}
function fail(label, detail) {
  results.push({ status: "FAIL", label, detail });
  console.error(`  ✗ FAIL  ${label}  ${detail}`);
}

async function api(method, path, opts = {}) {
  const url = `${BASE}${path}`;
  const headers = { "Content-Type": "application/json", ...(opts.headers ?? {}) };
  const response = await fetch(url, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: response.status, headers: response.headers, json, text };
}

async function login() {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await api("POST", "/api/v1/auth/login", {
      body: { workspaceSlug: WORKSPACE, userId: USER, password: PASSWORD },
    });
    if (res.status === 200 || res.status === 201) {
      const token = res.json?.token ?? res.json?.accessToken;
      if (!token) throw new Error("Login succeeded but no token in response");
      return token;
    }
    if (res.status === 502 && attempt < 5) {
      console.log(`  … login attempt ${attempt}/5 got 502, retrying in ${attempt * 5}s`);
      await new Promise(r => setTimeout(r, attempt * 5000));
      continue;
    }
    throw new Error(`Login failed: ${res.status} ${res.text}`);
  }
}

async function run() {
  console.log("\n=== Staging Account Export Acceptance Test ===\n");

  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const res = await api("GET", "/api/v1/health");
      if (res.status === 200) {
        pass("[health] api_reachable", `env=${res.json?.env ?? "unknown"}`);
        break;
      }
    } catch {}
    if (attempt === 10) {
      fail("[health] api_reachable", "API did not respond after 10 attempts");
      process.exit(1);
    }
    console.log(`  … health probe ${attempt}/10 failed, retrying in 5s`);
    await new Promise(r => setTimeout(r, 5000));
  }

  let token;
  try {
    token = await login();
    pass("[auth] login", `workspace=${WORKSPACE}`);
  } catch (e) {
    fail("[auth] login", e.message);
    process.exit(1);
  }
  const auth = { Authorization: `Bearer ${token}` };

  // ── Request a fresh export ──
  let jobId = null;
  try {
    const res = await api("POST", "/api/v1/auth/account/export", {
      headers: auth,
      body: { format: "json" },
    });
    if (res.status !== 202) throw new Error(`status=${res.status} body=${res.text.slice(0, 200)}`);
    jobId = res.json?.jobId;
    if (!jobId) throw new Error("202 response had no jobId");
    pass("[export] request", `jobId=${jobId}`);
  } catch (e) {
    fail("[export] request", e.message);
    console.log(JSON.stringify({ status: "FAIL", results, checkedAt: new Date().toISOString() }, null, 2));
    process.exit(1);
  }

  // ── Poll privacy-status until this job completes ──
  let completed = false;
  let lastStatus = "unknown";
  for (let attempt = 1; attempt <= 30; attempt++) {
    const res = await api("GET", "/api/v1/auth/account/privacy-status", { headers: auth });
    const latest = res.json?.latestExport;
    lastStatus = latest?.status ?? "unknown";
    if (latest?.id === jobId && latest?.status === "completed") {
      completed = true;
      break;
    }
    if (latest?.id === jobId && latest?.status === "failed") {
      fail("[export] job_completes", `job failed: ${latest?.errorMessage ?? "no error message"}`);
      console.log(JSON.stringify({ status: "FAIL", results, checkedAt: new Date().toISOString() }, null, 2));
      process.exit(1);
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  if (completed) {
    pass("[export] job_completes", `jobId=${jobId} status=${lastStatus}`);
  } else {
    fail("[export] job_completes", `jobId=${jobId} still status=${lastStatus} after 150s`);
    console.log(JSON.stringify({ status: "FAIL", results, checkedAt: new Date().toISOString() }, null, 2));
    process.exit(1);
  }

  // ── Authorized download: app-issued presigned URL must work ──
  let downloadUrl = null;
  try {
    const res = await api("GET", `/api/v1/auth/account/export/${jobId}/download`, { headers: auth });
    if (res.status !== 200) throw new Error(`status=${res.status} body=${res.text.slice(0, 200)}`);
    if (res.json?.kind !== "ready" || !res.json?.downloadUrl) {
      throw new Error(`unexpected response kind=${res.json?.kind ?? "none"} — expected a presigned "ready" URL (object_storage mode)`);
    }
    downloadUrl = res.json.downloadUrl;
    pass("[export] authorized_download_issued", `kind=ready expiresInSeconds=${res.json.expiresInSeconds}`);
  } catch (e) {
    fail("[export] authorized_download_issued", e.message);
  }

  if (downloadUrl) {
    try {
      const res = await fetch(downloadUrl, { signal: AbortSignal.timeout(15000) });
      if (res.status !== 200) throw new Error(`status=${res.status}`);
      const body = await res.text();
      const parsed = JSON.parse(body);
      if (!parsed || typeof parsed !== "object" || !("account" in parsed)) {
        throw new Error("downloaded artifact did not contain expected 'account' section");
      }
      pass("[export] presigned_download_works", `status=200 bytes=${body.length}`);
    } catch (e) {
      fail("[export] presigned_download_works", e.message);
    }

    // ── Unauthenticated direct access: strip the signature, expect rejection ──
    try {
      const unsigned = new URL(downloadUrl);
      unsigned.search = "";
      const res = await fetch(unsigned.toString(), { signal: AbortSignal.timeout(15000) });
      if (res.status === 200) {
        fail("[export] unsigned_access_rejected", `status=200 — private bucket served an unsigned request for ${unsigned.pathname}`);
      } else {
        pass("[export] unsigned_access_rejected", `status=${res.status} (bucket rejected unsigned request as expected)`);
      }
    } catch (e) {
      // A network-level rejection also counts as "did not work".
      pass("[export] unsigned_access_rejected", `request failed as expected: ${e.message}`);
    }
  }

  const passed = results.filter(r => r.status === "PASS").length;
  const failed = results.filter(r => r.status === "FAIL").length;
  console.log(`\n  TOTAL  ${results.length} checks  |  ${passed} pass  |  ${failed} fail\n`);
  console.log(JSON.stringify({
    status: failed > 0 ? "FAIL" : "PASS",
    results,
    checkedAt: new Date().toISOString(),
  }, null, 2));

  if (failed > 0) process.exit(1);
}

run().catch(e => {
  console.error("Acceptance test crashed:", e.message);
  process.exit(1);
});
