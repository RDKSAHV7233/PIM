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
const ROLLOUT_SCRIPT = path.join(REPO_ROOT, "scripts", "auth-identity-assigned-roles-rollout.cjs");

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

function createPrisma() {
  const url = String(process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL ?? "").trim();
  if (!url) {
    throw new Error("DATABASE_URL is required for assigned-roles rollout runbook test.");
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

function runRolloutCommand(args, env) {
  const raw = execFileSync("node", [ROLLOUT_SCRIPT, ...args], {
    cwd: REPO_ROOT,
    env,
    encoding: "utf8",
  });
  return JSON.parse(raw);
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
  const port = 7550 + Math.floor(Math.random() * 80);
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const platformToken = `auth-assigned-rollout-${runId}`;
  const tenantKey = `auth-assigned-rollout-${runId}`;
  const workspaceSlug = `arr-${runId}`.slice(0, 24);
  const adminUserId = `rollout-admin-${runId}@example.com`;
  const viewerNullUserId = `rollout-viewer-null-${runId}@example.com`;
  const reviewerEmptyUserId = `rollout-reviewer-empty-${runId}@example.com`;
  const editorEmptyUserId = `rollout-editor-empty-${runId}@example.com`;
  const adminEmptyUserId = `rollout-admin-empty-${runId}@example.com`;
  const multiRoleUserId = `rollout-multi-${runId}@example.com`;
  const invalidScalarUserId = `rollout-invalid-${runId}@example.com`;
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
      { tenantKey, workspaceSlug, displayName: `Assigned Roles Rollout ${runId}`, initialAdminUserId: adminUserId },
      { "x-pim-platform-admin-token": platformToken },
    );
    assertStatus(provision, 201, "platform tenant provisioning");

    await prisma.authIdentity.createMany({
      data: [
        { tenantKey, userId: viewerNullUserId, role: "viewer", assignedRoles: [], isActive: true, passwordHash },
        { tenantKey, userId: reviewerEmptyUserId, role: "reviewer", assignedRoles: [], isActive: true, passwordHash },
        { tenantKey, userId: editorEmptyUserId, role: "editor", assignedRoles: [], isActive: true, passwordHash },
        { tenantKey, userId: adminEmptyUserId, role: "admin", assignedRoles: [], isActive: true, passwordHash },
        { tenantKey, userId: multiRoleUserId, role: "viewer", assignedRoles: ["editor"], isActive: true, passwordHash },
        { tenantKey, userId: invalidScalarUserId, role: "not_a_role", assignedRoles: [], isActive: true, passwordHash },
      ],
    });

    await prisma.$executeRawUnsafe(
      `
      UPDATE "AuthIdentity"
      SET "assigned_roles" = NULL
      WHERE "tenantKey" = $1
        AND "userId" IN ($2, $3)
      `,
      tenantKey,
      viewerNullUserId,
      invalidScalarUserId,
    );

    const dryRunBackfill = runRolloutCommand(["--tenant", tenantKey, "--dry-run"], env);
    assert(dryRunBackfill.mode === "backfill", `expected backfill dry-run mode, got ${JSON.stringify(dryRunBackfill)}`);
    assert(dryRunBackfill.eligibleCount === 5, `expected five eligible backfill rows, got ${JSON.stringify(dryRunBackfill)}`);
    assert(dryRunBackfill.invalidScalarRoleCount === 1, `expected one invalid scalar role skip, got ${JSON.stringify(dryRunBackfill)}`);
    assert(
      dryRunBackfill.candidates.some((candidate) => candidate.userId === multiRoleUserId.toLowerCase() && candidate.eligible === false),
      `expected existing multi-role user to be skipped during backfill dry-run, got ${JSON.stringify(dryRunBackfill.candidates)}`,
    );

    const backfillApply = runRolloutCommand(["--tenant", tenantKey, "--confirm"], env);
    assert(backfillApply.updatedCount === 5, `expected five backfill updates, got ${JSON.stringify(backfillApply)}`);

    const rowsAfterBackfill = await prisma.authIdentity.findMany({
      where: { tenantKey },
      select: { userId: true, role: true, assignedRoles: true },
    });
    const byUserId = new Map(rowsAfterBackfill.map((row) => [String(row.userId).toLowerCase(), row]));
    assert(
      JSON.stringify(byUserId.get(viewerNullUserId.toLowerCase())?.assignedRoles ?? null) === JSON.stringify(["viewer"]),
      `expected viewer null row to backfill to ['viewer'], got ${JSON.stringify(byUserId.get(viewerNullUserId.toLowerCase()))}`,
    );
    assert(
      JSON.stringify(byUserId.get(reviewerEmptyUserId.toLowerCase())?.assignedRoles ?? null) === JSON.stringify(["reviewer"]),
      `expected reviewer empty row to backfill to ['reviewer'], got ${JSON.stringify(byUserId.get(reviewerEmptyUserId.toLowerCase()))}`,
    );
    assert(
      JSON.stringify(byUserId.get(editorEmptyUserId.toLowerCase())?.assignedRoles ?? null) === JSON.stringify(["editor"]),
      `expected editor empty row to backfill to ['editor'], got ${JSON.stringify(byUserId.get(editorEmptyUserId.toLowerCase()))}`,
    );
    assert(
      JSON.stringify(byUserId.get(adminEmptyUserId.toLowerCase())?.assignedRoles ?? null) === JSON.stringify(["admin"]),
      `expected admin empty row to backfill to ['admin'], got ${JSON.stringify(byUserId.get(adminEmptyUserId.toLowerCase()))}`,
    );
    assert(
      JSON.stringify(byUserId.get(multiRoleUserId.toLowerCase())?.assignedRoles ?? null) === JSON.stringify(["editor"]),
      `expected existing multi-role row to remain unchanged, got ${JSON.stringify(byUserId.get(multiRoleUserId.toLowerCase()))}`,
    );
    assert(
      !Array.isArray(byUserId.get(invalidScalarUserId.toLowerCase())?.assignedRoles) ||
        byUserId.get(invalidScalarUserId.toLowerCase()).assignedRoles.length === 0,
      `expected invalid scalar role row to remain empty-or-null and skipped, got ${JSON.stringify(byUserId.get(invalidScalarUserId.toLowerCase()))}`,
    );

    const viewerBackfilledLogin = await login(baseUrl, workspaceSlug, viewerNullUserId, password);
    assertStatus(viewerBackfilledLogin, 201, "viewer backfilled login");
    const viewerBackfilledClaims = verifyPimJwt(String(viewerBackfilledLogin.payload?.accessToken ?? ""));
    assert(viewerBackfilledClaims, "expected viewer backfilled token to verify");
    assert(
      Array.isArray(viewerBackfilledClaims.assignedRoles) && viewerBackfilledClaims.assignedRoles.includes("viewer"),
      `expected viewer backfilled token to carry assigned viewer role, got ${JSON.stringify(viewerBackfilledClaims)}`,
    );
    const viewerBackfilledEditorRead = await apiRequest(baseUrl, "GET", "/marketplace/channels", viewerBackfilledLogin.payload.accessToken);
    assertStatus(viewerBackfilledEditorRead, 403, "viewer remains denied editor read after backfill");

    const reviewerBackfilledLogin = await login(baseUrl, workspaceSlug, reviewerEmptyUserId, password);
    assertStatus(reviewerBackfilledLogin, 201, "reviewer backfilled login");
    const reviewerBackfilledEditorRead = await apiRequest(baseUrl, "GET", "/marketplace/channels", reviewerBackfilledLogin.payload.accessToken);
    assertStatus(reviewerBackfilledEditorRead, 403, "reviewer remains denied editor read after backfill");

    const editorBackfilledLogin = await login(baseUrl, workspaceSlug, editorEmptyUserId, password);
    assertStatus(editorBackfilledLogin, 201, "editor backfilled login");
    const editorBackfilledClaims = verifyPimJwt(String(editorBackfilledLogin.payload?.accessToken ?? ""));
    assert(editorBackfilledClaims, "expected editor backfilled token to verify");
    assert(
      Array.isArray(editorBackfilledClaims.assignedRoles) && editorBackfilledClaims.assignedRoles.includes("editor"),
      `expected editor backfilled token to carry assigned editor role, got ${JSON.stringify(editorBackfilledClaims)}`,
    );
    const editorBackfilledRead = await apiRequest(baseUrl, "GET", "/marketplace/channels", editorBackfilledLogin.payload.accessToken);
    assertStatus(editorBackfilledRead, 200, "editor backfilled read remains allowed");

    const adminBackfilledLogin = await login(baseUrl, workspaceSlug, adminEmptyUserId, password);
    assertStatus(adminBackfilledLogin, 201, "admin backfilled login");
    const adminBackfilledClaims = verifyPimJwt(String(adminBackfilledLogin.payload?.accessToken ?? ""));
    assert(adminBackfilledClaims, "expected admin backfilled token to verify");
    assert(
      Array.isArray(adminBackfilledClaims.assignedRoles) &&
        adminBackfilledClaims.assignedRoles.length === 1 &&
        adminBackfilledClaims.assignedRoles[0] === "admin",
      `expected admin backfill to preserve scalar-only compatibility instead of escalating to boundary roles, got ${JSON.stringify(adminBackfilledClaims)}`,
    );

    const invalidBackfilledLogin = await login(baseUrl, workspaceSlug, invalidScalarUserId, password);
    assertStatus(invalidBackfilledLogin, 201, "invalid-scalar login after backfill");
    const invalidBackfilledClaims = verifyPimJwt(String(invalidBackfilledLogin.payload?.accessToken ?? ""));
    assert(invalidBackfilledClaims, "expected invalid-scalar token to verify");
    assert(
      invalidBackfilledClaims.role === "viewer",
      `expected invalid scalar role to fall back to viewer compatibility, got ${JSON.stringify(invalidBackfilledClaims)}`,
    );
    assert(
      !Array.isArray(invalidBackfilledClaims.assignedRoles) || invalidBackfilledClaims.assignedRoles.length === 0,
      `expected invalid scalar role to remain without assigned roles, got ${JSON.stringify(invalidBackfilledClaims)}`,
    );

    const dryRunRollback = runRolloutCommand(["--tenant", tenantKey, "--rollback", "--dry-run"], env);
    assert(dryRunRollback.mode === "rollback", `expected rollback dry-run mode, got ${JSON.stringify(dryRunRollback)}`);
    assert(dryRunRollback.eligibleCount === 5, `expected five rollback-eligible rows, got ${JSON.stringify(dryRunRollback)}`);
    assert(
      dryRunRollback.candidates.some((candidate) => candidate.userId === multiRoleUserId.toLowerCase() && candidate.eligible === false),
      `expected non-scalar-singleton multi-role row to be skipped during rollback dry-run, got ${JSON.stringify(dryRunRollback.candidates)}`,
    );

    const rollbackApply = runRolloutCommand(["--tenant", tenantKey, "--rollback", "--confirm"], env);
    assert(rollbackApply.updatedCount === 5, `expected five rollback updates, got ${JSON.stringify(rollbackApply)}`);

    const rowsAfterRollback = await prisma.authIdentity.findMany({
      where: { tenantKey },
      select: { userId: true, role: true, assignedRoles: true },
    });
    const byUserIdAfterRollback = new Map(rowsAfterRollback.map((row) => [String(row.userId).toLowerCase(), row]));
    assert(
      JSON.stringify(byUserIdAfterRollback.get(viewerNullUserId.toLowerCase())?.assignedRoles ?? null) === JSON.stringify([]),
      `expected viewer row to rollback to empty assigned roles, got ${JSON.stringify(byUserIdAfterRollback.get(viewerNullUserId.toLowerCase()))}`,
    );
    assert(
      JSON.stringify(byUserIdAfterRollback.get(editorEmptyUserId.toLowerCase())?.assignedRoles ?? null) === JSON.stringify([]),
      `expected editor row to rollback to empty assigned roles, got ${JSON.stringify(byUserIdAfterRollback.get(editorEmptyUserId.toLowerCase()))}`,
    );
    assert(
      JSON.stringify(byUserIdAfterRollback.get(adminEmptyUserId.toLowerCase())?.assignedRoles ?? null) === JSON.stringify([]),
      `expected admin row to rollback to empty assigned roles, got ${JSON.stringify(byUserIdAfterRollback.get(adminEmptyUserId.toLowerCase()))}`,
    );
    assert(
      JSON.stringify(byUserIdAfterRollback.get(multiRoleUserId.toLowerCase())?.assignedRoles ?? null) === JSON.stringify(["editor"]),
      `expected existing multi-role row to remain untouched by rollback, got ${JSON.stringify(byUserIdAfterRollback.get(multiRoleUserId.toLowerCase()))}`,
    );

    const editorRollbackLogin = await login(baseUrl, workspaceSlug, editorEmptyUserId, password);
    assertStatus(editorRollbackLogin, 201, "editor rollback login");
    const editorRollbackClaims = verifyPimJwt(String(editorRollbackLogin.payload?.accessToken ?? ""));
    assert(editorRollbackClaims, "expected editor rollback token to verify");
    assert(
      !Array.isArray(editorRollbackClaims.assignedRoles) || editorRollbackClaims.assignedRoles.length === 0,
      `expected rollback to clear editor assigned roles, got ${JSON.stringify(editorRollbackClaims)}`,
    );
    const editorRollbackRead = await apiRequest(baseUrl, "GET", "/marketplace/channels", editorRollbackLogin.payload.accessToken);
    assertStatus(editorRollbackRead, 200, "editor scalar fallback still allows editor read after rollback");

    const viewerRollbackLogin = await login(baseUrl, workspaceSlug, viewerNullUserId, password);
    assertStatus(viewerRollbackLogin, 201, "viewer rollback login");
    const viewerRollbackRead = await apiRequest(baseUrl, "GET", "/marketplace/channels", viewerRollbackLogin.payload.accessToken);
    assertStatus(viewerRollbackRead, 403, "viewer scalar fallback still denies editor read after rollback");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantKey,
          workspaceSlug,
          validated: [
            "assigned_roles_backfill_dry_run_identifies_only_empty_or_null_scalar_rows",
            "assigned_roles_backfill_confirms_scalar_only_values_without_privilege_widening",
            "assigned_roles_backfill_skips_invalid_scalar_roles",
            "assigned_roles_backfill_preserves_existing_multi_role_rows",
            "assigned_roles_rollback_dry_run_limits_changes_to_scalar_singletons",
            "assigned_roles_rollback_confirm_clears_only_scalar_singletons",
            "assigned_roles_rollback_restores_scalar_only_auth_compatibility",
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
    console.error("Assigned-roles rollout runbook integration test failed:");
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
