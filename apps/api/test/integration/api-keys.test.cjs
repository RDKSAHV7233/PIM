#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync, execSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
const SCHEMA_PATH = path.join(REPO_ROOT, "packages", "db", "prisma", "schema.prisma");
const MIGRATION_FILES = [
  path.join(
    REPO_ROOT,
    "packages",
    "db",
    "prisma",
    "migrations",
    "20260318173000_api_access_keys_foundation",
    "migration.sql",
  ),
  path.join(
    REPO_ROOT,
    "packages",
    "db",
    "prisma",
    "migrations",
    "20260429113000_add_auth_identity_assigned_roles",
    "migration.sql",
  ),
  path.join(
    REPO_ROOT,
    "packages",
    "db",
    "prisma",
    "migrations",
    "20260427113000_api_access_key_scopes",
    "migration.sql",
  ),
];

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
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");  // Set L: auth middleware Redis gate
  setDefaultEnv("PIM_AUTH_PASSWORD", "vexa-pim-demo-password");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
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

async function apiKeyRequest(baseUrl, method, route, apiKey, body) {
  return apiRequest(baseUrl, method, route, null, body, { "x-pim-api-key": apiKey });
}

async function login(baseUrl, workspaceSlug, userId) {
  return apiRequest(baseUrl, "POST", "/auth/login", null, {
    workspaceSlug,
    userId,
    password: process.env.PIM_AUTH_PASSWORD,
    expiresInMinutes: 30,
  });
}

function createPrisma() {
  const url = String(process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL ?? "").trim();
  if (!url) {
    throw new Error("DATABASE_URL is required for api-keys integration test.");
  }
  return new PrismaClient({ datasources: { db: { url } } });
}

