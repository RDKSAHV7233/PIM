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
    const raw = line.slice(idx + 1).trim();
    const value = raw.replace(/^"|"$/g, "");
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
  setDefaultEnv("PIM_AUTH_PASSWORD", "pim1-demo-password");
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

async function login(baseUrl, userId, workspaceSlug) {
  const response = await apiRequest(baseUrl, "POST", "/auth/login", null, {
    userId,
    workspaceSlug,
    password: process.env.PIM_AUTH_PASSWORD,
    expiresInMinutes: 30,
  });
  assertStatus(response, 201, `login failed for user=${userId}`);
  const token = response.payload?.accessToken;
  assert(typeof token === "string" && token.length > 10, `missing token for user=${userId}`);
  return token;
}

async function killProcessTree(processHandle) {
  if (!processHandle || processHandle.killed || !processHandle.pid) {
    return;
  }
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/pid", String(processHandle.pid), "/t", "/f"], { stdio: "ignore" });
    } catch {
      // ignore cleanup failures
    }
    return;
  }
  processHandle.kill("SIGTERM");
  await sleep(300);
  if (!processHandle.killed) {
    processHandle.kill("SIGKILL");
  }
}

async function withApi(envOverrides, runCase) {
  const stdoutBuffer = [];
  const stderrBuffer = [];
  const apiProcess = spawn("node", [API_ENTRY], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...envOverrides,
    },
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
    await waitForHealth(envOverrides.baseUrl, 60_000);
    await runCase();
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const stdout = stdoutBuffer.join("").slice(-4000);
    const stderr = stderrBuffer.join("").slice(-4000);
    throw new Error(
      `${details}\n--- API stdout tail ---\n${stdout}\n--- API stderr tail ---\n${stderr}`.trim(),
    );
  } finally {
    await killProcessTree(apiProcess);
  }
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();

  const disabledPort = 5400 + Math.floor(Math.random() * 50);
  const disabledBaseUrl = `http://127.0.0.1:${disabledPort}/api/v1`;
  const disabledTenant = `ondc-disabled-${runId}`;
  const disabledWorkspaceSlug = `ondc-off-${runId}`.slice(0, 24);
  const disabledAdminUser = `ondc-admin-disabled-${runId}@example.com`;
  await withApi(
    {
      PORT: String(disabledPort),
      baseUrl: disabledBaseUrl,
      PIM_ALLOW_LEGACY_HEADERS: "false",
      PIM_DEFAULT_TENANT_KEY: disabledTenant,
      FEATURE_ONDC_ENABLED: "false",
      PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
        [disabledAdminUser]: { tenantId: disabledTenant, role: "admin", workspaceSlug: disabledWorkspaceSlug },
      }),
      PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
        [disabledWorkspaceSlug]: { tenantId: disabledTenant, displayName: "ONDC Disabled" },
      }),
    },
    async () => {
      const adminToken = await login(disabledBaseUrl, disabledAdminUser, disabledWorkspaceSlug);
      const disabledRoute = await apiRequest(disabledBaseUrl, "GET", "/ondc/versions", adminToken);
      assertStatus(disabledRoute, 404, "ondc route should be absent when FEATURE_ONDC_ENABLED=false");
    },
  );

  const enabledPort = 5450 + Math.floor(Math.random() * 50);
  const enabledBaseUrl = `http://127.0.0.1:${enabledPort}/api/v1`;
  const enabledTenant = `ondc-enabled-${runId}`;
  const enabledWorkspaceSlug = `ondc-on-${runId}`.slice(0, 24);
  const enabledViewerUser = `ondc-viewer-${runId}@example.com`;
  const enabledAdminUser = `ondc-admin-${runId}@example.com`;
  await withApi(
    {
      PORT: String(enabledPort),
      baseUrl: enabledBaseUrl,
      PIM_ALLOW_LEGACY_HEADERS: "false",
      PIM_DEFAULT_TENANT_KEY: enabledTenant,
      FEATURE_ONDC_ENABLED: "true",
      PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
        [enabledViewerUser]: { tenantId: enabledTenant, role: "viewer", workspaceSlug: enabledWorkspaceSlug },
        [enabledAdminUser]: { tenantId: enabledTenant, role: "admin", workspaceSlug: enabledWorkspaceSlug },
      }),
      PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
        [enabledWorkspaceSlug]: { tenantId: enabledTenant, displayName: "ONDC Enabled" },
      }),
    },
    async () => {
      const viewerToken = await login(enabledBaseUrl, enabledViewerUser, enabledWorkspaceSlug);
      const viewerResult = await apiRequest(enabledBaseUrl, "GET", "/ondc/versions", viewerToken);
      assertStatus(viewerResult, 403, "viewer should be denied ONDC admin route");

      const adminToken = await login(enabledBaseUrl, enabledAdminUser, enabledWorkspaceSlug);
      const adminResult = await apiRequest(enabledBaseUrl, "GET", "/ondc/versions", adminToken);
      assertStatus(adminResult, 200, "admin should be allowed ONDC versions");
      assert(Array.isArray(adminResult.payload), `expected ONDC versions array, got ${JSON.stringify(adminResult.payload)}`);
      assert(adminResult.payload.length > 0, "expected ONDC versions to return at least one version");
    },
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "ondc_route_absent_when_feature_disabled",
          "ondc_route_viewer_denied_when_feature_enabled",
          "ondc_route_admin_allowed_when_feature_enabled",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error("ONDC feature gating integration test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
