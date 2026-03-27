#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
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

async function startFakeR2Server() {
  const objects = new Map();
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    const parts = requestUrl.pathname.split("/").filter(Boolean);
    const bucket = parts.shift();
    const key = decodeURIComponent(parts.join("/"));
    if (!bucket || !key) {
      response.statusCode = 400;
      response.end("missing bucket or key");
      return;
    }
    const storageKey = `${bucket}/${key}`;

    if (request.method === "PUT") {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks);
      objects.set(storageKey, {
        body,
        contentType: String(request.headers["content-type"] ?? "application/octet-stream"),
        contentDisposition: String(request.headers["content-disposition"] ?? ""),
      });
      response.statusCode = 200;
      response.end("");
      return;
    }

    const stored = objects.get(storageKey);
    if (!stored) {
      response.statusCode = 404;
      response.end("");
      return;
    }

    if (stored.contentType) {
      response.setHeader("Content-Type", stored.contentType);
    }
    if (stored.contentDisposition) {
      response.setHeader("Content-Disposition", stored.contentDisposition);
    }

    if (request.method === "HEAD") {
      response.statusCode = 200;
      response.end("");
      return;
    }
    if (request.method === "GET") {
      response.statusCode = 200;
      response.end(stored.body);
      return;
    }

    response.statusCode = 405;
    response.end("");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to resolve fake R2 server address.");
  }

  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    close: async () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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
    assertStatus(statusResult, 200, "Privacy status before suspension failed");
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
  const port = 5150 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const platformToken = `auth-governance-${runId}`;
  const commercialToken = `commercial-governance-${runId}`;
  const tenantId = `auth-governance-tenant-${runId}`;
  const workspaceSlug = `ag-${runId}`.slice(0, 24);
  const userId = `auth-governance-user-${runId}@example.com`;
  const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "pim1-auth-governance-email-"));
  const fakeR2 = await startFakeR2Server();

  const env = {
    ...process.env,
    PORT: String(port),
    AUTH_MODE: "db",
    PIM_PLATFORM_ADMIN_TOKEN: platformToken,
    PIM_COMMERCIAL_OPS_TOKEN: commercialToken,
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_AUTH_IDENTITIES_JSON: "",
    PIM_AUTH_WORKSPACES_JSON: "",
    AUTH_EMAIL_PROVIDER: "file",
    AUTH_EMAIL_OUTBOX_DIR: outboxDir,
    PIM_WEB_BASE_URL: "http://localhost:3000",
    R2_ENDPOINT: fakeR2.endpoint,
    PIM_AUTH_PASSWORD: "tej-pim-demo-password",
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
        displayName: `Governance Suspension ${runId}`,
        initialAdminUserId: userId,
      },
      { "x-pim-platform-admin-token": platformToken },
    );
    assertStatus(provision, 201, "platform tenant provisioning");

    const loginResult = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId,
      password: env.PIM_AUTH_PASSWORD,
      expiresInMinutes: 30,
    });
    assertStatus(loginResult, 201, "Login before suspension failed");
    const token = String(loginResult.payload?.accessToken ?? "");
    assert(token.length > 10, "expected access token before suspension");

    const apiKeyCreate = await apiRequest(baseUrl, "POST", "/admin/api-keys", token, {
      label: `governance-${runId}`,
      role: "viewer",
    });
    assertStatus(apiKeyCreate, 201, "api key creation before suspension");
    const plainTextApiKey = String(apiKeyCreate.payload?.plainTextKey ?? "");
    assert(plainTextApiKey.startsWith("pim1_"), "expected plain text api key");

    const exportResult = await apiRequest(baseUrl, "POST", "/auth/account/export", token, {
      format: "json",
    });
    assertStatus(exportResult, 202, "account export before suspension");

    const readyStatus = await waitForExportReady(baseUrl, token, 15_000);
    const exportJobId = String(readyStatus?.latestExport?.jobId ?? "");
    assert(exportJobId.length > 0, "expected completed export job id before suspension");

    const suspend = await apiRequest(
      baseUrl,
      "POST",
      "/billing/internal/commercial-state",
      null,
      {
        tenantKey: tenantId,
        accessStatus: "suspended",
        suspensionReason: "governance_access_validation",
      },
      {
        "x-pim-commercial-ops-token": commercialToken,
        "x-pim-operator-id": "ops-commercial",
        "x-pim-operator-role": "commercial_ops",
      },
    );
    assert(suspend.status === 200 || suspend.status === 201, `suspend mutation failed: ${JSON.stringify(suspend)}`);

    const privacyWhileSuspended = await apiRequest(baseUrl, "GET", "/auth/account/privacy-status", token);
    assertStatus(privacyWhileSuspended, 200, "privacy status should remain available while suspended");
    assert(
      String(privacyWhileSuspended.payload?.commercialState?.accessStatus ?? "") === "suspended",
      `expected suspended commercial state in privacy status payload=${JSON.stringify(privacyWhileSuspended.payload)}`,
    );
    assert(
      String(privacyWhileSuspended.payload?.latestExport?.status ?? "") === "completed",
      `expected completed export in suspended privacy status payload=${JSON.stringify(privacyWhileSuspended.payload)}`,
    );

    const downloadWhileSuspended = await apiRequest(
      baseUrl,
      "GET",
      `/auth/account/export/${encodeURIComponent(exportJobId)}/download`,
      token,
    );
    assertStatus(downloadWhileSuspended, 200, "export download should remain available while suspended");
    assert(
      typeof downloadWhileSuspended.payload?.downloadUrl === "string" &&
        downloadWhileSuspended.payload.downloadUrl.length > 0,
      `expected download url while suspended payload=${JSON.stringify(downloadWhileSuspended.payload)}`,
    );

    const signedDownload = await fetch(downloadWhileSuspended.payload.downloadUrl, {
      method: "GET",
      signal: AbortSignal.timeout(20_000),
    });
    assert(signedDownload.ok, `signed export download failed while suspended status=${signedDownload.status}`);
    const downloadText = await signedDownload.text();
    assert(
      downloadText.includes(userId) && downloadText.includes(exportJobId),
      `download content mismatch while suspended body=${downloadText}`,
    );

    const deleteWhileSuspended = await apiRequest(baseUrl, "DELETE", "/auth/account", token, {
      confirmation: "DELETE",
      reason: "commercial suspension governance access test",
    });
    assertStatus(deleteWhileSuspended, 202, "account delete should remain available while suspended");

    const newExportWhileSuspended = await apiRequest(baseUrl, "POST", "/auth/account/export", token, {
      format: "csv",
    });
    assertStatus(newExportWhileSuspended, 403, "new account export should stay blocked while suspended");
    assert(
      String(newExportWhileSuspended.payload?.error ?? "") === "TENANT_SUSPENDED",
      `expected TENANT_SUSPENDED on new export while suspended payload=${JSON.stringify(newExportWhileSuspended.payload)}`,
    );

    const normalRouteWhileSuspended = await apiRequest(baseUrl, "GET", "/taxonomy/categories", token);
    assertStatus(normalRouteWhileSuspended, 403, "normal product route should remain blocked while suspended");
    assert(
      String(normalRouteWhileSuspended.payload?.error ?? "") === "TENANT_SUSPENDED",
      `expected TENANT_SUSPENDED on normal route payload=${JSON.stringify(normalRouteWhileSuspended.payload)}`,
    );

    const apiKeyPrivacyWhileSuspended = await apiRequest(
      baseUrl,
      "GET",
      "/auth/account/privacy-status",
      null,
      undefined,
      { "x-pim-api-key": plainTextApiKey },
    );
    assertStatus(apiKeyPrivacyWhileSuspended, 403, "api key should stay blocked from privacy status while suspended");
    assert(
      String(apiKeyPrivacyWhileSuspended.payload?.error ?? "") === "TENANT_SUSPENDED",
      `expected TENANT_SUSPENDED for api key privacy status payload=${JSON.stringify(apiKeyPrivacyWhileSuspended.payload)}`,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          userId,
          validated: [
            "suspended_jwt_can_read_privacy_status",
            "suspended_privacy_status_exposes_commercial_state",
            "suspended_jwt_can_download_ready_export",
            "suspended_jwt_can_schedule_account_deletion",
            "suspended_jwt_cannot_request_new_export",
            "suspended_jwt_remains_blocked_from_normal_product_routes",
            "suspended_api_key_remains_blocked_from_governance_routes",
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
    console.error("Billing commercial governance access integration test failed:");
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
    await fakeR2.close().catch(() => undefined);
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
