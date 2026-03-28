#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");

function getAuthPassword() {
  return process.env.PIM_AUTH_PASSWORD || "tej-pim-demo-password";
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || /^\s*#/.test(line)) {
      continue;
    }
    const index = line.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^"|"$/g, "");
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
  setDefaultEnv("PIM_DEFAULT_ROLE", "admin");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
  setDefaultEnv("PIM_AUTH_PASSWORD", "tej-pim-demo-password");
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

function assertStatus(result, expected, context) {
  if (result.status !== expected) {
    throw new Error(`${context} failed: expected ${expected}, got ${result.status} payload=${JSON.stringify(result.payload)}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 5400 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `queue-fail-tenant-${runId}`;
  const workspaceSlug = `worker-${runId}`.slice(0, 24);
  const userId = `queue-fail-user-${runId}`;
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Worker Failure" },
    }),
    PIM_AUTH_PASSWORD: getAuthPassword(),
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
      db: {
        url: process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL,
      },
    },
  });

  try {
    await waitForHealth(baseUrl, 60_000);

    const login = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      userId,
      workspaceSlug,
      password: getAuthPassword(),
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "login");
    const accessToken = login.payload?.accessToken;
    assert(typeof accessToken === "string" && accessToken.length > 10, "missing access token from login");

    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", accessToken, {
      name: `Queue Failure Category ${runId}`,
    });
    assertStatus(category, 201, "create category");

    const product = await apiRequest(baseUrl, "POST", "/catalog/products", accessToken, {
      title: `Queue Failure Product ${runId}`,
      brand: "TEJ PIM",
      description: "Record for async failure visibility test",
      categoryId: category.payload.id,
      status: "draft",
      attributes: { color: "black", size: "M" },
      hsnCode: "62046200",
      gstRate: 18,
    });
    assertStatus(product, 201, "create product");

    const installFlipkart = await apiRequest(baseUrl, "POST", "/connectors/flipkart/install", accessToken, {
      accountAlias: "primary",
    });
    assertStatus(installFlipkart, 201, "install flipkart connector");
    const installationId = String(installFlipkart.payload.id);

    const createJob = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/products/${product.payload.id}/export-jobs`,
      accessToken,
      {
        channel: "flipkart",
        maxRetries: 3,
      },
    );
    assertStatus(createJob, 201, "create export job");
    const jobId = String(createJob.payload.id);

    // Force deterministic processing failure:
    // 1) reset job state in case async worker already completed it
    // 2) soft-delete the product so simulateProduct() fails with "Product not found"
    // RLS-BYPASS: manual tenant filter
    await prisma.$executeRawUnsafe(
      `
      UPDATE "MarketplaceExportJob"
      SET "status" = 'queued',
          "retryCount" = 0,
          "failureReason" = NULL,
          "dlqReason" = NULL,
          "exportPayload" = NULL
      WHERE "id" = $1 AND "tenantKey" = $2
      `,
      jobId,
      tenantId,
    );
    // RLS-BYPASS: manual tenant filter
    await prisma.$executeRawUnsafe(
      `
      UPDATE "Product"
      SET "deletedAt" = NOW()
      WHERE "id" = $1 AND "tenantKey" = $2
      `,
      product.payload.id,
      tenantId,
    );

    const forcedProcess = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/export-jobs/${jobId}/process`,
      accessToken,
    );
    assertStatus(forcedProcess, 201, "process export job with missing product");
    const failedJob = forcedProcess.payload;
    assert(failedJob.status === "failed", `expected failed status, got ${String(failedJob.status)}`);
    const failureReason = String(failedJob.failureReason ?? "");
    assert(
      failureReason.toLowerCase().includes("product not found"),
      `expected failure reason to include not-found context, got '${failureReason}'`,
    );

    const installationStatus = await prisma.$queryRawUnsafe(
      `
      SELECT status
      FROM connector_installations
      WHERE id = $1 AND tenant_key = $2
      `,
      installationId,
      tenantId,
    );
    assert(Array.isArray(installationStatus), "expected installation status query to return rows");

    const listedJob = await apiRequest(baseUrl, "GET", `/marketplace/export-jobs/${jobId}`, accessToken);
    assertStatus(listedJob, 200, "get export job");
    assert(
      listedJob.payload?.status === "failed",
      `expected job to remain visible as failed, got ${String(listedJob.payload?.status)}`,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          jobId,
          validated: [
            "queue_worker_exception_marks_export_job_failed",
            "failed_status_visible_in_export_job_api",
            "failure_reason_persisted_for_seller_visibility",
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
    console.error("Marketplace worker failure visibility integration test failed:");
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
          // ignore cleanup failure
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
