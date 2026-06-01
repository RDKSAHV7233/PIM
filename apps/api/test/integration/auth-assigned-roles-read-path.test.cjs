#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
const JWT_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "auth", "jwt.js");
const ASSIGNED_ROLES_MIGRATION = path.join(
  REPO_ROOT,
  "packages",
  "db",
  "prisma",
  "migrations",
  "20260429113000_add_auth_identity_assigned_roles",
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
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");  // Set L: auth middleware Redis gate
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
  setDefaultEnv("APP_ENV", "development");
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
      // retry
    }
    await sleep(400);
  }
  throw new Error(`API did not become healthy at ${baseUrl}/health within ${timeoutMs}ms`);
}

function hasExited(childProcess) {
  return childProcess.exitCode !== null || childProcess.signalCode !== null;
}

async function waitForExit(childProcess, timeoutMs) {
  if (hasExited(childProcess)) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      childProcess.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    function onExit() {
      clearTimeout(timer);
      resolve(true);
    }
    childProcess.once("exit", onExit);
  });
}

async function stopApiProcess(apiProcess) {
  if (!apiProcess.pid || hasExited(apiProcess)) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/pid", String(apiProcess.pid), "/t", "/f"], { stdio: "ignore" });
    } catch {
      // ignore
    }
    return;
  }
  apiProcess.kill("SIGTERM");
  if (!(await waitForExit(apiProcess, 500)) && !hasExited(apiProcess)) {
    apiProcess.kill("SIGKILL");
  }
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

