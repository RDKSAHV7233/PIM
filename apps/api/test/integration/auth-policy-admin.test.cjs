#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
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
    throw new Error("DATABASE_URL is required for auth-policy-admin integration test.");
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

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const port = 7200 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const platformToken = `auth-policy-${runId}`;
  const tenantKey = `auth-policy-${runId}`;
  const workspaceSlug = `ap-${runId}`.slice(0, 24);
  const displayName = `Auth Policy ${runId}`;
  const adminUserId = `auth-policy-admin-${runId}@example.com`;
  const editorUserId = `auth-policy-editor-${runId}@example.com`;

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

    const unauthRead = await apiRequest(baseUrl, "GET", "/admin/auth-policy", null);
    assertStatus(unauthRead, 401, "unauthenticated auth-policy read");

    const adminLogin = await login(baseUrl, workspaceSlug, adminUserId, 180);
    assertStatus(adminLogin, 201, "admin login");
    const adminToken = String(adminLogin.payload?.accessToken ?? "");
    assert(adminToken.length > 10, "missing admin access token");

    const defaultPolicy = await apiRequest(baseUrl, "GET", "/admin/auth-policy", adminToken);
    assertStatus(defaultPolicy, 200, "default auth policy read");
    assert(defaultPolicy.payload?.isPersisted === false, `expected default policy to be virtual, got ${JSON.stringify(defaultPolicy.payload)}`);
    assert(defaultPolicy.payload?.sessionTimeoutMinutes === 240, "default session timeout should be 240 minutes");
    assert(defaultPolicy.payload?.runtimeApplied?.sessionTimeout === true, "session-timeout runtime flag must be true");
    assert(defaultPolicy.payload?.runtimeApplied?.mfaEnrollment === false, "mfa runtime flag must remain false in this slice");

    const updatePolicy = await apiRequest(baseUrl, "PATCH", "/admin/auth-policy", adminToken, {
      externalIdentityMode: true,
      mfaRequired: true,
      mfaGracePeriodDays: 14,
      sessionTimeoutMinutes: 90,
      allowedAuthMethods: ["password", "oidc"],
    });
    assertStatus(updatePolicy, 200, "auth policy update");
    assert(updatePolicy.payload?.isPersisted === true, "updated auth policy should be persisted");
    assert(updatePolicy.payload?.updatedBy === adminUserId.toLowerCase(), "updatedBy should match acting admin");

    const persistedPolicy = await apiRequest(baseUrl, "GET", "/admin/auth-policy", adminToken);
    assertStatus(persistedPolicy, 200, "persisted auth policy read");
    assert(persistedPolicy.payload?.externalIdentityMode === true, "external identity mode should persist");
    assert(persistedPolicy.payload?.mfaRequired === true, "mfaRequired should persist");
    assert(persistedPolicy.payload?.mfaGracePeriodDays === 14, "mfa grace period should persist");
    assert(persistedPolicy.payload?.sessionTimeoutMinutes === 90, "session timeout should persist");
    assert(
      Array.isArray(persistedPolicy.payload?.allowedAuthMethods) &&
        persistedPolicy.payload.allowedAuthMethods.includes("password") &&
        persistedPolicy.payload.allowedAuthMethods.includes("oidc"),
      "allowed auth methods should persist",
    );

    const clampedLogin = await login(baseUrl, workspaceSlug, adminUserId, 180);
    assertStatus(clampedLogin, 201, "post-policy admin login");
    assert(
      clampedLogin.payload?.expiresInSeconds === 90 * 60,
      `expected login expiry to clamp to 90 minutes, got ${JSON.stringify(clampedLogin.payload)}`,
    );

    const createEditor = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminToken, {
      userId: editorUserId,
      role: "editor",
    });
    assertStatus(createEditor, 201, "create editor user");

    const editorLogin = await login(baseUrl, workspaceSlug, editorUserId, 30);
    assertStatus(editorLogin, 201, "editor login");
    const editorToken = String(editorLogin.payload?.accessToken ?? "");

    const editorRead = await apiRequest(baseUrl, "GET", "/admin/auth-policy", editorToken);
    assertStatus(editorRead, 403, "editor auth policy read should be denied");

    const policyRow = await prisma.tenantAuthPolicy.findUnique({
      where: { tenantKey },
    });
    assert(policyRow?.sessionTimeoutMinutes === 90, "tenant auth policy row must persist in the database");

    const auditRows = await prisma.auditLog.findMany({
      where: {
        tenantKey,
        resource: "TenantAuthPolicy",
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    assert(auditRows.some((row) => row.action === "tenant_auth_policy.created" || row.action === "tenant_auth_policy.updated"), "expected auth policy audit row");
    assert(
      auditRows.some((row) => Array.isArray(row.metadata?.changedFields) && row.metadata.changedFields.includes("sessionTimeoutMinutes")),
      "expected auth policy audit metadata to capture changedFields including sessionTimeoutMinutes",
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantKey,
          validated: [
            "auth_policy_requires_authentication",
            "auth_policy_returns_virtual_defaults_when_absent",
            "auth_policy_update_persists_and_audits",
            "auth_policy_session_timeout_clamps_runtime_login_expiry",
            "auth_policy_is_admin_only",
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
    console.error("Auth policy admin integration test failed:");
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
          apiProcess.kill("SIGTERM");
        }
      } else {
        apiProcess.kill("SIGTERM");
      }
    }
    await prisma.$disconnect();
  }
}

run().catch((error) => {
  console.error("Auth policy admin integration test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
