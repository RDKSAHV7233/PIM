#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
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

async function login(baseUrl, workspaceSlug, userId) {
  const response = await apiRequest(baseUrl, "POST", "/auth/login", null, {
    workspaceSlug,
    userId,
    password: process.env.PIM_AUTH_PASSWORD,
    expiresInMinutes: 30,
  });
  return response;
}

function createPrisma() {
  const url = String(process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL ?? "").trim();
  if (!url) {
    throw new Error("DATABASE_URL is required for workspace-user-crud integration test.");
  }
  return new PrismaClient({ datasources: { db: { url } } });
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const port = 7000 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const platformToken = `workspace-users-${runId}`;
  const tenantKey = `workspace-users-${runId}`;
  const workspaceSlug = `wu-${runId}`.slice(0, 24);
  const displayName = `Workspace Users ${runId}`;
  const adminUserId = `workspace-admin-${runId}@example.com`;
  const viewerUserId = `workspace-viewer-${runId}@example.com`;
  const roleUserId = `workspace-role-${runId}@example.com`;

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

    const listInitial = await apiRequest(baseUrl, "GET", "/admin/workspace/users", adminToken);
    assertStatus(listInitial, 200, "list users as admin");
    assert(Array.isArray(listInitial.payload), "list users payload must be an array");
    assert(listInitial.payload.some((row) => row.userId === adminUserId.toLowerCase()), "admin user must be listed");

    const createViewer = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminToken, {
      userId: viewerUserId,
      role: "viewer",
    });
    assertStatus(createViewer, 201, "create viewer user");
    assert(createViewer.payload?.userId === viewerUserId.toLowerCase(), "created viewer userId mismatch");
    assert(createViewer.payload?.isLocked === false, "new user should not be locked");

    const createRoleUser = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminToken, {
      userId: roleUserId,
      role: "viewer",
    });
    assertStatus(createRoleUser, 201, "create role-change user");

    const createdAuditRows = await prisma.$queryRawUnsafe(
      `
      SELECT action, metadata
      FROM audit_logs
      WHERE tenant_key = $1
        AND action = 'workspace_user.created'
      ORDER BY created_at DESC
      LIMIT 5
      `,
      tenantKey,
    );
    const createdActions = Array.isArray(createdAuditRows) ? createdAuditRows : [];
    assert(createdActions.length >= 2, "expected workspace_user.created audit rows");

    const duplicateCreate = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminToken, {
      userId: viewerUserId,
      role: "viewer",
    });
    assertStatus(duplicateCreate, 409, "duplicate user create rejected");

    const updateRole = await apiRequest(
      baseUrl,
      "PATCH",
      `/admin/workspace/users/${encodeURIComponent(roleUserId)}/role`,
      adminToken,
      { role: "reviewer" },
    );
    assertStatus(updateRole, 200, "update user role");
    assert(updateRole.payload?.role === "reviewer", "role update must return reviewer");

    const roleAuditRows = await prisma.$queryRawUnsafe(
      `
      SELECT metadata
      FROM audit_logs
      WHERE tenant_key = $1
        AND action = 'workspace_user.role_changed'
      ORDER BY created_at DESC
      LIMIT 1
      `,
      tenantKey,
    );
    const roleAudit = Array.isArray(roleAuditRows) ? roleAuditRows[0] : null;
    assert(roleAudit && String(roleAudit.metadata?.fromRole ?? "") === "viewer", "role change audit must record fromRole=viewer");
    assert(roleAudit && String(roleAudit.metadata?.toRole ?? "") === "reviewer", "role change audit must record toRole=reviewer");

    const selfRoleChange = await apiRequest(
      baseUrl,
      "PATCH",
      `/admin/workspace/users/${encodeURIComponent(adminUserId)}/role`,
      adminToken,
      { role: "viewer" },
    );
    assertStatus(selfRoleChange, 400, "self role change rejected");

    const lockViewer = await apiRequest(
      baseUrl,
      "POST",
      `/admin/workspace/users/${encodeURIComponent(viewerUserId)}/lock`,
      adminToken,
      { durationMinutes: 60, reason: "policy-check" },
    );
    assertStatus(lockViewer, 200, "lock user");
    assert(Boolean(lockViewer.payload?.lockedUntil), "locked user must have lockedUntil");
    assert(lockViewer.payload?.isLocked === true, "locked user response must mark isLocked=true");

    const lockedLogin = await login(baseUrl, workspaceSlug, viewerUserId);
    assertStatus(lockedLogin, 423, "locked user login rejected");
    assert(String(lockedLogin.payload?.error ?? "") === "ACCOUNT_LOCKED", "locked login must return ACCOUNT_LOCKED");

    const unlockViewer = await apiRequest(
      baseUrl,
      "POST",
      `/admin/workspace/users/${encodeURIComponent(viewerUserId)}/unlock`,
      adminToken,
      {},
    );
    assertStatus(unlockViewer, 200, "unlock user");
    assert(unlockViewer.payload?.lockedUntil === null, "unlock must clear lockedUntil");

    const viewerLogin = await login(baseUrl, workspaceSlug, viewerUserId);
    assertStatus(viewerLogin, 201, "viewer login after unlock");
    const viewerToken = String(viewerLogin.payload?.accessToken ?? "");
    assert(viewerToken.length > 10, "missing viewer access token after unlock");

    const viewerListAttempt = await apiRequest(baseUrl, "GET", "/admin/workspace/users", viewerToken);
    assertStatus(viewerListAttempt, 403, "viewer denied admin workspace users route");

    const deactivateViewer = await apiRequest(
      baseUrl,
      "POST",
      `/admin/workspace/users/${encodeURIComponent(viewerUserId)}/deactivate`,
      adminToken,
      {},
    );
    assertStatus(deactivateViewer, 200, "deactivate user");
    assert(deactivateViewer.payload?.isActive === false, "deactivate must set isActive=false");

    const deactivatedLogin = await login(baseUrl, workspaceSlug, viewerUserId);
    assertStatus(deactivatedLogin, 401, "deactivated user login rejected");
    assert(String(deactivatedLogin.payload?.error ?? "") === "INVALID_CREDENTIALS", "deactivated user should look like invalid credentials");

    const auditRows = await prisma.$queryRawUnsafe(
      `
      SELECT action
      FROM audit_logs
      WHERE tenant_key = $1
        AND action IN (
          'workspace_user.created',
          'workspace_user.role_changed',
          'workspace_user.locked',
          'workspace_user.unlocked',
          'workspace_user.deactivated'
        )
      `,
      tenantKey,
    );
    const actions = Array.isArray(auditRows) ? auditRows.map((row) => String(row.action ?? "")) : [];
    assert(actions.includes("workspace_user.created"), "expected workspace_user.created audit row");
    assert(actions.includes("workspace_user.role_changed"), "expected workspace_user.role_changed audit row");
    assert(actions.includes("workspace_user.locked"), "expected workspace_user.locked audit row");
    assert(actions.includes("workspace_user.unlocked"), "expected workspace_user.unlocked audit row");
    assert(actions.includes("workspace_user.deactivated"), "expected workspace_user.deactivated audit row");

    console.log(JSON.stringify({
      status: "ok",
      tenantKey,
      workspaceSlug,
      validated: [
        "admin_can_list_workspace_users",
        "admin_can_create_workspace_user",
        "duplicate_workspace_user_rejected",
        "admin_can_change_role_with_audit",
        "self_role_change_rejected",
        "admin_can_lock_and_unlock_user",
        "locked_user_login_returns_account_locked",
        "viewer_forbidden_from_admin_workspace_users_route",
        "admin_can_deactivate_user",
        "deactivated_user_login_returns_invalid_credentials"
      ],
      checkedAt: new Date().toISOString(),
    }, null, 2));
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const stdout = stdoutBuffer.join("").slice(-4000);
    const stderr = stderrBuffer.join("").slice(-4000);
    console.error("Workspace user CRUD integration test failed:");
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
