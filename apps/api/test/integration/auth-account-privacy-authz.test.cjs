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
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
  setDefaultEnv("PIM_AUTH_PASSWORD", "pim1-demo-password");
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
      // Retry.
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

function assertStatus(result, expectedStatus, message) {
  if (result.status !== expectedStatus) {
    throw new Error(
      `${message}. expected=${expectedStatus} actual=${result.status} payload=${JSON.stringify(result.payload)}`,
    );
  }
}

async function login(baseUrl, tenantId, role) {
  const userId = `authz-${role}-${Date.now()}@example.com`;
  const response = await apiRequest(baseUrl, "POST", "/auth/login", null, {
    userId,
    tenantId,
    role,
    password: process.env.PIM_AUTH_PASSWORD,
    expiresInMinutes: 30,
  });
  assertStatus(response, 201, `Login failed for role=${role}`);
  if (!response.payload?.accessToken) {
    throw new Error(`Login missing token for role=${role}. payload=${JSON.stringify(response.payload)}`);
  }
  return response.payload.accessToken;
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const port = 5050 + Math.floor(Math.random() * 100);
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const tenantId = `auth-privacy-authz-${runId}`;

  const env = {
    ...process.env,
    PORT: String(port),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
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

    const unauthConsent = await apiRequest(baseUrl, "POST", "/auth/consent", null, {
      accepted: true,
      policyVersion: "dpdp-v1",
    });
    assertStatus(unauthConsent, 401, "Consent endpoint should require auth");

    const unauthExport = await apiRequest(baseUrl, "POST", "/auth/account/export", null, {
      format: "json",
    });
    assertStatus(unauthExport, 401, "Account export should require auth");

    const unauthDelete = await apiRequest(baseUrl, "DELETE", "/auth/account", null, {
      confirmation: "DELETE",
    });
    assertStatus(unauthDelete, 401, "Account delete should require auth");

    const unauthStatus = await apiRequest(baseUrl, "GET", "/auth/account/privacy-status", null);
    assertStatus(unauthStatus, 401, "Privacy status should require auth");

    const adminToken = await login(baseUrl, tenantId, "admin");
    const rejectedConsent = await apiRequest(baseUrl, "POST", "/auth/consent", adminToken, {
      accepted: false,
      policyVersion: "dpdp-v1",
    });
    assertStatus(rejectedConsent, 400, "Consent should fail closed when accepted=false");
    if (rejectedConsent.payload?.error !== "CONSENT_REQUIRED") {
      throw new Error(`Unexpected consent error payload=${JSON.stringify(rejectedConsent.payload)}`);
    }

    const viewerToken = await login(baseUrl, tenantId, "viewer");
    const viewerExport = await apiRequest(baseUrl, "POST", "/auth/account/export", viewerToken, {
      format: "csv",
    });
    assertStatus(viewerExport, 202, "Viewer should be allowed to request account export");
    if (viewerExport.payload?.status !== "queued") {
      throw new Error(`Viewer export did not return queued status. payload=${JSON.stringify(viewerExport.payload)}`);
    }

    const viewerStatus = await apiRequest(baseUrl, "GET", "/auth/account/privacy-status", viewerToken);
    assertStatus(viewerStatus, 200, "Viewer should be allowed to read privacy status");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          validated: [
            "consent_requires_auth_401",
            "export_requires_auth_401",
            "delete_requires_auth_401",
            "privacy_status_requires_auth_401",
            "consent_rejects_false_400",
            "viewer_export_allowed_202",
            "viewer_privacy_status_allowed_200",
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
    console.error("Auth account privacy authz integration test failed:");
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
          execFileSync("taskkill", ["/pid", String(apiProcess.pid), "/t", "/f"], {
            stdio: "ignore",
          });
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
  console.error(error);
  process.exit(1);
});
