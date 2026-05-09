#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
const RAW_CODE_PATTERN = /^[A-Z][A-Z_]{4,}$/;

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
    signal: AbortSignal.timeout(15_000),
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
    throw new Error(`${context} failed: expected ${expected}, got ${result.status} payload=${JSON.stringify(result.payload)}`);
  }
}

function assertSellerMessage(message, context) {
  assert(typeof message === "string" && message.trim().length >= 10, `${context}: sellerMessage must be readable text`);
  assert(!RAW_CODE_PATTERN.test(message.trim()), `${context}: sellerMessage must not be a raw connector code (${message})`);
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 5700 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `rejection-notification-tenant-${runId}`;
  const workspaceSlug = `rn-${runId}`.slice(0, 24);
  const userId = `rejection-notification-user-${runId}`;
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_PASSWORD: "vexa-pim-demo-password",
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Rejection Notification Test" },
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

  const prisma = new PrismaClient({
    datasources: {
      db: { url: process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL },
    },
  });

  try {
    await waitForHealth(baseUrl, 60_000);

    const login = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId,
      password: "vexa-pim-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "login");
    const token = login.payload?.accessToken;
    assert(typeof token === "string" && token.length > 10, "missing access token");

    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
      name: `Rejection Notification Category ${runId}`,
    });
    assertStatus(category, 201, "create category");

    const product = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
      title: `Rejection Notification Product ${runId}`,
      brand: "Vexa PIM",
      description: "Intentionally incomplete for rejection simulation",
      categoryId: category.payload.id,
      status: "draft",
      attributes: {},
    });
    assertStatus(product, 201, "create product");

    const install = await apiRequest(baseUrl, "POST", "/connectors/flipkart/install", token, {
      accountAlias: "primary",
    });
    assertStatus(install, 201, "install connector");

    const simulation = await apiRequest(
      baseUrl,
      "GET",
      `/marketplace/products/${product.payload.id}/simulate?channel=flipkart`,
      token,
    );
    assertStatus(simulation, 200, "simulate product");
    assert(Array.isArray(simulation.payload.channelIssues), "simulate response missing channelIssues array");
    assert(simulation.payload.channelIssues.length > 0, "simulate response expected at least one channel issue");
    simulation.payload.channelIssues.forEach((issue, index) => {
      assertSellerMessage(issue?.sellerMessage, `simulate.channelIssues[${index}]`);
    });

    const createJob = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/products/${product.payload.id}/export-jobs`,
      token,
      { channel: "flipkart", maxRetries: 2 },
    );
    assertStatus(createJob, 201, "create export job");
    const jobId = createJob.payload.id;

    const processJob = await apiRequest(baseUrl, "POST", `/marketplace/export-jobs/${jobId}/process`, token);
    assertStatus(processJob, 201, "process export job");

    const idempotencyKey = `${jobId}:PUBLISH`;
    // RLS-BYPASS: manual tenant filter
    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT channel_errors AS "channelErrors"
      FROM connector_submissions
      WHERE idempotency_key = $1
      `,
      idempotencyKey,
    );
    assert(Array.isArray(rows) && rows.length >= 1, "expected connector_submissions row with channel_errors");
    const channelErrors = Array.isArray(rows[0].channelErrors) ? rows[0].channelErrors : [];
    assert(channelErrors.length > 0, "expected persisted channel_errors to include at least one issue");
    channelErrors.forEach((issue, index) => {
      assertSellerMessage(issue?.sellerMessage, `connector_submissions.channel_errors[${index}]`);
    });

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          jobId,
          validated: [
            "seller_message_present_in_simulation_issues",
            "seller_message_present_in_persisted_submission_errors",
            "seller_message_not_raw_code_pattern",
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
    console.error("Rejection notification integration test failed:");
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
    await prisma.$disconnect();
    if (!apiProcess.killed && apiProcess.pid) {
      if (process.platform === "win32") {
        try {
          execFileSync("taskkill", ["/pid", String(apiProcess.pid), "/t", "/f"], { stdio: "ignore" });
        } catch {
          // ignore
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
  console.error(error);
  process.exit(1);
});



