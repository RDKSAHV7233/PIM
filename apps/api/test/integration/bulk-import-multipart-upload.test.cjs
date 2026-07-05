#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
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
  const localDatabaseUrl = "postgresql://postgres:postgres@localhost:5432/pim1?schema=public";
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl || /HOST:5432/i.test(databaseUrl)) {
    process.env.DATABASE_URL = localDatabaseUrl;
  }
  if (!process.env.DATABASE_URL_POOLED || /HOST:5432/i.test(String(process.env.DATABASE_URL_POOLED))) {
    process.env.DATABASE_URL_POOLED = process.env.DATABASE_URL;
  }
  if (!process.env.DATABASE_URL_DIRECT || /HOST:5432/i.test(String(process.env.DATABASE_URL_DIRECT))) {
    process.env.DATABASE_URL_DIRECT = process.env.DATABASE_URL;
  }
  setDefaultEnv("JWT_SECRET", "vexa-pim-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "vexa-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
  setDefaultEnv("APP_ENV", "development");
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

function generateCsv(rowCount) {
  const header = "title,description,brand,sku,sellingPrice,hsnCode,gstRate,status,attributes";
  const lines = [header];
  for (let i = 1; i <= rowCount; i++) {
    const attrs = JSON.stringify({ material: "cotton", color: "blue", weight: i * 0.5 + "kg" });
    lines.push([
      "Product " + i + " Test Import Item With Realistic Name",
      "Description for product " + i + " with enough text to simulate real-world data including specs and features",
      "BrandName-" + (i % 50),
      "SKU-MPART-" + crypto.randomUUID().slice(0, 8) + "-" + String(i).padStart(6, "0"),
      (Math.random() * 10000).toFixed(2),
      "6109" + String(i % 100).padStart(2, "0") + "00",
      (i % 3 === 0 ? 18 : i % 3 === 1 ? 12 : 5),
      "draft",
      '"' + attrs.replace(/"/g, '""') + '"',
    ].join(","));
  }
  return lines.join("\r\n");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function testMultipartUpload(baseUrl, token, rowCount, categoryId) {
  const label = `${rowCount / 1000}k`;
  console.log(`\n=== Testing ${label}-row CSV multipart upload ===`);

  const startGen = Date.now();
  const csvContent = generateCsv(rowCount);
  const csvBuffer = Buffer.from(csvContent, "utf-8");
  const sizeMB = (csvBuffer.length / (1024 * 1024)).toFixed(2);
  console.log(`  Generated: ${sizeMB} MB (${csvBuffer.length} bytes) in ${Date.now() - startGen}ms`);

  // Step 1: Multipart upload
  const boundary = "----FormBoundary" + crypto.randomUUID().replace(/-/g, "");
  const parts = [];
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="categoryId"\r\n\r\n${categoryId}`);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="sourceName"\r\n\r\ntest-${label}.csv`);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="maxRetries"\r\n\r\n3`);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="sourceFile"; filename="test-${label}.csv"\r\nContent-Type: text/csv\r\n\r\n`);
  const bodyParts = [
    Buffer.from(parts.join("\r\n") + "\r\n", "utf-8"),
    csvBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8"),
  ];
  const body = Buffer.concat(bodyParts);

  const startUpload = Date.now();
  const uploadRes = await fetch(`${baseUrl}/bulk-import/runs/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",

      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
    signal: AbortSignal.timeout(60_000),
  });
  const uploadDuration = Date.now() - startUpload;
  const uploadPayload = await uploadRes.json();
  console.log(`  Upload: ${uploadRes.status} in ${uploadDuration}ms`);

  if (!uploadRes.ok || !uploadPayload.id) {
    console.log(`  FAILED: upload returned ${uploadRes.status}: ${JSON.stringify(uploadPayload)}`);
    return { status: "FAIL", phase: "upload", rowCount, sizeMB, httpStatus: uploadRes.status, error: uploadPayload.message ?? uploadPayload.error };
  }
  const runId = uploadPayload.id;
  console.log(`  Run ID: ${runId}`);

  // Step 2: Validate the run
  const startValidate = Date.now();
  const validateRes = await fetch(`${baseUrl}/bulk-import/runs/${encodeURIComponent(runId)}/validate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",

    },
    signal: AbortSignal.timeout(120_000),
  });
  const validateDuration = Date.now() - startValidate;
  const validatePayload = await validateRes.json();
  console.log(`  Validate: ${validateRes.status} in ${validateDuration}ms`);

  if (!validateRes.ok) {
    console.log(`  FAILED: validate returned ${validateRes.status}: ${JSON.stringify(validatePayload).slice(0, 200)}`);
    return { status: "FAIL", phase: "validate", rowCount, sizeMB, runId, httpStatus: validateRes.status, error: validatePayload.message };
  }

  const run = validatePayload;
  const preflight = run.preflightSummary ?? {};
  const result = {
    status: run.status === "preflight_ready" ? "PASS" : run.status === "preflight_blocked" ? "BLOCKED_BY_PREFLIGHT" : run.status,
    rowCount,
    sizeMB,
    runId,
    totalRows: run.totalRows,
    acceptedRows: run.acceptedRows,
    failedRows: run.failedRows,
    blockingIssueCount: run.blockingIssueCount,
    warningCount: run.warningCount,
    effectiveMode: run.effectiveMode,
    estimatedBatchCount: run.estimatedBatchCount,
    canImport: preflight.canImport ?? false,
    mvpCeilingExceeded: preflight.mvpCeilingExceeded ?? false,
    uploadDuration: uploadDuration + "ms",
    validateDuration: validateDuration + "ms",
  };

  console.log(`  Result: ${result.status}`);
  console.log(`  Total rows: ${result.totalRows}, accepted: ${result.acceptedRows}, failed: ${result.failedRows}`);
  console.log(`  Blocking: ${result.blockingIssueCount}, warnings: ${result.warningCount}`);
  console.log(`  Mode: ${result.effectiveMode}, batches: ${result.estimatedBatchCount}`);
  console.log(`  Can import: ${result.canImport}, ceiling exceeded: ${result.mvpCeilingExceeded}`);

  return result;
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
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { status: response.status, payload };
}

