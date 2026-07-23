#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "src", "main.ts");

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
    } catch {}
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
  let payload = null;
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
    throw new Error(`${context} failed: expected ${expected}, got ${result.status}; payload=${JSON.stringify(result.payload)}`);
  }
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API source entry not found at ${API_ENTRY}.`);
  }

  const runId = Date.now().toString();
  const apiPort = 6310 + Math.floor(Math.random() * 80);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `bulk-import-validate-${runId}`;
  const workspaceSlug = `import-validate-${runId}`.slice(0, 24);
  const adminUserId = `import-admin-${runId}`;
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [adminUserId]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Bulk Import Validate" },
    }),
  };

  const stdoutBuffer = [];
  const stderrBuffer = [];
  const tsNodeEntry = path.join(REPO_ROOT, "node_modules", "ts-node", "dist", "bin.js");
  const apiProcess = spawn(process.execPath, [tsNodeEntry, "--project", "apps/api/tsconfig.build.json", API_ENTRY], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  apiProcess.stdout.on("data", (chunk) => stdoutBuffer.push(String(chunk)));
  apiProcess.stderr.on("data", (chunk) => stderrBuffer.push(String(chunk)));

  try {
    await waitForHealth(baseUrl, 120_000);

    const authPassword = process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password";
    const adminLogin = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      userId: adminUserId,
      workspaceSlug,
      password: authPassword,
      expiresInMinutes: 30,
    });
    assertStatus(adminLogin, 201, "admin login");
    const adminToken = String(adminLogin.payload?.accessToken ?? "");

    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", adminToken, {
      name: `Import Validate Category ${runId}`,
    });
    assertStatus(category, 201, "create category");

    const validSummary = await apiRequest(baseUrl, "POST", "/bulk-import/validate", adminToken, {
      categoryId: category.payload.id,
      sourceFormat: "json",
      sourceName: "valid-import.json",
      rows: [
        {
          title: `Import Row ${runId}`,
          description: "ready to import",
          brand: "Vexa PIM",
          status: "draft",
          hsnCode: "62046200",
          gstRate: 18,
          attributes: { material: "Cotton" },
          skuCode: `SKU-${runId}`,
        },
      ],
      chunkSize: 10,
      maxRetries: 2,
    });
    assertStatus(validSummary, 201, "validate valid import payload");
    assert(validSummary.payload.canImport === true, "valid payload must be importable");
    assert(validSummary.payload.blockingIssueCount === 0, "valid payload must have zero blocking issues");
    assert(validSummary.payload.acceptedRows === 1, "valid payload must accept the row");
    assert(validSummary.payload.categoryPath === category.payload.path, "validation summary must include category path");

    const mixedSummary = await apiRequest(baseUrl, "POST", "/bulk-import/validate", adminToken, {
      categoryId: category.payload.id,
      sourceFormat: "json",
      sourceName: "mixed-import.json",
      rows: [
        {
          title: "",
          description: "bad workflow row",
          brand: "",
          status: "approved",
          gstRate: -3,
          attributes: {},
        },
        {
          title: "Second row",
          description: "missing brand warning only",
          brand: "",
          status: "draft",
          hsnCode: "",
          gstRate: 18,
          attributes: {},
        },
      ],
      chunkSize: 10,
      maxRetries: 2,
    });
    assertStatus(mixedSummary, 201, "validate mixed import payload");
    assert(mixedSummary.payload.canImport === false, "mixed payload must block import");
    assert(mixedSummary.payload.totalRows === 2, "mixed payload must report total row count");
    assert(mixedSummary.payload.blockingIssueCount >= 3, "mixed payload must count blocking issues");
    assert(mixedSummary.payload.warningCount >= 2, "mixed payload must count warnings");
    assert(mixedSummary.payload.failedRows >= 1, "mixed payload must flag failed rows");
    assert(
      Array.isArray(mixedSummary.payload.sampleIssues) &&
      mixedSummary.payload.sampleIssues.some((issue) => issue.code === "WORKFLOW_ENTRY_INVALID") &&
      mixedSummary.payload.sampleIssues.some((issue) => issue.code === "TITLE_REQUIRED"),
      "mixed payload must surface representative blocking sample issues",
    );

    const malformedCsv = await apiRequest(baseUrl, "POST", "/bulk-import/validate", adminToken, {
      categoryId: category.payload.id,
      sourceFormat: "csv",
      sourceName: "malformed-import.csv",
      fileContentBase64: Buffer.from("title,brand", "utf8").toString("base64"),
      chunkSize: 10,
      maxRetries: 2,
    });
    assertStatus(malformedCsv, 400, "validate malformed csv payload");
    assert(
      String(malformedCsv.payload?.message ?? "").includes("CSV must include header and at least one data row."),
      "malformed csv payload must explain why parsing failed",
    );

    const emptySummary = await apiRequest(baseUrl, "POST", "/bulk-import/validate", adminToken, {
      categoryId: category.payload.id,
      sourceFormat: "json",
      sourceName: "empty-import.json",
      rows: [],
      chunkSize: 10,
      maxRetries: 2,
    });
    assertStatus(emptySummary, 201, "validate empty import payload");
    assert(emptySummary.payload.canImport === false, "empty payload must not be importable");
    assert(
      Array.isArray(emptySummary.payload.sampleIssues) &&
      emptySummary.payload.sampleIssues.some((issue) => issue.code === "NO_ROWS"),
      "empty payload must report NO_ROWS sample issue",
    );

    const missingCategory = await apiRequest(baseUrl, "POST", "/bulk-import/validate", adminToken, {
      categoryId: `missing-${runId}`,
      sourceFormat: "json",
      rows: [{ title: "Ghost row", brand: "Ghost", description: "ghost", status: "draft", attributes: {} }],
    });
    assertStatus(missingCategory, 404, "validate missing category");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          validated: [
            "bulk_import_validate_accepts_valid_payload",
            "bulk_import_validate_reports_blocking_and_warning_mix",
            "bulk_import_validate_rejects_malformed_csv_payloads",
            "bulk_import_validate_handles_empty_rows",
            "bulk_import_validate_requires_real_category",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("Bulk import validate integration test failed:");
    console.error(error instanceof Error ? error.message : String(error));
    const stdout = stdoutBuffer.join("").slice(-4000);
    const stderr = stderrBuffer.join("").slice(-4000);
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
        } catch {}
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
