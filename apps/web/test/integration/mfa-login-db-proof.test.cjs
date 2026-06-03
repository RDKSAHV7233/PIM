#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync, execFileSync } = require("node:child_process");
const { createHmac } = require("node:crypto");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");

// --- TOTP implementation (mirrors mfa.service.ts) ---

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(input) {
  const normalized = input.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const output = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function hotp(secretBase32, counter) {
  const secret = decodeBase32(secretBase32);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function totp(secretBase32, atMs) {
  const counter = Math.floor((atMs ?? Date.now()) / 1000 / 30);
  return hotp(secretBase32, counter);
}

// --- Helpers ---

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || /^\s*#/.test(line)) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const raw = line.slice(idx + 1).trim();
    const value = raw.replace(/^"|"$/g, "");
    if (key && !process.env[key]) process.env[key] = value;
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
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
  setDefaultEnv("PIM_AUTH_PASSWORD", "vexa-pim-demo-password");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertStatus(result, expected, context) {
  if (result.status !== expected) {
    throw new Error(
      `${context} failed: expected HTTP ${expected}, got ${result.status}; payload=${JSON.stringify(result.payload)}`,
    );
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.status < 500) return;
    } catch {
      // retry
    }
    await sleep(400);
  }
  throw new Error(`Service did not become ready: ${url}`);
}

async function apiRequest(baseUrl, method, route, body, bearerToken) {
  const headers = { Accept: "application/json" };
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  const options = { method, headers, signal: AbortSignal.timeout(20_000) };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${route}`, options);
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { status: response.status, payload };
}

function getSetCookieHeaders(response) {
  if (typeof response.headers.getSetCookie === "function") return response.headers.getSetCookie();
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function extractCookieValue(setCookieHeaders, name) {
  for (const header of setCookieHeaders) {
    const first = String(header).split(";")[0] ?? "";
    const eqIndex = first.indexOf("=");
    if (eqIndex <= 0) continue;
    const cookieName = first.slice(0, eqIndex).trim();
    if (cookieName === name) return first.slice(eqIndex + 1);
  }
  return null;
}

async function apiRequestRaw(baseUrl, method, route, body, bearerToken) {
  const headers = { Accept: "application/json" };
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  const options = { method, headers, signal: AbortSignal.timeout(20_000) };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${route}`, options);
  const setCookieHeaders = getSetCookieHeaders(response);
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { status: response.status, payload, setCookieHeaders };
}

function startProcess(command, args, cwd, env, stdoutBuffer, stderrBuffer) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  child.stdout.on("data", (chunk) => {
    stdoutBuffer.push(String(chunk));
    if (stdoutBuffer.length > 200) stdoutBuffer.shift();
  });
  child.stderr.on("data", (chunk) => {
    stderrBuffer.push(String(chunk));
    if (stderrBuffer.length > 200) stderrBuffer.shift();
  });
  return child;
}

function stopProcess(proc) {
  if (!proc || proc.killed || !proc.pid) return;
  if (process.platform === "win32") {
    try { execFileSync("taskkill", ["/pid", String(proc.pid), "/t", "/f"], { stdio: "ignore" }); } catch { /* ignore */ }
    return;
  }
  proc.kill("SIGTERM");
}

