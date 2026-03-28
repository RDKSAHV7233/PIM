#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
const AUTH_PASSWORD = process.env.PIM_AUTH_PASSWORD || "tej-pim-demo-password";

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
    if (key && !process.env[key]) process.env[key] = value;
  }
}

function setDefaultEnv(name, value) {
  if (!process.env[name] || String(process.env[name]).trim().length === 0) {
    process.env[name] = value;
  }
}

function prepareEnv() {
  readEnvFile(path.join(REPO_ROOT, ".env"));
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    setDefaultEnv("DATABASE_URL_POOLED", databaseUrl);
    setDefaultEnv("DATABASE_URL_DIRECT", databaseUrl);
  }
  setDefaultEnv("JWT_SECRET", "tej-pim-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "tej-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "tej-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/tej-pim-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, { method: "GET" });
      if (response.ok) return;
    } catch {}
    await sleep(400);
  }
  throw new Error(`API did not become healthy at ${baseUrl}/health within ${timeoutMs}ms`);
}

async function apiRequest(baseUrl, method, route, token, body) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const options = { method, headers, signal: AbortSignal.timeout(20_000) };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${route}`, options);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, payload };
}

function assertStatus(result, expected, context) {
  if (result.status !== expected) {
    throw new Error(`${context} failed: expected ${expected}, got ${result.status}; payload=${JSON.stringify(result.payload)}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 6700 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `catalog-projections-${runId}`;
  const workspaceSlug = `proj-${runId}`.slice(0, 24);
  const userId = `catalog-projections-user-${runId}`;
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Catalog Projections" },
    }),
  };

  const stdoutBuffer = [];
  const stderrBuffer = [];
  const apiProcess = spawn("node", [API_ENTRY], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  apiProcess.stdout.on("data", (chunk) => {
    stdoutBuffer.push(String(chunk));
    if (stdoutBuffer.length > 200) stdoutBuffer.shift();
  });
  apiProcess.stderr.on("data", (chunk) => {
    stderrBuffer.push(String(chunk));
    if (stderrBuffer.length > 200) stderrBuffer.shift();
  });

  try {
    await waitForHealth(baseUrl, 60_000);

    const login = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId,
      password: AUTH_PASSWORD,
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "login");
    const token = String(login.payload?.accessToken ?? "");

    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
      name: `Projection Category ${runId}`,
    });
    assertStatus(category, 201, "create category");

    for (let index = 0; index < 55; index += 1) {
      const created = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
        title: `Projection Product ${index} ${runId}`,
        brand: "TEJ PIM",
        description: "Projection coverage",
        categoryId: category.payload.id,
        status: "draft",
        hsnCode: "62046200",
        gstRate: 18,
        attributes: {},
      });
      assertStatus(created, 201, `create product ${index}`);
    }

    const slim = await apiRequest(baseUrl, "GET", "/catalog/products?slim=true", token);
    assertStatus(slim, 200, "list slim products");
    assert(Array.isArray(slim.payload.items), "expected slim payload items array");
    assert(slim.payload.items.length === 50, `expected slim default limit 50, got ${slim.payload.items.length}`);
    assert(typeof slim.payload.nextCursor === "string" && slim.payload.nextCursor.length > 0, "expected slim nextCursor");
    const slimItem = slim.payload.items[0];
    assert(!("variants" in slimItem), "slim list must not include variants array");
    assert(!("validationIssues" in slimItem), "slim list must not include validation issues array");
    assert("variantCount" in slimItem, "slim list must include variant count");
    assert("openValidationErrorCount" in slimItem, "slim list must include validation counts");

    const legacy = await apiRequest(baseUrl, "GET", "/catalog/products", token);
    assertStatus(legacy, 200, "list legacy products");
    assert(Array.isArray(legacy.payload), "legacy list should remain array");
    assert(legacy.payload.length >= 55, `expected full legacy list, got ${legacy.payload.length}`);
    const legacyItem = legacy.payload[0];
    assert(Array.isArray(legacyItem.variants), "legacy list should still include variants");
    assert(Array.isArray(legacyItem.validationIssues), "legacy list should still include validation issues");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          validated: ["catalog_products_slim_projection", "catalog_products_legacy_shape_preserved"],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("Catalog products list projections integration test failed:");
    console.error(error instanceof Error ? error.message : String(error));
    const stderr = stderrBuffer.join("");
    if (stderr.trim()) {
      console.error("--- api stderr tail ---");
      console.error(stderr.slice(-4000));
    }
    process.exitCode = 1;
  } finally {
    apiProcess.kill("SIGTERM");
    await sleep(500);
  }
}

run().catch((error) => {
  console.error("Catalog products list projections integration test crashed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
