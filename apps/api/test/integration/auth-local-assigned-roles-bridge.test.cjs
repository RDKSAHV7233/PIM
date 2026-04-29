#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
const JWT_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "auth", "jwt.js");

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
  const port = 7440 + Math.floor(Math.random() * 80);
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const workspaceSlug = `local-ar-${runId}`.slice(0, 24);
  const tenantId = `local-assigned-${runId}`;
  const localAdminUserId = `local-admin-${runId}@example.com`;
  const localAssignedUserId = `local-assigned-${runId}@example.com`;
  const localFallbackUserId = `local-fallback-${runId}@example.com`;
  const localInvalidOnlyUserId = `local-invalid-${runId}@example.com`;
  const localNullFallbackUserId = `local-null-${runId}@example.com`;
  const localSystemAdminUserId = `local-system-${runId}@example.com`;
  const localProductAdminUserId = `local-product-${runId}@example.com`;
  const password = process.env.PIM_AUTH_PASSWORD;

  const env = {
    ...process.env,
    PORT: String(port),
    AUTH_MODE: "local",
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_DEFAULT_WORKSPACE_SLUG: workspaceSlug,
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: `Local Assigned Roles ${runId}` },
    }),
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [localAdminUserId]: { tenantId, role: "admin" },
      [localAssignedUserId]: { tenantId, role: "viewer", assignedRoles: ["editor", "editor", "product_admin", "not_a_role"] },
      [localFallbackUserId]: { tenantId, role: "reviewer", assignedRoles: [] },
      [localInvalidOnlyUserId]: { tenantId, role: "viewer", assignedRoles: ["not_a_role"] },
      [localNullFallbackUserId]: { tenantId, role: "reviewer", assignedRoles: null },
      [localSystemAdminUserId]: { tenantId, role: "admin", assignedRoles: ["system_admin"] },
      [localProductAdminUserId]: { tenantId, role: "admin", assignedRoles: ["product_admin"] },
    }),
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

    const localAdminLogin = await login(baseUrl, workspaceSlug, localAdminUserId, password);
    assertStatus(localAdminLogin, 201, "local admin login");

    const localAssignedLogin = await login(baseUrl, workspaceSlug, localAssignedUserId, password);
    assertStatus(localAssignedLogin, 201, "local assigned-roles login");
    const localAssignedClaims = verifyPimJwt(String(localAssignedLogin.payload?.accessToken ?? ""));
    assert(localAssignedClaims, "expected local assigned-roles token to verify");
    assert(localAssignedClaims.role === "viewer", `expected local scalar role viewer, got ${localAssignedClaims.role}`);
    assert(
      Array.isArray(localAssignedClaims.assignedRoles) &&
        localAssignedClaims.assignedRoles.includes("editor") &&
        localAssignedClaims.assignedRoles.includes("product_admin") &&
        !localAssignedClaims.assignedRoles.includes("not_a_role"),
      `expected local assignedRoles to include editor/product_admin and exclude invalid roles, got ${JSON.stringify(localAssignedClaims.assignedRoles)}`,
    );
    assert(
      localAssignedClaims.assignedRoles.filter((role) => role === "editor").length === 1,
      `expected local duplicate editor roles to normalize to one value, got ${JSON.stringify(localAssignedClaims.assignedRoles)}`,
    );
    const localAssignedEditorRead = await apiRequest(
      baseUrl,
      "GET",
      "/marketplace/channels",
      localAssignedLogin.payload.accessToken,
    );
    assertStatus(localAssignedEditorRead, 200, "local assigned roles bridge editor read");

    const localFallbackLogin = await login(baseUrl, workspaceSlug, localFallbackUserId, password);
    assertStatus(localFallbackLogin, 201, "local scalar fallback login");
    const localFallbackClaims = verifyPimJwt(String(localFallbackLogin.payload?.accessToken ?? ""));
    assert(localFallbackClaims, "expected local scalar fallback token to verify");
    assert(localFallbackClaims.role === "reviewer", `expected local scalar fallback reviewer role, got ${localFallbackClaims.role}`);
    assert(
      !Array.isArray(localFallbackClaims.assignedRoles) || localFallbackClaims.assignedRoles.length === 0,
      `expected local scalar fallback assignedRoles to stay empty, got ${JSON.stringify(localFallbackClaims.assignedRoles)}`,
    );
    const localFallbackEditorRead = await apiRequest(
      baseUrl,
      "GET",
      "/marketplace/channels",
      localFallbackLogin.payload.accessToken,
    );
    assertStatus(localFallbackEditorRead, 403, "local scalar fallback denied editor read");

    const localInvalidOnlyLogin = await login(baseUrl, workspaceSlug, localInvalidOnlyUserId, password);
    assertStatus(localInvalidOnlyLogin, 201, "local invalid-only assigned roles login");
    const localInvalidOnlyClaims = verifyPimJwt(String(localInvalidOnlyLogin.payload?.accessToken ?? ""));
    assert(localInvalidOnlyClaims, "expected local invalid-only token to verify");
    assert(localInvalidOnlyClaims.role === "viewer", `expected local invalid-only role to remain viewer, got ${localInvalidOnlyClaims.role}`);
    assert(
      !Array.isArray(localInvalidOnlyClaims.assignedRoles) || localInvalidOnlyClaims.assignedRoles.length === 0,
      `expected local invalid-only assignedRoles to normalize away, got ${JSON.stringify(localInvalidOnlyClaims.assignedRoles)}`,
    );
    const localInvalidOnlyEditorRead = await apiRequest(
      baseUrl,
      "GET",
      "/marketplace/channels",
      localInvalidOnlyLogin.payload.accessToken,
    );
    assertStatus(localInvalidOnlyEditorRead, 403, "local invalid-only assigned roles must not escalate editor read");

    const localNullFallbackLogin = await login(baseUrl, workspaceSlug, localNullFallbackUserId, password);
    assertStatus(localNullFallbackLogin, 201, "local null assigned roles login");
    const localNullFallbackClaims = verifyPimJwt(String(localNullFallbackLogin.payload?.accessToken ?? ""));
    assert(localNullFallbackClaims, "expected local null assigned-roles token to verify");
    assert(
      localNullFallbackClaims.role === "reviewer",
      `expected local null assigned-roles scalar role reviewer, got ${localNullFallbackClaims.role}`,
    );
    assert(
      !Array.isArray(localNullFallbackClaims.assignedRoles) || localNullFallbackClaims.assignedRoles.length === 0,
      `expected local null assignedRoles to fall back to scalar-only compatibility, got ${JSON.stringify(localNullFallbackClaims.assignedRoles)}`,
    );
    const localNullFallbackEditorRead = await apiRequest(
      baseUrl,
      "GET",
      "/marketplace/channels",
      localNullFallbackLogin.payload.accessToken,
    );
    assertStatus(localNullFallbackEditorRead, 403, "local null assigned roles denied editor read");

    const localSystemAdminLogin = await login(baseUrl, workspaceSlug, localSystemAdminUserId, password);
    assertStatus(localSystemAdminLogin, 201, "local system-admin assigned roles login");
    const localSystemAdminClaims = verifyPimJwt(String(localSystemAdminLogin.payload?.accessToken ?? ""));
    assert(localSystemAdminClaims, "expected local system-admin token to verify");
    assert(localSystemAdminClaims.role === "admin", `expected local system-admin scalar role admin, got ${localSystemAdminClaims.role}`);
    assert(
      Array.isArray(localSystemAdminClaims.assignedRoles) &&
        localSystemAdminClaims.assignedRoles.includes("system_admin"),
      `expected local system-admin assignedRoles to include system_admin, got ${JSON.stringify(localSystemAdminClaims.assignedRoles)}`,
    );
    const localSystemAdminSecurityRead = await apiRequest(
      baseUrl,
      "GET",
      "/admin/workspace/access-scopes",
      localSystemAdminLogin.payload.accessToken,
    );
    assertStatus(localSystemAdminSecurityRead, 200, "local system-admin assigned role allowed security governance read");

    const localProductAdminLogin = await login(baseUrl, workspaceSlug, localProductAdminUserId, password);
    assertStatus(localProductAdminLogin, 201, "local product-admin assigned roles login");
    const localProductAdminClaims = verifyPimJwt(String(localProductAdminLogin.payload?.accessToken ?? ""));
    assert(localProductAdminClaims, "expected local product-admin token to verify");
    assert(localProductAdminClaims.role === "admin", `expected local product-admin scalar role admin, got ${localProductAdminClaims.role}`);
    assert(
      Array.isArray(localProductAdminClaims.assignedRoles) &&
        localProductAdminClaims.assignedRoles.includes("product_admin"),
      `expected local product-admin assignedRoles to include product_admin, got ${JSON.stringify(localProductAdminClaims.assignedRoles)}`,
    );
    const localProductAdminSecurityRead = await apiRequest(
      baseUrl,
      "GET",
      "/admin/workspace/access-scopes",
      localProductAdminLogin.payload.accessToken,
    );
    assertStatus(localProductAdminSecurityRead, 403, "local product-admin assigned role denied security governance read");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          workspaceSlug,
          validated: [
            "local_identity_assigned_roles_bridge_works",
            "local_identity_scalar_role_fallback_still_works",
            "local_duplicate_assigned_roles_normalize_safely",
            "local_identity_invalid_assigned_roles_do_not_escalate",
            "local_null_assigned_roles_fall_back_to_scalar_role",
            "local_system_admin_assigned_role_drives_security_governance_reads",
            "local_product_admin_assigned_role_does_not_escalate_security_governance_reads",
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
    console.error("Auth local assigned-roles bridge integration test failed:");
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
      try {
        execFileSync("taskkill", ["/pid", String(apiProcess.pid), "/t", "/f"], { stdio: "ignore" });
      } catch {
        // ignore
      }
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
