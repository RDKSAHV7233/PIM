#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");

function resolveAuthPassword() {
  return String(process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password");
}

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
  setDefaultEnv("JWT_SECRET", "vexa-pim-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "vexa-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");  // Set L: auth middleware Redis gate
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
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
  const apiPort = 6940 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `export-template-summary-${runId}`;
  const workspaceSlug = `exp-${runId}`.slice(0, 24);
  const userId = `export-template-user-${runId}`;
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Export Template Summary" },
    }),
  };

  const stderrBuffer = [];
  const prisma = new PrismaClient({
    datasources: {
      db: { url: process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL },
    },
  });
  const apiProcess = spawn("node", [API_ENTRY], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
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
      password: resolveAuthPassword(),
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "login");
    const token = String(login.payload?.accessToken ?? "");

    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
      name: `Export Template Category ${runId}`,
    });
    assertStatus(category, 201, "create category");

    const product = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
      title: `Export Template Product ${runId}`,
      brand: "Vexa PIM",
      description: "Template summary coverage",
      categoryId: category.payload.id,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 18,
      attributes: {},
    });
    assertStatus(product, 201, "create product");

    const template = await apiRequest(baseUrl, "POST", `/marketplace/categories/${category.payload.id}/templates`, token, {
      channel: "amazon",
      name: `Export Summary Template ${runId}`,
      requiredFields: ["title"],
      fieldMap: { title: "title" },
      isDefault: true,
    });
    assertStatus(template, 201, "create template");

    const exportJob = await prisma.marketplaceExportJob.create({
      data: {
        tenantKey: tenantId,
        productId: product.payload.id,
        categoryId: category.payload.id,
        channel: "amazon",
        templateId: template.payload.id,
        status: "queued",
        retryCount: 0,
        maxRetries: 1,
        payload: {},
      },
    });
    assert(exportJob.id, "expected seeded export job id");

    const summaryList = await apiRequest(
      baseUrl,
      "GET",
      `/marketplace/export-jobs?productId=${encodeURIComponent(product.payload.id)}&templateSummary=true`,
      token,
    );
    assertStatus(summaryList, 200, "list export jobs with template summary");
    assert(Array.isArray(summaryList.payload), "expected export jobs array for summary list");
    assert(summaryList.payload.length >= 1, "expected at least one export job");
    const summaryTemplate = summaryList.payload[0].template;
    assert(summaryTemplate && summaryTemplate.id && summaryTemplate.name, "expected template summary object");
    assert(typeof summaryTemplate.channelId === "string", "expected template summary channelId");
    assert(!("requiredFields" in summaryTemplate), "summary template should not include full template payload");

    const legacyList = await apiRequest(
      baseUrl,
      "GET",
      `/marketplace/export-jobs?productId=${encodeURIComponent(product.payload.id)}`,
      token,
    );
    assertStatus(legacyList, 200, "list export jobs legacy payload");
    assert(Array.isArray(legacyList.payload), "expected export jobs array for legacy list");
    const legacyTemplate = legacyList.payload[0].template;
    assert(legacyTemplate && Array.isArray(legacyTemplate.requiredFields), "legacy template should retain full payload");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          validated: ["export_jobs_template_summary_projection", "export_jobs_legacy_template_preserved"],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("Export jobs template summary integration test failed:");
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
    await prisma.$disconnect().catch(() => undefined);
  }
}

run().catch((error) => {
  console.error("Export jobs template summary integration test crashed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
