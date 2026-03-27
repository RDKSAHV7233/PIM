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
  setDefaultEnv("PIM_AUTH_PASSWORD", "tej-pim-demo-password");
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

async function apiRequest(baseUrl, method, route, token, body, extraHeaders) {
  const headers = { Accept: "application/json", ...(extraHeaders ?? {}) };
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
    throw new Error(`${context} failed: expected ${expected}, got ${result.status} payload=${JSON.stringify(result.payload)}`);
  }
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 6300 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `billing-suspend-${runId}`;
  const workspaceSlug = `bs-${runId}`.slice(0, 24);
  const adminUser = `admin-${runId}@example.com`;
  const commercialToken = `commercial-ops-${runId}`;
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [adminUser]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Billing Commercial Suspension" },
    }),
    PIM_COMMERCIAL_OPS_TOKEN: commercialToken,
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
      userId: adminUser,
      password: process.env.PIM_AUTH_PASSWORD,
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "admin login before suspension");
    const adminToken = String(login.payload?.accessToken ?? "");
    assert(adminToken.length > 10, "expected admin token before suspension");

    const apiKeyCreate = await apiRequest(baseUrl, "POST", "/admin/api-keys", adminToken, {
      label: `suspension-${runId}`,
      role: "viewer",
    });
    assertStatus(apiKeyCreate, 201, "api key creation before suspension");
    const plainTextApiKey = String(apiKeyCreate.payload?.plainTextKey ?? "");
    assert(plainTextApiKey.startsWith("pim1_"), "expected plain text API key");

    const jwtBeforeSuspend = await apiRequest(baseUrl, "GET", "/taxonomy/categories", adminToken);
    assertStatus(jwtBeforeSuspend, 200, "jwt access before suspension");

    const apiKeyBeforeSuspend = await apiRequest(
      baseUrl,
      "GET",
      "/taxonomy/categories",
      null,
      undefined,
      { "x-pim-api-key": plainTextApiKey },
    );
    assertStatus(apiKeyBeforeSuspend, 200, "api key access before suspension");

    const suspend = await apiRequest(
      baseUrl,
      "POST",
      "/billing/internal/commercial-state",
      null,
      {
        tenantKey: tenantId,
        accessStatus: "suspended",
        suspensionReason: "non_payment",
      },
      {
        "x-pim-commercial-ops-token": commercialToken,
        "x-pim-operator-id": "ops-commercial",
        "x-pim-operator-role": "commercial_ops",
      },
    );
    assert(suspend.status === 200 || suspend.status === 201, `suspend mutation failed: ${JSON.stringify(suspend)}`);
    assert(String(suspend.payload?.accessStatus ?? "") === "suspended", "expected tenant to be suspended");

    const loginWhileSuspended = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId: adminUser,
      password: process.env.PIM_AUTH_PASSWORD,
      expiresInMinutes: 30,
    });
    assertStatus(loginWhileSuspended, 403, "login while suspended");
    assert(String(loginWhileSuspended.payload?.error ?? "") === "TENANT_SUSPENDED", "expected TENANT_SUSPENDED on login");

    const jwtWhileSuspended = await apiRequest(baseUrl, "GET", "/taxonomy/categories", adminToken);
    assertStatus(jwtWhileSuspended, 403, "jwt access while suspended");
    assert(String(jwtWhileSuspended.payload?.error ?? "") === "TENANT_SUSPENDED", "expected TENANT_SUSPENDED for jwt access");

    const apiKeyWhileSuspended = await apiRequest(
      baseUrl,
      "GET",
      "/taxonomy/categories",
      null,
      undefined,
      { "x-pim-api-key": plainTextApiKey },
    );
    assertStatus(apiKeyWhileSuspended, 403, "api key access while suspended");
    assert(String(apiKeyWhileSuspended.payload?.error ?? "") === "TENANT_SUSPENDED", "expected TENANT_SUSPENDED for api key access");

    const resume = await apiRequest(
      baseUrl,
      "POST",
      "/billing/internal/commercial-state",
      null,
      {
        tenantKey: tenantId,
        accessStatus: "active",
      },
      {
        "x-pim-commercial-ops-token": commercialToken,
        "x-pim-operator-id": "ops-commercial",
        "x-pim-operator-role": "commercial_ops",
      },
    );
    assert(resume.status === 200 || resume.status === 201, `resume mutation failed: ${JSON.stringify(resume)}`);
    assert(String(resume.payload?.accessStatus ?? "") === "active", "expected tenant to be resumed");

    const jwtAfterResume = await apiRequest(baseUrl, "GET", "/taxonomy/categories", adminToken);
    assertStatus(jwtAfterResume, 200, "jwt access after resume");

    const apiKeyAfterResume = await apiRequest(
      baseUrl,
      "GET",
      "/taxonomy/categories",
      null,
      undefined,
      { "x-pim-api-key": plainTextApiKey },
    );
    assertStatus(apiKeyAfterResume, 200, "api key access after resume");

    const loginAfterResume = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId: adminUser,
      password: process.env.PIM_AUTH_PASSWORD,
      expiresInMinutes: 30,
    });
    assertStatus(loginAfterResume, 201, "login after resume");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          validated: [
            "internal_commercial_suspend_updates_access_state",
            "suspended_tenant_login_returns_tenant_suspended",
            "existing_jwt_is_blocked_while_suspended",
            "api_key_is_blocked_while_suspended",
            "resume_restores_existing_jwt_access",
            "resume_restores_api_key_access",
            "resume_allows_fresh_login",
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
    console.error("Billing commercial suspension integration test failed:");
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
    if (apiProcess.pid) {
      try {
        if (process.platform === "win32") {
          execFileSync("taskkill", ["/pid", String(apiProcess.pid), "/t", "/f"], { stdio: "ignore" });
        } else {
          apiProcess.kill("SIGTERM");
        }
      } catch {
        // ignore cleanup failures
      }
    }
  }
}

run();
