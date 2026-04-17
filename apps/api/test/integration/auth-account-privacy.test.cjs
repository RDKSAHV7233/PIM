#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");

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

  setDefaultEnv("JWT_SECRET", "vexa-pim-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "vexa-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("PIM_DEFAULT_ROLE", "admin");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
  setDefaultEnv("PIM_AUTH_PASSWORD", "vexa-pim-demo-password");
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
  const shadowTenantId = `auth-privacy-shadow-${runId}`;
  const workspaceSlug = `ap-${runId}`.slice(0, 24);
  const userId = `auth-privacy-user-${runId}@example.com`;
  const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "pim1-auth-export-email-"));
  const fakeR2 = await startFakeR2Server();

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
    R2_ENDPOINT: fakeR2.endpoint,
  };

  const stdoutBuffer = [];
  const stderrBuffer = [];
  const apiProcess = spawn("node", [API_ENTRY], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL,
      },
    },
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

    const shadowConsentPurpose = `shadow-consent-${runId}`;
    const shadowExportJobId = `exp_shadow_${runId}`;
    const shadowDeletionId = `del_shadow_${runId}`;
    await prisma.accountConsentEvent.create({
      data: {
        id: randomUUID(),
        tenantKey: shadowTenantId,
        userId,
        accepted: true,
        policyVersion: "shadow-v1",
        purpose: shadowConsentPurpose,
        consentRecordedAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const exportResult = await apiRequest(baseUrl, "POST", "/auth/account/export", token, {
      format: "json",
    });
    assertStatus(exportResult, 202, "Account export endpoint failed");
    if (exportResult.payload?.status !== "queued") {
      throw new Error(`Account export did not return queued status. payload=${JSON.stringify(exportResult.payload)}`);
    }

    await prisma.accountExportRequest.create({
      data: {
        id: shadowExportJobId,
        tenantKey: shadowTenantId,
        userId,
        actorRole: "admin",
        format: "json",
        status: "completed",
        requestedAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        estimatedReadyInSeconds: 0,
        artifactPath: "shadow/export.json",
        artifactFileName: "shadow-export.json",
        completedAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      },
    });
    await prisma.accountDeletionRequest.create({
      data: {
        id: shadowDeletionId,
        tenantKey: shadowTenantId,
        userId,
        actorRole: "admin",
        reason: "shadow delete",
        status: "scheduled",
        requestedAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
        scheduledFor: new Date(Date.now() + 4 * 60 * 60 * 1000),
      },
    });

    const statusPayload = await waitForExportReady(baseUrl, token, 15_000);
    if (String(statusPayload?.commercialState?.accessStatus ?? "") !== "active") {
      throw new Error(
        `Privacy status should expose active commercial access state. payload=${JSON.stringify(statusPayload)}`,
      );
    }
    if (String(statusPayload?.latestConsent?.purpose ?? "") !== "catalog_operations") {
      throw new Error(`Privacy status leaked consent data across tenants. payload=${JSON.stringify(statusPayload)}`);
    }
    if (String(statusPayload?.latestExport?.jobId ?? "") === shadowExportJobId) {
      throw new Error(`Privacy status leaked export data across tenants. payload=${JSON.stringify(statusPayload)}`);
    }
    if (statusPayload?.latestExport?.downloadAvailable !== true) {
      throw new Error(`Completed export should expose downloadAvailable=true. payload=${JSON.stringify(statusPayload)}`);
    }

    const downloadResult = await apiRequest(
      baseUrl,
      "GET",
      `/auth/account/export/${encodeURIComponent(statusPayload.latestExport.jobId)}/download`,
      token,
    );
    if (downloadResult.status !== 200) {
      throw new Error(`Export download request failed: status=${downloadResult.status} payload=${JSON.stringify(downloadResult.payload)}`);
    }
    if (typeof downloadResult.payload?.downloadUrl !== "string" || downloadResult.payload.downloadUrl.length === 0) {
      throw new Error(`Export download did not return a pre-signed URL. payload=${JSON.stringify(downloadResult.payload)}`);
    }
    if (Number(downloadResult.payload?.expiresInSeconds) !== 900) {
      throw new Error(`Expected export download URL expiry=900. payload=${JSON.stringify(downloadResult.payload)}`);
    }
    const signedDownload = await fetch(downloadResult.payload.downloadUrl, {
      method: "GET",
      signal: AbortSignal.timeout(20_000),
    });
    if (!signedDownload.ok) {
      throw new Error(`Pre-signed export download failed: status=${signedDownload.status}`);
    }
    const downloadText = await signedDownload.text();
    if (!downloadText.includes(userId) || !downloadText.includes(statusPayload.latestExport.jobId)) {
      throw new Error(`Export download content mismatch. body=${downloadText}`);
    }
    if (
      downloadText.includes(shadowConsentPurpose) ||
      downloadText.includes(shadowExportJobId) ||
      downloadText.includes(shadowDeletionId)
    ) {
      throw new Error(`Account export leaked cross-tenant privacy records. body=${downloadText}`);
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

    const postDeleteStatus = await apiRequest(baseUrl, "GET", "/auth/account/privacy-status", token);
    assertStatus(postDeleteStatus, 200, "Privacy status after delete failed");
    if (String(postDeleteStatus.payload?.latestDeletion?.ticketId ?? "") !== String(deleteResult.payload?.ticketId ?? "")) {
      throw new Error(`Privacy status leaked deletion data across tenants. payload=${JSON.stringify(postDeleteStatus.payload)}`);
    }

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
            "account_export_completes_and_returns_presigned_download",
            "privacy_status_blocks_cross_tenant_spoofed_records",
            "account_export_blocks_cross_tenant_spoofed_records",
            "privacy_status_exposes_active_commercial_state",
            "delete_account_confirmation_guard_400",
            "delete_account_202_scheduled",
            "deletion_status_blocks_cross_tenant_spoofed_records",
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
    await prisma.$disconnect().catch(() => undefined);
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