function hasDatabaseAccess() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (/^[A-Z][A-Z0-9_]*$/.test(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function npmInvocation(args) {
  if (process.platform === "win32") {
    const commandLine = ["npm", ...args].join(" ");
    return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", commandLine] };
  }
  return { command: "npm", args };
}

async function run() {
  prepareEnv();

  if (!hasDatabaseAccess()) {
    console.log(
      JSON.stringify({
        status: "skipped",
        reason: "DATABASE_URL is not configured or is a placeholder; MFA DB proof requires a live Postgres database.",
        checkedAt: new Date().toISOString(),
      }, null, 2),
    );
    return;
  }

  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build`);
  }

  const runId = Date.now().toString();
  const apiPort = 5980 + Math.floor(Math.random() * 15);
  const apiBaseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const outboxDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "vexa-pim-mfa-proof-"));
  const workspaceSlug = `mfa-proof-${runId.slice(-8)}`;
  const adminEmail = `mfa-proof-${runId}@example.com`;
  const password = "MfaProof#2026";

  const apiEnv = {
    ...process.env,
    PORT: String(apiPort),
    AUTH_MODE: "db",
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_AUTH_IDENTITIES_JSON: " ",
    PIM_AUTH_WORKSPACES_JSON: " ",
    FEATURE_PUBLIC_SIGNUP_ENABLED: "true",
    AUTH_EMAIL_PROVIDER: "file",
    AUTH_EMAIL_OUTBOX_DIR: outboxDir,
  };

  const apiStdout = [];
  const apiStderr = [];
  const apiProcess = startProcess("node", [API_ENTRY], REPO_ROOT, apiEnv, apiStdout, apiStderr);

  try {
    await waitForHttp(`${apiBaseUrl}/health`, 60_000);

    // 1. Register workspace + admin
    const signupResult = await apiRequest(apiBaseUrl, "POST", "/signup/workspace", {
      displayName: "MFA Proof Workspace",
      workspaceSlug,
      adminEmail,
      password,
      acceptedTerms: true,
    });
    assertStatus(signupResult, 200, "workspace register");
    assert(signupResult.payload?.status === "pending_verification", "Expected pending_verification status");

    // 2. Locate verification token from outbox
    const deadline = Date.now() + 10_000;
    let verificationToken = null;
    while (Date.now() < deadline && !verificationToken) {
      await sleep(200);
      const files = fs.existsSync(outboxDir) ? fs.readdirSync(outboxDir) : [];
      for (const file of files) {
        const parsed = JSON.parse(fs.readFileSync(path.join(outboxDir, file), "utf8"));
        if (String(parsed.to ?? "").toLowerCase() === adminEmail.toLowerCase() && parsed.category === "signup_verification") {
          const source = `${String(parsed.text ?? "")}\n${String(parsed.html ?? "")}`;
          const match = source.match(/\/signup\/verify\?token=([^&\s"]+)/i);
          if (match) { verificationToken = decodeURIComponent(match[1]); break; }
        }
      }
    }
    assert(verificationToken, "Verification token not found in outbox within 10s");

    // 3. Verify workspace
    const verifyResult = await apiRequest(apiBaseUrl, "POST", "/signup/verify", { token: verificationToken });
    assertStatus(verifyResult, 200, "workspace verify");

    // 4. Login to get access token
    const loginResult = await apiRequestRaw(apiBaseUrl, "POST", "/auth/login", {
      workspaceSlug,
      userId: adminEmail,
      password,
      expiresInMinutes: 30,
    });
    assertStatus(loginResult, 201, "initial login");
    const accessToken = loginResult.payload?.accessToken;
    assert(accessToken, "Expected accessToken in login response");

    // 5. Request voluntary enrollment token
    const enrollTokenResult = await apiRequest(
      apiBaseUrl, "POST", "/auth/mfa/request-enrollment-token", {}, accessToken,
    );
    assertStatus(enrollTokenResult, 200, "request-enrollment-token");
    const enrollmentToken = enrollTokenResult.payload?.enrollmentToken;
    const enrollmentExpiresIn = enrollTokenResult.payload?.expiresInSeconds;
    assert(enrollmentToken, "Expected enrollmentToken in response");
    assert(Number.isFinite(enrollmentExpiresIn) && enrollmentExpiresIn > 0, "Expected positive expiresInSeconds");

    // 6. Begin MFA enrollment
    const beginResult = await apiRequest(apiBaseUrl, "POST", "/auth/mfa/enroll", {}, enrollmentToken);
    assertStatus(beginResult, 201, "begin enrollment");
    const manualEntryKey = beginResult.payload?.manualEntryKey;
    const otpauthUri = beginResult.payload?.otpauthUri;
    assert(manualEntryKey, "Expected manualEntryKey in enroll response");
    assert(typeof otpauthUri === "string" && otpauthUri.startsWith("otpauth://totp/"), "Expected valid otpauth URI");

    // 7. Verify enrollment with TOTP (try current and next window in case of clock boundary)
    const now = Date.now();
    const codes = [totp(manualEntryKey, now), totp(manualEntryKey, now + 30_000)];
    let verifyEnrollResult = null;
    for (const code of codes) {
      verifyEnrollResult = await apiRequest(
        apiBaseUrl, "POST", "/auth/mfa/verify-enrollment", { code }, enrollmentToken,
      );
      if (verifyEnrollResult.status === 200) break;
    }
    assertStatus(verifyEnrollResult, 200, "verify enrollment");
    const backupCodes = verifyEnrollResult.payload?.backupCodes;
    assert(Array.isArray(backupCodes) && backupCodes.length === 8, "Expected 8 backup codes after enrollment");
    assert(verifyEnrollResult.payload?.ok === true, "Expected ok:true in verify-enrollment response");

    // 8. Check MFA status — must now be active
    const statusResult = await apiRequest(apiBaseUrl, "GET", "/auth/mfa", undefined, accessToken);
    assertStatus(statusResult, 200, "GET /auth/mfa after enrollment");
    assert(statusResult.payload?.isEnabled === true, "Expected isEnabled:true after successful enrollment");
    assert(statusResult.payload?.backupCodesRemaining === 8, "Expected 8 backup codes remaining");

    // 9. Admin user list must reflect mfaEnrolled:true for this user
    const usersResult = await apiRequest(apiBaseUrl, "GET", "/admin/workspace/users", undefined, accessToken);
    assertStatus(usersResult, 200, "GET /admin/workspace/users");
    const adminUser = Array.isArray(usersResult.payload)
      ? usersResult.payload.find((u) => String(u.userId ?? "").toLowerCase() === adminEmail.toLowerCase())
      : null;
    assert(adminUser, "Admin user must appear in workspace user list");
    assert(adminUser.mfaEnrolled === true, "Admin user must show mfaEnrolled:true after enrollment");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          workspaceSlug,
          adminEmail,
          validated: [
            "workspace_register_and_verify",
            "login_returns_access_token",
            "request_enrollment_token_from_session",
            "begin_enrollment_returns_totp_uri_and_secret",
            "verify_enrollment_with_totp_returns_backup_codes",
            "mfa_status_shows_active_after_enrollment",
            "admin_user_list_reflects_mfa_enrolled_status",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error("MFA login DB proof test failed:");
    console.error(details);
    if (apiStdout.length) {
      console.error("--- API stdout tail ---");
      console.error(apiStdout.join("").slice(-4000));
    }
    if (apiStderr.length) {
      console.error("--- API stderr tail ---");
      console.error(apiStderr.join("").slice(-4000));
    }
    process.exitCode = 1;
  } finally {
    fs.rmSync(outboxDir, { recursive: true, force: true });
    stopProcess(apiProcess);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
