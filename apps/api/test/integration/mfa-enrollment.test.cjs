#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createHmac } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
const ASSIGNED_ROLES_MIGRATION = path.join(
  REPO_ROOT,
  "packages",
  "db",
  "prisma",
  "migrations",
  "20260429113000_add_auth_identity_assigned_roles",
  "migration.sql",
);
const AUTH_POLICY_MIGRATION = path.join(
  REPO_ROOT,
  "packages",
  "db",
  "prisma",
  "migrations",
  "20260501162000_add_tenant_auth_policy",
  "migration.sql",
);
const MFA_MIGRATION = path.join(
  REPO_ROOT,
  "packages",
  "db",
  "prisma",
  "migrations",
  "20260501181500_add_user_mfa_foundation",
  "migration.sql",
);
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

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
  const localDatabaseUrl = "postgresql://postgres:postgres@localhost:5432/pim1?schema=public";
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl || /HOST:5432/i.test(databaseUrl)) {
    process.env.DATABASE_URL = localDatabaseUrl;
  }
  if (!process.env.DATABASE_URL_POOLED || /HOST:5432/i.test(String(process.env.DATABASE_URL_POOLED))) {
    process.env.DATABASE_URL_POOLED = process.env.DATABASE_URL;
  }
  if (!process.env.DATABASE_URL_DIRECT || /HOST:5432/i.test(String(process.env.DATABASE_URL_DIRECT))) {
    process.env.DATABASE_URL_DIRECT = process.env.DATABASE_URL;
  }
  setDefaultEnv("JWT_SECRET", "vexa-pim-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "vexa-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");
  setDefaultEnv("PIM_AUTH_PASSWORD", "vexa-pim-demo-password");
  setDefaultEnv("PIM_AUTH_IP_ATTEMPT_LIMIT", "100");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
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

async function login(baseUrl, workspaceSlug, userId, expiresInMinutes = 30) {
  return apiRequest(baseUrl, "POST", "/auth/login", null, {
    workspaceSlug,
    userId,
    password: process.env.PIM_AUTH_PASSWORD,
    expiresInMinutes,
  });
}

function createPrisma() {
  const url = String(process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL ?? "").trim();
  if (!url) {
    throw new Error("DATABASE_URL is required for MFA enrollment integration test.");
  }
  return new PrismaClient({ datasources: { db: { url } } });
}

async function applyMigrationFile(prisma, migrationPath) {
  const sql = fs.readFileSync(migrationPath, "utf8");
  const statements = sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
}

function decodeBase32(input) {
  const normalized = String(input).replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const output = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new Error(`Invalid base32 character: ${char}`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function hotp(secret, counter) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** 6).padStart(6, "0");
}

function totp(secretBase32, atMs = Date.now()) {
  const counter = Math.floor(atMs / 1000 / 30);
  return hotp(decodeBase32(secretBase32), counter);
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const port = 7350 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const platformToken = `mfa-${runId}`;
  const tenantKey = `mfa-${runId}`;
  const workspaceSlug = `mfa-${runId}`.slice(0, 24);
  const displayName = `MFA ${runId}`;
  const adminUserId = `mfa-admin-${runId}@example.com`;

  const env = {
    ...process.env,
    PORT: String(port),
    AUTH_MODE: "db",
    PIM_PLATFORM_ADMIN_TOKEN: platformToken,
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_AUTH_IDENTITIES_JSON: "",
    PIM_AUTH_WORKSPACES_JSON: "",
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
    await applyMigrationFile(prisma, ASSIGNED_ROLES_MIGRATION);
    await applyMigrationFile(prisma, AUTH_POLICY_MIGRATION);
    await applyMigrationFile(prisma, MFA_MIGRATION);
    await waitForHealth(baseUrl, 60_000);

    const provision = await apiRequest(
      baseUrl,
      "POST",
      "/platform/tenants",
      null,
      { tenantKey, workspaceSlug, displayName, initialAdminUserId: adminUserId, initialAdminPassword: process.env.PIM_AUTH_PASSWORD },
      { "x-pim-platform-admin-token": platformToken },
    );
    assertStatus(provision, 201, "platform tenant provisioning");

    const adminLogin = await login(baseUrl, workspaceSlug, adminUserId, 180);
    assertStatus(adminLogin, 201, "admin login");
    const adminToken = String(adminLogin.payload?.accessToken ?? "");
    assert(adminToken.length > 10, "missing admin access token");

    const emptyStatus = await apiRequest(baseUrl, "GET", "/auth/mfa", adminToken);
    assertStatus(emptyStatus, 200, "initial mfa status");
    assert(emptyStatus.payload?.isEnabled === false, "mfa should start disabled");
    assert(emptyStatus.payload?.isPending === false, "mfa should start not pending");

    const beginEnrollment = await apiRequest(baseUrl, "POST", "/auth/mfa/enroll", adminToken, {});
    assertStatus(beginEnrollment, 201, "begin mfa enrollment");
    assert(typeof beginEnrollment.payload?.manualEntryKey === "string", "manualEntryKey should be returned");
    assert(String(beginEnrollment.payload?.otpauthUri ?? "").startsWith("otpauth://totp/"), "otpauthUri should be returned");

    const pendingStatus = await apiRequest(baseUrl, "GET", "/auth/mfa", adminToken);
    assertStatus(pendingStatus, 200, "pending mfa status");
    assert(pendingStatus.payload?.isPending === true, "mfa should be pending after enrollment start");
    assert(pendingStatus.payload?.isEnabled === false, "mfa should not be active before verification");

    const invalidVerify = await apiRequest(baseUrl, "POST", "/auth/mfa/verify-enrollment", adminToken, {
      code: "000000",
    });
    assertStatus(invalidVerify, 401, "invalid mfa verification");
    assert(invalidVerify.payload?.error === "MFA_CODE_INVALID", "invalid code should be rejected");

    const validCode = totp(beginEnrollment.payload.manualEntryKey);
    const verifyEnrollment = await apiRequest(baseUrl, "POST", "/auth/mfa/verify-enrollment", adminToken, {
      code: validCode,
    });
    assertStatus(verifyEnrollment, 200, "verify mfa enrollment");
    assert(Array.isArray(verifyEnrollment.payload?.backupCodes), "backup codes should be returned");
    assert(verifyEnrollment.payload.backupCodes.length === 8, "expected 8 backup codes");

    const activeStatus = await apiRequest(baseUrl, "GET", "/auth/mfa", adminToken);
    assertStatus(activeStatus, 200, "active mfa status");
    assert(activeStatus.payload?.isEnabled === true, "mfa should be active after verification");
    assert(activeStatus.payload?.isPending === false, "mfa should not remain pending");
    assert(activeStatus.payload?.backupCodesRemaining === 8, "backup code count should be exposed");

    const regenerateCodes = await apiRequest(baseUrl, "POST", "/auth/mfa/backup-codes/regenerate", adminToken, {
      code: totp(beginEnrollment.payload.manualEntryKey),
    });
    assertStatus(regenerateCodes, 200, "regenerate backup codes");
    assert(regenerateCodes.payload?.backupCodes.length === 8, "regenerated backup codes should return 8 entries");

    const tenantPrisma = prisma.$extends({});
    const enrollmentRow = await tenantPrisma.userMfaEnrollment.findFirst({
      where: {
        tenantKey,
        userId: adminUserId.toLowerCase(),
        method: "totp",
      },
      select: {
        id: true,
        status: true,
        secretEncrypted: true,
        secretPreview: true,
        verifiedAt: true,
        backupCodes: {
          where: { consumedAt: null },
          select: { id: true },
        },
      },
    });
    assert(enrollmentRow, "mfa enrollment row should be stored");
    assert(enrollmentRow.status === "active", "mfa enrollment row should be active");
    assert(!String(enrollmentRow.secretEncrypted).includes(beginEnrollment.payload.manualEntryKey), "mfa secret must be encrypted at rest");
    assert(enrollmentRow.secretPreview === beginEnrollment.payload.secretPreview, "secret preview should persist");
    assert(enrollmentRow.backupCodes.length === 8, "backup codes should persist");
    assert(enrollmentRow.verifiedAt instanceof Date, "verifiedAt should be stored");

    const auditRows = await tenantPrisma.auditLog.findMany({
      where: {
        actorId: adminUserId.toLowerCase(),
        action: {
          in: [
            "auth.mfa_enrollment_started",
            "auth.mfa_enrollment_verified",
            "auth.mfa_backup_codes_regenerated",
          ],
        },
      },
      select: {
        action: true,
        metadata: true,
      },
    });
    assert(auditRows.some((row) => row.action === "auth.mfa_enrollment_started"), "expected mfa enrollment start audit");
    assert(auditRows.some((row) => row.action === "auth.mfa_enrollment_verified"), "expected mfa verification audit");
    assert(auditRows.some((row) => row.action === "auth.mfa_backup_codes_regenerated"), "expected backup code regeneration audit");

    console.log("mfa-enrollment integration checks passed");
  } finally {
    await prisma.$disconnect().catch(() => {});
    if (!apiProcess.killed) {
      apiProcess.kill("SIGTERM");
      await new Promise((resolve) => apiProcess.once("exit", resolve)).catch(() => {});
    }
    if (apiProcess.exitCode && apiProcess.exitCode !== 0) {
      const stdout = stdoutBuffer.join("");
      const stderr = stderrBuffer.join("");
      if (stdout.trim() || stderr.trim()) {
        console.error(stdout);
        console.error(stderr);
      }
    }
  }
}

run().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
