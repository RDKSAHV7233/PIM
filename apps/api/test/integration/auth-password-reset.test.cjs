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

  setDefaultEnv("JWT_SECRET", "tej-pim-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "tej-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "tej-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/tej-pim-local");
  setDefaultEnv("APP_ENV", "development");
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
      // Retry until timeout.
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
  return { status: response.status, payload, headers: response.headers };
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

async function login(baseUrl, workspaceSlug, userId, password) {
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
    const matches = [];
    for (const file of files) {
      const fullPath = path.join(outboxDir, file);
      const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      if (String(parsed.to ?? "").trim().toLowerCase() === recipient.toLowerCase()) {
        matches.push({ file, parsed });
      }
    }
    if (matches.length > 0) {
      matches.sort((left, right) => left.file.localeCompare(right.file));
      return matches[matches.length - 1].parsed;
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for auth email for ${recipient}`);
}

function extractResetToken(emailPayload) {
  const source = `${String(emailPayload.text ?? "")}\n${String(emailPayload.html ?? "")}`;
  const match = source.match(/\/login\/reset\?token=([^&\s\"]+)/i);
  if (!match) {
    throw new Error(`Unable to locate reset token in email payload=${JSON.stringify(emailPayload)}`);
  }
  return decodeURIComponent(match[1]);
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const port = 5000 + Math.floor(Math.random() * 70);
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const platformToken = `auth-reset-${runId}`;
  const tenantKey = `auth-reset-${runId}`;
  const workspaceSlug = `ar-${runId}`.slice(0, 24);
  const displayName = `Auth Reset ${runId}`;
  const adminUserId = `auth-reset-admin-${runId}@example.com`;
  const newPassword = "Recovery#2026";
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

    const invalid = await apiRequest(baseUrl, "POST", "/auth/password-reset/request", null, {});
    assertStatus(invalid, 400, "invalid password reset request");

    const requestReset = await apiRequest(baseUrl, "POST", "/auth/password-reset/request", null, {
      email: adminUserId,
    });
    assertStatus(requestReset, 200, "password reset request");
    const missingReset = await apiRequest(baseUrl, "POST", "/auth/password-reset/request", null, {
      email: "nobody@nowhere.example",
    });
    assertStatus(missingReset, 200, "password reset request for missing identity");
    assert(
      JSON.stringify(requestReset.payload) === JSON.stringify(missingReset.payload),
      `password reset request responses must be non-enumerating. existing=${JSON.stringify(requestReset.payload)} missing=${JSON.stringify(missingReset.payload)}`,
    );
    assert(
      JSON.stringify(requestReset.payload) === JSON.stringify({ ok: true, retryAfterSeconds: 0 }),
      `password reset response shape mismatch. payload=${JSON.stringify(requestReset.payload)}`,
    );

    const secondReset = await apiRequest(baseUrl, "POST", "/auth/password-reset/request", null, {
      email: adminUserId,
    });
    assertStatus(secondReset, 200, "second password reset request");
    const thirdReset = await apiRequest(baseUrl, "POST", "/auth/password-reset/request", null, {
      email: adminUserId,
    });
    assertStatus(thirdReset, 200, "third password reset request");
    const rateLimitedReset = await apiRequest(baseUrl, "POST", "/auth/password-reset/request", null, {
      email: adminUserId,
    });
    assertStatus(rateLimitedReset, 200, "rate-limited password reset request");
    assert(
      Number(rateLimitedReset.payload?.retryAfterSeconds) > 0,
      `expected retryAfterSeconds > 0 when password reset rate limited. payload=${JSON.stringify(rateLimitedReset.payload)}`,
    );
    assert(
      String(rateLimitedReset.headers.get("x-ratelimit-retry-after") ?? "").trim().length > 0,
      "expected X-RateLimit-Retry-After header when password reset rate limited",
    );

    const emailPayload = await waitForOutboxEmail(outboxDir, adminUserId, 10_000);
    const resetToken = extractResetToken(emailPayload);

    const confirmReset = await apiRequest(baseUrl, "POST", "/auth/password-reset/confirm", null, {
      token: resetToken,
      password: newPassword,
    });
    assertStatus(confirmReset, 200, "password reset confirm");
    assert(confirmReset.payload?.reset === true, "password reset confirm should return reset=true");

    const oldLogin = await login(baseUrl, workspaceSlug, adminUserId, process.env.PIM_AUTH_PASSWORD);
    assertStatus(oldLogin, 401, "legacy password rejected after reset");

    const newLogin = await login(baseUrl, workspaceSlug, adminUserId, newPassword);
    assertStatus(newLogin, 201, "new password login succeeds");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          validated: [
            "password_reset_request_rejects_invalid_body",
            "password_reset_request_is_non_enumerating",
            "password_reset_request_rate_limited_after_three_attempts",
            "password_reset_request_queues_email",
            "password_reset_confirm_updates_password",
            "old_shared_password_rejected_after_reset",
            "new_password_login_succeeds",
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
    console.error("Auth password reset integration test failed:");
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
          execFileSync("taskkill", ["/pid", String(apiProcess.pid), "/t", "/f"], { stdio: "ignore" });
        } catch {
          // Ignore cleanup failures.
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