function createPrisma() {
  const url = String(process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL ?? "").trim();
  if (!url) {
    throw new Error("DATABASE_URL is required for auth-assigned-roles integration test.");
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

async function login(baseUrl, workspaceSlug, userId, password = process.env.PIM_AUTH_PASSWORD) {
  return apiRequest(baseUrl, "POST", "/auth/login", null, {
    workspaceSlug,
    userId,
    password,
    expiresInMinutes: 30,
  });
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }
  if (!fs.existsSync(JWT_ENTRY)) {
    throw new Error(`JWT build output not found at ${JWT_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const { verifyPimJwt } = require(JWT_ENTRY);
  const runId = Date.now().toString();
  const port = 7330 + Math.floor(Math.random() * 100);
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const platformToken = `auth-assigned-roles-${runId}`;
  const tenantKey = `auth-assigned-${runId}`;
  const workspaceSlug = `ar-${runId}`.slice(0, 24);
  const adminUserId = `auth-assigned-admin-${runId}@example.com`;
  const persistedUserId = `auth-assigned-persisted-${runId}@example.com`;
  const fallbackUserId = `auth-assigned-fallback-${runId}@example.com`;
  const invalidOnlyUserId = `auth-assigned-invalid-${runId}@example.com`;
  const rollbackUserId = `auth-assigned-rollback-${runId}@example.com`;
  const persistedSystemAdminUserId = `auth-assigned-system-${runId}@example.com`;
  const persistedProductAdminUserId = `auth-assigned-product-${runId}@example.com`;
  const password = process.env.PIM_AUTH_PASSWORD;
  const passwordHash = await bcrypt.hash(password, 10);

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
    await waitForHealth(baseUrl, 60_000);

    const provision = await apiRequest(
      baseUrl,
      "POST",
      "/platform/tenants",
      null,
      { tenantKey, workspaceSlug, displayName: `Auth Assigned Roles ${runId}`, initialAdminUserId: adminUserId },
      { "x-pim-platform-admin-token": platformToken },
    );
    assertStatus(provision, 201, "platform tenant provisioning");

    const adminLogin = await login(baseUrl, workspaceSlug, adminUserId, password);
    assertStatus(adminLogin, 201, "admin login for workspace-user read compatibility");

    await prisma.authIdentity.createMany({
      data: [
        {
          tenantKey,
          userId: persistedUserId,
          role: "viewer",
          assignedRoles: ["editor", "editor", "product_admin", "not_a_role"],
          isActive: true,
          passwordHash,
        },
        {
          tenantKey,
          userId: fallbackUserId,
          role: "reviewer",
          assignedRoles: [],
          isActive: true,
          passwordHash,
        },
        {
          tenantKey,
          userId: invalidOnlyUserId,
          role: "viewer",
          assignedRoles: ["not_a_role"],
          isActive: true,
          passwordHash,
        },
        {
          tenantKey,
          userId: rollbackUserId,
          role: "viewer",
          assignedRoles: ["editor"],
          isActive: true,
          passwordHash,
        },
        {
          tenantKey,
          userId: persistedSystemAdminUserId,
          role: "admin",
          assignedRoles: ["system_admin"],
          isActive: true,
          passwordHash,
        },
        {
          tenantKey,
          userId: persistedProductAdminUserId,
          role: "admin",
          assignedRoles: ["product_admin"],
          isActive: true,
          passwordHash,
        },
      ],
    });

    const persistedLogin = await login(baseUrl, workspaceSlug, persistedUserId, password);
    assertStatus(persistedLogin, 201, "persisted assigned-roles login");
    const persistedClaims = verifyPimJwt(String(persistedLogin.payload?.accessToken ?? ""));
    assert(persistedClaims, "expected persisted assigned-roles token to verify");
    assert(persistedClaims.role === "viewer", `expected scalar role viewer to remain primary claim, got ${persistedClaims.role}`);
    assert(
      Array.isArray(persistedClaims.assignedRoles) &&
        persistedClaims.assignedRoles.includes("editor") &&
        persistedClaims.assignedRoles.includes("product_admin"),
      `expected assigned roles to include editor and product_admin, got ${JSON.stringify(persistedClaims.assignedRoles)}`,
    );
    assert(
      persistedClaims.assignedRoles.filter((role) => role === "editor").length === 1,
      `expected duplicate persisted editor roles to normalize to one value, got ${JSON.stringify(persistedClaims.assignedRoles)}`,
    );
    assert(
      !persistedClaims.assignedRoles.includes("not_a_role"),
      `expected invalid assigned role to be dropped, got ${JSON.stringify(persistedClaims.assignedRoles)}`,
    );

    const persistedEditorRead = await apiRequest(baseUrl, "GET", "/marketplace/channels", persistedLogin.payload.accessToken);
    assertStatus(persistedEditorRead, 200, "persisted assigned-roles editor read");
    assert(
      Array.isArray(persistedEditorRead.payload),
      `expected marketplace channels payload for assigned-roles editor read, got ${JSON.stringify(persistedEditorRead.payload)}`,
    );

    const workspaceUsersRead = await apiRequest(baseUrl, "GET", "/admin/workspace/users", adminLogin.payload.accessToken);
    assertStatus(workspaceUsersRead, 200, "workspace user governance read exposes persisted assigned roles");
    const persistedWorkspaceUser = Array.isArray(workspaceUsersRead.payload)
      ? workspaceUsersRead.payload.find((row) => String(row?.userId ?? "") === persistedUserId.toLowerCase())
      : null;
    assert(persistedWorkspaceUser, "expected persisted assigned-roles user to appear in workspace user listing");
    assert(
      Array.isArray(persistedWorkspaceUser.assignedRoles) &&
        persistedWorkspaceUser.assignedRoles.includes("editor"),
      `expected workspace user listing to expose assigned editor role, got ${JSON.stringify(persistedWorkspaceUser)}`,
    );
    assert(
      persistedWorkspaceUser.assignedRoles.filter((role) => role === "editor").length === 1,
      `expected workspace user listing to dedupe duplicate editor roles, got ${JSON.stringify(persistedWorkspaceUser)}`,
    );
    assert(
      !persistedWorkspaceUser.assignedRoles.includes("not_a_role"),
      `expected workspace user listing to normalize invalid assigned roles away, got ${JSON.stringify(persistedWorkspaceUser)}`,
    );

    const fallbackLogin = await login(baseUrl, workspaceSlug, fallbackUserId, password);
    assertStatus(fallbackLogin, 201, "scalar fallback login");
    const fallbackClaims = verifyPimJwt(String(fallbackLogin.payload?.accessToken ?? ""));
    assert(fallbackClaims, "expected scalar fallback token to verify");
    assert(fallbackClaims.role === "reviewer", `expected scalar reviewer role to remain primary claim, got ${fallbackClaims.role}`);
    assert(
      !Array.isArray(fallbackClaims.assignedRoles) || fallbackClaims.assignedRoles.length === 0,
      `expected empty assignedRoles for scalar fallback user, got ${JSON.stringify(fallbackClaims.assignedRoles)}`,
    );

    const fallbackEditorRead = await apiRequest(baseUrl, "GET", "/marketplace/channels", fallbackLogin.payload.accessToken);
    assertStatus(fallbackEditorRead, 403, "scalar fallback user denied editor read");

    const invalidOnlyLogin = await login(baseUrl, workspaceSlug, invalidOnlyUserId, password);
    assertStatus(invalidOnlyLogin, 201, "invalid-only assigned-roles login");
    const invalidOnlyClaims = verifyPimJwt(String(invalidOnlyLogin.payload?.accessToken ?? ""));
    assert(invalidOnlyClaims, "expected invalid-only token to verify");
    assert(invalidOnlyClaims.role === "viewer", `expected invalid-only user to remain viewer, got ${invalidOnlyClaims.role}`);
    assert(
      !Array.isArray(invalidOnlyClaims.assignedRoles) || invalidOnlyClaims.assignedRoles.length === 0,
      `expected invalid-only assigned roles to normalize away, got ${JSON.stringify(invalidOnlyClaims.assignedRoles)}`,
    );

    const invalidOnlyEditorRead = await apiRequest(baseUrl, "GET", "/marketplace/channels", invalidOnlyLogin.payload.accessToken);
    assertStatus(invalidOnlyEditorRead, 403, "invalid-only assigned roles must not escalate editor read");

    const rollbackLoginBeforeNull = await login(baseUrl, workspaceSlug, rollbackUserId, password);
    assertStatus(rollbackLoginBeforeNull, 201, "rollback compatibility login before assigned_roles null");
    const rollbackClaimsBeforeNull = verifyPimJwt(String(rollbackLoginBeforeNull.payload?.accessToken ?? ""));
    assert(rollbackClaimsBeforeNull, "expected rollback-compatibility token before null to verify");
    assert(
      Array.isArray(rollbackClaimsBeforeNull.assignedRoles) &&
        rollbackClaimsBeforeNull.assignedRoles.includes("editor"),
      `expected rollback-compatibility user to start with assigned editor role, got ${JSON.stringify(rollbackClaimsBeforeNull.assignedRoles)}`,
    );
    const rollbackEditorReadBeforeNull = await apiRequest(
      baseUrl,
      "GET",
      "/marketplace/channels",
      rollbackLoginBeforeNull.payload.accessToken,
    );
    assertStatus(rollbackEditorReadBeforeNull, 200, "rollback compatibility user starts with editor read");

    await prisma.$executeRawUnsafe(
      `
      UPDATE "AuthIdentity"
      SET "assigned_roles" = NULL
      WHERE "tenantKey" = $1
        AND "userId" = $2
      `,
      tenantKey,
      rollbackUserId,
    );

    const rollbackLoginAfterNull = await login(baseUrl, workspaceSlug, rollbackUserId, password);
    assertStatus(rollbackLoginAfterNull, 201, "rollback compatibility login after assigned_roles null");
    const rollbackClaimsAfterNull = verifyPimJwt(String(rollbackLoginAfterNull.payload?.accessToken ?? ""));
    assert(rollbackClaimsAfterNull, "expected rollback-compatibility token after null to verify");
    assert(
      rollbackClaimsAfterNull.role === "viewer",
      `expected rollback-compatibility scalar role viewer after null assigned_roles, got ${rollbackClaimsAfterNull.role}`,
    );
    assert(
      !Array.isArray(rollbackClaimsAfterNull.assignedRoles) || rollbackClaimsAfterNull.assignedRoles.length === 0,
      `expected null assigned_roles to fall back to scalar-only compatibility, got ${JSON.stringify(rollbackClaimsAfterNull.assignedRoles)}`,
    );
    const rollbackEditorReadAfterNull = await apiRequest(
      baseUrl,
      "GET",
      "/marketplace/channels",
      rollbackLoginAfterNull.payload.accessToken,
    );
    assertStatus(rollbackEditorReadAfterNull, 403, "rollback compatibility user denied editor read after assigned_roles null");

    const persistedSystemAdminLogin = await login(baseUrl, workspaceSlug, persistedSystemAdminUserId, password);
    assertStatus(persistedSystemAdminLogin, 201, "persisted system-admin assigned-roles login");
    const persistedSystemAdminClaims = verifyPimJwt(String(persistedSystemAdminLogin.payload?.accessToken ?? ""));
    assert(persistedSystemAdminClaims, "expected persisted system-admin token to verify");
    assert(
      persistedSystemAdminClaims.role === "admin",
      `expected scalar admin role to remain primary claim for persisted system-admin user, got ${persistedSystemAdminClaims.role}`,
    );
    assert(
      Array.isArray(persistedSystemAdminClaims.assignedRoles) &&
        persistedSystemAdminClaims.assignedRoles.includes("system_admin"),
      `expected persisted system-admin assignedRoles to include system_admin, got ${JSON.stringify(persistedSystemAdminClaims.assignedRoles)}`,
    );
    const persistedSystemAdminSecurityRead = await apiRequest(
      baseUrl,
      "GET",
      "/admin/workspace/access-scopes",
      persistedSystemAdminLogin.payload.accessToken,
    );
    assertStatus(persistedSystemAdminSecurityRead, 200, "persisted system-admin assigned role allowed security governance read");
    assert(
      Array.isArray(persistedSystemAdminSecurityRead.payload),
      `expected workspace access scopes payload for persisted system-admin read, got ${JSON.stringify(persistedSystemAdminSecurityRead.payload)}`,
    );

    const persistedProductAdminLogin = await login(baseUrl, workspaceSlug, persistedProductAdminUserId, password);
    assertStatus(persistedProductAdminLogin, 201, "persisted product-admin assigned-roles login");
    const persistedProductAdminClaims = verifyPimJwt(String(persistedProductAdminLogin.payload?.accessToken ?? ""));
    assert(persistedProductAdminClaims, "expected persisted product-admin token to verify");
    assert(
      persistedProductAdminClaims.role === "admin",
      `expected scalar admin role to remain primary claim for persisted product-admin user, got ${persistedProductAdminClaims.role}`,
    );
    assert(
      Array.isArray(persistedProductAdminClaims.assignedRoles) &&
        persistedProductAdminClaims.assignedRoles.includes("product_admin"),
      `expected persisted product-admin assignedRoles to include product_admin, got ${JSON.stringify(persistedProductAdminClaims.assignedRoles)}`,
    );
    const persistedProductAdminSecurityRead = await apiRequest(
      baseUrl,
      "GET",
      "/admin/workspace/access-scopes",
      persistedProductAdminLogin.payload.accessToken,
    );
    assertStatus(persistedProductAdminSecurityRead, 403, "persisted product-admin assigned role denied security governance read");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantKey,
          validated: [
            "assigned_roles_are_read_when_present",
            "scalar_role_fallback_still_works_when_assigned_roles_empty",
            "duplicate_persisted_assigned_roles_normalize_safely",
            "invalid_assigned_roles_do_not_escalate_privilege",
            "null_assigned_roles_fall_back_to_scalar_role",
            "rollback_to_scalar_only_compatibility_works",
            "workspace_user_governance_reads_surface_normalized_assigned_roles",
            "persisted_system_admin_assigned_role_drives_security_governance_reads",
            "persisted_product_admin_assigned_role_does_not_escalate_security_governance_reads",
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
    console.error("Auth assigned-roles read-path integration test failed:");
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
    await stopApiProcess(apiProcess);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