function runMigrations() {
  const env = {
    ...process.env,
    DATABASE_URL: String(process.env.DATABASE_URL ?? "").trim(),
    DATABASE_URL_POOLED: String(process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL ?? "").trim(),
    DATABASE_URL_DIRECT: String(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? "").trim(),
  };
  for (const migrationFile of MIGRATION_FILES) {
    const command =
      process.platform === "win32"
        ? `npx prisma db execute --schema "${SCHEMA_PATH}" --file "${migrationFile}"`
        : `npx prisma db execute --schema '${SCHEMA_PATH}' --file '${migrationFile}'`;
    try {
      execSync(command, {
        cwd: REPO_ROOT,
        stdio: "pipe",
        encoding: "utf8",
        env,
      });
    } catch (error) {
      const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
      if (/already exists/i.test(output) || /already contains|duplicate column/i.test(output)) {
        continue;
      }
      throw error;
    }
  }
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }
  runMigrations();

  const runId = Date.now().toString();
  const port = 7240 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const platformToken = `api-keys-${runId}`;
  const tenantKey = `api-keys-${runId}`;
  const workspaceSlug = `ak-${runId}`.slice(0, 24);
  const displayName = `API Keys ${runId}`;
  const adminUserId = `api-keys-admin-${runId}@example.com`;
  const viewerUserId = `api-keys-viewer-${runId}@example.com`;

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

  let adminToken = null;
  let categoryId = null;
  let productId = null;

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
    adminToken = String(adminLogin.payload?.accessToken ?? "");
    assert(adminToken.length > 10, "missing admin access token");

    const createViewerUser = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminToken, {
      userId: viewerUserId,
      role: "viewer",
    });
    assertStatus(createViewerUser, 201, "create viewer user");

    const viewerLogin = await login(baseUrl, workspaceSlug, viewerUserId);
    assertStatus(viewerLogin, 201, "viewer login");
    const viewerToken = String(viewerLogin.payload?.accessToken ?? "");
    assert(viewerToken.length > 10, "missing viewer access token");

    const createViewerKey = await apiRequest(baseUrl, "POST", "/admin/api-keys", adminToken, {
      label: "Viewer automation",
      role: "viewer",
      scopes: ["catalog.write"],
    });
    assertStatus(createViewerKey, 201, "create viewer api key");
    const viewerApiKey = String(createViewerKey.payload?.plainTextKey ?? "");
    const viewerApiKeyId = String(createViewerKey.payload?.id ?? "");
    assert(viewerApiKey.startsWith("pim1_"), "viewer API key should be returned once");

    const createEditorKey = await apiRequest(baseUrl, "POST", "/admin/api-keys", adminToken, {
      label: "Editor automation",
      role: "editor",
      scopes: ["catalog.read", "catalog.write"],
    });
    assertStatus(createEditorKey, 201, "create editor api key");
    const editorApiKey = String(createEditorKey.payload?.plainTextKey ?? "");
    const editorApiKeyId = String(createEditorKey.payload?.id ?? "");
    assert(editorApiKey.startsWith("pim1_"), "editor API key should be returned once");

    const createAdminKey = await apiRequest(baseUrl, "POST", "/admin/api-keys", adminToken, {
      label: "Admin automation",
      role: "admin",
    });
    assertStatus(createAdminKey, 403, "admin api key role rejected");

    const createInvalidScopeKey = await apiRequest(baseUrl, "POST", "/admin/api-keys", adminToken, {
      label: "Invalid scope automation",
      role: "editor",
      scopes: ["future.scope"],
    });
    assertStatus(createInvalidScopeKey, 400, "unsupported api key scope rejected");

    const listKeys = await apiRequest(baseUrl, "GET", "/admin/api-keys", adminToken);
    assertStatus(listKeys, 200, "list api keys");
    assert(Array.isArray(listKeys.payload), "api key list must be an array");
    assert(listKeys.payload.some((row) => row.id === viewerApiKeyId), "viewer api key must be listed");
    assert(listKeys.payload.some((row) => row.id === editorApiKeyId), "editor api key must be listed");

    const viewerJwtAdminAttempt = await apiRequest(baseUrl, "GET", "/admin/api-keys", viewerToken);
    assertStatus(viewerJwtAdminAttempt, 403, "viewer jwt denied admin api key route");

    const viewerApiAdminAttempt = await apiKeyRequest(baseUrl, "GET", "/admin/api-keys", viewerApiKey);
    assertStatus(viewerApiAdminAttempt, 403, "viewer api key denied admin api key route");

    const createCategory = await apiRequest(baseUrl, "POST", "/taxonomy/categories", adminToken, {
      name: `API Key Category ${runId}`,
    });
    assertStatus(createCategory, 201, "admin can create category for api key test");
    categoryId = String(createCategory.payload?.id ?? "");
    assert(categoryId.length > 0, "missing category id");

    const createProductWithEditorKey = await apiKeyRequest(baseUrl, "POST", "/catalog/products", editorApiKey, {
      title: `API Key Product ${runId}`,
      brand: "ApiKeyBrand",
      description: "Created via editor API key",
      categoryId,
      status: "draft",
      attributes: { pricing: { sellingPrice: 499 } },
    });
    assertStatus(createProductWithEditorKey, 201, "editor api key can create product");
    productId = String(createProductWithEditorKey.payload?.id ?? "");
    assert(productId.length > 0, "missing product id created via api key");

    const listProductsWithEditorKey = await apiKeyRequest(baseUrl, "GET", "/catalog/products", editorApiKey);
    assertStatus(listProductsWithEditorKey, 200, "editor api key can read catalog");

    const viewerWriteAttempt = await apiKeyRequest(baseUrl, "POST", "/catalog/products", viewerApiKey, {
      title: `Viewer Key Product ${runId}`,
      brand: "ViewerBrand",
      description: "Should be rejected for viewer api key",
      categoryId,
      status: "draft",
      attributes: { pricing: { sellingPrice: 299 } },
    });
    assertStatus(viewerWriteAttempt, 403, "viewer api key cannot write catalog");

    const createReadOnlyKey = await apiRequest(baseUrl, "POST", "/admin/api-keys", adminToken, {
      label: "Read only automation",
      role: "editor",
      scopes: ["catalog.read"],
    });
    assertStatus(createReadOnlyKey, 201, "create read-only api key");
    const readOnlyApiKey = String(createReadOnlyKey.payload?.plainTextKey ?? "");
    const readOnlyCreateAttempt = await apiKeyRequest(baseUrl, "POST", "/catalog/products", readOnlyApiKey, {
      title: `Read Only Product ${runId}`,
      brand: "ReadOnlyBrand",
      description: "Should be rejected without catalog.write scope",
      categoryId,
      status: "draft",
      attributes: { pricing: { sellingPrice: 199 } },
    });
    assertStatus(readOnlyCreateAttempt, 403, "read-only api key cannot write catalog");
    assert(
      String(readOnlyCreateAttempt.payload?.reason ?? "") === "API_CLIENT_SCOPE_FORBIDDEN",
      `expected API_CLIENT_SCOPE_FORBIDDEN for read-only write attempt, got ${JSON.stringify(readOnlyCreateAttempt.payload)}`,
    );

    const createNoScopeKey = await apiRequest(baseUrl, "POST", "/admin/api-keys", adminToken, {
      label: "No scope automation",
      role: "editor",
    });
    assertStatus(createNoScopeKey, 201, "create no-scope api key");
    const noScopeApiKey = String(createNoScopeKey.payload?.plainTextKey ?? "");
    const noScopeReadAttempt = await apiKeyRequest(baseUrl, "GET", "/catalog/products", noScopeApiKey);
    assertStatus(noScopeReadAttempt, 403, "no-scope api key denied catalog read");
    assert(
      String(noScopeReadAttempt.payload?.reason ?? "") === "API_CLIENT_SCOPE_FORBIDDEN",
      `expected API_CLIENT_SCOPE_FORBIDDEN for no-scope read attempt, got ${JSON.stringify(noScopeReadAttempt.payload)}`,
    );

    await sleep(300);
    const listAfterUsage = await apiRequest(baseUrl, "GET", "/admin/api-keys", adminToken);
    assertStatus(listAfterUsage, 200, "list api keys after usage");
    const editorKeyRow = listAfterUsage.payload.find((row) => row.id === editorApiKeyId);
    assert(Boolean(editorKeyRow?.lastUsedAt), "editor api key lastUsedAt should update after successful request");

    const revokeEditorKey = await apiRequest(baseUrl, "POST", `/admin/api-keys/${encodeURIComponent(editorApiKeyId)}/revoke`, adminToken, {});
    assertStatus(revokeEditorKey, 200, "revoke api key");
    assert(Boolean(revokeEditorKey.payload?.revokedAt), "revoked api key should expose revokedAt");

    const revokedEditorAttempt = await apiKeyRequest(baseUrl, "GET", "/catalog/products", editorApiKey);
    assertStatus(revokedEditorAttempt, 401, "revoked api key rejected");
    assert(String(revokedEditorAttempt.payload?.error ?? "") === "INVALID_API_KEY", "revoked key should return INVALID_API_KEY");

    const auditRows = await prisma.$queryRawUnsafe(
      `
      SELECT action
      FROM audit_logs
      WHERE tenant_key = $1
        AND action IN (
          'api_key.created',
          'api_key.revoked'
        )
      `,
      tenantKey,
    );
    const actions = Array.isArray(auditRows) ? auditRows.map((row) => String(row.action ?? "")) : [];
    assert(actions.filter((action) => action === "api_key.created").length >= 2, "expected api_key.created audit rows");
    assert(actions.includes("api_key.revoked"), "expected api_key.revoked audit row");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantKey,
          workspaceSlug,
          validated: [
            "admin_can_create_and_list_api_keys",
            "admin_api_key_role_is_forbidden",
            "unsupported_api_key_scope_is_rejected",
            "viewer_cannot_access_api_key_admin_routes",
            "editor_api_key_can_read_and_write_catalog_with_matching_scopes",
            "read_only_api_key_cannot_write_catalog",
            "no_scope_api_key_cannot_read_catalog",
            "viewer_api_key_cannot_write_public_api",
            "api_key_usage_updates_last_used_at",
            "revoked_api_key_is_rejected",
            "api_key_admin_mutations_emit_audit_rows",
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
    console.error("API keys integration test failed:");
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
    if (productId) {
      await apiRequest(baseUrl, "DELETE", `/catalog/products/${productId}`, adminToken).catch(() => undefined);
    }
    if (categoryId) {
      await apiRequest(baseUrl, "DELETE", `/taxonomy/categories/${categoryId}`, adminToken).catch(() => undefined);
    }
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
