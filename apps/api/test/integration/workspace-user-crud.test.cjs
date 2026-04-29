#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
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
  setDefaultEnv("JWT_SECRET", "tej-pim-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "tej-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");
  setDefaultEnv("PIM_AUTH_PASSWORD", "tej-pim-demo-password");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "tej-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/tej-pim-local");
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
  if (!fs.existsSync(JWT_ENTRY)) {
    throw new Error(`JWT build output not found at ${JWT_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const { verifyPimJwt } = require(JWT_ENTRY);

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
  const systemAdminUserId = `workspace-system-${runId}@example.com`;
  const reviewerEditorUserId = `workspace-reviewer-editor-${runId}@example.com`;

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
      assignedRoles: ["reviewer"],
    });
    assertStatus(createViewer, 201, "create viewer user");
    assert(createViewer.payload?.userId === viewerUserId.toLowerCase(), "created viewer userId mismatch");
    assert(createViewer.payload?.isLocked === false, "new user should not be locked");
    assert(
      Array.isArray(createViewer.payload?.assignedRoles) &&
        createViewer.payload.assignedRoles.includes("reviewer"),
      `expected create user to return assigned reviewer role, got ${JSON.stringify(createViewer.payload)}`,
    );
    const createRoleUser = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminToken, {
      userId: roleUserId,
      role: "viewer",
      assignedRoles: ["editor"],
    });
    assertStatus(createRoleUser, 201, "create role-change user");
    const createdRoleUserLogin = await login(baseUrl, workspaceSlug, roleUserId);
    assertStatus(createdRoleUserLogin, 201, "created role user login");
    const createdRoleUserClaims = verifyPimJwt(String(createdRoleUserLogin.payload?.accessToken ?? ""));
    assert(createdRoleUserClaims, "expected created role user token to verify");
    assert(createdRoleUserClaims.role === "viewer", `expected created role user scalar role viewer, got ${createdRoleUserClaims.role}`);
    assert(
      Array.isArray(createdRoleUserClaims.assignedRoles) &&
        createdRoleUserClaims.assignedRoles.includes("editor"),
      `expected created role user assignedRoles to include editor, got ${JSON.stringify(createdRoleUserClaims.assignedRoles)}`,
    );
    const createdRoleUserEditorRead = await apiRequest(
      baseUrl,
      "GET",
      "/marketplace/channels",
      createdRoleUserLogin.payload.accessToken,
    );
    assertStatus(createdRoleUserEditorRead, 200, "created role user assigned editor read");

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
    const createdRoleUserAudit = createdActions.find((row) => String(row.metadata?.targetUserId ?? "") === roleUserId.toLowerCase());
    assert(
      Array.isArray(createdRoleUserAudit?.metadata?.assignedRoles) &&
        createdRoleUserAudit.metadata.assignedRoles.includes("editor"),
      `expected workspace_user.created audit to include assigned editor role, got ${JSON.stringify(createdRoleUserAudit)}`,
    );
    const duplicateAssignedRolesCreate = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminToken, {
      userId: `workspace-duplicate-${runId}@example.com`,
      role: "viewer",
      assignedRoles: ["reviewer", "reviewer"],
    });
    assertStatus(duplicateAssignedRolesCreate, 400, "duplicate assigned roles rejected on create");

    const createReviewerEditorUser = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminToken, {
      userId: reviewerEditorUserId,
      role: "reviewer",
      assignedRoles: ["editor"],
    });
    assertStatus(createReviewerEditorUser, 201, "create reviewer to editor bridge user");
    const reviewerEditorLogin = await login(baseUrl, workspaceSlug, reviewerEditorUserId);
    assertStatus(reviewerEditorLogin, 201, "reviewer to editor bridge login");
    const reviewerEditorClaims = verifyPimJwt(String(reviewerEditorLogin.payload?.accessToken ?? ""));
    assert(reviewerEditorClaims, "expected reviewer to editor bridge token to verify");
    assert(reviewerEditorClaims.role === "reviewer", `expected reviewer to editor bridge scalar role reviewer, got ${reviewerEditorClaims.role}`);
    assert(
      Array.isArray(reviewerEditorClaims.assignedRoles) &&
        reviewerEditorClaims.assignedRoles.includes("editor"),
      `expected reviewer to editor bridge assignedRoles to include editor, got ${JSON.stringify(reviewerEditorClaims.assignedRoles)}`,
    );
    const reviewerEditorRead = await apiRequest(
      baseUrl,
      "GET",
      "/marketplace/channels",
      reviewerEditorLogin.payload.accessToken,
    );
    assertStatus(reviewerEditorRead, 200, "reviewer to editor bridge allowed editor read");

    const reviewerRedundantAssignedRoleCreate = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminToken, {
      userId: `workspace-reviewer-redundant-${runId}@example.com`,
      role: "reviewer",
      assignedRoles: ["reviewer"],
    });
    assertStatus(reviewerRedundantAssignedRoleCreate, 400, "redundant reviewer assigned role rejected on create");
    assert(
      String(reviewerRedundantAssignedRoleCreate.payload?.error ?? "") === "ASSIGNED_ROLE_DOES_NOT_WIDEN_BASE_ROLE",
      `expected ASSIGNED_ROLE_DOES_NOT_WIDEN_BASE_ROLE, got ${JSON.stringify(reviewerRedundantAssignedRoleCreate.payload)}`,
    );

    const editorRedundantAssignedRoleCreate = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminToken, {
      userId: `workspace-editor-redundant-${runId}@example.com`,
      role: "editor",
      assignedRoles: ["reviewer"],
    });
    assertStatus(editorRedundantAssignedRoleCreate, 400, "editor downgrade assigned role rejected on create");
    assert(
      String(editorRedundantAssignedRoleCreate.payload?.error ?? "") === "ASSIGNED_ROLE_DOES_NOT_WIDEN_BASE_ROLE",
      `expected ASSIGNED_ROLE_DOES_NOT_WIDEN_BASE_ROLE for editor downgrade, got ${JSON.stringify(editorRedundantAssignedRoleCreate.payload)}`,
    );

    const unsupportedAssignedRoleCreate = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminToken, {
      userId: `workspace-vendor-${runId}@example.com`,
      role: "admin",
      assignedRoles: ["vendor"],
    });
    assertStatus(unsupportedAssignedRoleCreate, 400, "unsupported assigned role rejected on create");
    assert(
      String(unsupportedAssignedRoleCreate.payload?.error ?? "") === "MANAGED_ASSIGNED_ROLE_NOT_SUPPORTED",
      `expected MANAGED_ASSIGNED_ROLE_NOT_SUPPORTED, got ${JSON.stringify(unsupportedAssignedRoleCreate.payload)}`,
    );

    const unsupportedSuperAdminCreate = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminToken, {
      userId: `workspace-super-${runId}@example.com`,
      role: "admin",
      assignedRoles: ["super_admin"],
    });
    assertStatus(unsupportedSuperAdminCreate, 400, "unsupported super admin assigned role rejected on create");
    assert(
      String(unsupportedSuperAdminCreate.payload?.error ?? "") === "MANAGED_ASSIGNED_ROLE_NOT_SUPPORTED",
      `expected MANAGED_ASSIGNED_ROLE_NOT_SUPPORTED for super_admin, got ${JSON.stringify(unsupportedSuperAdminCreate.payload)}`,
    );

    const nonAdminBoundaryCreate = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminToken, {
      userId: `workspace-product-${runId}@example.com`,
      role: "viewer",
      assignedRoles: ["product_admin"],
    });
    assertStatus(nonAdminBoundaryCreate, 400, "non-admin base role cannot receive admin boundary assigned role on create");
    assert(
      String(nonAdminBoundaryCreate.payload?.error ?? "") === "ADMIN_BOUNDARY_ASSIGNED_ROLE_REQUIRES_ADMIN_BASE_ROLE",
      `expected ADMIN_BOUNDARY_ASSIGNED_ROLE_REQUIRES_ADMIN_BASE_ROLE, got ${JSON.stringify(nonAdminBoundaryCreate.payload)}`,
    );

    const duplicateCreate = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminToken, {
      userId: viewerUserId,
      role: "viewer",
    });
    assertStatus(duplicateCreate, 409, "duplicate user create rejected");

    const createSystemAdminUser = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminToken, {
      userId: systemAdminUserId,
      role: "admin",
      assignedRoles: ["system_admin"],
    });
    assertStatus(createSystemAdminUser, 201, "create system admin boundary user");
    assert(
      Array.isArray(createSystemAdminUser.payload?.assignedRoles) &&
        createSystemAdminUser.payload.assignedRoles.includes("system_admin"),
      `expected create system admin user to return assigned system_admin role, got ${JSON.stringify(createSystemAdminUser.payload)}`,
    );
    const createdSystemAdminLogin = await login(baseUrl, workspaceSlug, systemAdminUserId);
    assertStatus(createdSystemAdminLogin, 201, "created system admin user login");
    const createdSystemAdminClaims = verifyPimJwt(String(createdSystemAdminLogin.payload?.accessToken ?? ""));
    assert(createdSystemAdminClaims, "expected system admin boundary token to verify");
    assert(createdSystemAdminClaims.role === "admin", `expected system admin boundary scalar role admin, got ${createdSystemAdminClaims.role}`);
    assert(
      Array.isArray(createdSystemAdminClaims.assignedRoles) &&
        createdSystemAdminClaims.assignedRoles.includes("system_admin"),
      `expected system admin boundary claims to include system_admin, got ${JSON.stringify(createdSystemAdminClaims.assignedRoles)}`,
    );
    const systemAdminSecurityRead = await apiRequest(
      baseUrl,
      "GET",
      "/admin/workspace/access-scopes",
      createdSystemAdminLogin.payload.accessToken,
    );
    assertStatus(systemAdminSecurityRead, 200, "created system admin boundary user allowed security governance read");

    const invalidAdminBoundaryUpdate = await apiRequest(
      baseUrl,
      "PATCH",
      `/admin/workspace/users/${encodeURIComponent(roleUserId)}/role`,
      adminToken,
      { role: "reviewer", assignedRoles: ["product_admin"] },
    );
    assertStatus(invalidAdminBoundaryUpdate, 400, "non-admin base role cannot receive admin boundary assigned role on update");
    assert(
      String(invalidAdminBoundaryUpdate.payload?.error ?? "") === "ADMIN_BOUNDARY_ASSIGNED_ROLE_REQUIRES_ADMIN_BASE_ROLE",
      `expected ADMIN_BOUNDARY_ASSIGNED_ROLE_REQUIRES_ADMIN_BASE_ROLE on update, got ${JSON.stringify(invalidAdminBoundaryUpdate.payload)}`,
    );

    const updateRoleToReviewerEditor = await apiRequest(
      baseUrl,
      "PATCH",
      `/admin/workspace/users/${encodeURIComponent(roleUserId)}/role`,
      adminToken,
      { role: "reviewer", assignedRoles: ["editor"] },
    );
    assertStatus(updateRoleToReviewerEditor, 200, "update user role to reviewer with editor bridge");
    assert(updateRoleToReviewerEditor.payload?.role === "reviewer", "role update must return reviewer for editor bridge");
    assert(
      Array.isArray(updateRoleToReviewerEditor.payload?.assignedRoles) &&
        updateRoleToReviewerEditor.payload.assignedRoles.includes("editor"),
      `expected reviewer editor bridge to return assigned editor role, got ${JSON.stringify(updateRoleToReviewerEditor.payload)}`,
    );
    const updatedReviewerEditorLogin = await login(baseUrl, workspaceSlug, roleUserId);
    assertStatus(updatedReviewerEditorLogin, 201, "updated reviewer editor user login");
    const updatedReviewerEditorClaims = verifyPimJwt(String(updatedReviewerEditorLogin.payload?.accessToken ?? ""));
    assert(updatedReviewerEditorClaims, "expected updated reviewer editor token to verify");
    assert(updatedReviewerEditorClaims.role === "reviewer", `expected reviewer scalar role after editor bridge, got ${updatedReviewerEditorClaims.role}`);
    assert(
      Array.isArray(updatedReviewerEditorClaims.assignedRoles) &&
        updatedReviewerEditorClaims.assignedRoles.includes("editor"),
      `expected reviewer editor bridge claims to include editor, got ${JSON.stringify(updatedReviewerEditorClaims.assignedRoles)}`,
    );
    const updatedReviewerEditorRead = await apiRequest(
      baseUrl,
      "GET",
      "/marketplace/channels",
      updatedReviewerEditorLogin.payload.accessToken,
    );
    assertStatus(updatedReviewerEditorRead, 200, "reviewer editor bridge keeps editor read");

    const redundantReviewerUpdate = await apiRequest(
      baseUrl,
      "PATCH",
      `/admin/workspace/users/${encodeURIComponent(roleUserId)}/role`,
      adminToken,
      { role: "reviewer", assignedRoles: ["reviewer"] },
    );
    assertStatus(redundantReviewerUpdate, 400, "redundant reviewer assigned role rejected on update");
    assert(
      String(redundantReviewerUpdate.payload?.error ?? "") === "ASSIGNED_ROLE_DOES_NOT_WIDEN_BASE_ROLE",
      `expected ASSIGNED_ROLE_DOES_NOT_WIDEN_BASE_ROLE on redundant reviewer update, got ${JSON.stringify(redundantReviewerUpdate.payload)}`,
    );

    const updateRole = await apiRequest(
      baseUrl,
      "PATCH",
      `/admin/workspace/users/${encodeURIComponent(roleUserId)}/role`,
      adminToken,
      { role: "admin", assignedRoles: ["product_admin"] },
    );
    assertStatus(updateRole, 200, "update user role");
    assert(updateRole.payload?.role === "admin", "role update must return admin");
    assert(
      Array.isArray(updateRole.payload?.assignedRoles) &&
        updateRole.payload.assignedRoles.includes("product_admin"),
      `expected role update to return assigned product_admin role, got ${JSON.stringify(updateRole.payload)}`,
    );
    const updatedRoleUserLogin = await login(baseUrl, workspaceSlug, roleUserId);
    assertStatus(updatedRoleUserLogin, 201, "updated role user login");
    const updatedRoleUserClaims = verifyPimJwt(String(updatedRoleUserLogin.payload?.accessToken ?? ""));
    assert(updatedRoleUserClaims, "expected updated role user token to verify");
    assert(updatedRoleUserClaims.role === "admin", `expected updated scalar role admin, got ${updatedRoleUserClaims.role}`);
    assert(
      Array.isArray(updatedRoleUserClaims.assignedRoles) &&
        updatedRoleUserClaims.assignedRoles.includes("product_admin") &&
        !updatedRoleUserClaims.assignedRoles.includes("editor"),
      `expected updated assignedRoles to include product_admin and exclude editor, got ${JSON.stringify(updatedRoleUserClaims.assignedRoles)}`,
    );
    const updatedRoleUserSecurityRead = await apiRequest(
      baseUrl,
      "GET",
      "/admin/workspace/access-scopes",
      updatedRoleUserLogin.payload.accessToken,
    );
    assertStatus(updatedRoleUserSecurityRead, 403, "product admin assigned role does not escalate security governance read");

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
    assert(roleAudit && String(roleAudit.metadata?.fromRole ?? "") === "reviewer", "role change audit must record fromRole=reviewer");
    assert(roleAudit && String(roleAudit.metadata?.toRole ?? "") === "admin", "role change audit must record toRole=admin");
    assert(
      roleAudit &&
        Array.isArray(roleAudit.metadata?.fromAssignedRoles) &&
        roleAudit.metadata.fromAssignedRoles.includes("editor"),
      `expected role change audit to record fromAssignedRoles=editor, got ${JSON.stringify(roleAudit)}`,
    );
    assert(
      roleAudit &&
        Array.isArray(roleAudit.metadata?.toAssignedRoles) &&
        roleAudit.metadata.toAssignedRoles.includes("product_admin"),
      `expected role change audit to record toAssignedRoles=product_admin, got ${JSON.stringify(roleAudit)}`,
    );

    const updateRoleWithoutAssignedRoles = await apiRequest(
      baseUrl,
      "PATCH",
      `/admin/workspace/users/${encodeURIComponent(roleUserId)}/role`,
      adminToken,
      { role: "admin" },
    );
    assertStatus(updateRoleWithoutAssignedRoles, 200, "update user role without assigned roles preserves existing roles");
    assert(
      Array.isArray(updateRoleWithoutAssignedRoles.payload?.assignedRoles) &&
        updateRoleWithoutAssignedRoles.payload.assignedRoles.includes("product_admin"),
      `expected role update without assignedRoles to preserve existing assigned roles, got ${JSON.stringify(updateRoleWithoutAssignedRoles.payload)}`,
    );
    const preservedAssignedRolesLogin = await login(baseUrl, workspaceSlug, roleUserId);
    assertStatus(preservedAssignedRolesLogin, 201, "preserved assigned roles login");
    const preservedAssignedRolesClaims = verifyPimJwt(String(preservedAssignedRolesLogin.payload?.accessToken ?? ""));
    assert(preservedAssignedRolesClaims, "expected preserved assigned roles token to verify");
    assert(preservedAssignedRolesClaims.role === "admin", `expected preserved scalar role admin, got ${preservedAssignedRolesClaims.role}`);
    assert(
      Array.isArray(preservedAssignedRolesClaims.assignedRoles) &&
        preservedAssignedRolesClaims.assignedRoles.includes("product_admin") &&
        !preservedAssignedRolesClaims.assignedRoles.includes("editor"),
      `expected preserved assignedRoles to keep product_admin and exclude editor, got ${JSON.stringify(preservedAssignedRolesClaims.assignedRoles)}`,
    );

    const incompatiblePreservedAssignedRolesUpdate = await apiRequest(
      baseUrl,
      "PATCH",
      `/admin/workspace/users/${encodeURIComponent(roleUserId)}/role`,
      adminToken,
      { role: "viewer" },
    );
    assertStatus(incompatiblePreservedAssignedRolesUpdate, 400, "incompatible preserved assigned roles rejected on scalar role downgrade");
    assert(
      String(incompatiblePreservedAssignedRolesUpdate.payload?.error ?? "") === "ADMIN_BOUNDARY_ASSIGNED_ROLE_REQUIRES_ADMIN_BASE_ROLE",
      `expected ADMIN_BOUNDARY_ASSIGNED_ROLE_REQUIRES_ADMIN_BASE_ROLE when preserving incompatible roles, got ${JSON.stringify(incompatiblePreservedAssignedRolesUpdate.payload)}`,
    );

    const duplicateAssignedRolesUpdate = await apiRequest(
      baseUrl,
      "PATCH",
      `/admin/workspace/users/${encodeURIComponent(roleUserId)}/role`,
      adminToken,
      { role: "viewer", assignedRoles: ["product_admin", "product_admin"] },
    );
    assertStatus(duplicateAssignedRolesUpdate, 400, "duplicate assigned roles rejected on update");

    const clearAssignedRoles = await apiRequest(
      baseUrl,
      "PATCH",
      `/admin/workspace/users/${encodeURIComponent(roleUserId)}/role`,
      adminToken,
      { role: "viewer", assignedRoles: [] },
    );
    assertStatus(clearAssignedRoles, 200, "update user role with empty assigned roles clears persisted roles");
    assert(
      Array.isArray(clearAssignedRoles.payload?.assignedRoles) &&
        clearAssignedRoles.payload.assignedRoles.length === 0,
      `expected clearing assignedRoles to return an empty role set, got ${JSON.stringify(clearAssignedRoles.payload)}`,
    );
    const clearedAssignedRolesLogin = await login(baseUrl, workspaceSlug, roleUserId);
    assertStatus(clearedAssignedRolesLogin, 201, "cleared assigned roles login");
    const clearedAssignedRolesClaims = verifyPimJwt(String(clearedAssignedRolesLogin.payload?.accessToken ?? ""));
    assert(clearedAssignedRolesClaims, "expected cleared assigned roles token to verify");
    assert(
      clearedAssignedRolesClaims.role === "viewer",
      `expected cleared assigned roles scalar role viewer, got ${clearedAssignedRolesClaims.role}`,
    );
    assert(
      !Array.isArray(clearedAssignedRolesClaims.assignedRoles) || clearedAssignedRolesClaims.assignedRoles.length === 0,
      `expected cleared assigned roles to fall back to scalar-only compatibility, got ${JSON.stringify(clearedAssignedRolesClaims.assignedRoles)}`,
    );
    const clearedAssignedRolesEditorRead = await apiRequest(
      baseUrl,
      "GET",
      "/marketplace/channels",
      clearedAssignedRolesLogin.payload.accessToken,
    );
    assertStatus(clearedAssignedRolesEditorRead, 403, "cleared assigned roles remove former editor-capable read");

    const listAfterClear = await apiRequest(baseUrl, "GET", "/admin/workspace/users", adminToken);
    assertStatus(listAfterClear, 200, "list users after clearing assigned roles");
    const clearedRoleUserRow = Array.isArray(listAfterClear.payload)
      ? listAfterClear.payload.find((row) => String(row?.userId ?? "") === roleUserId.toLowerCase())
      : null;
    assert(clearedRoleUserRow, "expected cleared assigned-roles user to remain listed");
    assert(
      Array.isArray(clearedRoleUserRow.assignedRoles) &&
        clearedRoleUserRow.assignedRoles.length === 0,
      `expected workspace-user listing to surface cleared assigned roles as an empty array, got ${JSON.stringify(clearedRoleUserRow)}`,
    );

    const clearedRoleAuditRows = await prisma.$queryRawUnsafe(
      `
      SELECT metadata
      FROM audit_logs
      WHERE tenant_key = $1
        AND action = 'workspace_user.role_changed'
      ORDER BY created_at DESC
      LIMIT 5
      `,
      tenantKey,
    );
    const clearedRoleAudit = Array.isArray(clearedRoleAuditRows)
      ? clearedRoleAuditRows.find(
          (row) =>
            String(row?.metadata?.targetUserId ?? "") === roleUserId.toLowerCase() &&
            Array.isArray(row?.metadata?.toAssignedRoles) &&
            row.metadata.toAssignedRoles.length === 0,
        )
      : null;
    assert(clearedRoleAudit, "expected workspace_user.role_changed audit row for clearing assigned roles");
    assert(
      Array.isArray(clearedRoleAudit.metadata?.fromAssignedRoles) &&
        clearedRoleAudit.metadata.fromAssignedRoles.includes("product_admin"),
      `expected clear-role audit to record prior product_admin assignment, got ${JSON.stringify(clearedRoleAudit)}`,
    );

    const invalidAssignedRolesUpdate = await apiRequest(
      baseUrl,
      "PATCH",
      `/admin/workspace/users/${encodeURIComponent(roleUserId)}/role`,
      adminToken,
      { role: "viewer", assignedRoles: ["not_a_role"] },
    );
    assertStatus(invalidAssignedRolesUpdate, 400, "invalid assigned roles rejected on update");

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

    const viewerAuthProbeBeforeRelock = await apiRequest(baseUrl, "GET", "/auth/account/privacy-status", viewerToken);
    assertStatus(viewerAuthProbeBeforeRelock, 200, "viewer token reaches authenticated route before relock");

    const relockViewer = await apiRequest(
      baseUrl,
      "POST",
      `/admin/workspace/users/${encodeURIComponent(viewerUserId)}/lock`,
      adminToken,
      { durationMinutes: 60, reason: "stale-token-check" },
    );
    assertStatus(relockViewer, 200, "relock user after viewer JWT issued");

    const staleLockedTokenAttempt = await apiRequest(baseUrl, "GET", "/auth/account/privacy-status", viewerToken);
    assertStatus(staleLockedTokenAttempt, 401, "stale viewer token denied after lock");
    assert(
      String(staleLockedTokenAttempt.payload?.error ?? "") === "USER_LOCKED",
      "stale viewer token after lock must return USER_LOCKED",
    );

    const secondUnlockViewer = await apiRequest(
      baseUrl,
      "POST",
      `/admin/workspace/users/${encodeURIComponent(viewerUserId)}/unlock`,
      adminToken,
      {},
    );
    assertStatus(secondUnlockViewer, 200, "unlock relocked user");

    const secondViewerLogin = await login(baseUrl, workspaceSlug, viewerUserId);
    assertStatus(secondViewerLogin, 201, "viewer login after second unlock");
    const secondViewerToken = String(secondViewerLogin.payload?.accessToken ?? "");
    assert(secondViewerToken.length > 10, "missing viewer access token after second unlock");

    const viewerListAttempt = await apiRequest(baseUrl, "GET", "/admin/workspace/users", viewerToken);
    assertStatus(viewerListAttempt, 403, "viewer denied admin workspace users route");

    const viewerAuthProbeBeforeDeactivate = await apiRequest(baseUrl, "GET", "/auth/account/privacy-status", secondViewerToken);
    assertStatus(viewerAuthProbeBeforeDeactivate, 200, "viewer token reaches authenticated route before deactivation");

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

    const staleDeactivatedTokenAttempt = await apiRequest(baseUrl, "GET", "/auth/account/privacy-status", secondViewerToken);
    assertStatus(staleDeactivatedTokenAttempt, 401, "stale viewer token denied after deactivation");
    assert(
      String(staleDeactivatedTokenAttempt.payload?.error ?? "") === "USER_INACTIVE",
      "stale viewer token after deactivation must return USER_INACTIVE",
    );

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
        "admin_can_assign_persisted_roles_with_audit",
        "bounded_capability_increasing_assigned_roles_are_enforced_on_managed_writes",
        "unsupported_assigned_roles_are_rejected_on_managed_writes",
        "admin_boundary_assigned_roles_require_admin_base_role",
        "reviewer_can_bridge_to_editor_on_managed_writes",
        "system_admin_assigned_role_can_be_managed_and_read_back",
        "duplicate_assigned_roles_rejected_on_managed_writes",
        "assigned_role_update_without_payload_preserves_existing_roles",
        "assigned_role_preserve_path_rejects_incompatible_scalar_role_changes",
        "assigned_role_update_with_empty_array_clears_roles",
        "workspace_user_assigned_roles_writes_persist_into_later_logins",
        "invalid_assigned_roles_rejected",
        "self_role_change_rejected",
        "admin_can_lock_and_unlock_user",
        "locked_user_login_returns_account_locked",
        "stale_jwt_rejected_after_later_lock",
        "viewer_forbidden_from_admin_workspace_users_route",
        "admin_can_deactivate_user",
        "deactivated_user_login_returns_invalid_credentials",
        "stale_jwt_rejected_after_later_deactivation"
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
