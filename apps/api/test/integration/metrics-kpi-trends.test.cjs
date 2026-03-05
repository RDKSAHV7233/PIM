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
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    setDefaultEnv("DATABASE_URL_POOLED", databaseUrl);
    setDefaultEnv("DATABASE_URL_DIRECT", databaseUrl);
  }
  setDefaultEnv("JWT_SECRET", "pim1-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "pim1-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "pim1-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/pim1-local");
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
    signal: AbortSignal.timeout(60_000),
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(`${baseUrl}${route}`, options);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Request timeout/failure for ${method} ${route}: ${reason}`);
  }
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, payload };
}

async function tracedRequest(label, baseUrl, method, route, token, body) {
  console.log(`[metrics-kpi-test] ${label}: ${method} ${route}`);
  return apiRequest(baseUrl, method, route, token, body);
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

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 5800 + Math.floor(Math.random() * 140);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `metrics-kpi-tenant-${runId}`;
  const userId = `metrics-kpi-user-${runId}`;
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin" },
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

    const login = await tracedRequest("login", baseUrl, "POST", "/auth/login", null, {
      userId,
      password: "pim1-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "login");
    const token = login.payload?.accessToken;
    assert(typeof token === "string" && token.length > 10, "missing access token");

    const category = await tracedRequest("create category", baseUrl, "POST", "/taxonomy/categories", token, {
      name: `Metrics KPI Category ${runId}`,
    });
    assertStatus(category, 201, "create category");

    const product = await tracedRequest("create product", baseUrl, "POST", "/catalog/products", token, {
      title: `Metrics KPI Product ${runId}`,
      brand: "PIM1",
      description: "Intentionally incomplete for rejection metrics",
      categoryId: category.payload.id,
      status: "draft",
      attributes: {},
    });
    assertStatus(product, 201, "create product");

    const install = await tracedRequest("install connector", baseUrl, "POST", "/connectors/flipkart/install", token, {
      accountAlias: "primary",
    });
    assertStatus(install, 201, "install connector");

    const createJob = await tracedRequest(
      "create export job",
      baseUrl,
      "POST",
      `/marketplace/products/${product.payload.id}/export-jobs`,
      token,
      { channel: "flipkart", maxRetries: 2 },
    );
    assertStatus(createJob, 201, "create export job");
    const jobId = createJob.payload.id;

    const processFirst = await tracedRequest(
      "process export job first attempt",
      baseUrl,
      "POST",
      `/marketplace/export-jobs/${jobId}/process`,
      token,
    );
    assertStatus(processFirst, 201, "process export job first attempt");
    const processSecond = await tracedRequest(
      "process export job second attempt",
      baseUrl,
      "POST",
      `/marketplace/export-jobs/${jobId}/process`,
      token,
    );
    assertStatus(processSecond, 201, "process export job second attempt");

    const readiness = await tracedRequest("dashboard readiness", baseUrl, "GET", "/dashboard/readiness", token);
    assertStatus(readiness, 200, "dashboard readiness");

    const trends = await tracedRequest("metrics trends", baseUrl, "GET", "/metrics/kpi-trends?days=7", token);
    assertStatus(trends, 200, "metrics kpi trends");
    const payload = trends.payload ?? {};

    assert(Array.isArray(payload.readinessAccuracy), "kpi trends missing readinessAccuracy array");
    assert(Array.isArray(payload.throughput), "kpi trends missing throughput array");
    assert(Array.isArray(payload.rejectionRate), "kpi trends missing rejectionRate array");
    assert(
      Array.isArray(payload.reliabilityDuplicatePreventionRate),
      "kpi trends missing reliabilityDuplicatePreventionRate array",
    );
    assert(
      payload.rejectionRate.some((point) => point.connectorSlug === "flipkart"),
      `expected rejection rate point for flipkart, payload=${JSON.stringify(payload)}`,
    );
    assert(
      payload.reliabilityDuplicatePreventionRate.some(
        (point) => point.connectorSlug === "flipkart" && Number(point.value) > 0,
      ),
      `expected reliability duplicate-prevention point for flipkart, payload=${JSON.stringify(payload)}`,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          jobId,
          validated: [
            "metrics_emitted_for_readiness_throughput_rejection_reliability",
            "kpi_trends_endpoint_returns_tenant_scoped_connector_series",
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
    console.error("Metrics KPI trends integration test failed:");
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



