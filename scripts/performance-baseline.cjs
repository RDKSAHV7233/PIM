#!/usr/bin/env node
/**
 * Performance Baseline Measurement
 *
 * Measures API response times for critical endpoints and records them.
 * Run periodically to detect regressions. No external dependencies.
 *
 * Usage: node scripts/performance-baseline.cjs
 *
 * Environment:
 *   PLAYWRIGHT_API_URL — API base URL (default: http://127.0.0.1:4001/api/v1)
 *   PLAYWRIGHT_WORKSPACE — workspace slug (default: default)
 *   PIM_AUTH_PASSWORD or PLAYWRIGHT_PASSWORD — login password
 */

/* eslint-disable no-console */

const API_URL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:4001/api/v1";
const WORKSPACE = process.env.PLAYWRIGHT_WORKSPACE || "default";
const PASSWORD = process.env.PLAYWRIGHT_PASSWORD || process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password";
const ADMIN_USER = process.env.PLAYWRIGHT_ADMIN_USER || "admin@vexa-pim.local";

const THRESHOLDS = {
  health: 200,         // /health — should be instant
  login: 1000,         // /auth/login — bcrypt hash
  products_list: 2000, // /catalog/products — paginated
  product_create: 1500,// POST /catalog/products
  dashboard: 3000,     // /dashboard/snapshot
  categories: 1000,    // /taxonomy/categories
  connectors: 1000,    // /connectors/installed
  audit: 2000,         // /audit
  usage: 1000,         // /billing/usage
  users: 1000,         // /admin/workspace/users
};

async function measure(label, fn) {
  const start = performance.now();
  try {
    const result = await fn();
    const ms = Math.round(performance.now() - start);
    const threshold = THRESHOLDS[label] || 2000;
    const status = ms <= threshold ? "PASS" : "SLOW";
    console.log(`  ${status === "PASS" ? "\x1b[32m✓\x1b[0m" : "\x1b[33m⚠\x1b[0m"} ${label}: ${ms}ms (threshold: ${threshold}ms)`);
    return { label, ms, threshold, status, ok: true };
  } catch (err) {
    const ms = Math.round(performance.now() - start);
    console.log(`  \x1b[31m✗\x1b[0m ${label}: FAILED in ${ms}ms — ${err.message.slice(0, 80)}`);
    return { label, ms, threshold: THRESHOLDS[label] || 2000, status: "FAIL", ok: false };
  }
}

async function request(method, route, token, body) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const opts = { method, headers, signal: AbortSignal.timeout(30_000) };
  if (body) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${API_URL}${route}`, opts);
  if (!res.ok) throw new Error(`${method} ${route}: ${res.status}`);
  return res.json();
}

async function run() {
  console.log(`\nPerformance Baseline — ${new Date().toISOString()}`);
  console.log(`API: ${API_URL}\n`);

  const results = [];

  // 1. Health (no auth)
  results.push(await measure("health", () => request("GET", "/health")));

  // 2. Login
  let token;
  results.push(await measure("login", async () => {
    const payload = await request("POST", "/auth/login", null, {
      workspaceSlug: WORKSPACE,
      userId: ADMIN_USER,
      password: PASSWORD,
      expiresInMinutes: 10,
    });
    token = payload.accessToken;
    return payload;
  }));

  if (!token) {
    console.log("\n\x1b[31mLogin failed — cannot measure authenticated endpoints.\x1b[0m\n");
    process.exit(1);
  }

  // 3. Authenticated endpoints
  results.push(await measure("products_list", () => request("GET", "/catalog/products?limit=20", token)));
  results.push(await measure("categories", () => request("GET", "/taxonomy/categories?limit=20", token)));
  results.push(await measure("dashboard", () => request("GET", "/dashboard/snapshot", token)));
  results.push(await measure("connectors", () => request("GET", "/connectors/installed?limit=10", token)));
  results.push(await measure("usage", () => request("GET", "/billing/usage", token)));
  results.push(await measure("users", () => request("GET", "/admin/workspace/users", token)));
  results.push(await measure("audit", () => request("GET", "/audit?limit=10", token)));

  // Summary
  const passed = results.filter(r => r.status === "PASS").length;
  const slow = results.filter(r => r.status === "SLOW").length;
  const failed = results.filter(r => r.status === "FAIL").length;
  const total = results.length;

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Results: ${passed}/${total} within threshold, ${slow} slow, ${failed} failed`);

  if (failed > 0) {
    console.log("\x1b[31mFailed endpoints need investigation.\x1b[0m");
    process.exit(1);
  }
  if (slow > 0) {
    console.log("\x1b[33mSome endpoints are above threshold — consider optimization.\x1b[0m");
  } else {
    console.log("\x1b[32mAll endpoints within performance thresholds.\x1b[0m");
  }

  // Write baseline to file
  const fs = require("node:fs");
  const path = require("node:path");
  const baselinePath = path.join(__dirname, "../.runlogs/performance-baseline.json");
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, JSON.stringify({
    timestamp: new Date().toISOString(),
    apiUrl: API_URL,
    results: results.map(r => ({ label: r.label, ms: r.ms, threshold: r.threshold, status: r.status })),
  }, null, 2));
  console.log(`\nBaseline saved to ${path.relative(process.cwd(), baselinePath)}\n`);
}

run().catch((err) => {
  console.error("Performance baseline failed:", err.message);
  process.exit(1);
});