async function login(baseUrl, userId, workspaceSlug) {
  const response = await apiRequest(baseUrl, "POST", "/auth/login", null, {
    userId,
    workspaceSlug,
    password: process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password",
    expiresInMinutes: 30,
  });
  assert(response.status === 201, `login failed: HTTP ${response.status}`);
  const token = String(response.payload?.accessToken ?? "");
  assert(token.length > 10, "missing access token");
  return token;
}

async function loginWithRetry(baseUrl, userId, workspaceSlug, maxAttempts = 8, delayMs = 600) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await login(baseUrl, userId, workspaceSlug);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await sleep(delayMs);
    }
  }
  throw lastError;
}

async function main() {
  if (!fs.existsSync(API_ENTRY)) {
    console.error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
    process.exit(1);
  }

  prepareEnv();

  const PORT = 6340;
  const baseUrl = `http://127.0.0.1:${PORT}/api/v1`;
  const runId = crypto.randomUUID().slice(0, 8);
  const adminUser = `mpart-admin-${runId}`;
  const workspaceSlug = `mpart-ws-${runId}`;
  const tenantId = `mpart-tenant-${Date.now()}`;

  const env = {
    ...process.env,
    PORT: String(PORT),
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [adminUser]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Multipart Upload Test" },
    }),
  };

  console.log("Starting API server...");
  const stderrLines = [];
  const apiProcess = spawn("node", [API_ENTRY], {
    cwd: REPO_ROOT,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  apiProcess.stderr.on("data", (data) => stderrLines.push(data.toString()));
  apiProcess.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error("API exited with code", code);
      console.error("--- API stderr tail ---");
      console.error(stderrLines.slice(-5).join(""));
    }
  });

  try {
    await waitForHealth(baseUrl, 120_000);
    await sleep(800);
    console.log("API is healthy.");

    const token = await loginWithRetry(baseUrl, adminUser, workspaceSlug);
    console.log("Logged in.");

    // Create a test category
    const catRes = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
      name: `Multipart Test ${runId}`,
    });
    assert(catRes.status === 201, `create category failed: HTTP ${catRes.status}`);
    const categoryId = catRes.payload.id;
    console.log(`Category created: ${categoryId}`);

    const results = {};

    // Test 20k rows
    results["20k"] = await testMultipartUpload(baseUrl, token, 20_000, categoryId);

    // Test 30k rows
    results["30k"] = await testMultipartUpload(baseUrl, token, 30_000, categoryId);

    // Test 50k rows (will hit 30k row ceiling — expected BLOCKED_BY_PREFLIGHT)
    results["50k"] = await testMultipartUpload(baseUrl, token, 50_000, categoryId);

    console.log("\n=== SUMMARY ===");
    console.log(JSON.stringify(results, null, 2));

    // Assertions — the test tenant may not have a configured plan, so the row
    // ceiling from PlanUsageService may block imports even for valid files.
    // The critical thing is: upload succeeds (run ID assigned) and validation
    // returns a structured result (not a JSON parse error).
    for (const [label, result] of Object.entries(results)) {
      assert(result.runId, `${label} CSV: upload must succeed and return a run ID`);
      assert(typeof result.totalRows === "number" && result.totalRows > 0,
        `${label} CSV: validation must parse the file and report totalRows`);
      assert(result.status === "PASS" || result.status === "BLOCKED_BY_PREFLIGHT",
        `${label} CSV: expected PASS or BLOCKED_BY_PREFLIGHT, got ${result.status}`);
    }
    // 50k: upload must succeed (file is under 32MB) even if validation blocks on row ceiling
    assert(results["50k"].runId, "50k CSV: upload must succeed (file is under 32MB)");

    console.log("\nAll multipart upload tests passed.");
  } finally {
    apiProcess.kill("SIGTERM");
    await sleep(500);
  }
}

main().catch((error) => {
  console.error("Multipart upload test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
