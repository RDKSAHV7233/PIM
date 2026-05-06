#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || /^\s*#/.test(line)) {
      continue;
    }
    const idx = line.indexOf("=");
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
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
  setDefaultEnv("PIM_DEFAULT_ROLE", "admin");
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
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await sleep(400);
  }
  throw new Error(`API did not become healthy at ${baseUrl}/health within ${timeoutMs}ms`);
}

async function apiRequest(baseUrl, method, route, token, body) {
  const headers = { Accept: "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const options = {
    method,
    headers,
    signal: AbortSignal.timeout(20_000),
  };
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertStatus(result, expected, context) {
  if (result.status !== expected) {
    throw new Error(
      `${context}: expected HTTP ${expected}, got ${result.status}; payload=${JSON.stringify(result.payload)}`,
    );
  }
}

function assertResponseShape(payload, context) {
  const required = [
    "jobId",
    "totalRows",
    "acceptedRows",
    "blockingErrors",
    "warnings",
    "duplicateSkuIssues",
    "missingRequiredFields",
    "mappingGaps",
    "sampleRowErrors",
  ];
  for (const key of required) {
    assert(
      key in payload,
      `${context}: response missing required key "${key}"; payload=${JSON.stringify(payload)}`,
    );
  }
  assert(typeof payload.jobId === "string", `${context}: jobId must be string`);
  assert(typeof payload.totalRows === "number", `${context}: totalRows must be number`);
  assert(typeof payload.acceptedRows === "number", `${context}: acceptedRows must be number`);
  assert(Array.isArray(payload.blockingErrors), `${context}: blockingErrors must be array`);
  assert(Array.isArray(payload.warnings), `${context}: warnings must be array`);
  assert(Array.isArray(payload.duplicateSkuIssues), `${context}: duplicateSkuIssues must be array`);
  assert(Array.isArray(payload.missingRequiredFields), `${context}: missingRequiredFields must be array`);
  assert(Array.isArray(payload.mappingGaps), `${context}: mappingGaps must be array`);
  assert(Array.isArray(payload.sampleRowErrors), `${context}: sampleRowErrors must be array`);
}

async function login(baseUrl, userId, workspaceSlug) {
  const response = await apiRequest(baseUrl, "POST", "/auth/login", null, {
    userId,
    workspaceSlug,
    password: process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password",
    expiresInMinutes: 30,
  });
  assertStatus(response, 201, `login ${userId}`);
  const token = String(response.payload?.accessToken ?? "");
  assert(token.length > 10, `missing access token for ${userId}`);
  return token;
}

async function loginWithRetry(baseUrl, userId, workspaceSlug, maxAttempts = 8, delayMs = 600) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await login(baseUrl, userId, workspaceSlug);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("401") && !message.includes("INVALID_CREDENTIALS")) {
        throw error;
      }
      if (attempt < maxAttempts) {
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
}

