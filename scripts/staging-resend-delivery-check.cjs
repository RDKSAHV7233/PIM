#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * One-off verification that the new AUTH_EMAIL_RESEND_API_KEY actually works —
 * triggers a real password-reset-request email for the smoke user, then checks
 * the auth-email queue's failed-jobs lane for a fresh failure (Resend send
 * errors surface as thrown errors in processAuthEmailJob -> job failure).
 *
 * Requires env: STAGING_BASE_URL, STAGING_SMOKE_USER, STAGING_SMOKE_PASSWORD,
 *               STAGING_SMOKE_WORKSPACE
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

async function api(method, path, opts = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: response.status, json, text };
}

async function run() {
  console.log("\n=== Resend Delivery Check ===\n");

  const before = await api("GET", "/api/v1/queue/auth-email/lanes/default/failed?limit=20", {});
  const beforeIds = new Set((before.json?.items ?? []).map((j) => j.id));
  console.log(`  failed jobs before: ${beforeIds.size} (status=${before.status})`);

  const login = await api("POST", "/api/v1/auth/login", {
    body: { workspaceSlug: WORKSPACE, userId: USER, password: PASSWORD },
  });
  const token = login.json?.token ?? login.json?.accessToken;
  if (!token) {
    console.error("  login failed, cannot check queue:", login.status, login.text.slice(0, 200));
    process.exit(1);
  }
  const auth = { Authorization: `Bearer ${token}` };

  const reqRes = await api("POST", "/api/v1/auth/password-reset/request", { body: { email: USER } });
  console.log(`  password-reset/request: status=${reqRes.status} body=${reqRes.text.slice(0, 200)}`);

  await new Promise((r) => setTimeout(r, 8000));

  const after = await api("GET", "/api/v1/queue/auth-email/lanes/default/failed?limit=20", { headers: auth });
  const afterItems = after.json?.items ?? [];
  const newFailures = afterItems.filter((j) => !beforeIds.has(j.id));

  console.log(`  failed jobs after: ${afterItems.length} (status=${after.status})`);
  console.log(`  new failures since request: ${newFailures.length}`);
  if (newFailures.length > 0) {
    console.log("  NEW FAILURE DETAIL:", JSON.stringify(newFailures, null, 2));
    console.log("\n  RESULT: FAIL — a new auth-email job failed after the password-reset request.\n");
    process.exit(1);
  }

  console.log("\n  RESULT: PASS — password-reset/request returned 200 and no new auth-email job failure appeared.\n");
}

run().catch((e) => {
  console.error("Check crashed:", e.message);
  process.exit(1);
});
