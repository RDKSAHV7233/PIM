#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
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
  setDefaultEnv("JWT_SECRET", "pim1-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "pim1-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("PIM_AUTH_PASSWORD", "pim1-demo-password");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "pim1-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/pim1-local");
  setDefaultEnv("APP_ENV", "development");
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
  let payload = null;
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
    throw new Error(`${context} failed: expected ${expected}, got ${result.status}; payload=${JSON.stringify(result.payload)}`);
  }
}

async function login(baseUrl, workspaceSlug, userId, password = process.env.PIM_AUTH_PASSWORD) {
  return apiRequest(baseUrl, "POST", "/auth/login", null, {
    workspaceSlug,
    userId,
    password,
    expiresInMinutes: 30,
  });
}

async function waitForOutboxEmail(outboxDir, recipient, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = fs.existsSync(outboxDir) ? fs.readdirSync(outboxDir) : [];
    for (const file of files) {
      const payload = JSON.parse(fs.readFileSync(path.join(outboxDir, file), "utf8"));
      if (String(payload.to ?? "").trim().toLowerCase() === recipient.toLowerCase()) {
        return payload;
      }
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for auth email for ${recipient}`);
}

function createPrisma() {
  const url = String(process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL ?? "").trim();
  if (!url) {
    throw new Error("DATABASE_URL is required for auth-per-user-password integration test.");
  }
  return new PrismaClient({ datasources: { db: { url } } });
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const port = 7150 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const platformToken = `auth-password-${runId}`;
  const tenantKey = `auth-password-${runId}`;
  const workspaceSlug = `ap-${runId}`.slice(0, 24);
  const displayName = `Auth Password ${runId}`;
  const adminUserId = `auth-admin-${runId}@example.com`;
  const targetUserId = `auth-target-${runId}@example.com`;
  const viewerUserId = `auth-viewer-${runId}@example.com`;
  const perUserPassword = "RadheAuth#2026";
  const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "pim1-auth-email-"));

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

  const prisma = createPrisma();
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

    const provision = await apiRequest(
      baseUrl,
      "POST",
      "/platform/tenants",
      null,
      { tenantKey, workspaceSlug, displayName, initialAdminUserId: adminUserId },
      { "x-pim-platform-admin-token": platformToken },
    );
    assertStatus(provision, 201, "platform tenant provisioning");

    const adminLogin = await login(baseUrl, workspaceSlug, adminUserId);
    assertStatus(adminLogin, 201, "admin login");
    const adminToken = String(adminLogin.payload?.accessToken ?? "");
    assert(adminToken.length > 10, "missing admin access token");

    const createTarget = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminToken, {
      userId: targetUserId,
      role: "editor",
    });
    assertStatus(createTarget, 201, "create target user");

    const createViewer = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminToken, {
      userId: viewerUserId,
      role: "viewer",
    });
    assertStatus(createViewer, 201, "create viewer user");

    const setPassword = await apiRequest(
      baseUrl,
      "POST",
      `/admin/workspace/users/${encodeURIComponent(targetUserId)}/password`,
      adminToken,
      { password: perUserPassword },
    );
    assertStatus(setPassword, 200, "admin set per-user password");
    assert(setPassword.payload?.ok === true, "set password must return ok=true");

    const passwordAuditRows = await prisma.$queryRawUnsafe(
      `
      SELECT metadata
      FROM audit_logs
      WHERE tenant_key = $1
        AND action = 'workspace_user.password_set'
      ORDER BY created_at DESC
      LIMIT 1
      `,
      tenantKey,
    );
    const passwordAudit = Array.isArray(passwordAuditRows) ? passwordAuditRows[0] : null;
    assert(
      passwordAudit && String(passwordAudit.metadata?.targetUserId ?? "") === targetUserId.toLowerCase(),
      "password set audit must record targetUserId",
    );

    const targetLogin = await login(baseUrl, workspaceSlug, targetUserId, perUserPassword);
    assertStatus(targetLogin, 201, "target login with per-user password");
    const targetToken = String(targetLogin.payload?.accessToken ?? "");
    assert(targetToken.length > 10, "missing target access token");

    const oldPasswordLogin = await login(baseUrl, workspaceSlug, targetUserId, process.env.PIM_AUTH_PASSWORD);
    assertStatus(oldPasswordLogin, 401, "legacy shared password rejected for hashed identity");
    assert(String(oldPasswordLogin.payload?.error ?? "") === "INVALID_CREDENTIALS", "old password must return INVALID_CREDENTIALS");

    const stepUpSuccess = await apiRequest(baseUrl, "POST", "/auth/step-up", targetToken, {
      password: perUserPassword,
      scope: "mapping_high_risk",
    });
    assertStatus(stepUpSuccess, 201, "step-up with per-user password");
    assert(String(stepUpSuccess.payload?.stepUpToken ?? "").length > 10, "missing step-up token");

    const stepUpDenied = await apiRequest(baseUrl, "POST", "/auth/step-up", targetToken, {
      password: "WrongPassword#2026",
      scope: "mapping_high_risk",
    });
    assertStatus(stepUpDenied, 401, "step-up with wrong password rejected");
    assert(String(stepUpDenied.payload?.error ?? "") === "STEP_UP_INVALID_CREDENTIALS", "wrong password step-up must be denied");

    const passwordReset = await apiRequest(baseUrl, "POST", "/auth/password-reset/request", null, {
      email: targetUserId,
    });
    assertStatus(passwordReset, 200, "password reset request response");
    assert(passwordReset.payload?.requested === true, "password reset must queue delivery");
    await waitForOutboxEmail(outboxDir, targetUserId, 10_000);

    const lockViewer = await apiRequest(
      baseUrl,
      "POST",
      `/admin/workspace/users/${encodeURIComponent(viewerUserId)}/lock`,
      adminToken,
      { durationMinutes: 15, reason: "auth hardening integration test" },
    );
    assertStatus(lockViewer, 200, "lock viewer for resend-unlock test");

    const resendUnlock = await apiRequest(baseUrl, "POST", "/auth/resend-unlock", null, {
      email: viewerUserId,
      workspaceSlug,
    });
    assertStatus(resendUnlock, 200, "resend unlock response");
    assert(resendUnlock.payload?.resent === true, "resend unlock must queue email delivery");
    await waitForOutboxEmail(outboxDir, viewerUserId, 10_000);

    const viewerLogin = await login(baseUrl, workspaceSlug, viewerUserId);
    assertStatus(viewerLogin, 423, "locked viewer login rejected");

    const unlockViewer = await apiRequest(
      baseUrl,
      "POST",
      `/admin/workspace/users/${encodeURIComponent(viewerUserId)}/unlock`,
      adminToken,
      {},
    );
    assertStatus(unlockViewer, 200, "unlock viewer");

    const viewerRelogin = await login(baseUrl, workspaceSlug, viewerUserId);
    assertStatus(viewerRelogin, 201, "viewer login after unlock");
    const viewerToken = String(viewerRelogin.payload?.accessToken ?? "");
    assert(viewerToken.length > 10, "missing viewer access token");

    const viewerSetPassword = await apiRequest(
      baseUrl,
      "POST",
      `/admin/workspace/users/${encodeURIComponent(targetUserId)}/password`,
      viewerToken,
      { password: "ViewerDenied#2026" },
    );
    assertStatus(viewerSetPassword, 403, "viewer denied password set route");

    const shortPassword = await apiRequest(
      baseUrl,
      "POST",
      `/admin/workspace/users/${encodeURIComponent(targetUserId)}/password`,
      adminToken,
      { password: "short" },
    );
    assertStatus(shortPassword, 400, "short password rejected");
    assert(String(shortPassword.payload?.error ?? "") === "PASSWORD_TOO_SHORT", "short password error code mismatch");

    console.log(JSON.stringify({
      status: "ok",
      tenantKey,
      workspaceSlug,
      validated: [
        "admin_can_set_user_password",
        "hashed_user_can_login_with_new_password",
        "hashed_user_cannot_use_legacy_shared_password",
        "step_up_uses_per_user_password",
        "step_up_rejects_wrong_password",
        "password_reset_response_is_honest",
        "resend_unlock_response_is_honest",
        "viewer_forbidden_from_setting_passwords",
        "short_password_rejected",
      ],
      checkedAt: new Date().toISOString(),
    }, null, 2));
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const stdout = stdoutBuffer.join("").slice(-4000);
    const stderr = stderrBuffer.join("").slice(-4000);
    console.error("Auth per-user password integration test failed:");
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
    await prisma.$disconnect().catch(() => undefined);
    fs.rmSync(outboxDir, { recursive: true, force: true });
    if (!apiProcess.killed && apiProcess.pid) {
      if (process.platform === "win32") {
        try {
          execFileSync("taskkill", ["/pid", String(apiProcess.pid), "/t", "/f"], { stdio: "ignore" });
        } catch {
          // ignore
        }
      } else {
        apiProcess.kill("SIGTERM");
      }
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