async function countProducts(baseUrl, token) {
  const result = await apiRequest(baseUrl, "GET", "/catalog/products?limit=1", token);
  if (result.status !== 200) {
    return 0;
  }
  if (Array.isArray(result.payload)) {
    // If the endpoint returns paginated, use totalCount or count the array
    return result.payload.length;
  }
  if (typeof result.payload === "object" && result.payload !== null) {
    if (typeof result.payload.totalCount === "number") {
      return result.payload.totalCount;
    }
    if (Array.isArray(result.payload.items)) {
      return result.payload.items.length;
    }
  }
  return 0;
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 6840 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `bip-tenant-${runId}`;
  const workspaceSlug = `bip-${runId}`.slice(0, 24);
  const adminUser = `bip-admin-${runId}`;

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [adminUser]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Bulk Import Preflight" },
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
    if (stdoutBuffer.length > 200) {
      stdoutBuffer.shift();
    }
  });
  apiProcess.stderr.on("data", (chunk) => {
    stderrBuffer.push(String(chunk));
    if (stderrBuffer.length > 200) {
      stderrBuffer.shift();
    }
  });

  try {
    await waitForHealth(baseUrl, 60_000);
    await sleep(800);

    const token = await loginWithRetry(baseUrl, adminUser, workspaceSlug);

    // Create a category for the job
    const cat = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
      name: `Preflight Test Cat ${runId}`,
    });
    assertStatus(cat, 201, "create category for preflight test");
    const categoryId = cat.payload.id;

    // Snapshot product count before creating the job
    const productCountBefore = await countProducts(baseUrl, token);

    // Create a bulk import job with 4 rows:
    // Row 1: valid row with skuCode and title
    // Row 2: valid row with a DIFFERENT skuCode and title
    // Row 3: row with the SAME skuCode as row 2 (duplicate → duplicateSkuIssues)
    // Row 4: row missing title (and skuCode) → missingRequiredFields
    const sku1 = `PREFLIGHT-SKU-A-${runId}`;
    const sku2 = `PREFLIGHT-SKU-B-${runId}`;

    const jobResult = await apiRequest(baseUrl, "POST", "/bulk-import/jobs", token, {
      categoryId,
      sourceFormat: "json",
      sourceName: `preflight-test-${runId}`,
      rows: [
        { title: "Valid Product One", brand: "Vexa", skuCode: sku1, description: "First row" },
        { title: "Valid Product Two", brand: "Vexa", skuCode: sku2, description: "Second row" },
        { title: "Valid Product Three Duplicate SKU", brand: "Vexa", skuCode: sku2, description: "Third row — duplicate sku2" },
        { brand: "Vexa", description: "Fourth row — missing title and skuCode" },
      ],
    });
    assertStatus(jobResult, 201, "create bulk import job");
    const jobId = jobResult.payload.id;
    assert(typeof jobId === "string" && jobId.length > 0, `job id must be a non-empty string; got ${jobId}`);

    // Snapshot product count after creating job (should still be same — job creation does not process)
    const productCountAfterCreate = await countProducts(baseUrl, token);

    // Call the preflight validate endpoint
    const validateResult = await apiRequest(baseUrl, "POST", `/bulk-import/jobs/${jobId}/validate`, token);
    assertStatus(validateResult, 200, "POST /bulk-import/jobs/:id/validate");
    const v = validateResult.payload;

    // Assert response shape
    assertResponseShape(v, "preflight validate");

    // Assert job id matches
    assert(v.jobId === jobId, `response jobId must match the job; expected=${jobId} got=${v.jobId}`);

    // Assert totalRows
    assert(
      v.totalRows === 4,
      `totalRows must be 4; got ${v.totalRows}`,
    );

    // Assert that validate did NOT create any products (zero-write guarantee)
    const productCountAfterValidate = await countProducts(baseUrl, token);
    assert(
      productCountAfterValidate === productCountAfterCreate,
      `validate must not create any products; before=${productCountAfterCreate} after=${productCountAfterValidate}`,
    );
    assert(
      productCountAfterCreate === productCountBefore,
      `job creation must not create any products; before=${productCountBefore} after=${productCountAfterCreate}`,
    );

    // Assert duplicateSkuIssues is non-empty (sku2 appears in rows 2 and 3)
    assert(
      v.duplicateSkuIssues.length > 0,
      `duplicateSkuIssues must be non-empty for duplicate skuCode ${sku2}; got=${JSON.stringify(v.duplicateSkuIssues)}`,
    );
    const dupEntry = v.duplicateSkuIssues.find((entry) => entry.skuCode === sku2);
    assert(
      dupEntry !== undefined,
      `duplicateSkuIssues must include skuCode=${sku2}; got=${JSON.stringify(v.duplicateSkuIssues)}`,
    );
    assert(
      Array.isArray(dupEntry.rowNumbers) && dupEntry.rowNumbers.length >= 2,
      `duplicateSkuIssues entry for ${sku2} must have at least 2 rowNumbers; got=${JSON.stringify(dupEntry)}`,
    );

    // Assert missingRequiredFields includes skuCode or blockingErrors mentions it
    const missingHasSkuCode = Array.isArray(v.missingRequiredFields) && v.missingRequiredFields.includes("skuCode");
    const blockingMentionsSkuCode = Array.isArray(v.blockingErrors) &&
      v.blockingErrors.some((e) => String(e).toLowerCase().includes("skucode") || String(e).toLowerCase().includes("sku"));
    assert(
      missingHasSkuCode || blockingMentionsSkuCode,
      `missing skuCode must appear in missingRequiredFields or blockingErrors; missingRequiredFields=${JSON.stringify(v.missingRequiredFields)} blockingErrors=${JSON.stringify(v.blockingErrors)}`,
    );

    // Assert acceptedRows <= totalRows
    assert(
      v.acceptedRows <= v.totalRows,
      `acceptedRows (${v.acceptedRows}) must be <= totalRows (${v.totalRows})`,
    );

    // Assert sampleRowErrors has at most 5 entries
    assert(
      v.sampleRowErrors.length <= 5,
      `sampleRowErrors must have at most 5 entries; got ${v.sampleRowErrors.length}`,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          jobId,
          totalRows: v.totalRows,
          acceptedRows: v.acceptedRows,
          blockingErrors: v.blockingErrors,
          duplicateSkuIssues: v.duplicateSkuIssues,
          missingRequiredFields: v.missingRequiredFields,
          productCountBefore,
          productCountAfterValidate,
          validated: [
            "validate_endpoint_returns_200_with_correct_shape",
            "zero_products_created_after_validate",
            "zero_products_created_after_job_create",
            "duplicate_skuCode_detected_in_duplicateSkuIssues",
            "missing_skuCode_detected_in_missingRequiredFields_or_blockingErrors",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const stdout = stdoutBuffer.join("").slice(-4000);
    const stderr = stderrBuffer.join("").slice(-4000);
    console.error("Bulk import preflight integration test failed:");
    console.error(details);
    if (stdout) {
      console.error("--- API stdout tail ---");
      console.error(stdout);
    }
    if (stderr) {
      console.error("--- API stderr tail ---");
      console.error(stderr);
    }
    process.exitCode = 1;
  } finally {
    if (!apiProcess.killed && apiProcess.pid) {
      if (process.platform === "win32") {
        try {
          execFileSync("taskkill", ["/pid", String(apiProcess.pid), "/t", "/f"], { stdio: "ignore" });
        } catch {
          // Ignore cleanup failures.
        }
      } else {
        apiProcess.kill("SIGTERM");
        await sleep(500);
        if (!apiProcess.killed) {
          apiProcess.kill("SIGKILL");
        }
      }
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
