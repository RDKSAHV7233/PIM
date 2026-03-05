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

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const port = 4950 + Math.floor(Math.random() * 100);
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const tenantId = `auth-privacy-tenant-${runId}`;
  const userId = `auth-privacy-user-${runId}@example.com`;

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

    const loginResult = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      userId,
      tenantId,
      role: "admin",
      password: process.env.PIM_AUTH_PASSWORD,
      expiresInMinutes: 30,
    });
    assertStatus(loginResult, 201, "Login failed");
    const token = loginResult.payload?.accessToken;
    if (!token || typeof token !== "string") {
      throw new Error(`Login did not return accessToken. payload=${JSON.stringify(loginResult.payload)}`);
    }

    const consentResult = await apiRequest(baseUrl, "POST", "/auth/consent", token, {
      accepted: true,
      policyVersion: "dpdp-v1",
      purpose: "catalog_operations",
    });
    assertStatus(consentResult, 200, "Consent endpoint failed");
    if (consentResult.payload?.accepted !== true) {
      throw new Error(`Consent endpoint did not persist accepted=true. payload=${JSON.stringify(consentResult.payload)}`);
    }

    const exportResult = await apiRequest(baseUrl, "POST", "/auth/account/export", token, {
      format: "json",
    });
    assertStatus(exportResult, 202, "Account export endpoint failed");
    if (exportResult.payload?.status !== "queued") {
      throw new Error(`Account export did not return queued status. payload=${JSON.stringify(exportResult.payload)}`);
    }

    const badDeleteResult = await apiRequest(baseUrl, "DELETE", "/auth/account", token, {
      confirmation: "REMOVE",
      reason: "test invalid confirmation",
    });
    assertStatus(badDeleteResult, 400, "Delete account should fail without DELETE confirmation");
    if (badDeleteResult.payload?.error !== "DELETE_CONFIRMATION_REQUIRED") {
      throw new Error(
        `Delete account invalid confirmation error mismatch. payload=${JSON.stringify(badDeleteResult.payload)}`,
      );
    }

    const deleteResult = await apiRequest(baseUrl, "DELETE", "/auth/account", token, {
      confirmation: "DELETE",
      reason: "test requested erasure",
    });
    assertStatus(deleteResult, 202, "Delete account endpoint failed");
    if (deleteResult.payload?.status !== "scheduled") {
      throw new Error(`Delete account did not return scheduled status. payload=${JSON.stringify(deleteResult.payload)}`);
    }

    const statusResult = await apiRequest(baseUrl, "GET", "/auth/account/privacy-status", token);
    assertStatus(statusResult, 200, "Privacy status endpoint failed");
    if (statusResult.payload?.latestConsent?.policyVersion !== "dpdp-v1") {
      throw new Error(`Privacy status missing latest consent. payload=${JSON.stringify(statusResult.payload)}`);
    }
    if (statusResult.payload?.latestExport?.status !== "queued") {
      throw new Error(`Privacy status missing latest export. payload=${JSON.stringify(statusResult.payload)}`);
    }
    if (statusResult.payload?.latestDeletion?.status !== "scheduled") {
      throw new Error(`Privacy status missing latest deletion. payload=${JSON.stringify(statusResult.payload)}`);
    }

    const auditResult = await apiRequest(baseUrl, "GET", `/audit/logs?limit=50&actorId=${encodeURIComponent(userId)}`, token);
    assertStatus(auditResult, 200, "Audit logs endpoint failed");
    if (!Array.isArray(auditResult.payload)) {
      throw new Error(`Audit logs payload should be array. payload=${JSON.stringify(auditResult.payload)}`);
    }
    const actions = new Set(auditResult.payload.map((entry) => String(entry?.action ?? "")));
    const requiredActions = [
      "consent.recorded",
      "account.export_requested",
      "account.deletion_scheduled",
    ];
    for (const action of requiredActions) {
      if (!actions.has(action)) {
        throw new Error(`Audit logs missing action=${action}. actions=${JSON.stringify(Array.from(actions))}`);
      }
    }

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          userId,
          validated: [
            "consent_acceptance_200",
            "account_export_202_queued",
          "delete_account_confirmation_guard_400",
          "delete_account_202_scheduled",
          "privacy_status_200_with_latest_records",
          "audit_actions_recorded",
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
    console.error("Auth account privacy integration test failed:");
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
