#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
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

async function apiRequest(baseUrl, method, route, token, body, extraHeaders = {}) {
  const headers = { Accept: "application/json", ...extraHeaders };
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

async function apiBinaryRequest(baseUrl, route, token) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: "GET",
    headers: {
      Accept: "application/octet-stream",
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(20_000),
  });
  return {
    status: response.status,
    body: Buffer.from(await response.arrayBuffer()),
    headers: response.headers,
  };
}

function assertStatus(result, expectedStatus, message) {
  if (result.status !== expectedStatus) {
    throw new Error(
      `${message}. expected=${expectedStatus} actual=${result.status} payload=${JSON.stringify(result.payload)}`,
    );
  }
}

async function waitForExportReady(baseUrl, token, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const statusResult = await apiRequest(baseUrl, "GET", "/auth/account/privacy-status", token);
    assertStatus(statusResult, 200, "Privacy status endpoint failed");
    if (statusResult.payload?.latestExport?.status === "completed") {
      return statusResult.payload;
    }
    await sleep(250);
  }
  throw new Error("Timed out waiting for account export to complete.");
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const port = 4950 + Math.floor(Math.random() * 100);
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const platformToken = `auth-privacy-${runId}`;
  const tenantId = `auth-privacy-tenant-${runId}`;
  const workspaceSlug = `ap-${runId}`.slice(0, 24);
  const userId = `auth-privacy-user-${runId}@example.com`;
  const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "pim1-auth-export-email-"));

  const env = {
    ...process.env,
    PORT: String(port),
    AUTH_MODE: "db",
    PIM_PLATFORM_ADMIN_TOKEN: platformToken,
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_AUTH_IDENTITIES_JSON: "",
    PIM_AUTH_WORKSPACES_JSON: "",
    AUTH_EMAIL_PROVIDER: "file",
    AUTH_EMAIL_OUTBOX_DIR: outboxDir,
    PIM_WEB_BASE_URL: "http://localhost:3000",
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

    const provision = await apiRequest(
      baseUrl,
      "POST",
      "/platform/tenants",
      null,
      {
        tenantKey: tenantId,
        workspaceSlug,
        displayName: `Auth Privacy ${runId}`,
        initialAdminUserId: userId,
      },
      { "x-pim-platform-admin-token": platformToken },
    );
    assertStatus(provision, 201, "platform tenant provisioning");

    const loginResult = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId,
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

    const exportResult = await apiRequest(baseUrl, "POST", "/auth/account/export", token, {
      format: "json",
    });
    assertStatus(exportResult, 202, "Account export endpoint failed");
    if (exportResult.payload?.status !== "queued") {
      throw new Error(`Account export did not return queued status. payload=${JSON.stringify(exportResult.payload)}`);
    }

    const statusPayload = await waitForExportReady(baseUrl, token, 15_000);
    if (statusPayload?.latestExport?.downloadAvailable !== true) {
      throw new Error(`Completed export should expose downloadAvailable=true. payload=${JSON.stringify(statusPayload)}`);
    }

    const downloadResult = await apiBinaryRequest(
      baseUrl,
      `/auth/account/export/${encodeURIComponent(statusPayload.latestExport.jobId)}/download`,
      token,
    );
    if (downloadResult.status !== 200) {
      throw new Error(`Export download failed: status=${downloadResult.status}`);
    }
    const downloadText = downloadResult.body.toString("utf8");
    if (!downloadText.includes(userId) || !downloadText.includes(statusPayload.latestExport.jobId)) {
      throw new Error(`Export download content mismatch. body=${downloadText}`);
    }

    const badDeleteResult = await apiRequest(baseUrl, "DELETE", "/auth/account", token, {
      confirmation: "REMOVE",
      reason: "test invalid confirmation",
    });
    assertStatus(badDeleteResult, 400, "Delete account should fail without DELETE confirmation");

    const deleteResult = await apiRequest(baseUrl, "DELETE", "/auth/account", token, {
      confirmation: "DELETE",
      reason: "test requested erasure",
    });
    assertStatus(deleteResult, 202, "Delete account endpoint failed");

    const auditResult = await apiRequest(baseUrl, "GET", `/audit/logs?limit=100&actorId=${encodeURIComponent(userId)}`, token);
    assertStatus(auditResult, 200, "Audit logs endpoint failed");
    const actions = new Set((Array.isArray(auditResult.payload) ? auditResult.payload : []).map((entry) => String(entry?.action ?? "")));
    const requiredActions = [
      "consent.recorded",
      "account.export_requested",
      "account.export_completed",
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
            "account_export_completes_and_is_downloadable",
            "delete_account_confirmation_guard_400",
            "delete_account_202_scheduled",
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
    fs.rmSync(outboxDir, { recursive: true, force: true });
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
