#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync, execSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
const SCHEMA_PATH = path.join(REPO_ROOT, "packages", "db", "prisma", "schema.prisma");
const STEP_UP_HEADER = "x-pim-step-up-token";
const STEP_UP_SCOPE = "mapping_high_risk";
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
    "20260427113000_api_access_key_scopes",
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
    "20260428131500_add_product_vendor_scope_key",
    "migration.sql",
  ),
];
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9oN0b1sAAAAASUVORK5CYII=";

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
    const value = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
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
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("PIM_DEFAULT_ROLE", "admin");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
  setDefaultEnv("QUEUE_BACKEND", "memory");
  setDefaultEnv("QUEUE_WORKER_ENABLED", "true");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForWebhookDeliveryRow(baseUrl, token, endpointId, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await apiRequest(
      baseUrl,
      "GET",
      `/admin/webhooks/deliveries?endpointId=${encodeURIComponent(endpointId)}&limit=10`,
      token,
    );
    if (response.status === 200 && Array.isArray(response.payload)) {
      const row = response.payload.find((item) => predicate(item));
      if (row) {
        return row;
      }
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for outbound webhook delivery row for endpoint ${endpointId} after ${timeoutMs}ms`);
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
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, payload };
}

async function issueStepUp(baseUrl, token, password) {
  const result = await apiRequest(baseUrl, "POST", "/auth/step-up", token, {
    password,
    scope: STEP_UP_SCOPE,
  });
  assertStatus(result, 201, "issue step-up token");
  const stepUpToken = String(result.payload?.stepUpToken ?? "");
  assert(stepUpToken.length > 10, "missing step-up token");
  return stepUpToken;
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

async function commercialPlanRequest(baseUrl, commercialToken, tenantKey, planTier) {
  return apiRequest(
    baseUrl,
    "POST",
    "/billing/internal/plan-tier",
    null,
    { tenantKey, planTier },
    {
      "x-pim-commercial-ops-token": commercialToken,
      "x-pim-operator-id": "ops-commercial",
      "x-pim-operator-role": "commercial_ops",
    },
  );
}

async function login(baseUrl, workspaceSlug, userId, password) {
  return apiRequest(baseUrl, "POST", "/auth/login", null, {
    workspaceSlug,
    userId,
    password,
    expiresInMinutes: 30,
  });
}

async function advanceToApproved(baseUrl, token, product) {
  const toReview = await apiRequest(baseUrl, "PATCH", `/catalog/products/${product.id}`, token, {
    expectedVersion: product.version,
    title: product.title,
    description: product.description ?? "",
    brand: product.brand,
    categoryId: product.categoryId,
    hsnCode: product.hsnCode ?? undefined,
    gstRate: product.gstRate ?? undefined,
    attributes: product.attributes ?? {},
    status: "in_review",
  });
  if (toReview.status !== 200) {
    throw new Error(`advance to in_review failed: ${toReview.status} ${JSON.stringify(toReview.payload)}`);
  }
  const toApproved = await apiRequest(baseUrl, "PATCH", `/catalog/products/${product.id}`, token, {
    expectedVersion: toReview.payload.version,
    title: toReview.payload.title,
    description: toReview.payload.description ?? "",
    brand: toReview.payload.brand,
    categoryId: toReview.payload.categoryId,
    hsnCode: toReview.payload.hsnCode ?? undefined,
    gstRate: toReview.payload.gstRate ?? undefined,
    attributes: toReview.payload.attributes ?? {},
    status: "approved",
  });
  if (toApproved.status !== 200) {
    throw new Error(`advance to approved failed: ${toApproved.status} ${JSON.stringify(toApproved.payload)}`);
  }
  return toApproved.payload;
}

async function run() {
  prepareEnv();
  runMigrations();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 7100 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `access-policy-${runId}`;
  const workspaceSlug = `ap-${runId}`.slice(0, 24);
  const adminUser = `ap-admin-${runId}`;
  const productAdminUser = `ap-product-admin-${runId}`;
  const systemAdminUser = `ap-system-admin-${runId}`;
  const superAdminUser = `ap-super-admin-${runId}`;
  const categoryManagerUser = `ap-category-manager-${runId}`;
  const vendorUser = `ap-vendor-${runId}`;
  const editorUser = `ap-editor-${runId}`;
  const reviewerUser = `ap-reviewer-${runId}`;
  const viewerUser = `ap-viewer-${runId}`;
  const boundaryTargetUser = `ap-boundary-target-${runId}`;
  const commercialToken = `commercial-ops-${runId}`;
  const authPassword = "vexa-pim-demo-password";

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [adminUser]: { tenantId, role: "admin", workspaceSlug },
      [productAdminUser]: { tenantId, role: "admin", workspaceSlug, assignedRoles: ["product_admin"] },
      [systemAdminUser]: { tenantId, role: "admin", workspaceSlug, assignedRoles: ["system_admin"] },
      [superAdminUser]: { tenantId, role: "admin", workspaceSlug, assignedRoles: ["super_admin"] },
      [categoryManagerUser]: { tenantId, role: "admin", workspaceSlug, assignedRoles: ["category_manager"] },
      [vendorUser]: { tenantId, role: "admin", workspaceSlug, assignedRoles: ["vendor"] },
      [editorUser]: { tenantId, role: "editor", workspaceSlug },
      [reviewerUser]: { tenantId, role: "reviewer", workspaceSlug },
      [viewerUser]: { tenantId, role: "viewer", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Access Policy Remediation" },
    }),
    PIM_AUTH_PASSWORD: authPassword,
    PIM_COMMERCIAL_OPS_TOKEN: commercialToken,
    PIM_ACCESS_POLICY_SHADOW_MODE: "true",
  };

  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL } },
  });
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

    const adminLogin = await login(baseUrl, workspaceSlug, adminUser, authPassword);
    assertStatus(adminLogin, 201, "admin login");
    const adminToken = String(adminLogin.payload?.accessToken ?? "");
    assert(adminToken.length > 10, "missing admin token");

    const productAdminLogin = await login(baseUrl, workspaceSlug, productAdminUser, authPassword);
    assertStatus(productAdminLogin, 201, "product admin login");
    const productAdminToken = String(productAdminLogin.payload?.accessToken ?? "");
    assert(productAdminToken.length > 10, "missing product admin token");

    const systemAdminLogin = await login(baseUrl, workspaceSlug, systemAdminUser, authPassword);
    assertStatus(systemAdminLogin, 201, "system admin login");
    const systemAdminToken = String(systemAdminLogin.payload?.accessToken ?? "");
    assert(systemAdminToken.length > 10, "missing system admin token");

    const superAdminLogin = await login(baseUrl, workspaceSlug, superAdminUser, authPassword);
    assertStatus(superAdminLogin, 201, "super admin login");
    const superAdminToken = String(superAdminLogin.payload?.accessToken ?? "");
    assert(superAdminToken.length > 10, "missing super admin token");

    const categoryManagerLogin = await login(baseUrl, workspaceSlug, categoryManagerUser, authPassword);
    assertStatus(categoryManagerLogin, 201, "category manager login");
    const categoryManagerToken = String(categoryManagerLogin.payload?.accessToken ?? "");
    assert(categoryManagerToken.length > 10, "missing category manager token");

    const vendorLogin = await login(baseUrl, workspaceSlug, vendorUser, authPassword);
    assertStatus(vendorLogin, 201, "vendor login");
    const vendorToken = String(vendorLogin.payload?.accessToken ?? "");
    assert(vendorToken.length > 10, "missing vendor token");

    const editorLogin = await login(baseUrl, workspaceSlug, editorUser, authPassword);
    assertStatus(editorLogin, 201, "editor login");
    const editorToken = String(editorLogin.payload?.accessToken ?? "");
    assert(editorToken.length > 10, "missing editor token");

    const reviewerLogin = await login(baseUrl, workspaceSlug, reviewerUser, authPassword);
    assertStatus(reviewerLogin, 201, "reviewer login");
    const reviewerToken = String(reviewerLogin.payload?.accessToken ?? "");
    assert(reviewerToken.length > 10, "missing reviewer token");

    const viewerLogin = await login(baseUrl, workspaceSlug, viewerUser, authPassword);
    assertStatus(viewerLogin, 201, "viewer login");
    const viewerToken = String(viewerLogin.payload?.accessToken ?? "");
    assert(viewerToken.length > 10, "missing viewer token");

    const setEnterprise = await commercialPlanRequest(baseUrl, commercialToken, tenantId, "ENTERPRISE");
    assert(
      setEnterprise.status === 200 || setEnterprise.status === 201,
      `set enterprise plan failed: got ${setEnterprise.status} payload=${JSON.stringify(setEnterprise.payload)}`,
    );

    const createBoundaryTarget = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminToken, {
      userId: boundaryTargetUser,
      role: "viewer",
    });
    assertStatus(createBoundaryTarget, 201, "create boundary target user");

    const productAdminUsersDenied = await apiRequest(baseUrl, "GET", "/admin/workspace/users", productAdminToken);
    assertStatus(productAdminUsersDenied, 403, "product admin denied workspace user management");
    assert(
      String(productAdminUsersDenied.payload?.reason ?? "") === "ADMIN_BOUNDARY_FORBIDDEN",
      `expected ADMIN_BOUNDARY_FORBIDDEN for product admin workspace user read, got ${JSON.stringify(productAdminUsersDenied.payload)}`,
    );

    const systemAdminUsersAllowed = await apiRequest(baseUrl, "GET", "/admin/workspace/users", systemAdminToken);
    assertStatus(systemAdminUsersAllowed, 200, "system admin allowed workspace user management");
    assert(
      Array.isArray(systemAdminUsersAllowed.payload) &&
        systemAdminUsersAllowed.payload.some((item) => String(item?.userId ?? "") === boundaryTargetUser),
      `expected system admin workspace user read to include boundary target, got ${JSON.stringify(systemAdminUsersAllowed.payload)}`,
    );
    const systemAdminBoundaryUser = systemAdminUsersAllowed.payload.find(
      (item) => String(item?.userId ?? "") === boundaryTargetUser,
    );
    assert(
      systemAdminBoundaryUser && systemAdminBoundaryUser.createdBy === null,
      `expected system admin workspace user read to redact createdBy, got ${JSON.stringify(systemAdminBoundaryUser)}`,
    );
    assert(
      Array.isArray(systemAdminBoundaryUser?.redactedFields) &&
        systemAdminBoundaryUser.redactedFields.includes("createdBy"),
      `expected system admin workspace user read to expose redactedFields.createdBy, got ${JSON.stringify(systemAdminBoundaryUser)}`,
    );

    const superAdminUsersAllowed = await apiRequest(baseUrl, "GET", "/admin/workspace/users", superAdminToken);
    assertStatus(superAdminUsersAllowed, 200, "super admin allowed workspace user management");
    const superAdminBoundaryUser = Array.isArray(superAdminUsersAllowed.payload)
      ? superAdminUsersAllowed.payload.find((item) => String(item?.userId ?? "") === boundaryTargetUser)
      : null;
    assert(
      String(superAdminBoundaryUser?.createdBy ?? "").length > 0,
      `expected super admin workspace user read to retain createdBy, got ${JSON.stringify(superAdminBoundaryUser)}`,
    );

    const productAdminApiKeysDenied = await apiRequest(baseUrl, "GET", "/admin/api-keys", productAdminToken);
    assertStatus(productAdminApiKeysDenied, 403, "product admin denied api key management");
    assert(
      String(productAdminApiKeysDenied.payload?.reason ?? "") === "ADMIN_BOUNDARY_FORBIDDEN",
      `expected ADMIN_BOUNDARY_FORBIDDEN for product admin api key read, got ${JSON.stringify(productAdminApiKeysDenied.payload)}`,
    );

    const createBoundaryApiKey = await apiRequest(baseUrl, "POST", "/admin/api-keys", adminToken, {
      label: `Boundary Key ${runId}`,
      role: "editor",
      scopes: ["catalog.read"],
    });
    assertStatus(createBoundaryApiKey, 201, "create boundary api key");
    const boundaryApiKeyId = String(createBoundaryApiKey.payload?.id ?? "");
    assert(boundaryApiKeyId.length > 0, "expected created boundary api key id");

    const systemAdminApiKeysAllowed = await apiRequest(baseUrl, "GET", "/admin/api-keys", systemAdminToken);
    assertStatus(systemAdminApiKeysAllowed, 200, "system admin allowed api key management");
    assert(Array.isArray(systemAdminApiKeysAllowed.payload), "expected system admin api key list to return an array");
    const systemAdminBoundaryApiKey = systemAdminApiKeysAllowed.payload.find((item) => String(item?.id ?? "") === boundaryApiKeyId);
    assert(
      systemAdminBoundaryApiKey && systemAdminBoundaryApiKey.createdBy === null,
      `expected system admin api key read to redact createdBy, got ${JSON.stringify(systemAdminBoundaryApiKey)}`,
    );
    assert(
      Array.isArray(systemAdminBoundaryApiKey?.redactedFields) &&
        systemAdminBoundaryApiKey.redactedFields.includes("createdBy"),
      `expected system admin api key read to expose redactedFields.createdBy, got ${JSON.stringify(systemAdminBoundaryApiKey)}`,
    );

    const superAdminApiKeysAllowed = await apiRequest(baseUrl, "GET", "/admin/api-keys", superAdminToken);
    assertStatus(superAdminApiKeysAllowed, 200, "super admin allowed api key management");
    const superAdminBoundaryApiKey = Array.isArray(superAdminApiKeysAllowed.payload)
      ? superAdminApiKeysAllowed.payload.find((item) => String(item?.id ?? "") === boundaryApiKeyId)
      : null;
    assert(
      String(superAdminBoundaryApiKey?.createdBy ?? "").length > 0,
      `expected super admin api key read to retain createdBy, got ${JSON.stringify(superAdminBoundaryApiKey)}`,
    );

    const productAdminScopesDenied = await apiRequest(
      baseUrl,
      "GET",
      "/admin/workspace/access-scopes",
      productAdminToken,
    );
    assertStatus(productAdminScopesDenied, 403, "product admin denied access-scope reads");
    assert(
      String(productAdminScopesDenied.payload?.reason ?? "") === "ADMIN_BOUNDARY_FORBIDDEN",
      `expected ADMIN_BOUNDARY_FORBIDDEN for product admin scope read, got ${JSON.stringify(productAdminScopesDenied.payload)}`,
    );

    const createBoundaryScopeAssignment = await apiRequest(baseUrl, "POST", "/admin/workspace/access-scopes", adminToken, {
      subjectType: "user",
      subjectId: boundaryTargetUser,
      scopeType: "brand",
      scopeValue: `boundary-brand-read-${runId}`,
      actions: ["view"],
    });
    assertStatus(createBoundaryScopeAssignment, 201, "create boundary access scope assignment");
    const boundaryScopeAssignmentId = String(createBoundaryScopeAssignment.payload?.id ?? "");
    assert(boundaryScopeAssignmentId.length > 0, "expected created boundary scope assignment id");

    const systemAdminScopesAllowed = await apiRequest(
      baseUrl,
      "GET",
      "/admin/workspace/access-scopes",
      systemAdminToken,
    );
    assertStatus(systemAdminScopesAllowed, 200, "system admin allowed access-scope reads");
    assert(Array.isArray(systemAdminScopesAllowed.payload), "expected system admin access-scope list to return an array");
    const systemAdminBoundaryScope = systemAdminScopesAllowed.payload.find(
      (item) => String(item?.id ?? "") === boundaryScopeAssignmentId,
    );
    assert(
      systemAdminBoundaryScope && systemAdminBoundaryScope.createdBy === null,
      `expected system admin scope read to redact createdBy, got ${JSON.stringify(systemAdminBoundaryScope)}`,
    );
    assert(
      Array.isArray(systemAdminBoundaryScope?.redactedFields) &&
        systemAdminBoundaryScope.redactedFields.includes("createdBy"),
      `expected system admin scope read to expose redactedFields.createdBy, got ${JSON.stringify(systemAdminBoundaryScope)}`,
    );

    const superAdminScopesAllowed = await apiRequest(
      baseUrl,
      "GET",
      "/admin/workspace/access-scopes",
      superAdminToken,
    );
    assertStatus(superAdminScopesAllowed, 200, "super admin allowed access-scope reads");
    const superAdminBoundaryScope = Array.isArray(superAdminScopesAllowed.payload)
      ? superAdminScopesAllowed.payload.find((item) => String(item?.id ?? "") === boundaryScopeAssignmentId)
      : null;
    assert(
      String(superAdminBoundaryScope?.createdBy ?? "").length > 0,
      `expected super admin scope read to retain createdBy, got ${JSON.stringify(superAdminBoundaryScope)}`,
    );

    const productAdminDashboardReadinessAllowed = await apiRequest(
      baseUrl,
      "GET",
      "/dashboard/readiness",
      productAdminToken,
    );
    assertStatus(productAdminDashboardReadinessAllowed, 200, "product admin allowed dashboard readiness");

    const systemAdminDashboardReadinessDenied = await apiRequest(
      baseUrl,
      "GET",
      "/dashboard/readiness",
      systemAdminToken,
    );
    assertStatus(systemAdminDashboardReadinessDenied, 403, "system admin denied dashboard readiness");
    assert(
      String(systemAdminDashboardReadinessDenied.payload?.reason ?? "") === "ADMIN_BOUNDARY_FORBIDDEN",
      `expected ADMIN_BOUNDARY_FORBIDDEN for system admin dashboard readiness, got ${JSON.stringify(systemAdminDashboardReadinessDenied.payload)}`,
    );

    const categoryManagerDashboardReadinessDenied = await apiRequest(
      baseUrl,
      "GET",
      "/dashboard/readiness",
      categoryManagerToken,
    );
    assertStatus(categoryManagerDashboardReadinessDenied, 403, "category manager denied dashboard readiness");
    assert(
      String(categoryManagerDashboardReadinessDenied.payload?.reason ?? "") === "FOUNDATION_ROLE_BLOCKED",
      `expected FOUNDATION_ROLE_BLOCKED for category manager dashboard readiness, got ${JSON.stringify(categoryManagerDashboardReadinessDenied.payload)}`,
    );

    const vendorDashboardReadinessDenied = await apiRequest(
      baseUrl,
      "GET",
      "/dashboard/readiness",
      vendorToken,
    );
    assertStatus(vendorDashboardReadinessDenied, 403, "vendor denied dashboard readiness");
    assert(
      String(vendorDashboardReadinessDenied.payload?.reason ?? "") === "FOUNDATION_ROLE_BLOCKED",
      `expected FOUNDATION_ROLE_BLOCKED for vendor dashboard readiness, got ${JSON.stringify(vendorDashboardReadinessDenied.payload)}`,
    );

    const productAdminBillingPlanProfileDenied = await apiRequest(
      baseUrl,
      "GET",
      "/billing/plan-profile",
      productAdminToken,
    );
    assertStatus(productAdminBillingPlanProfileDenied, 403, "product admin denied billing plan profile");
    assert(
      String(productAdminBillingPlanProfileDenied.payload?.reason ?? "") === "ADMIN_BOUNDARY_FORBIDDEN",
      `expected ADMIN_BOUNDARY_FORBIDDEN for product admin billing plan profile, got ${JSON.stringify(productAdminBillingPlanProfileDenied.payload)}`,
    );

    const systemAdminBillingPlanProfileAllowed = await apiRequest(
      baseUrl,
      "GET",
      "/billing/plan-profile",
      systemAdminToken,
    );
    assertStatus(systemAdminBillingPlanProfileAllowed, 200, "system admin allowed billing plan profile");
    assert(
      String(systemAdminBillingPlanProfileAllowed.payload?.tenantKey ?? "") === tenantId,
      `expected system admin billing plan profile to return tenant profile, got ${JSON.stringify(systemAdminBillingPlanProfileAllowed.payload)}`,
    );
    assert(
      systemAdminBillingPlanProfileAllowed.payload?.billingContactEmail === null,
      `expected system admin billing plan profile to redact billingContactEmail, got ${JSON.stringify(systemAdminBillingPlanProfileAllowed.payload)}`,
    );
    assert(
      systemAdminBillingPlanProfileAllowed.payload?.updatedBy === null,
      `expected system admin billing plan profile to redact updatedBy, got ${JSON.stringify(systemAdminBillingPlanProfileAllowed.payload)}`,
    );
    assert(
      Array.isArray(systemAdminBillingPlanProfileAllowed.payload?.redactedFields) &&
        systemAdminBillingPlanProfileAllowed.payload.redactedFields.includes("billingContactEmail") &&
        systemAdminBillingPlanProfileAllowed.payload.redactedFields.includes("updatedBy"),
      `expected system admin billing plan profile to expose redactedFields for billing governance, got ${JSON.stringify(systemAdminBillingPlanProfileAllowed.payload)}`,
    );

    const superAdminBillingPlanProfileAllowed = await apiRequest(
      baseUrl,
      "GET",
      "/billing/plan-profile",
      superAdminToken,
    );
    assertStatus(superAdminBillingPlanProfileAllowed, 200, "super admin allowed billing plan profile");
    assert(
      String(superAdminBillingPlanProfileAllowed.payload?.updatedBy ?? "").length > 0,
      `expected super admin billing plan profile to retain updatedBy, got ${JSON.stringify(superAdminBillingPlanProfileAllowed.payload)}`,
    );
    assert(
      !Array.isArray(superAdminBillingPlanProfileAllowed.payload?.redactedFields),
      `expected super admin billing plan profile to remain unredacted, got ${JSON.stringify(superAdminBillingPlanProfileAllowed.payload)}`,
    );

    const productAdminUpgradeRequestDenied = await apiRequest(
      baseUrl,
      "GET",
      "/billing/upgrade-request",
      productAdminToken,
    );
    assertStatus(productAdminUpgradeRequestDenied, 403, "product admin denied billing upgrade request");
    assert(
      String(productAdminUpgradeRequestDenied.payload?.reason ?? "") === "ADMIN_BOUNDARY_FORBIDDEN",
      `expected ADMIN_BOUNDARY_FORBIDDEN for product admin billing upgrade request, got ${JSON.stringify(productAdminUpgradeRequestDenied.payload)}`,
    );

    const systemAdminCreateUpgradeRequestAllowed = await apiRequest(
      baseUrl,
      "POST",
      "/billing/upgrade-request",
      systemAdminToken,
      {
        notes: `Upgrade request ${runId}`,
        source: "admin_plan",
      },
    );
    assertStatus(systemAdminCreateUpgradeRequestAllowed, 200, "system admin allowed billing upgrade request create");
    assert(
      String(systemAdminCreateUpgradeRequestAllowed.payload?.item?.id ?? "").length > 0,
      `expected system admin billing upgrade request create payload, got ${JSON.stringify(systemAdminCreateUpgradeRequestAllowed.payload)}`,
    );

    const systemAdminUpgradeRequestAllowed = await apiRequest(
      baseUrl,
      "GET",
      "/billing/upgrade-request",
      systemAdminToken,
    );
    assertStatus(systemAdminUpgradeRequestAllowed, 200, "system admin allowed billing upgrade request");
    assert(
      Object.prototype.hasOwnProperty.call(systemAdminUpgradeRequestAllowed.payload ?? {}, "item"),
      `expected system admin upgrade request payload, got ${JSON.stringify(systemAdminUpgradeRequestAllowed.payload)}`,
    );
    assert(
      systemAdminUpgradeRequestAllowed.payload?.item?.requestedBy === null,
      `expected system admin billing upgrade request to redact requestedBy, got ${JSON.stringify(systemAdminUpgradeRequestAllowed.payload)}`,
    );
    assert(
      systemAdminUpgradeRequestAllowed.payload?.item?.notes === null,
      `expected system admin billing upgrade request to redact notes, got ${JSON.stringify(systemAdminUpgradeRequestAllowed.payload)}`,
    );
    assert(
      Array.isArray(systemAdminUpgradeRequestAllowed.payload?.item?.redactedFields) &&
        systemAdminUpgradeRequestAllowed.payload.item.redactedFields.includes("requestedBy") &&
        systemAdminUpgradeRequestAllowed.payload.item.redactedFields.includes("notes"),
      `expected system admin billing upgrade request to expose redactedFields, got ${JSON.stringify(systemAdminUpgradeRequestAllowed.payload)}`,
    );

    const superAdminUpgradeRequestAllowed = await apiRequest(
      baseUrl,
      "GET",
      "/billing/upgrade-request",
      superAdminToken,
    );
    assertStatus(superAdminUpgradeRequestAllowed, 200, "super admin allowed billing upgrade request");
    assert(
      String(superAdminUpgradeRequestAllowed.payload?.item?.requestedBy ?? "").length > 0,
      `expected super admin billing upgrade request to retain requestedBy, got ${JSON.stringify(superAdminUpgradeRequestAllowed.payload)}`,
    );
    assert(
      !Array.isArray(superAdminUpgradeRequestAllowed.payload?.item?.redactedFields),
      `expected super admin billing upgrade request to remain unredacted, got ${JSON.stringify(superAdminUpgradeRequestAllowed.payload)}`,
    );

    const systemAdminBillingContactAllowed = await apiRequest(
      baseUrl,
      "POST",
      "/billing/billing-contact",
      systemAdminToken,
      { billingContactEmail: `finance+${runId}@example.com` },
    );
    assertStatus(systemAdminBillingContactAllowed, 200, "system admin allowed billing contact update");
    assert(
      String(systemAdminBillingContactAllowed.payload?.billingContactEmail ?? "") === `finance+${runId}@example.com`,
      `expected system admin billing contact update to persist email, got ${JSON.stringify(systemAdminBillingContactAllowed.payload)}`,
    );

    const productAdminPlanTierDenied = await apiRequest(
      baseUrl,
      "POST",
      "/billing/plan-tier",
      productAdminToken,
      { planTier: "GROWTH" },
    );
    assertStatus(productAdminPlanTierDenied, 403, "product admin denied billing plan-tier mutation");
    assert(
      String(productAdminPlanTierDenied.payload?.reason ?? "") === "ADMIN_BOUNDARY_FORBIDDEN",
      `expected ADMIN_BOUNDARY_FORBIDDEN for product admin billing plan-tier mutation, got ${JSON.stringify(productAdminPlanTierDenied.payload)}`,
    );

    const systemAdminPlanTierBlocked = await apiRequest(
      baseUrl,
      "POST",
      "/billing/plan-tier",
      systemAdminToken,
      { planTier: "GROWTH" },
    );
    assertStatus(systemAdminPlanTierBlocked, 403, "system admin billing plan-tier remains internal only");
    assert(
      String(systemAdminPlanTierBlocked.payload?.error ?? "") === "COMMERCIAL_MUTATION_INTERNAL_ONLY",
      `expected COMMERCIAL_MUTATION_INTERNAL_ONLY for system admin billing plan-tier, got ${JSON.stringify(systemAdminPlanTierBlocked.payload)}`,
    );

    const superAdminPlanTierBlocked = await apiRequest(
      baseUrl,
      "POST",
      "/billing/plan-tier",
      superAdminToken,
      { planTier: "GROWTH" },
    );
    assertStatus(superAdminPlanTierBlocked, 403, "super admin billing plan-tier remains internal only");
    assert(
      String(superAdminPlanTierBlocked.payload?.error ?? "") === "COMMERCIAL_MUTATION_INTERNAL_ONLY",
      `expected COMMERCIAL_MUTATION_INTERNAL_ONLY for super admin billing plan-tier, got ${JSON.stringify(superAdminPlanTierBlocked.payload)}`,
    );

    const systemAdminAuditEventsAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/audit/events?entityType=plan&action=TENANT_BILLING_CONTACT_UPDATED&resourceId=${encodeURIComponent(tenantId)}&limit=25`,
      systemAdminToken,
    );
    assertStatus(systemAdminAuditEventsAllowed, 200, "system admin allowed audit events");
    assert(Array.isArray(systemAdminAuditEventsAllowed.payload?.items), "expected system admin audit events items array");
    const systemAdminBillingEventRow = systemAdminAuditEventsAllowed.payload.items.find(
      (item) => String(item?.action ?? "") === "TENANT_BILLING_CONTACT_UPDATED" && String(item?.resourceId ?? "") === tenantId,
    );
    assert(
      systemAdminBillingEventRow && systemAdminBillingEventRow.metadata === null,
      `expected system admin audit events to redact metadata, got ${JSON.stringify(systemAdminBillingEventRow)}`,
    );
    assert(
      Array.isArray(systemAdminBillingEventRow?.redactedFields) &&
        systemAdminBillingEventRow.redactedFields.includes("metadata"),
      `expected system admin audit events to expose redactedFields.metadata, got ${JSON.stringify(systemAdminBillingEventRow)}`,
    );

    const superAdminAuditEventsAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/audit/events?entityType=plan&action=TENANT_BILLING_CONTACT_UPDATED&resourceId=${encodeURIComponent(tenantId)}&limit=25`,
      superAdminToken,
    );
    assertStatus(superAdminAuditEventsAllowed, 200, "super admin allowed audit events");
    assert(Array.isArray(superAdminAuditEventsAllowed.payload?.items), "expected super admin audit events items array");
    const superAdminBillingEventRow = superAdminAuditEventsAllowed.payload.items.find(
      (item) => String(item?.action ?? "") === "TENANT_BILLING_CONTACT_UPDATED" && String(item?.resourceId ?? "") === tenantId,
    );
    assert(
      String(superAdminBillingEventRow?.metadata?.billingContactEmail ?? "").length > 0,
      `expected super admin audit events to retain metadata, got ${JSON.stringify(superAdminBillingEventRow)}`,
    );

    const systemAdminAuditEventsExportAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/audit/events/export?entityType=plan&action=TENANT_BILLING_CONTACT_UPDATED&resourceId=${encodeURIComponent(tenantId)}&limit=25`,
      systemAdminToken,
      undefined,
      { Accept: "text/csv" },
    );
    assertStatus(systemAdminAuditEventsExportAllowed, 200, "system admin allowed audit events export");
    const systemAdminAuditEventsCsv = String(systemAdminAuditEventsExportAllowed.payload ?? "");
    assert(
      systemAdminAuditEventsCsv.includes("TENANT_BILLING_CONTACT_UPDATED"),
      `expected system admin audit event export row, got ${systemAdminAuditEventsCsv}`,
    );
    assert(
      !systemAdminAuditEventsCsv.includes(`finance+${runId}@example.com`),
      `expected system admin audit event export to redact billing email, got ${systemAdminAuditEventsCsv}`,
    );

    const superAdminAuditEventsExportAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/audit/events/export?entityType=plan&action=TENANT_BILLING_CONTACT_UPDATED&resourceId=${encodeURIComponent(tenantId)}&limit=25`,
      superAdminToken,
      undefined,
      { Accept: "text/csv" },
    );
    assertStatus(superAdminAuditEventsExportAllowed, 200, "super admin allowed audit events export");
    const superAdminAuditEventsCsv = String(superAdminAuditEventsExportAllowed.payload ?? "");
    assert(
      superAdminAuditEventsCsv.includes(`finance+${runId}@example.com`),
      `expected super admin audit event export to retain billing email, got ${superAdminAuditEventsCsv}`,
    );

    const productAdminAuditLogsDenied = await apiRequest(baseUrl, "GET", "/audit/logs?limit=10", productAdminToken);
    assertStatus(productAdminAuditLogsDenied, 403, "product admin denied audit logs");
    assert(
      String(productAdminAuditLogsDenied.payload?.reason ?? "") === "ADMIN_BOUNDARY_FORBIDDEN",
      `expected ADMIN_BOUNDARY_FORBIDDEN for product admin audit logs, got ${JSON.stringify(productAdminAuditLogsDenied.payload)}`,
    );

    const systemAdminAuditLogsAllowed = await apiRequest(baseUrl, "GET", "/audit/logs?limit=10", systemAdminToken);
    assertStatus(systemAdminAuditLogsAllowed, 200, "system admin allowed audit logs");
    assert(Array.isArray(systemAdminAuditLogsAllowed.payload), "expected system admin audit logs payload to be an array");
    const systemAdminBillingAuditRow = systemAdminAuditLogsAllowed.payload.find(
      (item) => String(item?.action ?? "") === "TENANT_BILLING_CONTACT_UPDATED",
    );
    assert(
      systemAdminBillingAuditRow && systemAdminBillingAuditRow.metadata === null,
      `expected system admin audit logs to redact metadata, got ${JSON.stringify(systemAdminBillingAuditRow)}`,
    );
    assert(
      Array.isArray(systemAdminBillingAuditRow?.redactedFields) &&
        systemAdminBillingAuditRow.redactedFields.includes("metadata"),
      `expected system admin audit logs to expose redactedFields.metadata, got ${JSON.stringify(systemAdminBillingAuditRow)}`,
    );

    const superAdminAuditLogsAllowed = await apiRequest(baseUrl, "GET", "/audit/logs?limit=10", superAdminToken);
    assertStatus(superAdminAuditLogsAllowed, 200, "super admin allowed audit logs");
    assert(Array.isArray(superAdminAuditLogsAllowed.payload), "expected super admin audit logs payload to be an array");
    const superAdminBillingAuditRow = superAdminAuditLogsAllowed.payload.find(
      (item) => String(item?.action ?? "") === "TENANT_BILLING_CONTACT_UPDATED",
    );
    assert(
      String(superAdminBillingAuditRow?.metadata?.billingContactEmail ?? "").length > 0,
      `expected super admin audit logs to retain metadata, got ${JSON.stringify(superAdminBillingAuditRow)}`,
    );

    const createBoundaryWebhook = await apiRequest(baseUrl, "POST", "/admin/webhooks", adminToken, {
      name: `Boundary Webhook ${runId}`,
      eventType: "approval_decision",
      targetUrl: `https://example.test/hooks/${runId}`,
      signingSecret: `boundary-secret-${runId}-long`,
      isActive: true,
    });
    assertStatus(createBoundaryWebhook, 201, "create boundary outbound webhook");
    const boundaryWebhookId = String(createBoundaryWebhook.payload?.id ?? "");
    assert(boundaryWebhookId.length > 0, "expected created boundary outbound webhook id");

    const createBoundaryFailureWebhook = await apiRequest(baseUrl, "POST", "/admin/webhooks", adminToken, {
      name: `Boundary Failure Webhook ${runId}`,
      eventType: "approval_decision",
      targetUrl: `http://127.0.0.1:9/fail-${runId}`,
      signingSecret: `boundary-failure-secret-${runId}-long`,
      isActive: true,
    });
    assertStatus(createBoundaryFailureWebhook, 201, "create boundary outbound webhook failure fixture");
    const boundaryFailureWebhookId = String(createBoundaryFailureWebhook.payload?.id ?? "");
    assert(boundaryFailureWebhookId.length > 0, "expected created failing boundary outbound webhook id");

    const queueBoundaryFailureWebhook = await apiRequest(
      baseUrl,
      "POST",
      `/admin/webhooks/${encodeURIComponent(boundaryFailureWebhookId)}/test`,
      adminToken,
    );
    assertStatus(queueBoundaryFailureWebhook, 200, "queue boundary failing outbound webhook test");

    const boundaryFailureDelivery = await waitForWebhookDeliveryRow(
      baseUrl,
      superAdminToken,
      boundaryFailureWebhookId,
      (item) =>
        String(item?.endpointId ?? "") === boundaryFailureWebhookId &&
        String(item?.status ?? "") === "failed" &&
        String(item?.errorMessage ?? "").length > 0,
      20_000,
    );

    const grantBoundaryConnectorPermission = await apiRequest(baseUrl, "POST", "/connectors/permissions", adminToken, {
      principalType: "role",
      principalId: "editor",
      connectorSlug: "shopify",
      accountAlias: `boundary-${runId}`,
      action: "reconnect",
    });
    assertStatus(grantBoundaryConnectorPermission, 201, "grant boundary connector permission");
    const boundaryConnectorPermissionId = String(grantBoundaryConnectorPermission.payload?.id ?? "");
    assert(boundaryConnectorPermissionId.length > 0, "expected granted boundary connector permission id");

    const productAdminWebhooksDenied = await apiRequest(baseUrl, "GET", "/admin/webhooks", productAdminToken);
    assertStatus(productAdminWebhooksDenied, 403, "product admin denied outbound webhooks");
    assert(
      String(productAdminWebhooksDenied.payload?.reason ?? "") === "ADMIN_BOUNDARY_FORBIDDEN",
      `expected ADMIN_BOUNDARY_FORBIDDEN for product admin outbound webhooks, got ${JSON.stringify(productAdminWebhooksDenied.payload)}`,
    );

    const systemAdminWebhooksAllowed = await apiRequest(baseUrl, "GET", "/admin/webhooks", systemAdminToken);
    assertStatus(systemAdminWebhooksAllowed, 200, "system admin allowed outbound webhooks");
    assert(Array.isArray(systemAdminWebhooksAllowed.payload), "expected system admin outbound webhooks payload to be an array");
    const systemAdminBoundaryWebhook = systemAdminWebhooksAllowed.payload.find(
      (item) => String(item?.id ?? "") === boundaryWebhookId,
    );
    assert(
      systemAdminBoundaryWebhook && systemAdminBoundaryWebhook.createdBy === null,
      `expected system admin webhook read to redact createdBy, got ${JSON.stringify(systemAdminBoundaryWebhook)}`,
    );
    assert(
      Array.isArray(systemAdminBoundaryWebhook?.redactedFields) &&
        systemAdminBoundaryWebhook.redactedFields.includes("createdBy"),
      `expected system admin webhook read to expose redactedFields.createdBy, got ${JSON.stringify(systemAdminBoundaryWebhook)}`,
    );

    const superAdminWebhooksAllowed = await apiRequest(baseUrl, "GET", "/admin/webhooks", superAdminToken);
    assertStatus(superAdminWebhooksAllowed, 200, "super admin allowed outbound webhooks");
    const superAdminBoundaryWebhook = Array.isArray(superAdminWebhooksAllowed.payload)
      ? superAdminWebhooksAllowed.payload.find((item) => String(item?.id ?? "") === boundaryWebhookId)
      : null;
    assert(
      String(superAdminBoundaryWebhook?.createdBy ?? "").length > 0,
      `expected super admin webhook read to retain createdBy, got ${JSON.stringify(superAdminBoundaryWebhook)}`,
    );

    const systemAdminWebhookDeliveriesAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/admin/webhooks/deliveries?endpointId=${encodeURIComponent(boundaryFailureWebhookId)}&limit=10`,
      systemAdminToken,
    );
    assertStatus(systemAdminWebhookDeliveriesAllowed, 200, "system admin allowed outbound webhook deliveries");
    assert(
      Array.isArray(systemAdminWebhookDeliveriesAllowed.payload),
      `expected system admin webhook deliveries payload to be an array, got ${JSON.stringify(systemAdminWebhookDeliveriesAllowed.payload)}`,
    );
    const systemAdminBoundaryDelivery = systemAdminWebhookDeliveriesAllowed.payload.find(
      (item) => String(item?.id ?? "") === String(boundaryFailureDelivery?.id ?? ""),
    );
    assert(
      systemAdminBoundaryDelivery && systemAdminBoundaryDelivery.errorMessage === null,
      `expected system admin webhook delivery read to redact errorMessage, got ${JSON.stringify(systemAdminBoundaryDelivery)}`,
    );
    assert(
      Array.isArray(systemAdminBoundaryDelivery?.redactedFields) &&
        systemAdminBoundaryDelivery.redactedFields.includes("errorMessage"),
      `expected system admin webhook delivery read to expose redactedFields.errorMessage, got ${JSON.stringify(systemAdminBoundaryDelivery)}`,
    );

    const superAdminWebhookDeliveriesAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/admin/webhooks/deliveries?endpointId=${encodeURIComponent(boundaryFailureWebhookId)}&limit=10`,
      superAdminToken,
    );
    assertStatus(superAdminWebhookDeliveriesAllowed, 200, "super admin allowed outbound webhook deliveries");
    const superAdminBoundaryDelivery = Array.isArray(superAdminWebhookDeliveriesAllowed.payload)
      ? superAdminWebhookDeliveriesAllowed.payload.find((item) => String(item?.id ?? "") === String(boundaryFailureDelivery?.id ?? ""))
      : null;
    assert(
      String(superAdminBoundaryDelivery?.errorMessage ?? "").length > 0,
      `expected super admin webhook delivery read to retain errorMessage, got ${JSON.stringify(superAdminBoundaryDelivery)}`,
    );

    const editorWebhooksDenied = await apiRequest(baseUrl, "GET", "/admin/webhooks", editorToken);
    assertStatus(editorWebhooksDenied, 403, "editor denied outbound webhooks");

    const productAdminConnectorPermissionsDenied = await apiRequest(
      baseUrl,
      "GET",
      "/connectors/permissions",
      productAdminToken,
    );
    assertStatus(productAdminConnectorPermissionsDenied, 403, "product admin denied connector permissions");
    assert(
      String(productAdminConnectorPermissionsDenied.payload?.reason ?? "") === "ADMIN_BOUNDARY_FORBIDDEN",
      `expected ADMIN_BOUNDARY_FORBIDDEN for product admin connector permissions, got ${JSON.stringify(productAdminConnectorPermissionsDenied.payload)}`,
    );

    const systemAdminConnectorPermissionsAllowed = await apiRequest(
      baseUrl,
      "GET",
      "/connectors/permissions",
      systemAdminToken,
    );
    assertStatus(systemAdminConnectorPermissionsAllowed, 200, "system admin allowed connector permissions");
    assert(Array.isArray(systemAdminConnectorPermissionsAllowed.payload), "expected system admin connector permissions payload to be an array");
    const systemAdminBoundaryConnectorPermission = systemAdminConnectorPermissionsAllowed.payload.find(
      (item) => String(item?.id ?? "") === boundaryConnectorPermissionId,
    );
    assert(
      systemAdminBoundaryConnectorPermission && systemAdminBoundaryConnectorPermission.createdBy === null,
      `expected system admin connector permission read to redact createdBy, got ${JSON.stringify(systemAdminBoundaryConnectorPermission)}`,
    );
    assert(
      Array.isArray(systemAdminBoundaryConnectorPermission?.redactedFields) &&
        systemAdminBoundaryConnectorPermission.redactedFields.includes("createdBy"),
      `expected system admin connector permission read to expose redactedFields.createdBy, got ${JSON.stringify(systemAdminBoundaryConnectorPermission)}`,
    );

    const superAdminConnectorPermissionsAllowed = await apiRequest(
      baseUrl,
      "GET",
      "/connectors/permissions",
      superAdminToken,
    );
    assertStatus(superAdminConnectorPermissionsAllowed, 200, "super admin allowed connector permissions");
    const superAdminBoundaryConnectorPermission = Array.isArray(superAdminConnectorPermissionsAllowed.payload)
      ? superAdminConnectorPermissionsAllowed.payload.find((item) => String(item?.id ?? "") === boundaryConnectorPermissionId)
      : null;
    assert(
      String(superAdminBoundaryConnectorPermission?.createdBy ?? "").length > 0,
      `expected super admin connector permission read to retain createdBy, got ${JSON.stringify(superAdminBoundaryConnectorPermission)}`,
    );

    const categoryManagerConnectorPermissionsDenied = await apiRequest(
      baseUrl,
      "GET",
      "/connectors/permissions",
      categoryManagerToken,
    );
    assertStatus(categoryManagerConnectorPermissionsDenied, 403, "category manager denied connector permissions");
    assert(
      String(categoryManagerConnectorPermissionsDenied.payload?.reason ?? "") === "FOUNDATION_ROLE_BLOCKED",
      `expected FOUNDATION_ROLE_BLOCKED for category manager connector permissions, got ${JSON.stringify(categoryManagerConnectorPermissionsDenied.payload)}`,
    );

    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", adminToken, {
      name: `Access Policy Category ${runId}`,
    });
    assertStatus(category, 201, "create category");

    const product = await apiRequest(baseUrl, "POST", "/catalog/products", adminToken, {
      title: `Access Policy Product ${runId}`,
      brand: "Aarika Looms",
      description: "Access policy remediation test product",
      categoryId: category.payload.id,
      vendorScopeKey: "aarika-vendor",
      status: "draft",
      hsnCode: "62046200",
      gstRate: 18,
      attributes: {
        pricing: {
          mrp: 1999,
          sellingPrice: 1499,
        },
        sku: `SKU-${runId}`,
        inventoryQty: 22,
      },
    });
    assertStatus(product, 201, "create product");
    const toReviewForEditor = await apiRequest(baseUrl, "PATCH", `/catalog/products/${product.payload.id}`, adminToken, {
      expectedVersion: product.payload.version,
      title: product.payload.title,
      description: product.payload.description ?? "",
      brand: product.payload.brand,
      categoryId: product.payload.categoryId,
      hsnCode: product.payload.hsnCode,
      gstRate: product.payload.gstRate,
      attributes: product.payload.attributes ?? {},
      status: "in_review",
    });
    if (toReviewForEditor.status !== 200) {
      throw new Error(`advance to in_review failed: ${toReviewForEditor.status} ${JSON.stringify(toReviewForEditor.payload)}`);
    }
    const inReviewProduct = toReviewForEditor.payload;

    const purgeBoundaryProduct = await apiRequest(baseUrl, "POST", "/catalog/products", adminToken, {
      title: `Purge Boundary Product ${runId}`,
      brand: "Aarika Looms",
      description: "Throwaway product for catalog purge admin-boundary proof",
      categoryId: category.payload.id,
      vendorScopeKey: "aarika-vendor",
      status: "draft",
      attributes: {
        sku: `PURGE-${runId}`,
      },
    });
    assertStatus(purgeBoundaryProduct, 201, "create product purge boundary target");

    const systemAdminPurgeDenied = await apiRequest(
      baseUrl,
      "DELETE",
      `/catalog/products/${purgeBoundaryProduct.payload.id}/purge`,
      systemAdminToken,
    );
    assertStatus(systemAdminPurgeDenied, 403, "system admin denied catalog product purge");
    assert(
      String(systemAdminPurgeDenied.payload?.reason ?? "") === "ADMIN_BOUNDARY_FORBIDDEN",
      `expected ADMIN_BOUNDARY_FORBIDDEN for system admin catalog product purge, got ${JSON.stringify(systemAdminPurgeDenied.payload)}`,
    );

    const productAdminSoftDeleteForPurge = await apiRequest(
      baseUrl,
      "DELETE",
      `/catalog/products/${purgeBoundaryProduct.payload.id}`,
      productAdminToken,
    );
    assertStatus(productAdminSoftDeleteForPurge, 200, "product admin soft-delete catalog product purge target");

    const productAdminPurgeAllowed = await apiRequest(
      baseUrl,
      "DELETE",
      `/catalog/products/${purgeBoundaryProduct.payload.id}/purge`,
      productAdminToken,
    );
    assertStatus(productAdminPurgeAllowed, 200, "product admin allowed catalog product purge");
    assert(
      String(productAdminPurgeAllowed.payload?.status ?? "") === "purged",
      `expected product admin catalog purge payload, got ${JSON.stringify(productAdminPurgeAllowed.payload)}`,
    );

    const editorRestrictedProductUpdate = await apiRequest(
      baseUrl,
      "PATCH",
      `/catalog/products/${product.payload.id}`,
      editorToken,
      {
        expectedVersion: inReviewProduct.version,
        title: inReviewProduct.title,
        description: inReviewProduct.description ?? "",
        brand: inReviewProduct.brand,
        categoryId: inReviewProduct.categoryId,
        hsnCode: inReviewProduct.hsnCode,
        gstRate: inReviewProduct.gstRate,
        status: inReviewProduct.status,
        attributes: {
          ...(inReviewProduct.attributes ?? {}),
          pricing: {
            ...((inReviewProduct.attributes ?? {}).pricing ?? {}),
            sellingPrice: 1399,
          },
        },
      },
    );
    assertStatus(editorRestrictedProductUpdate, 403, "editor restricted product attribute update denied");
    assert(
      String(editorRestrictedProductUpdate.payload?.error ?? "") === "ACCESS_POLICY_DENIED",
      `expected ACCESS_POLICY_DENIED for restricted product update, got ${JSON.stringify(editorRestrictedProductUpdate.payload)}`,
    );

    const adminVariantCreate = await apiRequest(
      baseUrl,
      "POST",
      `/catalog/products/${product.payload.id}/variants`,
      adminToken,
      {
        skuCode: `VAR-${runId}`,
        mrp: 1899,
        sellingPrice: 1399,
        inventoryQty: 10,
        status: "draft",
        attributes: {},
      },
    );
    assertStatus(adminVariantCreate, 201, "admin create variant");

    const outOfScopeCategory = await apiRequest(baseUrl, "POST", "/taxonomy/categories", adminToken, {
      name: `Out Of Scope Category ${runId}`,
    });
    assertStatus(outOfScopeCategory, 201, "create out-of-scope category");

    const outOfScopeProduct = await apiRequest(baseUrl, "POST", "/catalog/products", adminToken, {
      title: `Out Of Scope Product ${runId}`,
      brand: "Aarika Looms",
      description: "Out of scope product for category manager enforcement proof",
      categoryId: outOfScopeCategory.payload.id,
      vendorScopeKey: "outside-vendor",
      status: "draft",
      attributes: {
        merchandising: {
          finish: "matte",
        },
      },
    });
    assertStatus(outOfScopeProduct, 201, "create out-of-scope product");

    const ownedMediaAsset = await apiRequest(baseUrl, "POST", "/media/assets", adminToken, {
      productId: product.payload.id,
      fileName: "owned-media.png",
      mimeType: "image/png",
      contentBase64: TINY_PNG,
      width: 1200,
      height: 1200,
    });
    const outOfScopeMediaAsset = await apiRequest(baseUrl, "POST", "/media/assets", adminToken, {
      productId: outOfScopeProduct.payload.id,
      fileName: "unowned-media.png",
      mimeType: "image/png",
      contentBase64: TINY_PNG,
      width: 1200,
      height: 1200,
    });
    assertStatus(ownedMediaAsset, 201, "create owned media asset");
    assertStatus(outOfScopeMediaAsset, 201, "create out-of-scope media asset");

    const categoryManagerWorkspaceUser = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminToken, {
      userId: categoryManagerUser,
      role: "admin",
    });
    assertStatus(categoryManagerWorkspaceUser, 201, "materialize category manager workspace user for scoped assignments");

    const vendorWorkspaceUser = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminToken, {
      userId: vendorUser,
      role: "admin",
    });
    assertStatus(vendorWorkspaceUser, 201, "materialize vendor workspace user for scoped assignments");

    const categoryManagerScopeAssignment = await apiRequest(baseUrl, "POST", "/admin/workspace/access-scopes", adminToken, {
      subjectType: "user",
      subjectId: categoryManagerUser,
      scopeType: "category",
      categoryId: category.payload.id,
      actions: ["view", "create", "edit", "delete"],
    });
    assertStatus(categoryManagerScopeAssignment, 201, "assign category scope to category manager");
    assert(
      String(categoryManagerScopeAssignment.payload?.categoryId ?? "") === String(category.payload.id),
      `expected category-manager scope assignment to target the base category, got ${JSON.stringify(categoryManagerScopeAssignment.payload)}`,
    );

    const vendorScopeAssignment = await apiRequest(baseUrl, "POST", "/admin/workspace/access-scopes", adminToken, {
      subjectType: "user",
      subjectId: vendorUser,
      scopeType: "vendor",
      scopeValue: "aarika-vendor",
      actions: ["view"],
    });
    assertStatus(vendorScopeAssignment, 201, "assign vendor scope to vendor role");
    assert(
      String(vendorScopeAssignment.payload?.scopeType ?? "") === "vendor",
      `expected vendor scope assignment to persist vendor scope, got ${JSON.stringify(vendorScopeAssignment.payload)}`,
    );

    const categoryManagerCatalogStatsDenied = await apiRequest(baseUrl, "GET", "/catalog/stats", categoryManagerToken);
    assertStatus(categoryManagerCatalogStatsDenied, 403, "category manager denied catalog stats by default");
    assert(
      String(categoryManagerCatalogStatsDenied.payload?.reason ?? "") === "FOUNDATION_ROLE_BLOCKED",
      `expected FOUNDATION_ROLE_BLOCKED for category manager catalog stats, got ${JSON.stringify(categoryManagerCatalogStatsDenied.payload)}`,
    );

    const categoryManagerCategoryList = await apiRequest(
      baseUrl,
      "GET",
      "/taxonomy/categories?all=true",
      categoryManagerToken,
    );
    assertStatus(categoryManagerCategoryList, 200, "category manager category list allowed in scope");
    assert(
      Array.isArray(categoryManagerCategoryList.payload) &&
        categoryManagerCategoryList.payload.some((item) => item.id === category.payload.id) &&
        categoryManagerCategoryList.payload.every((item) => item.id !== outOfScopeCategory.payload.id),
      `expected category manager category list to stay in scope, got ${JSON.stringify(categoryManagerCategoryList.payload)}`,
    );

    const categoryManagerCategoryDetailAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/taxonomy/categories/${encodeURIComponent(category.payload.id)}`,
      categoryManagerToken,
    );
    assertStatus(categoryManagerCategoryDetailAllowed, 200, "category manager category detail allowed in scope");

    const categoryManagerCategoryDetailDenied = await apiRequest(
      baseUrl,
      "GET",
      `/taxonomy/categories/${encodeURIComponent(outOfScopeCategory.payload.id)}`,
      categoryManagerToken,
    );
    assertStatus(categoryManagerCategoryDetailDenied, 403, "category manager category detail denied out of scope");
    assert(
      String(categoryManagerCategoryDetailDenied.payload?.reason ?? "") === "CATEGORY_SCOPE_DENIED",
      `expected CATEGORY_SCOPE_DENIED for category manager out-of-scope category detail, got ${JSON.stringify(categoryManagerCategoryDetailDenied.payload)}`,
    );

    const categoryManagerAttributeListAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/taxonomy/categories/${encodeURIComponent(category.payload.id)}/attributes`,
      categoryManagerToken,
    );
    assertStatus(categoryManagerAttributeListAllowed, 200, "category manager attribute list allowed in scope");
    assert(Array.isArray(categoryManagerAttributeListAllowed.payload), "expected category manager attribute list array");

    const categoryManagerAttributeCreated = await apiRequest(
      baseUrl,
      "POST",
      `/taxonomy/categories/${encodeURIComponent(category.payload.id)}/attributes`,
      categoryManagerToken,
      {
        name: `Scoped Material ${runId}`,
        key: `scoped_material_${runId}`,
        dataType: "text",
        required: false,
        appliesTo: "product",
      },
    );
    assertStatus(categoryManagerAttributeCreated, 201, "category manager attribute create allowed in scope");
    const categoryManagerAttributeId = String(categoryManagerAttributeCreated.payload?.id ?? "");
    assert(categoryManagerAttributeId.length > 10, "missing category manager attribute id");

    const categoryManagerAttributeUpdated = await apiRequest(
      baseUrl,
      "PATCH",
      `/taxonomy/categories/attributes/${encodeURIComponent(categoryManagerAttributeId)}`,
      categoryManagerToken,
      {
        name: `Scoped Material Updated ${runId}`,
        key: `scoped_material_${runId}`,
        dataType: "text",
        required: true,
        appliesTo: "product",
      },
    );
    assertStatus(categoryManagerAttributeUpdated, 200, "category manager attribute update allowed in scope");

    const categoryManagerAttributeDeleted = await apiRequest(
      baseUrl,
      "DELETE",
      `/taxonomy/categories/attributes/${encodeURIComponent(categoryManagerAttributeId)}`,
      categoryManagerToken,
    );
    assertStatus(categoryManagerAttributeDeleted, 200, "category manager attribute delete allowed in scope");

    const categoryManagerCategoryCreateDenied = await apiRequest(baseUrl, "POST", "/taxonomy/categories", categoryManagerToken, {
      name: `Category Manager Tree Mutation ${runId}`,
      parentId: category.payload.id,
    });
    assertStatus(categoryManagerCategoryCreateDenied, 403, "category manager denied taxonomy hierarchy create");
    assert(
      String(categoryManagerCategoryCreateDenied.payload?.reason ?? "") === "FOUNDATION_ROLE_BLOCKED",
      `expected FOUNDATION_ROLE_BLOCKED for category manager taxonomy create, got ${JSON.stringify(categoryManagerCategoryCreateDenied.payload)}`,
    );

    const categoryManagerProductList = await apiRequest(baseUrl, "GET", "/catalog/products?slim=true", categoryManagerToken);
    assertStatus(categoryManagerProductList, 200, "category manager product list allowed in scope");
    assert(
      Array.isArray(categoryManagerProductList.payload?.items) &&
        categoryManagerProductList.payload.items.some((item) => item.id === product.payload.id) &&
        categoryManagerProductList.payload.items.every((item) => item.id !== outOfScopeProduct.payload.id),
      `expected category manager product list to stay in scope, got ${JSON.stringify(categoryManagerProductList.payload)}`,
    );

    const categoryManagerProductDetailAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/catalog/products/${product.payload.id}`,
      categoryManagerToken,
    );
    assertStatus(categoryManagerProductDetailAllowed, 200, "category manager product detail allowed in scope");
    assert(
      categoryManagerProductDetailAllowed.payload?.attributes?.pricing?.sellingPrice === undefined,
      `expected category manager product detail to remain redacted, got ${JSON.stringify(categoryManagerProductDetailAllowed.payload)}`,
    );

    const categoryManagerProductDetailDenied = await apiRequest(
      baseUrl,
      "GET",
      `/catalog/products/${outOfScopeProduct.payload.id}`,
      categoryManagerToken,
    );
    assertStatus(categoryManagerProductDetailDenied, 403, "category manager product detail denied out of scope");
    assert(
      String(categoryManagerProductDetailDenied.payload?.reason ?? "") === "OBJECT_SCOPE_DENIED",
      `expected OBJECT_SCOPE_DENIED for category manager out-of-scope product detail, got ${JSON.stringify(categoryManagerProductDetailDenied.payload)}`,
    );

    const categoryManagerProductCreated = await apiRequest(baseUrl, "POST", "/catalog/products", categoryManagerToken, {
      title: `Scoped Category Manager Product ${runId}`,
      brand: "Aarika Looms",
      description: "Scoped product created by category manager",
      categoryId: category.payload.id,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 18,
      attributes: {
        merchandising: {
          texture: "woven",
        },
      },
    });
    assertStatus(categoryManagerProductCreated, 201, "category manager product create allowed in scope");

    const categoryManagerOutOfScopeCreateDenied = await apiRequest(baseUrl, "POST", "/catalog/products", categoryManagerToken, {
      title: `Out Of Scope Category Manager Product ${runId}`,
      brand: "Aarika Looms",
      description: "Should be denied outside assigned category scope",
      categoryId: outOfScopeCategory.payload.id,
      status: "draft",
      attributes: {},
    });
    assertStatus(categoryManagerOutOfScopeCreateDenied, 403, "category manager product create denied out of scope");
    assert(
      String(categoryManagerOutOfScopeCreateDenied.payload?.reason ?? "") === "OBJECT_SCOPE_DENIED",
      `expected OBJECT_SCOPE_DENIED for category manager out-of-scope product create, got ${JSON.stringify(categoryManagerOutOfScopeCreateDenied.payload)}`,
    );

    const categoryManagerProductUpdated = await apiRequest(
      baseUrl,
      "PATCH",
      `/catalog/products/${categoryManagerProductCreated.payload.id}`,
      categoryManagerToken,
      {
        expectedVersion: categoryManagerProductCreated.payload.version,
        title: `Scoped Category Manager Product Updated ${runId}`,
        brand: categoryManagerProductCreated.payload.brand,
        description: "Scoped product updated by category manager",
        categoryId: categoryManagerProductCreated.payload.categoryId,
        status: categoryManagerProductCreated.payload.status,
        hsnCode: categoryManagerProductCreated.payload.hsnCode,
        gstRate: categoryManagerProductCreated.payload.gstRate,
        attributes: categoryManagerProductCreated.payload.attributes ?? {},
      },
    );
    assertStatus(categoryManagerProductUpdated, 200, "category manager product update allowed in scope");

    const categoryManagerProductDeleted = await apiRequest(
      baseUrl,
      "DELETE",
      `/catalog/products/${categoryManagerProductCreated.payload.id}`,
      categoryManagerToken,
    );
    assertStatus(categoryManagerProductDeleted, 200, "category manager product delete allowed in scope");

    const vendorCatalogListAllowed = await apiRequest(baseUrl, "GET", "/catalog/products?slim=true", vendorToken);
    assertStatus(vendorCatalogListAllowed, 200, "vendor allowed catalog list on owned canonical path");
    assert(
      Array.isArray(vendorCatalogListAllowed.payload?.items) &&
        vendorCatalogListAllowed.payload.items.length === 1 &&
        vendorCatalogListAllowed.payload.items[0].id === product.payload.id,
      `expected vendor catalog list to contain only owned product, got ${JSON.stringify(vendorCatalogListAllowed.payload)}`,
    );

    const vendorCatalogDetailAllowed = await apiRequest(baseUrl, "GET", `/catalog/products/${product.payload.id}`, vendorToken);
    assertStatus(vendorCatalogDetailAllowed, 200, "vendor allowed owned catalog detail on canonical path");
    assert(
      vendorCatalogDetailAllowed.payload?.attributes?.pricing?.sellingPrice === undefined,
      `expected vendor catalog detail to stay redacted, got ${JSON.stringify(vendorCatalogDetailAllowed.payload)}`,
    );

    const vendorVariantListAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/catalog/products/${product.payload.id}/variants`,
      vendorToken,
    );
    assertStatus(vendorVariantListAllowed, 200, "vendor allowed owned variant list on canonical path");
    assert(
      Array.isArray(vendorVariantListAllowed.payload) &&
        vendorVariantListAllowed.payload.every(
          (variant) =>
            variant?.mrp === undefined && variant?.sellingPrice === undefined && variant?.inventoryQty === undefined,
        ),
      `expected vendor variant reads to stay redacted, got ${JSON.stringify(vendorVariantListAllowed.payload)}`,
    );

    const vendorCatalogDetailDenied = await apiRequest(
      baseUrl,
      "GET",
      `/catalog/products/${outOfScopeProduct.payload.id}`,
      vendorToken,
    );
    assertStatus(vendorCatalogDetailDenied, 403, "vendor denied unowned catalog detail");
    assert(
      String(vendorCatalogDetailDenied.payload?.reason ?? "") === "OBJECT_SCOPE_DENIED",
      `expected OBJECT_SCOPE_DENIED for vendor catalog detail, got ${JSON.stringify(vendorCatalogDetailDenied.payload)}`,
    );

    const vendorComplianceIssuesAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/compliance/products/${product.payload.id}/issues`,
      vendorToken,
    );
    assertStatus(vendorComplianceIssuesAllowed, 200, "vendor allowed owned compliance product issues on proven path");
    assert(
      Array.isArray(vendorComplianceIssuesAllowed.payload),
      `expected vendor owned compliance issues payload, got ${JSON.stringify(vendorComplianceIssuesAllowed.payload)}`,
    );

    const vendorComplianceIssuesDenied = await apiRequest(
      baseUrl,
      "GET",
      `/compliance/products/${outOfScopeProduct.payload.id}/issues`,
      vendorToken,
    );
    assertStatus(vendorComplianceIssuesDenied, 403, "vendor denied unowned compliance product issues");
    assert(
      String(vendorComplianceIssuesDenied.payload?.reason ?? "") === "OBJECT_SCOPE_DENIED",
      `expected OBJECT_SCOPE_DENIED for vendor compliance issues, got ${JSON.stringify(vendorComplianceIssuesDenied.payload)}`,
    );

    const vendorRejectionScoreAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/rejection-intelligence/products/${product.payload.id}/score?channel=shopify`,
      vendorToken,
    );
    assertStatus(vendorRejectionScoreAllowed, 200, "vendor allowed owned rejection score on proven path");
    assert(
      typeof vendorRejectionScoreAllowed.payload?.riskScore === "number",
      `expected vendor rejection score payload, got ${JSON.stringify(vendorRejectionScoreAllowed.payload)}`,
    );

    const vendorAutoSuggestionAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/auto-suggestions/products/${product.payload.id}/title-suggestion`,
      vendorToken,
    );
    assertStatus(vendorAutoSuggestionAllowed, 200, "vendor allowed owned auto-suggestion on proven path");
    assert(
      String(vendorAutoSuggestionAllowed.payload?.productId ?? "") === String(product.payload.id),
      `expected vendor auto-suggestion payload, got ${JSON.stringify(vendorAutoSuggestionAllowed.payload)}`,
    );

    const vendorAutoSuggestionAttributeAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/auto-suggestions/products/${product.payload.id}/attribute-enrichment`,
      vendorToken,
    );
    assertStatus(vendorAutoSuggestionAttributeAllowed, 200, "vendor allowed owned auto-suggestion attribute on proven path");
    assert(
      String(vendorAutoSuggestionAttributeAllowed.payload?.productId ?? "") === String(product.payload.id),
      `expected vendor auto-suggestion attribute payload, got ${JSON.stringify(vendorAutoSuggestionAttributeAllowed.payload)}`,
    );

    const vendorAutoSuggestionCategoryAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/auto-suggestions/products/${product.payload.id}/category-suggestion`,
      vendorToken,
    );
    assertStatus(vendorAutoSuggestionCategoryAllowed, 200, "vendor allowed owned auto-suggestion category on proven path");
    assert(
      String(vendorAutoSuggestionCategoryAllowed.payload?.productId ?? "") === String(product.payload.id),
      `expected vendor auto-suggestion category payload, got ${JSON.stringify(vendorAutoSuggestionCategoryAllowed.payload)}`,
    );

    const vendorRejectionScoreDenied = await apiRequest(
      baseUrl,
      "GET",
      `/rejection-intelligence/products/${outOfScopeProduct.payload.id}/score?channel=shopify`,
      vendorToken,
    );
    assertStatus(vendorRejectionScoreDenied, 403, "vendor denied unowned rejection score");
    assert(
      String(vendorRejectionScoreDenied.payload?.reason ?? "") === "OBJECT_SCOPE_DENIED",
      `expected OBJECT_SCOPE_DENIED for vendor rejection score, got ${JSON.stringify(vendorRejectionScoreDenied.payload)}`,
    );

    const vendorAutoSuggestionDenied = await apiRequest(
      baseUrl,
      "GET",
      `/auto-suggestions/products/${outOfScopeProduct.payload.id}/title-suggestion`,
      vendorToken,
    );
    assertStatus(vendorAutoSuggestionDenied, 403, "vendor denied unowned auto-suggestion");
    assert(
      String(vendorAutoSuggestionDenied.payload?.reason ?? "") === "OBJECT_SCOPE_DENIED",
      `expected OBJECT_SCOPE_DENIED for vendor auto-suggestion, got ${JSON.stringify(vendorAutoSuggestionDenied.payload)}`,
    );

    const vendorAutoSuggestionAttributeDenied = await apiRequest(
      baseUrl,
      "GET",
      `/auto-suggestions/products/${outOfScopeProduct.payload.id}/attribute-enrichment`,
      vendorToken,
    );
    assertStatus(vendorAutoSuggestionAttributeDenied, 403, "vendor denied unowned auto-suggestion attribute");
    assert(
      String(vendorAutoSuggestionAttributeDenied.payload?.reason ?? "") === "OBJECT_SCOPE_DENIED",
      `expected OBJECT_SCOPE_DENIED for vendor auto-suggestion attribute, got ${JSON.stringify(vendorAutoSuggestionAttributeDenied.payload)}`,
    );

    const vendorAutoSuggestionCategoryDenied = await apiRequest(
      baseUrl,
      "GET",
      `/auto-suggestions/products/${outOfScopeProduct.payload.id}/category-suggestion`,
      vendorToken,
    );
    assertStatus(vendorAutoSuggestionCategoryDenied, 403, "vendor denied unowned auto-suggestion category");
    assert(
      String(vendorAutoSuggestionCategoryDenied.payload?.reason ?? "") === "OBJECT_SCOPE_DENIED",
      `expected OBJECT_SCOPE_DENIED for vendor auto-suggestion category, got ${JSON.stringify(vendorAutoSuggestionCategoryDenied.payload)}`,
    );

    const vendorMediaListAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/media/assets?productId=${encodeURIComponent(product.payload.id)}`,
      vendorToken,
    );
    assertStatus(vendorMediaListAllowed, 200, "vendor allowed owned media list on proven path");
    assert(
      Array.isArray(vendorMediaListAllowed.payload) &&
        vendorMediaListAllowed.payload.length === 1 &&
        vendorMediaListAllowed.payload[0].id === ownedMediaAsset.payload.id,
      `expected vendor media list to contain only owned asset, got ${JSON.stringify(vendorMediaListAllowed.payload)}`,
    );

    const vendorMediaDetailAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/media/assets/${ownedMediaAsset.payload.id}`,
      vendorToken,
    );
    assertStatus(vendorMediaDetailAllowed, 200, "vendor allowed owned media detail on proven path");
    assert(
      String(vendorMediaDetailAllowed.payload?.id ?? "") === String(ownedMediaAsset.payload.id),
      `expected vendor media detail payload, got ${JSON.stringify(vendorMediaDetailAllowed.payload)}`,
    );

    const vendorMediaValidationAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/media/assets/${ownedMediaAsset.payload.id}/validation?channel=shopify`,
      vendorToken,
    );
    assertStatus(vendorMediaValidationAllowed, 200, "vendor allowed owned media validation on proven path");
    assert(
      String(vendorMediaValidationAllowed.payload?.channel ?? "") === "shopify",
      `expected vendor media validation payload, got ${JSON.stringify(vendorMediaValidationAllowed.payload)}`,
    );

    const vendorMediaDetailDenied = await apiRequest(
      baseUrl,
      "GET",
      `/media/assets/${outOfScopeMediaAsset.payload.id}`,
      vendorToken,
    );
    assertStatus(vendorMediaDetailDenied, 403, "vendor denied unowned media detail");
    assert(
      String(vendorMediaDetailDenied.payload?.reason ?? "") === "OBJECT_SCOPE_DENIED",
      `expected OBJECT_SCOPE_DENIED for vendor media detail, got ${JSON.stringify(vendorMediaDetailDenied.payload)}`,
    );

    const vendorCatalogCreateDenied = await apiRequest(baseUrl, "POST", "/catalog/products", vendorToken, {
      title: `Vendor Create Denied ${runId}`,
      brand: "Aarika Looms",
      description: "Vendor write should remain blocked",
      categoryId: category.payload.id,
      vendorScopeKey: "aarika-vendor",
      status: "draft",
      attributes: {},
    });
    assertStatus(vendorCatalogCreateDenied, 403, "vendor catalog create remains blocked outside proven path");

    const vendorTaxonomyMetadataDenied = await apiRequest(baseUrl, "GET", "/taxonomy/categories?all=true", vendorToken);
    assertStatus(vendorTaxonomyMetadataDenied, 403, "vendor denied taxonomy metadata outside proven path");
    assert(
      String(vendorTaxonomyMetadataDenied.payload?.reason ?? "") === "FOUNDATION_ROLE_BLOCKED",
      `expected FOUNDATION_ROLE_BLOCKED for vendor taxonomy metadata, got ${JSON.stringify(vendorTaxonomyMetadataDenied.payload)}`,
    );

    const viewerCatalogDetail = await apiRequest(baseUrl, "GET", `/catalog/products/${product.payload.id}`, viewerToken);
    assertStatus(viewerCatalogDetail, 200, "viewer product detail allowed with redaction");
    assert(
      viewerCatalogDetail.payload?.attributes?.pricing?.mrp === undefined,
      `expected viewer product detail to redact pricing.mrp, got ${JSON.stringify(viewerCatalogDetail.payload)}`,
    );
    assert(
      viewerCatalogDetail.payload?.attributes?.pricing?.sellingPrice === undefined,
      `expected viewer product detail to redact pricing.sellingPrice, got ${JSON.stringify(viewerCatalogDetail.payload)}`,
    );
    assert(
      viewerCatalogDetail.payload?.attributes?.inventoryQty === undefined,
      `expected viewer product detail to redact inventoryQty, got ${JSON.stringify(viewerCatalogDetail.payload)}`,
    );

    const viewerLegacyAliasDetail = await apiRequest(baseUrl, "GET", `/products/${product.payload.id}`, viewerToken);
    assertStatus(viewerLegacyAliasDetail, 200, "viewer legacy product alias detail allowed with redaction");
    assert(
      viewerLegacyAliasDetail.payload?.attributes?.pricing?.sellingPrice === undefined,
      `expected legacy product alias detail to redact pricing fields, got ${JSON.stringify(viewerLegacyAliasDetail.payload)}`,
    );

    const viewerVariantsRead = await apiRequest(baseUrl, "GET", `/catalog/products/${product.payload.id}/variants`, viewerToken);
    assertStatus(viewerVariantsRead, 200, "viewer variants allowed with redaction");
    assert(Array.isArray(viewerVariantsRead.payload), `expected variants array, got ${JSON.stringify(viewerVariantsRead.payload)}`);
    assert(viewerVariantsRead.payload.length >= 1, "expected at least one variant in viewer read");
    assert(
      viewerVariantsRead.payload.every(
        (variant) =>
          variant?.mrp === undefined && variant?.sellingPrice === undefined && variant?.inventoryQty === undefined,
      ),
      `expected viewer variant reads to redact pricing and inventory fields, got ${JSON.stringify(viewerVariantsRead.payload)}`,
    );

    const viewerSearchResults = await apiRequest(
      baseUrl,
      "GET",
      `/catalog/products/search?q=${encodeURIComponent(`VAR-${runId}`)}&limit=5`,
      viewerToken,
    );
    assertStatus(viewerSearchResults, 200, "viewer catalog search allowed with redaction");
    assert(
      Array.isArray(viewerSearchResults.payload) && viewerSearchResults.payload.length >= 1,
      `expected viewer catalog search results, got ${JSON.stringify(viewerSearchResults.payload)}`,
    );
    assert(
      viewerSearchResults.payload.every((item) => item?.matchedSku === undefined),
      `expected viewer catalog search to redact matched SKU, got ${JSON.stringify(viewerSearchResults.payload)}`,
    );

    const adminCatalogDetail = await apiRequest(baseUrl, "GET", `/catalog/products/${product.payload.id}`, adminToken);
    assertStatus(adminCatalogDetail, 200, "admin product detail allowed");
    assert(
      Number(adminCatalogDetail.payload?.attributes?.pricing?.sellingPrice ?? 0) === 1499,
      `expected admin product detail to retain pricing fields, got ${JSON.stringify(adminCatalogDetail.payload)}`,
    );
    assert(
      Number(adminCatalogDetail.payload?.variants?.[0]?.sellingPrice ?? 0) === 1399,
      `expected admin product detail to retain variant pricing fields, got ${JSON.stringify(adminCatalogDetail.payload?.variants)}`,
    );

    const adminSearchResults = await apiRequest(
      baseUrl,
      "GET",
      `/catalog/products/search?q=${encodeURIComponent(`VAR-${runId}`)}&limit=5`,
      adminToken,
    );
    assertStatus(adminSearchResults, 200, "admin catalog search allowed");
    assert(
      adminSearchResults.payload.some((item) => String(item?.matchedSku ?? "") === `VAR-${runId}`),
      `expected admin catalog search to retain matched SKU, got ${JSON.stringify(adminSearchResults.payload)}`,
    );

    // Editor CAN update non-pricing variant fields (sku, inventoryQty, status)
    const editorVariantUpdateAllowed = await apiRequest(
      baseUrl,
      "PATCH",
      `/catalog/variants/${adminVariantCreate.payload.id}`,
      editorToken,
      {
        skuCode: adminVariantCreate.payload.skuCode,
        mrp: adminVariantCreate.payload.mrp,
        sellingPrice: adminVariantCreate.payload.sellingPrice,
        inventoryQty: 5,
        status: adminVariantCreate.payload.status,
        attributes: adminVariantCreate.payload.attributes ?? {},
      },
    );
    assertStatus(editorVariantUpdateAllowed, 200, "editor non-pricing variant update allowed");

    // Editor CANNOT update pricing fields (mrp, sellingPrice)
    const editorVariantPricingDenied = await apiRequest(
      baseUrl,
      "PATCH",
      `/catalog/variants/${adminVariantCreate.payload.id}`,
      editorToken,
      {
        skuCode: adminVariantCreate.payload.skuCode,
        mrp: 2999,
        sellingPrice: adminVariantCreate.payload.sellingPrice,
        inventoryQty: 5,
        status: adminVariantCreate.payload.status,
        attributes: adminVariantCreate.payload.attributes ?? {},
      },
    );
    assertStatus(editorVariantPricingDenied, 403, "editor pricing variant update denied");
    assert(
      String(editorVariantPricingDenied.payload?.error ?? "") === "ACCESS_POLICY_DENIED",
      `expected ACCESS_POLICY_DENIED for pricing variant update, got ${JSON.stringify(editorVariantPricingDenied.payload)}`,
    );

    // Editor CANNOT delete variants
    const editorVariantDeleteDenied = await apiRequest(
      baseUrl,
      "DELETE",
      `/catalog/variants/${adminVariantCreate.payload.id}`,
      editorToken,
    );
    assertStatus(editorVariantDeleteDenied, 403, "editor variant delete denied");
    assert(
      String(editorVariantDeleteDenied.payload?.error ?? "") === "ACCESS_POLICY_DENIED",
      `expected ACCESS_POLICY_DENIED for variant delete, got ${JSON.stringify(editorVariantDeleteDenied.payload)}`,
    );

    const editorBulkEditDenied = await apiRequest(baseUrl, "POST", "/bulk-edit/apply", editorToken, {
      scope: { productIds: [product.payload.id] },
      updates: { status: "in_review" },
    });
    assertStatus(editorBulkEditDenied, 403, "editor bulk edit restricted field denied");
    assert(
      String(editorBulkEditDenied.payload?.error ?? "") === "ACCESS_POLICY_DENIED",
      "expected ACCESS_POLICY_DENIED for editor bulk edit restricted field",
    );

    const adminBulkEditAllowed = await apiRequest(baseUrl, "POST", "/bulk-edit/apply", adminToken, {
      scope: { productIds: [product.payload.id] },
      updates: { status: "in_review" },
    });
    assert(
      adminBulkEditAllowed.status === 200 || adminBulkEditAllowed.status === 201,
      `admin bulk edit status update failed: got ${adminBulkEditAllowed.status} payload=${JSON.stringify(adminBulkEditAllowed.payload)}`,
    );
    assert(Number(adminBulkEditAllowed.payload?.appliedCount ?? 0) === 1, "expected admin bulk edit to apply exactly once");

    const editorBulkImportDenied = await apiRequest(baseUrl, "POST", "/bulk-import/jobs", editorToken, {
      categoryId: category.payload.id,
      sourceFormat: "json",
      rows: [
        {
          title: `Restricted Import ${runId}`,
          description: "Editor should not import restricted status field",
          brand: "Aarika Looms",
          status: "draft",
          hsnCode: "62046200",
          gstRate: 18,
          attributes: {},
        },
      ],
      chunkSize: 1,
      maxRetries: 1,
    });
    assertStatus(editorBulkImportDenied, 403, "editor bulk import restricted field denied");
    assert(
      String(editorBulkImportDenied.payload?.error ?? "") === "ACCESS_POLICY_DENIED",
      "expected ACCESS_POLICY_DENIED for editor bulk import restricted field",
    );

    const viewerConnectorInstallDenied = await apiRequest(baseUrl, "POST", "/connectors/amazon-in/install", viewerToken, {
      accountAlias: "viewer-attempt",
    });
    assertStatus(viewerConnectorInstallDenied, 403, "viewer denied connector install");

    const reviewerConnectorInstallDenied = await apiRequest(baseUrl, "POST", "/connectors/amazon-in/install", reviewerToken, {
      accountAlias: "reviewer-attempt",
    });
    assertStatus(reviewerConnectorInstallDenied, 403, "reviewer denied connector install");

    const viewerBulkImportJobsDenied = await apiRequest(baseUrl, "GET", "/bulk-import/jobs", viewerToken);
    assertStatus(viewerBulkImportJobsDenied, 403, "viewer denied bulk import jobs");

    const reviewerBulkImportJobsDenied = await apiRequest(baseUrl, "GET", "/bulk-import/jobs", reviewerToken);
    assertStatus(reviewerBulkImportJobsDenied, 403, "reviewer denied bulk import jobs");

    const editorBulkImportJobsAllowed = await apiRequest(baseUrl, "GET", "/bulk-import/jobs", editorToken);
    assertStatus(editorBulkImportJobsAllowed, 200, "editor allowed bulk import jobs");

    const adminBulkImportVisibilityJob = await apiRequest(baseUrl, "POST", "/bulk-import/jobs", adminToken, {
      categoryId: category.payload.id,
      sourceFormat: "json",
      rows: [
        {
          description: "Admin-only source payload visibility fixture",
          brand: "Aarika Looms",
          status: "draft",
          attributes: {
            sku: `BULK-ROW-SKU-${runId}`,
            pricing: {
              mrp: 1999,
              sellingPrice: 1499,
              cost: 999,
              inventoryQty: 11,
            },
          },
        },
      ],
      chunkSize: 1,
      maxRetries: 1,
    });
    assertStatus(adminBulkImportVisibilityJob, 201, "create bulk import visibility fixture job");
    const bulkImportVisibilityJobId = String(adminBulkImportVisibilityJob.payload?.id ?? "");
    assert(bulkImportVisibilityJobId.length > 10, "missing bulk import visibility fixture job id");

    const adminBulkImportVisibilityProcess = await apiRequest(
      baseUrl,
      "POST",
      `/bulk-import/jobs/${encodeURIComponent(bulkImportVisibilityJobId)}/process`,
      adminToken,
      { chunkSize: 1 },
    );
    assert(
      adminBulkImportVisibilityProcess.status === 200 || adminBulkImportVisibilityProcess.status === 201,
      `process bulk import visibility fixture job failed: got ${adminBulkImportVisibilityProcess.status} payload=${JSON.stringify(adminBulkImportVisibilityProcess.payload)}`,
    );

    const adminBulkImportVisibilityRows = await apiRequest(
      baseUrl,
      "GET",
      `/bulk-import/jobs/${encodeURIComponent(bulkImportVisibilityJobId)}/rows?limit=10`,
      adminToken,
    );
    assertStatus(adminBulkImportVisibilityRows, 200, "admin allowed bulk import row visibility fixture read");
    const adminBulkImportVisibilityRow = Array.isArray(adminBulkImportVisibilityRows.payload)
      ? adminBulkImportVisibilityRows.payload[0]
      : null;
    assert(
      adminBulkImportVisibilityRow &&
        adminBulkImportVisibilityRow.payload?.status === "draft" &&
        Number(adminBulkImportVisibilityRow.payload?.attributes?.pricing?.mrp ?? 0) === 1999 &&
        String(adminBulkImportVisibilityRow.payload?.attributes?.sku ?? "") === `BULK-ROW-SKU-${runId}`,
      `expected admin bulk import rows to retain full source payload, got ${JSON.stringify(adminBulkImportVisibilityRow)}`,
    );

    const editorBulkImportVisibilityRows = await apiRequest(
      baseUrl,
      "GET",
      `/bulk-import/jobs/${encodeURIComponent(bulkImportVisibilityJobId)}/rows?limit=10`,
      editorToken,
    );
    assertStatus(editorBulkImportVisibilityRows, 200, "editor allowed bulk import row visibility fixture read");
    const editorBulkImportVisibilityRow = Array.isArray(editorBulkImportVisibilityRows.payload)
      ? editorBulkImportVisibilityRows.payload[0]
      : null;
    assert(
      editorBulkImportVisibilityRow &&
        !("status" in (editorBulkImportVisibilityRow.payload ?? {})) &&
        editorBulkImportVisibilityRow.payload?.attributes?.pricing == null &&
        !("sku" in (editorBulkImportVisibilityRow.payload?.attributes ?? {})),
      `expected editor bulk import rows to redact sensitive source payload fields, got ${JSON.stringify(editorBulkImportVisibilityRow)}`,
    );
    assert(
      Array.isArray(editorBulkImportVisibilityRow?.redactedFields) &&
        editorBulkImportVisibilityRow.redactedFields.includes("payload.status") &&
        editorBulkImportVisibilityRow.redactedFields.includes("payload.attributes.pricing.mrp") &&
        editorBulkImportVisibilityRow.redactedFields.includes("payload.attributes.sku"),
      `expected editor bulk import rows to expose payload redactedFields, got ${JSON.stringify(editorBulkImportVisibilityRow)}`,
    );

    const adminBulkImportVisibilityErrorReport = await apiRequest(
      baseUrl,
      "GET",
      `/bulk-import/jobs/${encodeURIComponent(bulkImportVisibilityJobId)}/error-report`,
      adminToken,
      undefined,
      { Accept: "text/csv" },
    );
    assertStatus(adminBulkImportVisibilityErrorReport, 200, "admin allowed bulk import error report visibility fixture read");
    const adminBulkImportVisibilityCsv = String(adminBulkImportVisibilityErrorReport.payload ?? "");
    assert(
      adminBulkImportVisibilityCsv.includes(`BULK-ROW-SKU-${runId}`) &&
        adminBulkImportVisibilityCsv.includes("draft") &&
        adminBulkImportVisibilityCsv.includes("1999"),
      `expected admin bulk import error report to retain full source payload, got ${adminBulkImportVisibilityCsv}`,
    );

    const editorBulkImportVisibilityErrorReport = await apiRequest(
      baseUrl,
      "GET",
      `/bulk-import/jobs/${encodeURIComponent(bulkImportVisibilityJobId)}/error-report`,
      editorToken,
      undefined,
      { Accept: "text/csv" },
    );
    assertStatus(editorBulkImportVisibilityErrorReport, 200, "editor allowed bulk import error report visibility fixture read");
    const editorBulkImportVisibilityCsv = String(editorBulkImportVisibilityErrorReport.payload ?? "");
    assert(
      !editorBulkImportVisibilityCsv.includes(`BULK-ROW-SKU-${runId}`) &&
        !editorBulkImportVisibilityCsv.includes("draft") &&
        !editorBulkImportVisibilityCsv.includes("1999"),
      `expected editor bulk import error report to redact sensitive source payload fields, got ${editorBulkImportVisibilityCsv}`,
    );

    const viewerBulkEditOperationsDenied = await apiRequest(baseUrl, "GET", "/bulk-edit/operations", viewerToken);
    assertStatus(viewerBulkEditOperationsDenied, 403, "viewer denied bulk edit operations");

    const reviewerBulkEditOperationsDenied = await apiRequest(baseUrl, "GET", "/bulk-edit/operations", reviewerToken);
    assertStatus(reviewerBulkEditOperationsDenied, 403, "reviewer denied bulk edit operations");

    const editorBulkEditOperationsAllowed = await apiRequest(baseUrl, "GET", "/bulk-edit/operations", editorToken);
    assertStatus(editorBulkEditOperationsAllowed, 200, "editor allowed bulk edit operations");

    const viewerAuditLogsDenied = await apiRequest(baseUrl, "GET", "/audit/logs?limit=10", viewerToken);
    assertStatus(viewerAuditLogsDenied, 403, "viewer denied audit logs");

    const reviewerAuditLogsDenied = await apiRequest(baseUrl, "GET", "/audit/logs?limit=10", reviewerToken);
    assertStatus(reviewerAuditLogsDenied, 403, "reviewer denied audit logs");

    const editorAuditLogsDenied = await apiRequest(baseUrl, "GET", "/audit/logs?limit=10", editorToken);
    assertStatus(editorAuditLogsDenied, 403, "editor denied audit logs");

    const adminAuditLogsAllowed = await apiRequest(baseUrl, "GET", "/audit/logs?limit=10", adminToken);
    assertStatus(adminAuditLogsAllowed, 200, "admin allowed audit logs");
    assert(
      Array.isArray(adminAuditLogsAllowed.payload),
      `expected admin audit logs payload, got ${JSON.stringify(adminAuditLogsAllowed.payload)}`,
    );

    const installAmazon = await apiRequest(baseUrl, "POST", "/connectors/amazon-in/install", adminToken, {
      accountAlias: "primary",
    });
    assertStatus(installAmazon, 201, "install amazon connector");
    const installationId = String(installAmazon.payload?.id ?? "");
    assert(installationId.length > 10, "missing installation id");

    const viewerInstalledDenied = await apiRequest(baseUrl, "GET", "/connectors/installed?limit=50", viewerToken);
    assertStatus(viewerInstalledDenied, 403, "viewer denied installed connectors");

    const viewerBillingUsageDenied = await apiRequest(baseUrl, "GET", "/billing/usage", viewerToken);
    assertStatus(viewerBillingUsageDenied, 403, "viewer denied billing usage");

    const reviewerBillingUsageDenied = await apiRequest(baseUrl, "GET", "/billing/usage", reviewerToken);
    assertStatus(reviewerBillingUsageDenied, 403, "reviewer denied billing usage");

    const editorBillingUsageAllowed = await apiRequest(baseUrl, "GET", "/billing/usage", editorToken);
    assertStatus(editorBillingUsageAllowed, 200, "editor allowed billing usage");
    assert(
      typeof editorBillingUsageAllowed.payload?.planTier === "string",
      `expected editor billing usage payload, got ${JSON.stringify(editorBillingUsageAllowed.payload)}`,
    );

    const adminBillingUsageAllowed = await apiRequest(baseUrl, "GET", "/billing/usage", adminToken);
    assertStatus(adminBillingUsageAllowed, 200, "admin allowed billing usage");
    assert(
      typeof adminBillingUsageAllowed.payload?.billingStatus === "string",
      `expected admin billing usage payload, got ${JSON.stringify(adminBillingUsageAllowed.payload)}`,
    );

    const viewerBillingPlanProfileDenied = await apiRequest(baseUrl, "GET", "/billing/plan-profile", viewerToken);
    assertStatus(viewerBillingPlanProfileDenied, 403, "viewer denied billing plan profile");

    const reviewerBillingPlanProfileDenied = await apiRequest(baseUrl, "GET", "/billing/plan-profile", reviewerToken);
    assertStatus(reviewerBillingPlanProfileDenied, 403, "reviewer denied billing plan profile");

    const editorBillingPlanProfileDenied = await apiRequest(baseUrl, "GET", "/billing/plan-profile", editorToken);
    assertStatus(editorBillingPlanProfileDenied, 403, "editor denied billing plan profile");

    const adminBillingPlanProfileAllowed = await apiRequest(baseUrl, "GET", "/billing/plan-profile", adminToken);
    assertStatus(adminBillingPlanProfileAllowed, 200, "admin allowed billing plan profile");
    assert(
      typeof adminBillingPlanProfileAllowed.payload?.tenantKey === "string",
      `expected admin billing plan profile payload, got ${JSON.stringify(adminBillingPlanProfileAllowed.payload)}`,
    );

    const viewerBillingUpgradeRequestDenied = await apiRequest(baseUrl, "GET", "/billing/upgrade-request", viewerToken);
    assertStatus(viewerBillingUpgradeRequestDenied, 403, "viewer denied billing upgrade request");

    const reviewerBillingUpgradeRequestDenied = await apiRequest(baseUrl, "GET", "/billing/upgrade-request", reviewerToken);
    assertStatus(reviewerBillingUpgradeRequestDenied, 403, "reviewer denied billing upgrade request");

    const editorBillingUpgradeRequestDenied = await apiRequest(baseUrl, "GET", "/billing/upgrade-request", editorToken);
    assertStatus(editorBillingUpgradeRequestDenied, 403, "editor denied billing upgrade request");

    const adminBillingUpgradeRequestAllowed = await apiRequest(baseUrl, "GET", "/billing/upgrade-request", adminToken);
    assertStatus(adminBillingUpgradeRequestAllowed, 200, "admin allowed billing upgrade request");
    assert(
      Object.prototype.hasOwnProperty.call(adminBillingUpgradeRequestAllowed.payload ?? {}, "item"),
      `expected admin billing upgrade request payload, got ${JSON.stringify(adminBillingUpgradeRequestAllowed.payload)}`,
    );

    const viewerPrivacyStatusAllowed = await apiRequest(baseUrl, "GET", "/auth/account/privacy-status", viewerToken);
    assertStatus(viewerPrivacyStatusAllowed, 200, "viewer allowed account privacy status");
    assert(
      String(viewerPrivacyStatusAllowed.payload?.userId ?? "") === viewerUser,
      `expected viewer privacy status payload for viewer user, got ${JSON.stringify(viewerPrivacyStatusAllowed.payload)}`,
    );

    const viewerAccountExportRequested = await apiRequest(baseUrl, "POST", "/auth/account/export", viewerToken, {
      format: "json",
    });
    assertStatus(viewerAccountExportRequested, 202, "viewer allowed account export request");
    const viewerExportJobId = String(viewerAccountExportRequested.payload?.jobId ?? "");
    assert(
      viewerExportJobId.startsWith("exp_"),
      `expected account export job id, got ${JSON.stringify(viewerAccountExportRequested.payload)}`,
    );

    const viewerAccountExportDownloadUnavailable = await apiRequest(
      baseUrl,
      "GET",
      `/auth/account/export/${encodeURIComponent(viewerExportJobId)}/download`,
      viewerToken,
    );
    assertStatus(viewerAccountExportDownloadUnavailable, 202, "viewer account export download returns queued or unavailable state");
    assert(
      String(viewerAccountExportDownloadUnavailable.payload?.status ?? "") === "unavailable",
      `expected queued export download to remain unavailable, got ${JSON.stringify(viewerAccountExportDownloadUnavailable.payload)}`,
    );

    const viewerCatalogStatsAllowed = await apiRequest(baseUrl, "GET", "/catalog/stats", viewerToken);
    assertStatus(viewerCatalogStatsAllowed, 200, "viewer allowed catalog stats with redaction");
    assert(
      Array.isArray(viewerCatalogStatsAllowed.payload?.redactedSections) &&
        viewerCatalogStatsAllowed.payload.redactedSections.includes("approval_queue"),
      `expected viewer catalog stats to redact approval queue, got ${JSON.stringify(viewerCatalogStatsAllowed.payload)}`,
    );
    assert(
      Number(viewerCatalogStatsAllowed.payload?.pendingApprovals ?? -1) === 0,
      `expected viewer catalog stats to zero approval queue, got ${JSON.stringify(viewerCatalogStatsAllowed.payload)}`,
    );

    const reviewerCatalogStatsAllowed = await apiRequest(baseUrl, "GET", "/catalog/stats", reviewerToken);
    assertStatus(reviewerCatalogStatsAllowed, 200, "reviewer allowed catalog stats");
    assert(
      Array.isArray(reviewerCatalogStatsAllowed.payload?.redactedSections) &&
        !reviewerCatalogStatsAllowed.payload.redactedSections.includes("approval_queue"),
      `expected reviewer catalog stats to retain approval queue, got ${JSON.stringify(reviewerCatalogStatsAllowed.payload)}`,
    );
    assert(
      Number(reviewerCatalogStatsAllowed.payload?.pendingApprovals ?? 0) >= 1,
      `expected reviewer catalog stats to retain nonzero approval queue, got ${JSON.stringify(reviewerCatalogStatsAllowed.payload)}`,
    );

    const adminCatalogStatsAllowed = await apiRequest(baseUrl, "GET", "/catalog/stats", adminToken);
    assertStatus(adminCatalogStatsAllowed, 200, "admin allowed catalog stats");
    assert(
      Number(adminCatalogStatsAllowed.payload?.pendingApprovals ?? 0) >= 1,
      `expected admin catalog stats to retain approval queue, got ${JSON.stringify(adminCatalogStatsAllowed.payload)}`,
    );

    const viewerDashboardReadinessDenied = await apiRequest(baseUrl, "GET", "/dashboard/readiness", viewerToken);
    assertStatus(viewerDashboardReadinessDenied, 403, "viewer denied dashboard readiness");

    const reviewerDashboardReadinessDenied = await apiRequest(baseUrl, "GET", "/dashboard/readiness", reviewerToken);
    assertStatus(reviewerDashboardReadinessDenied, 403, "reviewer denied dashboard readiness");

    const editorDashboardReadinessAllowed = await apiRequest(baseUrl, "GET", "/dashboard/readiness", editorToken);
    assertStatus(editorDashboardReadinessAllowed, 200, "editor allowed dashboard readiness");
    assert(
      Array.isArray(editorDashboardReadinessAllowed.payload?.connectors),
      `expected editor dashboard readiness payload, got ${JSON.stringify(editorDashboardReadinessAllowed.payload)}`,
    );

    const adminDashboardReadinessAllowed = await apiRequest(baseUrl, "GET", "/dashboard/readiness", adminToken);
    assertStatus(adminDashboardReadinessAllowed, 200, "admin allowed dashboard readiness");
    assert(
      typeof adminDashboardReadinessAllowed.payload?.asOf === "string",
      `expected admin dashboard readiness payload, got ${JSON.stringify(adminDashboardReadinessAllowed.payload)}`,
    );

    const viewerCatalogHealthDenied = await apiRequest(baseUrl, "GET", "/dashboard/catalog-health", viewerToken);
    assertStatus(viewerCatalogHealthDenied, 403, "viewer denied dashboard catalog health");

    const reviewerCatalogHealthDenied = await apiRequest(baseUrl, "GET", "/dashboard/catalog-health", reviewerToken);
    assertStatus(reviewerCatalogHealthDenied, 403, "reviewer denied dashboard catalog health");

    const editorCatalogHealthAllowed = await apiRequest(baseUrl, "GET", "/dashboard/catalog-health", editorToken);
    assertStatus(editorCatalogHealthAllowed, 200, "editor allowed dashboard catalog health");
    assert(
      typeof editorCatalogHealthAllowed.payload?.averageCompleteness === "number",
      `expected editor dashboard catalog health payload, got ${JSON.stringify(editorCatalogHealthAllowed.payload)}`,
    );

    const adminCatalogHealthAllowed = await apiRequest(baseUrl, "GET", "/dashboard/catalog-health", adminToken);
    assertStatus(adminCatalogHealthAllowed, 200, "admin allowed dashboard catalog health");
    assert(
      Array.isArray(adminCatalogHealthAllowed.payload?.distribution),
      `expected admin dashboard catalog health payload, got ${JSON.stringify(adminCatalogHealthAllowed.payload)}`,
    );

    const viewerDashboardHealthAllowed = await apiRequest(baseUrl, "GET", "/dashboard/health", viewerToken);
    assertStatus(viewerDashboardHealthAllowed, 200, "viewer allowed dashboard health with redaction");
    assert(
      Array.isArray(viewerDashboardHealthAllowed.payload?.redactedSections) &&
        viewerDashboardHealthAllowed.payload.redactedSections.includes("connector_breakdown"),
      `expected viewer dashboard health to redact connector breakdown, got ${JSON.stringify(viewerDashboardHealthAllowed.payload)}`,
    );
    assert(
      viewerDashboardHealthAllowed.payload.redactedSections.includes("approval_queue"),
      `expected viewer dashboard health to redact approval queue, got ${JSON.stringify(viewerDashboardHealthAllowed.payload)}`,
    );
    assert(
      Object.keys(viewerDashboardHealthAllowed.payload?.snapshot?.publishReadyByConnector ?? {}).length === 0,
      `expected viewer dashboard health to remove per-connector readiness, got ${JSON.stringify(viewerDashboardHealthAllowed.payload)}`,
    );
    assert(
      Object.keys(viewerDashboardHealthAllowed.payload?.snapshot?.blockedByConnector ?? {}).length === 0,
      `expected viewer dashboard health to remove per-connector blocked counts, got ${JSON.stringify(viewerDashboardHealthAllowed.payload)}`,
    );
    assert(
      Number(viewerDashboardHealthAllowed.payload?.pendingApprovals ?? -1) === 0,
      `expected viewer dashboard health to zero approval queue, got ${JSON.stringify(viewerDashboardHealthAllowed.payload)}`,
    );
    assert(
      typeof viewerDashboardHealthAllowed.payload?.publishReadyTotal === "number" &&
        typeof viewerDashboardHealthAllowed.payload?.blockedTotal === "number",
      `expected viewer dashboard health to retain aggregate totals, got ${JSON.stringify(viewerDashboardHealthAllowed.payload)}`,
    );

    const reviewerDashboardHealthAllowed = await apiRequest(baseUrl, "GET", "/dashboard/health", reviewerToken);
    assertStatus(reviewerDashboardHealthAllowed, 200, "reviewer allowed dashboard health with partial redaction");
    assert(
      Array.isArray(reviewerDashboardHealthAllowed.payload?.redactedSections) &&
        reviewerDashboardHealthAllowed.payload.redactedSections.includes("connector_breakdown"),
      `expected reviewer dashboard health to redact connector breakdown, got ${JSON.stringify(reviewerDashboardHealthAllowed.payload)}`,
    );
    assert(
      !reviewerDashboardHealthAllowed.payload.redactedSections.includes("approval_queue"),
      `expected reviewer dashboard health to retain approval queue, got ${JSON.stringify(reviewerDashboardHealthAllowed.payload)}`,
    );
    assert(
      typeof reviewerDashboardHealthAllowed.payload?.pendingApprovals === "number",
      `expected reviewer dashboard health to retain pending approvals, got ${JSON.stringify(reviewerDashboardHealthAllowed.payload)}`,
    );

    const adminDashboardHealthAllowed = await apiRequest(baseUrl, "GET", "/dashboard/health", adminToken);
    assertStatus(adminDashboardHealthAllowed, 200, "admin allowed dashboard health");
    assert(
      Array.isArray(adminDashboardHealthAllowed.payload?.redactedSections) &&
        adminDashboardHealthAllowed.payload.redactedSections.length === 0,
      `expected admin dashboard health to avoid redaction, got ${JSON.stringify(adminDashboardHealthAllowed.payload)}`,
    );
    assert(
      typeof adminDashboardHealthAllowed.payload?.publishReadyTotal === "number" &&
        typeof adminDashboardHealthAllowed.payload?.blockedTotal === "number",
      `expected admin dashboard health aggregates, got ${JSON.stringify(adminDashboardHealthAllowed.payload)}`,
    );

    const viewerOperationsSummaryDenied = await apiRequest(baseUrl, "GET", "/dashboard/operations-summary", viewerToken);
    assertStatus(viewerOperationsSummaryDenied, 403, "viewer denied dashboard operations summary");

    const reviewerOperationsSummaryDenied = await apiRequest(baseUrl, "GET", "/dashboard/operations-summary", reviewerToken);
    assertStatus(reviewerOperationsSummaryDenied, 403, "reviewer denied dashboard operations summary");

    const editorOperationsSummaryAllowed = await apiRequest(baseUrl, "GET", "/dashboard/operations-summary", editorToken);
    assertStatus(editorOperationsSummaryAllowed, 200, "editor allowed dashboard operations summary");
    assert(
      typeof editorOperationsSummaryAllowed.payload?.jobsNeedingRetry === "number",
      `expected editor dashboard operations summary payload, got ${JSON.stringify(editorOperationsSummaryAllowed.payload)}`,
    );

    const adminOperationsSummaryAllowed = await apiRequest(baseUrl, "GET", "/dashboard/operations-summary", adminToken);
    assertStatus(adminOperationsSummaryAllowed, 200, "admin allowed dashboard operations summary");
    assert(
      typeof adminOperationsSummaryAllowed.payload?.failedImportJobs === "number",
      `expected admin dashboard operations summary payload, got ${JSON.stringify(adminOperationsSummaryAllowed.payload)}`,
    );

    const viewerKpiTrendsDenied = await apiRequest(baseUrl, "GET", "/metrics/kpi-trends?days=7", viewerToken);
    assertStatus(viewerKpiTrendsDenied, 403, "viewer denied metrics kpi trends");

    const reviewerKpiTrendsDenied = await apiRequest(baseUrl, "GET", "/metrics/kpi-trends?days=7", reviewerToken);
    assertStatus(reviewerKpiTrendsDenied, 403, "reviewer denied metrics kpi trends");

    const editorKpiTrendsDenied = await apiRequest(baseUrl, "GET", "/metrics/kpi-trends?days=7", editorToken);
    assertStatus(editorKpiTrendsDenied, 403, "editor denied metrics kpi trends");

    const adminKpiTrendsAllowed = await apiRequest(baseUrl, "GET", "/metrics/kpi-trends?days=7", adminToken);
    assertStatus(adminKpiTrendsAllowed, 200, "admin allowed metrics kpi trends");
    assert(
      Array.isArray(adminKpiTrendsAllowed.payload?.signupRequests),
      `expected admin metrics kpi trends payload, got ${JSON.stringify(adminKpiTrendsAllowed.payload)}`,
    );

    const viewerExportJobsDenied = await apiRequest(baseUrl, "GET", "/marketplace/export-jobs", viewerToken);
    assertStatus(viewerExportJobsDenied, 403, "viewer denied export job list");

    const viewerDefinitionsDenied = await apiRequest(baseUrl, "GET", "/connectors/definitions", viewerToken);
    assertStatus(viewerDefinitionsDenied, 403, "viewer denied connector definitions");

    const viewerComplianceRulesDenied = await apiRequest(baseUrl, "GET", "/compliance/rules", viewerToken);
    assertStatus(viewerComplianceRulesDenied, 403, "viewer denied compliance rule reads");

    const reviewerComplianceRulesDenied = await apiRequest(baseUrl, "GET", "/compliance/rules", reviewerToken);
    assertStatus(reviewerComplianceRulesDenied, 403, "reviewer denied compliance rule reads");

    const editorComplianceRulesDenied = await apiRequest(baseUrl, "GET", "/compliance/rules", editorToken);
    assertStatus(editorComplianceRulesDenied, 403, "editor denied compliance rule reads");

    const adminComplianceRulesAllowed = await apiRequest(baseUrl, "GET", "/compliance/rules", adminToken);
    assertStatus(adminComplianceRulesAllowed, 200, "admin allowed compliance rule reads");
    assert(
      Array.isArray(adminComplianceRulesAllowed.payload),
      `expected compliance rules array for admin, got ${JSON.stringify(adminComplianceRulesAllowed.payload)}`,
    );

    const productAdminComplianceRuleCreated = await apiRequest(baseUrl, "POST", "/compliance/rules", productAdminToken, {
      ruleCode: `REQ_${runId}`,
      name: `Required Title ${runId}`,
      categoryId: category.payload.id,
      severity: "error",
      ruleType: "required_field",
      config: { fieldPath: "title" },
      active: true,
    });
    assertStatus(productAdminComplianceRuleCreated, 201, "product admin allowed compliance rule create");
    assert(
      String(productAdminComplianceRuleCreated.payload?.ruleCode ?? "") === `REQ_${runId}`,
      `expected product admin compliance rule create payload, got ${JSON.stringify(productAdminComplianceRuleCreated.payload)}`,
    );

    const productAdminComplianceRulesAllowed = await apiRequest(baseUrl, "GET", "/compliance/rules", productAdminToken);
    assertStatus(productAdminComplianceRulesAllowed, 200, "product admin allowed compliance rule reads");
    assert(
      Array.isArray(productAdminComplianceRulesAllowed.payload) &&
        productAdminComplianceRulesAllowed.payload.some((item) => String(item?.id ?? "") === productAdminComplianceRuleCreated.payload.id),
      `expected product admin compliance rule list to include created rule, got ${JSON.stringify(productAdminComplianceRulesAllowed.payload)}`,
    );

    const systemAdminComplianceRulesDenied = await apiRequest(baseUrl, "GET", "/compliance/rules", systemAdminToken);
    assertStatus(systemAdminComplianceRulesDenied, 403, "system admin denied compliance rule reads");
    assert(
      String(systemAdminComplianceRulesDenied.payload?.reason ?? "") === "ADMIN_BOUNDARY_FORBIDDEN",
      `expected ADMIN_BOUNDARY_FORBIDDEN for system admin compliance rule reads, got ${JSON.stringify(systemAdminComplianceRulesDenied.payload)}`,
    );

    const viewerAiTitleDenied = await apiRequest(
      baseUrl,
      "GET",
      `/auto-suggestions/products/${product.payload.id}/title-suggestion`,
      viewerToken,
    );
    assertStatus(viewerAiTitleDenied, 403, "viewer denied auto-suggestion title read");

    const reviewerAiTitleDenied = await apiRequest(
      baseUrl,
      "GET",
      `/auto-suggestions/products/${product.payload.id}/title-suggestion`,
      reviewerToken,
    );
    assertStatus(reviewerAiTitleDenied, 403, "reviewer denied auto-suggestion title read");

    const reviewerAiAttributeDenied = await apiRequest(
      baseUrl,
      "GET",
      `/auto-suggestions/products/${product.payload.id}/attribute-enrichment`,
      reviewerToken,
    );
    assertStatus(reviewerAiAttributeDenied, 403, "reviewer denied auto-suggestion attribute read");

    const reviewerAiCategoryDenied = await apiRequest(
      baseUrl,
      "GET",
      `/auto-suggestions/products/${product.payload.id}/category-suggestion`,
      reviewerToken,
    );
    assertStatus(reviewerAiCategoryDenied, 403, "reviewer denied auto-suggestion category read");

    const editorAiTitleAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/auto-suggestions/products/${product.payload.id}/title-suggestion`,
      editorToken,
    );
    assertStatus(editorAiTitleAllowed, 200, "editor allowed auto-suggestion title read");
    assert(
      String(editorAiTitleAllowed.payload?.productId ?? "") === product.payload.id,
      `expected editor title suggestion payload for product, got ${JSON.stringify(editorAiTitleAllowed.payload)}`,
    );

    const editorAiAttributeAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/auto-suggestions/products/${product.payload.id}/attribute-enrichment`,
      editorToken,
    );
    assertStatus(editorAiAttributeAllowed, 200, "editor allowed auto-suggestion attribute read");
    assert(
      String(editorAiAttributeAllowed.payload?.productId ?? "") === product.payload.id,
      `expected editor attribute enrichment payload for product, got ${JSON.stringify(editorAiAttributeAllowed.payload)}`,
    );

    const editorAiCategoryAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/auto-suggestions/products/${product.payload.id}/category-suggestion`,
      editorToken,
    );
    assertStatus(editorAiCategoryAllowed, 200, "editor allowed auto-suggestion category read");
    assert(
      String(editorAiCategoryAllowed.payload?.productId ?? "") === product.payload.id,
      `expected editor category suggestion payload for product, got ${JSON.stringify(editorAiCategoryAllowed.payload)}`,
    );

    const viewerRejectionScoreDenied = await apiRequest(
      baseUrl,
      "GET",
      `/rejection-intelligence/products/${product.payload.id}/score?channel=amazon`,
      viewerToken,
    );
    assertStatus(viewerRejectionScoreDenied, 403, "viewer denied rejection intelligence score");

    const reviewerRejectionScoreAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/rejection-intelligence/products/${product.payload.id}/score?channel=amazon`,
      reviewerToken,
    );
    assertStatus(reviewerRejectionScoreAllowed, 200, "reviewer allowed rejection intelligence score");
    assert(
      typeof reviewerRejectionScoreAllowed.payload?.riskScore === "number",
      `expected reviewer rejection score payload, got ${JSON.stringify(reviewerRejectionScoreAllowed.payload)}`,
    );

    const viewerSubmissionsDenied = await apiRequest(baseUrl, "GET", "/submissions?connectorSlug=amazon-in", viewerToken);
    assertStatus(viewerSubmissionsDenied, 403, "viewer denied submission list");

    const viewerDeadLetterDenied = await apiRequest(baseUrl, "GET", "/submissions/dead-letter", viewerToken);
    assertStatus(viewerDeadLetterDenied, 403, "viewer denied dead-letter submissions");

    const editorPreviewDeniedByConnectorPermission = await apiRequest(
      baseUrl,
      "POST",
      `/connectors/${encodeURIComponent(installationId)}/payload-preview`,
      editorToken,
      { productId: product.payload.id, channel: "amazon" },
    );
    assertStatus(editorPreviewDeniedByConnectorPermission, 403, "editor preview denied before connector grant");
    assert(
      String(editorPreviewDeniedByConnectorPermission.payload?.error ?? "") === "CONNECTOR_PERMISSION_DENIED",
      "expected CONNECTOR_PERMISSION_DENIED before connector grant",
    );

    const grantEditorReconnect = await apiRequest(baseUrl, "POST", "/connectors/permissions", adminToken, {
      principalType: "role",
      principalId: "editor",
      connectorSlug: "amazon-in",
      accountAlias: "primary",
      action: "reconnect",
    });
    assertStatus(grantEditorReconnect, 201, "grant editor reconnect permission");

    const reviewerReconnectDenied = await apiRequest(
      baseUrl,
      "POST",
      `/connectors/${encodeURIComponent(installationId)}/reconnect`,
      reviewerToken,
      {},
    );
    assertStatus(reviewerReconnectDenied, 403, "reviewer denied connector reconnect");

    const viewerPublicationTargetsDenied = await apiRequest(
      baseUrl,
      "POST",
      `/connectors/${encodeURIComponent(installationId)}/publication-targets`,
      viewerToken,
      { publicationIds: ["mock-publication"] },
    );
    assertStatus(viewerPublicationTargetsDenied, 403, "viewer denied publication target update");

    const editorReconnectAllowed = await apiRequest(
      baseUrl,
      "POST",
      `/connectors/${encodeURIComponent(installationId)}/reconnect`,
      editorToken,
      {},
    );
    assertStatus(editorReconnectAllowed, 201, "editor reconnect allowed after connector grant");

    const editorPreviewDeniedByPolicy = await apiRequest(
      baseUrl,
      "POST",
      `/connectors/${encodeURIComponent(installationId)}/payload-preview`,
      editorToken,
      { productId: product.payload.id, channel: "amazon" },
    );
    assertStatus(editorPreviewDeniedByPolicy, 403, "editor preview denied by access policy");
    assert(
      String(editorPreviewDeniedByPolicy.payload?.error ?? "") === "ACCESS_POLICY_DENIED",
      "expected ACCESS_POLICY_DENIED after connector grant",
    );

    const adminPreviewAllowed = await apiRequest(
      baseUrl,
      "POST",
      `/connectors/${encodeURIComponent(installationId)}/payload-preview`,
      adminToken,
      { productId: product.payload.id, channel: "amazon" },
    );
    assert(
      adminPreviewAllowed.status === 200 || adminPreviewAllowed.status === 201,
      `admin preview allowed failed: expected 200/201, got ${adminPreviewAllowed.status}; payload=${JSON.stringify(adminPreviewAllowed.payload)}`,
    );
    assert(
      String(adminPreviewAllowed.payload?.installationId ?? "") === installationId,
      `expected preview response to include installation id, got ${JSON.stringify(adminPreviewAllowed.payload)}`,
    );

    // Export job creation requires approved status — fetch current version then advance
    const currentProductForExport = await apiRequest(baseUrl, "GET", `/catalog/products/${product.payload.id}`, adminToken);
    assertStatus(currentProductForExport, 200, "fetch product before export job tests");
    await advanceToApproved(baseUrl, adminToken, currentProductForExport.payload);

    const editorExportDenied = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/products/${product.payload.id}/export-jobs`,
      editorToken,
      { channel: "amazon" },
    );
    assertStatus(editorExportDenied, 403, "editor export denied by access policy");
    assert(
      String(editorExportDenied.payload?.error ?? "") === "ACCESS_POLICY_DENIED",
      "expected ACCESS_POLICY_DENIED for editor marketplace export",
    );

    const adminExportJobCreated = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/products/${product.payload.id}/export-jobs`,
      adminToken,
      { channel: "amazon" },
    );
    assert(
      adminExportJobCreated.status === 200 || adminExportJobCreated.status === 201,
      `admin marketplace export job create failed: got ${adminExportJobCreated.status} payload=${JSON.stringify(adminExportJobCreated.payload)}`,
    );
    const exportJobId = String(adminExportJobCreated.payload?.id ?? "");
    assert(exportJobId.length > 10, `expected export job id, got ${JSON.stringify(adminExportJobCreated.payload)}`);

    const productAdminExportJobsAllowed = await apiRequest(baseUrl, "GET", "/marketplace/export-jobs", productAdminToken);
    assertStatus(productAdminExportJobsAllowed, 200, "product admin allowed export job list");
    const productAdminExportJobItems = Array.isArray(productAdminExportJobsAllowed.payload?.items)
      ? productAdminExportJobsAllowed.payload.items
      : Array.isArray(productAdminExportJobsAllowed.payload)
        ? productAdminExportJobsAllowed.payload
        : [];
    assert(
      productAdminExportJobItems.some((item) => String(item?.id ?? "") === exportJobId),
      `expected product admin export job list to include created job, got ${JSON.stringify(productAdminExportJobsAllowed.payload)}`,
    );

    const productAdminExportJobAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/marketplace/export-jobs/${encodeURIComponent(exportJobId)}`,
      productAdminToken,
    );
    assertStatus(productAdminExportJobAllowed, 200, "product admin allowed export job detail");
    assert(
      String(productAdminExportJobAllowed.payload?.id ?? "") === exportJobId,
      `expected product admin export job detail payload, got ${JSON.stringify(productAdminExportJobAllowed.payload)}`,
    );

    const productAdminSimulationAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/marketplace/products/${product.payload.id}/simulate?channel=amazon`,
      productAdminToken,
    );
    assertStatus(productAdminSimulationAllowed, 200, "product admin allowed marketplace simulation");
    assert(
      String(productAdminSimulationAllowed.payload?.productId ?? "") === product.payload.id,
      `expected product admin marketplace simulation payload, got ${JSON.stringify(productAdminSimulationAllowed.payload)}`,
    );

    const systemAdminExportJobsDenied = await apiRequest(baseUrl, "GET", "/marketplace/export-jobs", systemAdminToken);
    assertStatus(systemAdminExportJobsDenied, 403, "system admin denied export job list");
    assert(
      String(systemAdminExportJobsDenied.payload?.reason ?? "") === "ADMIN_BOUNDARY_FORBIDDEN",
      `expected ADMIN_BOUNDARY_FORBIDDEN for system admin export job list, got ${JSON.stringify(systemAdminExportJobsDenied.payload)}`,
    );

    const systemAdminSimulationDenied = await apiRequest(
      baseUrl,
      "GET",
      `/marketplace/products/${product.payload.id}/simulate?channel=amazon`,
      systemAdminToken,
    );
    assertStatus(systemAdminSimulationDenied, 403, "system admin denied marketplace simulation");
    assert(
      String(systemAdminSimulationDenied.payload?.reason ?? "") === "ADMIN_BOUNDARY_FORBIDDEN",
      `expected ADMIN_BOUNDARY_FORBIDDEN for system admin marketplace simulation, got ${JSON.stringify(systemAdminSimulationDenied.payload)}`,
    );

    const productAdminMappingArchiveDraft = await apiRequest(
      baseUrl,
      "POST",
      "/marketplace/connectors/flipkart/mappings/versions",
      adminToken,
      {
        categoryScope: String(category.payload.id),
        mappingLevel: "tenant_connector_category_mapping",
        connectorDefinitionId: "flipkart",
        connectorDefinitionVersion: "1.0.0",
        compatibilityState: "compatible",
        mappingRules: {
          field_mappings: {
            title: "product_title",
            brand: "brand",
            description: "description",
            hsnCode: "hsn_code",
            gstRate: "gst_rate",
            "attributes.color": "color",
            "attributes.size": "size",
          },
          category: {
            source: String(category.payload.id),
            target: String(category.payload.id),
          },
        },
        fallbackPolicy: {
          enabled: true,
          warning_tag: "fallback_category_mapping",
        },
        fallbackAckRequired: true,
      },
    );
    assertStatus(productAdminMappingArchiveDraft, 201, "create product-admin mapping archive draft");
    const productAdminArchiveVersionId = String(productAdminMappingArchiveDraft.payload?.id ?? "");
    assert(productAdminArchiveVersionId.length > 10, "missing product-admin archive draft id");

    const productAdminStepUpToken = await issueStepUp(baseUrl, productAdminToken, authPassword);
    const productAdminArchiveAllowed = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(productAdminArchiveVersionId)}/archive`,
      productAdminToken,
      { reason: "archive product governance mapping" },
      { [STEP_UP_HEADER]: productAdminStepUpToken },
    );
    assertStatus(productAdminArchiveAllowed, 201, "product admin allowed marketplace mapping archive");
    assert(
      String(productAdminArchiveAllowed.payload?.lifecycleState ?? "") === "archived",
      `expected product admin archive payload to be archived, got ${JSON.stringify(productAdminArchiveAllowed.payload)}`,
    );

    const productAdminPreflightAllowed = await apiRequest(
      baseUrl,
      "POST",
      "/marketplace/connectors/flipkart/mappings/preflight",
      productAdminToken,
      {
        categoryScope: String(category.payload.id),
        fallbackAcknowledged: true,
      },
    );
    assertStatus(productAdminPreflightAllowed, 201, "product admin allowed marketplace mapping preflight");
    assert(
      Array.isArray(productAdminPreflightAllowed.payload?.warnings) &&
        Array.isArray(productAdminPreflightAllowed.payload?.blockers),
      `expected product admin preflight payload, got ${JSON.stringify(productAdminPreflightAllowed.payload)}`,
    );

    const productAdminPublishReadinessAllowed = await apiRequest(
      baseUrl,
      "POST",
      "/marketplace/connectors/amazon/publish-readiness",
      productAdminToken,
      {
        categoryScope: String(category.payload.id),
        productId: product.payload.id,
        fallbackAcknowledged: true,
      },
    );
    assertStatus(productAdminPublishReadinessAllowed, 201, "product admin allowed marketplace publish readiness");
    assert(
      typeof productAdminPublishReadinessAllowed.payload?.ok === "boolean" &&
        Array.isArray(productAdminPublishReadinessAllowed.payload?.blockers),
      `expected product admin publish readiness payload, got ${JSON.stringify(productAdminPublishReadinessAllowed.payload)}`,
    );

    const productAdminBatchReadinessAllowed = await apiRequest(
      baseUrl,
      "POST",
      "/marketplace/readiness/batch",
      productAdminToken,
      {
        productIds: [product.payload.id],
        channels: ["amazon", "shopify"],
      },
    );
    assertStatus(productAdminBatchReadinessAllowed, 200, "product admin allowed marketplace batch readiness");
    assert(
      Array.isArray(productAdminBatchReadinessAllowed.payload?.items) &&
        productAdminBatchReadinessAllowed.payload.items.length === 1,
      `expected product admin batch readiness payload, got ${JSON.stringify(productAdminBatchReadinessAllowed.payload)}`,
    );

    const systemAdminMappingArchiveDraft = await apiRequest(
      baseUrl,
      "POST",
      "/marketplace/connectors/flipkart/mappings/versions",
      adminToken,
      {
        categoryScope: String(category.payload.id),
        mappingLevel: "tenant_connector_category_mapping",
        connectorDefinitionId: "flipkart",
        connectorDefinitionVersion: "1.0.1",
        compatibilityState: "compatible",
        mappingRules: {
          field_mappings: {
            title: "product_title",
            brand: "brand",
            description: "description",
            hsnCode: "hsn_code",
            gstRate: "gst_rate",
            "attributes.color": "color",
            "attributes.size": "size",
          },
          category: {
            source: String(category.payload.id),
            target: String(category.payload.id),
          },
        },
        fallbackPolicy: {
          enabled: true,
          warning_tag: "fallback_category_mapping",
        },
        fallbackAckRequired: true,
      },
    );
    assertStatus(systemAdminMappingArchiveDraft, 201, "create system-admin mapping archive draft");
    const systemAdminArchiveVersionId = String(systemAdminMappingArchiveDraft.payload?.id ?? "");
    assert(systemAdminArchiveVersionId.length > 10, "missing system-admin archive draft id");

    const systemAdminStepUpToken = await issueStepUp(baseUrl, systemAdminToken, authPassword);
    const systemAdminArchiveDenied = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(systemAdminArchiveVersionId)}/archive`,
      systemAdminToken,
      { reason: "system admin archive attempt" },
      { [STEP_UP_HEADER]: systemAdminStepUpToken },
    );
    assertStatus(systemAdminArchiveDenied, 403, "system admin denied marketplace mapping archive");
    assert(
      String(systemAdminArchiveDenied.payload?.reason ?? "") === "ADMIN_BOUNDARY_FORBIDDEN",
      `expected ADMIN_BOUNDARY_FORBIDDEN for system admin marketplace mapping archive, got ${JSON.stringify(systemAdminArchiveDenied.payload)}`,
    );

    const systemAdminPreflightDenied = await apiRequest(
      baseUrl,
      "POST",
      "/marketplace/connectors/flipkart/mappings/preflight",
      systemAdminToken,
      {
        categoryScope: String(category.payload.id),
        fallbackAcknowledged: true,
      },
    );
    assertStatus(systemAdminPreflightDenied, 403, "system admin denied marketplace mapping preflight");
    assert(
      String(systemAdminPreflightDenied.payload?.reason ?? "") === "ADMIN_BOUNDARY_FORBIDDEN",
      `expected ADMIN_BOUNDARY_FORBIDDEN for system admin marketplace mapping preflight, got ${JSON.stringify(systemAdminPreflightDenied.payload)}`,
    );

    const systemAdminPublishReadinessDenied = await apiRequest(
      baseUrl,
      "POST",
      "/marketplace/connectors/amazon/publish-readiness",
      systemAdminToken,
      {
        categoryScope: String(category.payload.id),
        productId: product.payload.id,
        fallbackAcknowledged: true,
      },
    );
    assertStatus(systemAdminPublishReadinessDenied, 403, "system admin denied marketplace publish readiness");
    assert(
      String(systemAdminPublishReadinessDenied.payload?.reason ?? "") === "ADMIN_BOUNDARY_FORBIDDEN",
      `expected ADMIN_BOUNDARY_FORBIDDEN for system admin marketplace publish readiness, got ${JSON.stringify(systemAdminPublishReadinessDenied.payload)}`,
    );

    const systemAdminBatchReadinessDenied = await apiRequest(
      baseUrl,
      "POST",
      "/marketplace/readiness/batch",
      systemAdminToken,
      {
        productIds: [product.payload.id],
        channels: ["amazon", "shopify"],
      },
    );
    assertStatus(systemAdminBatchReadinessDenied, 403, "system admin denied marketplace batch readiness");
    assert(
      String(systemAdminBatchReadinessDenied.payload?.reason ?? "") === "ADMIN_BOUNDARY_FORBIDDEN",
      `expected ADMIN_BOUNDARY_FORBIDDEN for system admin batch readiness, got ${JSON.stringify(systemAdminBatchReadinessDenied.payload)}`,
    );

    const productAdminConnectorRecordDeleteDenied = await apiRequest(
      baseUrl,
      "DELETE",
      `/connectors/amazon-in/install/${encodeURIComponent(installationId)}`,
      productAdminToken,
    );
    assertStatus(productAdminConnectorRecordDeleteDenied, 403, "product admin denied connector installation record delete");
    assert(
      String(productAdminConnectorRecordDeleteDenied.payload?.reason ?? "") === "ADMIN_BOUNDARY_FORBIDDEN",
      `expected ADMIN_BOUNDARY_FORBIDDEN for product admin connector record delete, got ${JSON.stringify(productAdminConnectorRecordDeleteDenied.payload)}`,
    );

    const systemAdminConnectorRecordDeleteAllowed = await apiRequest(
      baseUrl,
      "DELETE",
      `/connectors/amazon-in/install/${encodeURIComponent(installationId)}`,
      systemAdminToken,
    );
    assertStatus(systemAdminConnectorRecordDeleteAllowed, 200, "system admin allowed connector installation record delete");
    assert(
      String(systemAdminConnectorRecordDeleteAllowed.payload?.id ?? "") === installationId,
      `expected system admin connector delete payload, got ${JSON.stringify(systemAdminConnectorRecordDeleteAllowed.payload)}`,
    );

    const productAdminCategoryCreated = await apiRequest(baseUrl, "POST", "/taxonomy/categories", productAdminToken, {
      name: `Product Admin Category ${runId}`,
      parentId: category.payload.id,
    });
    assertStatus(productAdminCategoryCreated, 201, "product admin allowed taxonomy category create");
    const productAdminCategoryId = String(productAdminCategoryCreated.payload?.id ?? "");
    assert(productAdminCategoryId.length > 10, "missing product-admin taxonomy category id");

    const productAdminCategoryUpdated = await apiRequest(
      baseUrl,
      "PATCH",
      `/taxonomy/categories/${encodeURIComponent(productAdminCategoryId)}`,
      productAdminToken,
      { name: `Product Admin Category Updated ${runId}` },
    );
    assertStatus(productAdminCategoryUpdated, 200, "product admin allowed taxonomy category update");
    assert(
      String(productAdminCategoryUpdated.payload?.name ?? "").includes("Updated"),
      `expected product admin taxonomy update payload, got ${JSON.stringify(productAdminCategoryUpdated.payload)}`,
    );

    const productAdminAttributeCreated = await apiRequest(
      baseUrl,
      "POST",
      `/taxonomy/categories/${encodeURIComponent(productAdminCategoryId)}/attributes`,
      productAdminToken,
      {
        name: `Material ${runId}`,
        key: `material_${runId}`,
        dataType: "text",
        required: false,
        appliesTo: "product",
      },
    );
    assertStatus(productAdminAttributeCreated, 201, "product admin allowed taxonomy attribute create");
    const productAdminAttributeId = String(productAdminAttributeCreated.payload?.id ?? "");
    assert(productAdminAttributeId.length > 10, "missing product-admin taxonomy attribute id");

    const productAdminAttributeUpdated = await apiRequest(
      baseUrl,
      "PATCH",
      `/taxonomy/categories/attributes/${encodeURIComponent(productAdminAttributeId)}`,
      productAdminToken,
      {
        name: `Material Updated ${runId}`,
        key: `material_${runId}`,
        dataType: "text",
        required: true,
        appliesTo: "product",
      },
    );
    assertStatus(productAdminAttributeUpdated, 200, "product admin allowed taxonomy attribute update");
    assert(
      Boolean(productAdminAttributeUpdated.payload?.required) === true,
      `expected product admin taxonomy attribute update payload, got ${JSON.stringify(productAdminAttributeUpdated.payload)}`,
    );

    const systemAdminTaxonomyCreateDenied = await apiRequest(baseUrl, "POST", "/taxonomy/categories", systemAdminToken, {
      name: `System Admin Category ${runId}`,
      parentId: category.payload.id,
    });
    assertStatus(systemAdminTaxonomyCreateDenied, 403, "system admin denied taxonomy category create");
    assert(
      String(systemAdminTaxonomyCreateDenied.payload?.reason ?? "") === "ADMIN_BOUNDARY_FORBIDDEN",
      `expected ADMIN_BOUNDARY_FORBIDDEN for system admin taxonomy create, got ${JSON.stringify(systemAdminTaxonomyCreateDenied.payload)}`,
    );

    const systemAdminTaxonomyAttributeCreateDenied = await apiRequest(
      baseUrl,
      "POST",
      `/taxonomy/categories/${encodeURIComponent(productAdminCategoryId)}/attributes`,
      systemAdminToken,
      {
        name: `System Material ${runId}`,
        key: `system_material_${runId}`,
        dataType: "text",
        required: false,
        appliesTo: "product",
      },
    );
    assertStatus(systemAdminTaxonomyAttributeCreateDenied, 403, "system admin denied taxonomy attribute create");
    assert(
      String(systemAdminTaxonomyAttributeCreateDenied.payload?.reason ?? "") === "ADMIN_BOUNDARY_FORBIDDEN",
      `expected ADMIN_BOUNDARY_FORBIDDEN for system admin taxonomy attribute create, got ${JSON.stringify(systemAdminTaxonomyAttributeCreateDenied.payload)}`,
    );

    const productAdminAttributeDeleted = await apiRequest(
      baseUrl,
      "DELETE",
      `/taxonomy/categories/attributes/${encodeURIComponent(productAdminAttributeId)}`,
      productAdminToken,
    );
    assertStatus(productAdminAttributeDeleted, 200, "product admin allowed taxonomy attribute delete");

    const productAdminCategoryDeleted = await apiRequest(
      baseUrl,
      "DELETE",
      `/taxonomy/categories/${encodeURIComponent(productAdminCategoryId)}`,
      productAdminToken,
    );
    assertStatus(productAdminCategoryDeleted, 200, "product admin allowed taxonomy category delete");

    const editorApiKey = await apiRequest(baseUrl, "POST", "/admin/api-keys", adminToken, {
      label: `Editor policy key ${runId}`,
      role: "editor",
      scopes: ["catalog.read", "catalog.write"],
    });
    assertStatus(editorApiKey, 201, "create editor api key");
    const editorApiKeyValue = String(editorApiKey.payload?.plainTextKey ?? "");
    assert(editorApiKeyValue.startsWith("pim1_"), "expected editor api key plain text value");

    const readOnlyApiKey = await apiRequest(baseUrl, "POST", "/admin/api-keys", adminToken, {
      label: `Editor read-only key ${runId}`,
      role: "editor",
      scopes: ["catalog.read"],
    });
    assertStatus(readOnlyApiKey, 201, "create read-only editor api key");
    const readOnlyApiKeyValue = String(readOnlyApiKey.payload?.plainTextKey ?? "");
    assert(readOnlyApiKeyValue.startsWith("pim1_"), "expected read-only api key plain text value");

    const writeOnlyApiKey = await apiRequest(baseUrl, "POST", "/admin/api-keys", adminToken, {
      label: `Editor write-only key ${runId}`,
      role: "editor",
      scopes: ["catalog.write"],
    });
    assertStatus(writeOnlyApiKey, 201, "create write-only editor api key");
    const writeOnlyApiKeyValue = String(writeOnlyApiKey.payload?.plainTextKey ?? "");
    assert(writeOnlyApiKeyValue.startsWith("pim1_"), "expected write-only api key plain text value");

    const noScopeApiKey = await apiRequest(baseUrl, "POST", "/admin/api-keys", adminToken, {
      label: `Editor no-scope key ${runId}`,
      role: "editor",
    });
    assertStatus(noScopeApiKey, 201, "create no-scope editor api key");
    const noScopeApiKeyValue = String(noScopeApiKey.payload?.plainTextKey ?? "");
    assert(noScopeApiKeyValue.startsWith("pim1_"), "expected no-scope api key plain text value");

    const mediaReadApiKey = await apiRequest(baseUrl, "POST", "/admin/api-keys", adminToken, {
      label: `Editor media-read key ${runId}`,
      role: "editor",
      scopes: ["media.read"],
    });
    assertStatus(mediaReadApiKey, 201, "create media-read editor api key");
    const mediaReadApiKeyValue = String(mediaReadApiKey.payload?.plainTextKey ?? "");
    assert(mediaReadApiKeyValue.startsWith("pim1_"), "expected media-read api key plain text value");

    const complianceReadApiKey = await apiRequest(baseUrl, "POST", "/admin/api-keys", adminToken, {
      label: `Editor compliance-read key ${runId}`,
      role: "editor",
      scopes: ["compliance.read"],
    });
    assertStatus(complianceReadApiKey, 201, "create compliance-read editor api key");
    const complianceReadApiKeyValue = String(complianceReadApiKey.payload?.plainTextKey ?? "");
    assert(complianceReadApiKeyValue.startsWith("pim1_"), "expected compliance-read api key plain text value");

    const rejectionReadApiKey = await apiRequest(baseUrl, "POST", "/admin/api-keys", adminToken, {
      label: `Editor rejection-read key ${runId}`,
      role: "editor",
      scopes: ["rejection_intelligence.read"],
    });
    assertStatus(rejectionReadApiKey, 201, "create rejection-read editor api key");
    const rejectionReadApiKeyValue = String(rejectionReadApiKey.payload?.plainTextKey ?? "");
    assert(rejectionReadApiKeyValue.startsWith("pim1_"), "expected rejection-read api key plain text value");

    const autoSuggestionsReadApiKey = await apiRequest(baseUrl, "POST", "/admin/api-keys", adminToken, {
      label: `Editor auto-suggestions-read key ${runId}`,
      role: "editor",
      scopes: ["auto_suggestions.read"],
    });
    assertStatus(autoSuggestionsReadApiKey, 201, "create auto-suggestions-read editor api key");
    const autoSuggestionsReadApiKeyValue = String(autoSuggestionsReadApiKey.payload?.plainTextKey ?? "");
    assert(autoSuggestionsReadApiKeyValue.startsWith("pim1_"), "expected auto-suggestions-read api key plain text value");

    const taxonomyReadApiKey = await apiRequest(baseUrl, "POST", "/admin/api-keys", adminToken, {
      label: `Editor taxonomy-read key ${runId}`,
      role: "editor",
      scopes: ["taxonomy.read"],
    });
    assertStatus(taxonomyReadApiKey, 201, "create taxonomy-read editor api key");
    const taxonomyReadApiKeyValue = String(taxonomyReadApiKey.payload?.plainTextKey ?? "");
    assert(taxonomyReadApiKeyValue.startsWith("pim1_"), "expected taxonomy-read api key plain text value");

    const bulkImportReadApiKey = await apiRequest(baseUrl, "POST", "/admin/api-keys", adminToken, {
      label: `Editor bulk-import-read key ${runId}`,
      role: "editor",
      scopes: ["bulk_import.read"],
    });
    assertStatus(bulkImportReadApiKey, 201, "create bulk-import-read editor api key");
    const bulkImportReadApiKeyValue = String(bulkImportReadApiKey.payload?.plainTextKey ?? "");
    assert(bulkImportReadApiKeyValue.startsWith("pim1_"), "expected bulk-import-read api key plain text value");

    const issuesReadApiKey = await apiRequest(baseUrl, "POST", "/admin/api-keys", adminToken, {
      label: `Editor issues-read key ${runId}`,
      role: "editor",
      scopes: ["issues.read"],
    });
    assertStatus(issuesReadApiKey, 201, "create issues-read editor api key");
    const issuesReadApiKeyValue = String(issuesReadApiKey.payload?.plainTextKey ?? "");
    assert(issuesReadApiKeyValue.startsWith("pim1_"), "expected issues-read api key plain text value");

    const apiKeyCatalogDetailAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/catalog/products/${product.payload.id}`,
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyCatalogDetailAllowed, 200, "api key allowed explicit catalog detail read");
    assert(
      Number(apiKeyCatalogDetailAllowed.payload?.attributes?.pricing?.sellingPrice ?? 0) === 1499,
      `expected editor api key to retain allowed catalog pricing read, got ${JSON.stringify(apiKeyCatalogDetailAllowed.payload)}`,
    );

    const apiKeyCatalogDetailNoScopeDenied = await apiRequest(
      baseUrl,
      "GET",
      `/catalog/products/${product.payload.id}`,
      null,
      undefined,
      { "x-pim-api-key": noScopeApiKeyValue },
    );
    assertStatus(apiKeyCatalogDetailNoScopeDenied, 403, "api key without scopes denied catalog detail read");
    assert(
      String(apiKeyCatalogDetailNoScopeDenied.payload?.reason ?? "") === "API_CLIENT_SCOPE_FORBIDDEN",
      `expected API_CLIENT_SCOPE_FORBIDDEN for no-scope api key, got ${JSON.stringify(apiKeyCatalogDetailNoScopeDenied.payload)}`,
    );

    const apiKeyCatalogDetailWrongScopeDenied = await apiRequest(
      baseUrl,
      "GET",
      `/catalog/products/${product.payload.id}`,
      null,
      undefined,
      { "x-pim-api-key": writeOnlyApiKeyValue },
    );
    assertStatus(apiKeyCatalogDetailWrongScopeDenied, 403, "write-only api key denied catalog detail read");
    assert(
      String(apiKeyCatalogDetailWrongScopeDenied.payload?.reason ?? "") === "API_CLIENT_SCOPE_FORBIDDEN",
      `expected API_CLIENT_SCOPE_FORBIDDEN for write-only api key read, got ${JSON.stringify(apiKeyCatalogDetailWrongScopeDenied.payload)}`,
    );

    const editorHumanMediaReadAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/media/assets/${ownedMediaAsset.payload.id}`,
      editorToken,
    );
    assertStatus(editorHumanMediaReadAllowed, 200, "editor human media detail remains allowed");
    assert(
      String(editorHumanMediaReadAllowed.payload?.id ?? "") === String(ownedMediaAsset.payload.id),
      `expected editor human media detail payload, got ${JSON.stringify(editorHumanMediaReadAllowed.payload)}`,
    );

    const apiKeyMediaListAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/media/assets?productId=${encodeURIComponent(product.payload.id)}`,
      null,
      undefined,
      { "x-pim-api-key": mediaReadApiKeyValue },
    );
    assertStatus(apiKeyMediaListAllowed, 200, "api key allowed explicit media list read");
    assert(
      Array.isArray(apiKeyMediaListAllowed.payload) &&
        apiKeyMediaListAllowed.payload.some((item) => item.id === ownedMediaAsset.payload.id),
      `expected media-read api key to receive owned media rows, got ${JSON.stringify(apiKeyMediaListAllowed.payload)}`,
    );

    const apiKeyMediaDetailWrongScopeDenied = await apiRequest(
      baseUrl,
      "GET",
      `/media/assets/${ownedMediaAsset.payload.id}`,
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyMediaDetailWrongScopeDenied, 403, "catalog-scoped api key denied media detail read");
    assert(
      String(apiKeyMediaDetailWrongScopeDenied.payload?.reason ?? "") === "API_CLIENT_SCOPE_FORBIDDEN",
      `expected API_CLIENT_SCOPE_FORBIDDEN for catalog-only api key media read, got ${JSON.stringify(apiKeyMediaDetailWrongScopeDenied.payload)}`,
    );

    const apiKeyMediaValidationNoScopeDenied = await apiRequest(
      baseUrl,
      "GET",
      `/media/assets/${ownedMediaAsset.payload.id}/validation?channel=shopify`,
      null,
      undefined,
      { "x-pim-api-key": noScopeApiKeyValue },
    );
    assertStatus(apiKeyMediaValidationNoScopeDenied, 403, "api key without scopes denied media validation read");
    assert(
      String(apiKeyMediaValidationNoScopeDenied.payload?.reason ?? "") === "API_CLIENT_SCOPE_FORBIDDEN",
      `expected API_CLIENT_SCOPE_FORBIDDEN for no-scope api key media validation, got ${JSON.stringify(apiKeyMediaValidationNoScopeDenied.payload)}`,
    );

    const apiKeyComplianceIssuesAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/compliance/products/${product.payload.id}/issues`,
      null,
      undefined,
      { "x-pim-api-key": complianceReadApiKeyValue },
    );
    assertStatus(apiKeyComplianceIssuesAllowed, 200, "api key allowed explicit compliance issues read");
    assert(
      Array.isArray(apiKeyComplianceIssuesAllowed.payload),
      `expected compliance-read api key issues array, got ${JSON.stringify(apiKeyComplianceIssuesAllowed.payload)}`,
    );

    const apiKeyComplianceIssuesWrongScopeDenied = await apiRequest(
      baseUrl,
      "GET",
      `/compliance/products/${product.payload.id}/issues`,
      null,
      undefined,
      { "x-pim-api-key": mediaReadApiKeyValue },
    );
    assertStatus(apiKeyComplianceIssuesWrongScopeDenied, 403, "media-scoped api key denied compliance issues read");
    assert(
      String(apiKeyComplianceIssuesWrongScopeDenied.payload?.reason ?? "") === "API_CLIENT_SCOPE_FORBIDDEN",
      `expected API_CLIENT_SCOPE_FORBIDDEN for wrong-scope compliance read, got ${JSON.stringify(apiKeyComplianceIssuesWrongScopeDenied.payload)}`,
    );

    const apiKeyRejectionScoreAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/rejection-intelligence/products/${product.payload.id}/score?channel=amazon`,
      null,
      undefined,
      { "x-pim-api-key": rejectionReadApiKeyValue },
    );
    assertStatus(apiKeyRejectionScoreAllowed, 200, "api key allowed explicit rejection score read");
    assert(
      typeof apiKeyRejectionScoreAllowed.payload?.riskScore === "number",
      `expected rejection-read api key payload, got ${JSON.stringify(apiKeyRejectionScoreAllowed.payload)}`,
    );

    const apiKeyRejectionScoreNoScopeDenied = await apiRequest(
      baseUrl,
      "GET",
      `/rejection-intelligence/products/${product.payload.id}/score?channel=amazon`,
      null,
      undefined,
      { "x-pim-api-key": noScopeApiKeyValue },
    );
    assertStatus(apiKeyRejectionScoreNoScopeDenied, 403, "api key without scopes denied rejection score read");
    assert(
      String(apiKeyRejectionScoreNoScopeDenied.payload?.reason ?? "") === "API_CLIENT_SCOPE_FORBIDDEN",
      `expected API_CLIENT_SCOPE_FORBIDDEN for no-scope rejection read, got ${JSON.stringify(apiKeyRejectionScoreNoScopeDenied.payload)}`,
    );

    const apiKeyAutoSuggestionTitleAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/auto-suggestions/products/${product.payload.id}/title-suggestion`,
      null,
      undefined,
      { "x-pim-api-key": autoSuggestionsReadApiKeyValue },
    );
    assertStatus(apiKeyAutoSuggestionTitleAllowed, 200, "api key allowed explicit auto-suggestion title read");
    assert(
      String(apiKeyAutoSuggestionTitleAllowed.payload?.productId ?? "") === String(product.payload.id),
      `expected auto-suggestions-read api key title payload, got ${JSON.stringify(apiKeyAutoSuggestionTitleAllowed.payload)}`,
    );

    const apiKeyAutoSuggestionAttributeAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/auto-suggestions/products/${product.payload.id}/attribute-enrichment`,
      null,
      undefined,
      { "x-pim-api-key": autoSuggestionsReadApiKeyValue },
    );
    assertStatus(apiKeyAutoSuggestionAttributeAllowed, 200, "api key allowed explicit auto-suggestion attribute read");
    assert(
      String(apiKeyAutoSuggestionAttributeAllowed.payload?.productId ?? "") === String(product.payload.id),
      `expected auto-suggestions-read api key attribute payload, got ${JSON.stringify(apiKeyAutoSuggestionAttributeAllowed.payload)}`,
    );

    const apiKeyAutoSuggestionCategoryWrongScopeDenied = await apiRequest(
      baseUrl,
      "GET",
      `/auto-suggestions/products/${product.payload.id}/category-suggestion`,
      null,
      undefined,
      { "x-pim-api-key": rejectionReadApiKeyValue },
    );
    assertStatus(apiKeyAutoSuggestionCategoryWrongScopeDenied, 403, "rejection-scoped api key denied auto-suggestion category read");
    assert(
      String(apiKeyAutoSuggestionCategoryWrongScopeDenied.payload?.reason ?? "") === "API_CLIENT_SCOPE_FORBIDDEN",
      `expected API_CLIENT_SCOPE_FORBIDDEN for wrong-scope auto-suggestion read, got ${JSON.stringify(apiKeyAutoSuggestionCategoryWrongScopeDenied.payload)}`,
    );

    const apiKeyCatalogWriteScopeMismatchDenied = await apiRequest(
      baseUrl,
      "POST",
      "/catalog/products",
      null,
      {
        title: `API Key Read Only Product ${runId}`,
        brand: "ReadOnlyKeyBrand",
        description: "Should be rejected without catalog.write scope",
        categoryId: category.payload.id,
        status: "draft",
      },
      { "x-pim-api-key": readOnlyApiKeyValue },
    );
    assertStatus(apiKeyCatalogWriteScopeMismatchDenied, 403, "read-only api key denied catalog write");
    assert(
      String(apiKeyCatalogWriteScopeMismatchDenied.payload?.reason ?? "") === "API_CLIENT_SCOPE_FORBIDDEN",
      `expected API_CLIENT_SCOPE_FORBIDDEN for read-only api key write, got ${JSON.stringify(apiKeyCatalogWriteScopeMismatchDenied.payload)}`,
    );

    const editorHumanTaxonomyAllowed = await apiRequest(
      baseUrl,
      "GET",
      "/taxonomy/categories?all=true",
      editorToken,
    );
    assertStatus(editorHumanTaxonomyAllowed, 200, "editor human taxonomy metadata remains allowed");

    const apiKeyTaxonomyAllowed = await apiRequest(
      baseUrl,
      "GET",
      "/taxonomy/categories?all=true",
      null,
      undefined,
      { "x-pim-api-key": taxonomyReadApiKeyValue },
    );
    assertStatus(apiKeyTaxonomyAllowed, 200, "api key allowed explicit taxonomy metadata read");
    assert(
      Array.isArray(apiKeyTaxonomyAllowed.payload),
      `expected taxonomy-read api key to receive taxonomy list array, got ${JSON.stringify(apiKeyTaxonomyAllowed.payload)}`,
    );

    const apiKeyTaxonomyWrongScopeDenied = await apiRequest(
      baseUrl,
      "GET",
      "/taxonomy/categories?all=true",
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyTaxonomyWrongScopeDenied, 403, "catalog-scoped api key denied taxonomy metadata read");
    assert(
      String(apiKeyTaxonomyWrongScopeDenied.payload?.reason ?? "") === "API_CLIENT_SCOPE_FORBIDDEN",
      `expected API_CLIENT_SCOPE_FORBIDDEN for wrong-scope taxonomy metadata, got ${JSON.stringify(apiKeyTaxonomyWrongScopeDenied.payload)}`,
    );

    const apiKeyTaxonomyNoScopeDenied = await apiRequest(
      baseUrl,
      "GET",
      `/taxonomy/categories/${encodeURIComponent(category.payload.id)}/attributes`,
      null,
      undefined,
      { "x-pim-api-key": noScopeApiKeyValue },
    );
    assertStatus(apiKeyTaxonomyNoScopeDenied, 403, "api key without scopes denied taxonomy attributes read");
    assert(
      String(apiKeyTaxonomyNoScopeDenied.payload?.reason ?? "") === "API_CLIENT_SCOPE_FORBIDDEN",
      `expected API_CLIENT_SCOPE_FORBIDDEN for no-scope taxonomy metadata, got ${JSON.stringify(apiKeyTaxonomyNoScopeDenied.payload)}`,
    );

    const apiKeyDashboardHealthDenied = await apiRequest(
      baseUrl,
      "GET",
      "/dashboard/health",
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyDashboardHealthDenied, 403, "api key denied dashboard health");
    assert(
      String(apiKeyDashboardHealthDenied.payload?.reason ?? "") === "API_CLIENT_FORBIDDEN",
      `expected API_CLIENT_FORBIDDEN for api key dashboard health, got ${JSON.stringify(apiKeyDashboardHealthDenied.payload)}`,
    );

    const apiKeyBillingUsageDenied = await apiRequest(
      baseUrl,
      "GET",
      "/billing/usage",
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyBillingUsageDenied, 403, "api key denied billing usage");
    assert(
      String(apiKeyBillingUsageDenied.payload?.reason ?? "") === "API_CLIENT_FORBIDDEN",
      `expected API_CLIENT_FORBIDDEN for api key billing usage, got ${JSON.stringify(apiKeyBillingUsageDenied.payload)}`,
    );

    const apiKeyBillingPlanProfileDenied = await apiRequest(
      baseUrl,
      "GET",
      "/billing/plan-profile",
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyBillingPlanProfileDenied, 403, "api key denied billing plan profile");
    assert(
      String(apiKeyBillingPlanProfileDenied.payload?.reason ?? "") === "API_CLIENT_FORBIDDEN",
      `expected API_CLIENT_FORBIDDEN for api key billing plan profile, got ${JSON.stringify(apiKeyBillingPlanProfileDenied.payload)}`,
    );

    const apiKeyBillingUpgradeRequestDenied = await apiRequest(
      baseUrl,
      "GET",
      "/billing/upgrade-request",
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyBillingUpgradeRequestDenied, 403, "api key denied billing upgrade request");
    assert(
      String(apiKeyBillingUpgradeRequestDenied.payload?.reason ?? "") === "API_CLIENT_FORBIDDEN",
      `expected API_CLIENT_FORBIDDEN for api key billing upgrade request, got ${JSON.stringify(apiKeyBillingUpgradeRequestDenied.payload)}`,
    );

    const apiKeyInstalledConnectorsDenied = await apiRequest(
      baseUrl,
      "GET",
      "/connectors/installed?limit=50",
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyInstalledConnectorsDenied, 403, "api key denied installed connectors");
    assert(
      String(apiKeyInstalledConnectorsDenied.payload?.reason ?? "") === "API_CLIENT_FORBIDDEN",
      `expected API_CLIENT_FORBIDDEN for api key installed connectors, got ${JSON.stringify(apiKeyInstalledConnectorsDenied.payload)}`,
    );

    const apiKeyConnectorDefinitionsDenied = await apiRequest(
      baseUrl,
      "GET",
      "/connectors/definitions",
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyConnectorDefinitionsDenied, 403, "api key denied connector definitions");
    assert(
      String(apiKeyConnectorDefinitionsDenied.payload?.reason ?? "") === "API_CLIENT_FORBIDDEN",
      `expected API_CLIENT_FORBIDDEN for api key connector definitions, got ${JSON.stringify(apiKeyConnectorDefinitionsDenied.payload)}`,
    );

    const apiKeyMarketplaceChannelsDenied = await apiRequest(
      baseUrl,
      "GET",
      "/marketplace/channels",
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyMarketplaceChannelsDenied, 403, "api key denied marketplace channels");
    assert(
      String(apiKeyMarketplaceChannelsDenied.payload?.reason ?? "") === "API_CLIENT_FORBIDDEN",
      `expected API_CLIENT_FORBIDDEN for api key marketplace channels, got ${JSON.stringify(apiKeyMarketplaceChannelsDenied.payload)}`,
    );

    const apiKeySubmissionsDenied = await apiRequest(
      baseUrl,
      "GET",
      "/submissions?connectorSlug=amazon-in",
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeySubmissionsDenied, 403, "api key denied submissions");
    assert(
      String(apiKeySubmissionsDenied.payload?.reason ?? "") === "API_CLIENT_FORBIDDEN",
      `expected API_CLIENT_FORBIDDEN for api key submissions, got ${JSON.stringify(apiKeySubmissionsDenied.payload)}`,
    );

    const apiKeyDeadLetterDenied = await apiRequest(
      baseUrl,
      "GET",
      "/submissions/dead-letter",
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyDeadLetterDenied, 403, "api key denied dead-letter submissions");
    assert(
      String(apiKeyDeadLetterDenied.payload?.reason ?? "") === "API_CLIENT_FORBIDDEN",
      `expected API_CLIENT_FORBIDDEN for api key dead-letter submissions, got ${JSON.stringify(apiKeyDeadLetterDenied.payload)}`,
    );

    const apiKeyAutoSuggestionDenied = await apiRequest(
      baseUrl,
      "GET",
      `/auto-suggestions/products/${product.payload.id}/title-suggestion`,
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyAutoSuggestionDenied, 403, "api key denied auto suggestion reads");
    assert(
      String(apiKeyAutoSuggestionDenied.payload?.reason ?? "") === "API_CLIENT_SCOPE_FORBIDDEN",
      `expected API_CLIENT_SCOPE_FORBIDDEN for catalog-scoped api key auto suggestion reads, got ${JSON.stringify(apiKeyAutoSuggestionDenied.payload)}`,
    );

    const apiKeyRejectionScoreDenied = await apiRequest(
      baseUrl,
      "GET",
      `/rejection-intelligence/products/${product.payload.id}/score?channel=amazon`,
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyRejectionScoreDenied, 403, "api key denied rejection intelligence score");
    assert(
      String(apiKeyRejectionScoreDenied.payload?.reason ?? "") === "API_CLIENT_SCOPE_FORBIDDEN",
      `expected API_CLIENT_SCOPE_FORBIDDEN for catalog-scoped api key rejection intelligence score, got ${JSON.stringify(apiKeyRejectionScoreDenied.payload)}`,
    );

    const apiKeyBulkImportJobsAllowed = await apiRequest(
      baseUrl,
      "GET",
      "/bulk-import/jobs",
      null,
      undefined,
      { "x-pim-api-key": bulkImportReadApiKeyValue },
    );
    assertStatus(apiKeyBulkImportJobsAllowed, 200, "api key allowed explicit bulk import jobs read");
    assert(
      Array.isArray(apiKeyBulkImportJobsAllowed.payload) || Array.isArray(apiKeyBulkImportJobsAllowed.payload?.items),
      `expected bulk-import-read api key jobs payload, got ${JSON.stringify(apiKeyBulkImportJobsAllowed.payload)}`,
    );

    const apiKeyBulkImportJobsNoScopeDenied = await apiRequest(
      baseUrl,
      "GET",
      "/bulk-import/jobs",
      null,
      undefined,
      { "x-pim-api-key": noScopeApiKeyValue },
    );
    assertStatus(apiKeyBulkImportJobsNoScopeDenied, 403, "api key without scopes denied bulk import jobs");
    assert(
      String(apiKeyBulkImportJobsNoScopeDenied.payload?.reason ?? "") === "API_CLIENT_SCOPE_FORBIDDEN",
      `expected API_CLIENT_SCOPE_FORBIDDEN for no-scope bulk import jobs read, got ${JSON.stringify(apiKeyBulkImportJobsNoScopeDenied.payload)}`,
    );

    const apiKeyBulkImportJobsWrongScopeDenied = await apiRequest(
      baseUrl,
      "GET",
      "/bulk-import/jobs",
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyBulkImportJobsWrongScopeDenied, 403, "api key with unrelated scope denied bulk import jobs");
    assert(
      String(apiKeyBulkImportJobsWrongScopeDenied.payload?.reason ?? "") === "API_CLIENT_SCOPE_FORBIDDEN",
      `expected API_CLIENT_SCOPE_FORBIDDEN for unrelated-scope bulk import jobs read, got ${JSON.stringify(apiKeyBulkImportJobsWrongScopeDenied.payload)}`,
    );

    const apiKeyBulkImportWriteDenied = await apiRequest(
      baseUrl,
      "POST",
      "/bulk-import/jobs",
      null,
      {
        categoryId: category.payload.id,
        sourceFormat: "json",
        rows: [],
        chunkSize: 1,
        maxRetries: 1,
      },
      { "x-pim-api-key": bulkImportReadApiKeyValue },
    );
    assertStatus(apiKeyBulkImportWriteDenied, 403, "bulk-import-read api key denied bulk import job write");
    assert(
      String(apiKeyBulkImportWriteDenied.payload?.reason ?? "") === "API_CLIENT_FORBIDDEN",
      `expected API_CLIENT_FORBIDDEN for bulk-import-read api key write, got ${JSON.stringify(apiKeyBulkImportWriteDenied.payload)}`,
    );

    const apiKeyBulkEditOperationsDenied = await apiRequest(
      baseUrl,
      "GET",
      "/bulk-edit/operations",
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyBulkEditOperationsDenied, 403, "api key denied bulk edit operations");
    assert(
      String(apiKeyBulkEditOperationsDenied.payload?.reason ?? "") === "API_CLIENT_FORBIDDEN",
      `expected API_CLIENT_FORBIDDEN for api key bulk edit operations, got ${JSON.stringify(apiKeyBulkEditOperationsDenied.payload)}`,
    );

    const apiKeyAuditLogsDenied = await apiRequest(
      baseUrl,
      "GET",
      "/audit/logs?limit=10",
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyAuditLogsDenied, 403, "api key denied audit logs");
    assert(
      String(apiKeyAuditLogsDenied.payload?.reason ?? "") === "API_CLIENT_FORBIDDEN",
      `expected API_CLIENT_FORBIDDEN for api key audit logs, got ${JSON.stringify(apiKeyAuditLogsDenied.payload)}`,
    );

    const apiKeyPrivacyStatusDenied = await apiRequest(
      baseUrl,
      "GET",
      "/auth/account/privacy-status",
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyPrivacyStatusDenied, 403, "api key denied account privacy status");
    assert(
      String(apiKeyPrivacyStatusDenied.payload?.reason ?? "") === "API_CLIENT_FORBIDDEN",
      `expected API_CLIENT_FORBIDDEN for api key account privacy status, got ${JSON.stringify(apiKeyPrivacyStatusDenied.payload)}`,
    );

    const apiKeyAccountExportDownloadDenied = await apiRequest(
      baseUrl,
      "GET",
      `/auth/account/export/${encodeURIComponent(viewerExportJobId)}/download`,
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyAccountExportDownloadDenied, 403, "api key denied account export download");
    assert(
      String(apiKeyAccountExportDownloadDenied.payload?.reason ?? "") === "API_CLIENT_FORBIDDEN",
      `expected API_CLIENT_FORBIDDEN for api key account export download, got ${JSON.stringify(apiKeyAccountExportDownloadDenied.payload)}`,
    );

    const apiKeyNotificationsDenied = await apiRequest(
      baseUrl,
      "GET",
      "/notifications?limit=20",
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyNotificationsDenied, 403, "api key denied notifications");
    assert(
      String(apiKeyNotificationsDenied.payload?.reason ?? "") === "API_CLIENT_FORBIDDEN",
      `expected API_CLIENT_FORBIDDEN for api key notifications, got ${JSON.stringify(apiKeyNotificationsDenied.payload)}`,
    );

    const editorHumanIssueInboxAllowed = await apiRequest(
      baseUrl,
      "GET",
      "/issues/inbox?pagination=cursor&limit=5",
      editorToken,
    );
    assertStatus(editorHumanIssueInboxAllowed, 200, "editor human issue inbox remains allowed");
    assert(
      Array.isArray(editorHumanIssueInboxAllowed.payload?.items),
      `expected editor human issue inbox payload, got ${JSON.stringify(editorHumanIssueInboxAllowed.payload)}`,
    );

    const apiKeyIssueInboxAllowed = await apiRequest(
      baseUrl,
      "GET",
      "/issues/inbox?pagination=cursor&limit=5",
      null,
      undefined,
      { "x-pim-api-key": issuesReadApiKeyValue },
    );
    assertStatus(apiKeyIssueInboxAllowed, 200, "api key allowed explicit issue inbox read");
    assert(
      Array.isArray(apiKeyIssueInboxAllowed.payload?.items),
      `expected issues-read api key inbox payload, got ${JSON.stringify(apiKeyIssueInboxAllowed.payload)}`,
    );

    const apiKeyIssueInboxNoScopeDenied = await apiRequest(
      baseUrl,
      "GET",
      "/issues/inbox?pagination=cursor&limit=5",
      null,
      undefined,
      { "x-pim-api-key": noScopeApiKeyValue },
    );
    assertStatus(apiKeyIssueInboxNoScopeDenied, 403, "api key without scopes denied issue inbox");
    assert(
      String(apiKeyIssueInboxNoScopeDenied.payload?.reason ?? "") === "API_CLIENT_SCOPE_FORBIDDEN",
      `expected API_CLIENT_SCOPE_FORBIDDEN for no-scope issue inbox read, got ${JSON.stringify(apiKeyIssueInboxNoScopeDenied.payload)}`,
    );

    const apiKeyIssueInboxWrongScopeDenied = await apiRequest(
      baseUrl,
      "GET",
      "/issues/inbox?pagination=cursor&limit=5",
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyIssueInboxWrongScopeDenied, 403, "api key with unrelated scope denied issue inbox");
    assert(
      String(apiKeyIssueInboxWrongScopeDenied.payload?.reason ?? "") === "API_CLIENT_SCOPE_FORBIDDEN",
      `expected API_CLIENT_SCOPE_FORBIDDEN for unrelated-scope issue inbox read, got ${JSON.stringify(apiKeyIssueInboxWrongScopeDenied.payload)}`,
    );

    const apiKeyIssueInboxResolveDenied = await apiRequest(
      baseUrl,
      "POST",
      "/issues/inbox/resolve",
      null,
      { issueIds: ["issue-not-needed-for-guard-check"] },
      { "x-pim-api-key": issuesReadApiKeyValue },
    );
    assertStatus(apiKeyIssueInboxResolveDenied, 403, "issues-read api key denied issue inbox resolve write");
    assert(
      String(apiKeyIssueInboxResolveDenied.payload?.reason ?? "") === "API_CLIENT_FORBIDDEN",
      `expected API_CLIENT_FORBIDDEN for issues-read api key inbox resolve write, got ${JSON.stringify(apiKeyIssueInboxResolveDenied.payload)}`,
    );

    const apiKeyComplianceRulesDenied = await apiRequest(
      baseUrl,
      "GET",
      "/compliance/rules",
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyComplianceRulesDenied, 403, "api key denied compliance rules");
    assert(
      String(apiKeyComplianceRulesDenied.payload?.reason ?? "") === "API_CLIENT_FORBIDDEN",
      `expected API_CLIENT_FORBIDDEN for api key compliance rules, got ${JSON.stringify(apiKeyComplianceRulesDenied.payload)}`,
    );

    const apiKeyAdminKeysDenied = await apiRequest(
      baseUrl,
      "GET",
      "/admin/api-keys",
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyAdminKeysDenied, 403, "api key denied admin api-keys management");
    assert(
      String(apiKeyAdminKeysDenied.payload?.reason ?? "") === "API_CLIENT_FORBIDDEN",
      `expected API_CLIENT_FORBIDDEN for api key admin api-keys route, got ${JSON.stringify(apiKeyAdminKeysDenied.payload)}`,
    );

    const apiKeyWorkspaceUsersDenied = await apiRequest(
      baseUrl,
      "GET",
      "/admin/workspace/users",
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyWorkspaceUsersDenied, 403, "api key denied workspace user management");
    assert(
      String(apiKeyWorkspaceUsersDenied.payload?.reason ?? "") === "API_CLIENT_FORBIDDEN",
      `expected API_CLIENT_FORBIDDEN for api key workspace users route, got ${JSON.stringify(apiKeyWorkspaceUsersDenied.payload)}`,
    );

    const apiKeyAccessScopesDenied = await apiRequest(
      baseUrl,
      "GET",
      "/admin/workspace/access-scopes",
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyAccessScopesDenied, 403, "api key denied workspace access scope management");
    assert(
      String(apiKeyAccessScopesDenied.payload?.reason ?? "") === "API_CLIENT_FORBIDDEN",
      `expected API_CLIENT_FORBIDDEN for api key workspace access scopes route, got ${JSON.stringify(apiKeyAccessScopesDenied.payload)}`,
    );

    const apiKeyWebhooksDenied = await apiRequest(
      baseUrl,
      "GET",
      "/admin/webhooks",
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyWebhooksDenied, 403, "api key denied admin webhooks");
    assert(
      String(apiKeyWebhooksDenied.payload?.reason ?? "") === "API_CLIENT_FORBIDDEN",
      `expected API_CLIENT_FORBIDDEN for api key admin webhooks route, got ${JSON.stringify(apiKeyWebhooksDenied.payload)}`,
    );

    const systemAdminScopeMutationDenied = await apiRequest(
      baseUrl,
      "POST",
      "/admin/workspace/access-scopes",
      systemAdminToken,
      {
        subjectType: "user",
        subjectId: boundaryTargetUser,
        scopeType: "brand",
        scopeValue: `boundary-brand-${runId}`,
        actions: ["view"],
      },
    );
    assertStatus(systemAdminScopeMutationDenied, 403, "system admin denied super-admin-only scope mutation");
    assert(
      String(systemAdminScopeMutationDenied.payload?.reason ?? "") === "ADMIN_BOUNDARY_FORBIDDEN",
      `expected ADMIN_BOUNDARY_FORBIDDEN for system admin scope mutation, got ${JSON.stringify(systemAdminScopeMutationDenied.payload)}`,
    );

    const superAdminScopeMutationAllowed = await apiRequest(
      baseUrl,
      "POST",
      "/admin/workspace/access-scopes",
      superAdminToken,
      {
        subjectType: "user",
        subjectId: boundaryTargetUser,
        scopeType: "brand",
        scopeValue: `boundary-brand-${runId}`,
        actions: ["view"],
      },
    );
    assertStatus(superAdminScopeMutationAllowed, 201, "super admin allowed scope mutation");
    assert(
      String(superAdminScopeMutationAllowed.payload?.scopeType ?? "") === "brand",
      `expected super admin scope mutation to create brand assignment, got ${JSON.stringify(superAdminScopeMutationAllowed.payload)}`,
    );

    const denialRows = await prisma.$queryRawUnsafe(
      `
      SELECT action, resource, metadata
      FROM audit_logs
      WHERE tenant_key = $1
        AND action = 'AUTHORIZATION_DENIED'
      ORDER BY created_at DESC
      LIMIT 200
      `,
      tenantId,
    );
    const rows = Array.isArray(denialRows) ? denialRows : [];
    const reasonCodes = rows.map((row) => String(row.metadata?.reasonCode ?? ""));
    assert(reasonCodes.includes("ROLE_FORBIDDEN"), `expected ROLE_FORBIDDEN audit row, got ${JSON.stringify(rows)}`);
    assert(reasonCodes.includes("FIELD_WRITE_RESTRICTED"), `expected FIELD_WRITE_RESTRICTED audit row, got ${JSON.stringify(rows)}`);
    assert(
      reasonCodes.includes("SENSITIVE_PAYLOAD_RESTRICTED"),
      `expected SENSITIVE_PAYLOAD_RESTRICTED audit row, got ${JSON.stringify(rows)}`,
    );
    const serializedRows = JSON.stringify(rows);
    assert(!serializedRows.includes("Authorization"), "audit denial rows must not contain raw authorization headers");
    assert(!serializedRows.includes(adminToken), "audit denial rows must not contain bearer tokens");
    assert(!serializedRows.includes(editorToken), "audit denial rows must not contain bearer tokens");
    assert(!serializedRows.includes(reviewerToken), "audit denial rows must not contain bearer tokens");

    const shadowMismatchRows = await prisma.$queryRawUnsafe(
      `
      SELECT action, resource, metadata
      FROM audit_logs
      WHERE tenant_key = $1
        AND action = 'POLICY_SHADOW_MISMATCH'
      ORDER BY created_at DESC
      LIMIT 10
      `,
      tenantId,
    );
    assert(
      Array.isArray(shadowMismatchRows) && shadowMismatchRows.length === 0,
      `expected policy shadow mode to match legacy RBAC, got ${JSON.stringify(shadowMismatchRows)}`,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          validated: [
            "editor_restricted_product_attribute_write_denied",
            "editor_non_pricing_variant_update_allowed",
            "editor_pricing_variant_update_denied",
            "editor_variant_delete_denied",
            "viewer_product_reads_redact_sensitive_catalog_fields",
            "viewer_catalog_search_redacts_matched_sku",
            "admin_catalog_search_retains_matched_sku",
            "legacy_product_alias_reads_use_actor_aware_redaction",
            "editor_bulk_edit_restricted_field_denied",
            "admin_bulk_edit_restricted_field_allowed",
            "editor_bulk_import_restricted_field_denied",
            "viewer_and_reviewer_denied_bulk_operation_reads",
            "editor_allowed_bulk_operation_reads",
            "viewer_reviewer_and_editor_denied_audit_logs",
            "admin_allowed_audit_logs",
            "viewer_catalog_stats_redact_approval_queue",
            "reviewer_and_admin_catalog_stats_retain_approval_queue",
            "viewer_and_reviewer_denied_auto_suggestion_reads",
            "editor_allowed_auto_suggestion_reads",
            "viewer_denied_rejection_intelligence_score",
            "reviewer_allowed_rejection_intelligence_score",
            "viewer_and_reviewer_denied_billing_usage_reads",
            "editor_and_admin_allowed_billing_usage_reads",
            "viewer_reviewer_and_editor_denied_billing_plan_profile_and_upgrade_request_reads",
            "admin_allowed_billing_plan_profile_and_upgrade_request_reads",
            "viewer_self_service_account_reads_allowed",
            "product_admin_denied_system_admin_user_management_routes",
            "system_admin_allowed_workspace_user_and_api_key_reads",
            "product_admin_denied_security_scope_routes",
            "product_admin_allowed_product_data_governance_reads",
            "system_admin_denied_product_data_governance_reads",
            "system_admin_audit_logs_redact_metadata",
            "super_admin_audit_logs_retain_metadata",
            "blocked_foundation_roles_denied_admin_boundary_routes",
            "system_admin_webhook_delivery_reads_redact_error_messages",
            "super_admin_webhook_delivery_reads_retain_error_messages",
            "category_manager_allowed_scoped_catalog_and_taxonomy_paths_only",
            "category_manager_denied_out_of_scope_and_hierarchy_mutation_paths",
            "vendor_allowed_owned_catalog_reads_on_proven_path_only",
            "vendor_allowed_owned_compliance_issue_reads_on_proven_path_only",
            "vendor_allowed_owned_rejection_score_reads_on_proven_path_only",
            "vendor_allowed_owned_auto_suggestion_reads_on_proven_path_only",
            "vendor_allowed_owned_auto_suggestion_attribute_reads_on_proven_path_only",
            "vendor_allowed_owned_auto_suggestion_category_reads_on_proven_path_only",
            "vendor_allowed_owned_media_reads_on_proven_path_only",
            "vendor_denied_unowned_catalog_resources_and_non_proven_paths",
            "product_admin_denied_billing_governance_reads",
            "system_admin_allowed_billing_governance_reads",
            "product_admin_denied_billing_plan_tier_governance",
            "system_admin_and_super_admin_billing_plan_tier_stay_internal_only",
            "system_admin_billing_plan_profile_redacts_sensitive_fields",
            "super_admin_billing_plan_profile_retains_sensitive_fields",
            "system_admin_billing_upgrade_request_redacts_sensitive_fields",
            "super_admin_billing_upgrade_request_retains_sensitive_fields",
            "system_admin_audit_events_redact_metadata",
            "super_admin_audit_events_retain_metadata",
            "system_admin_audit_events_export_redacts_metadata",
            "super_admin_audit_events_export_retains_metadata",
            "product_admin_denied_security_governance_reads",
            "system_admin_allowed_security_governance_reads",
            "editor_denied_outbound_webhook_governance_reads",
            "system_admin_denied_super_admin_only_scope_mutations",
            "super_admin_allowed_scope_mutation_routes",
            "viewer_and_reviewer_denied_dashboard_readiness_reads",
            "editor_and_admin_allowed_dashboard_readiness_reads",
            "viewer_and_reviewer_denied_dashboard_catalog_health_reads",
            "editor_and_admin_allowed_dashboard_catalog_health_reads",
            "viewer_dashboard_health_receives_redacted_aggregate_response",
            "reviewer_dashboard_health_keeps_quality_queue_while_redacting_connector_breakdown",
            "admin_dashboard_health_retains_full_visibility",
            "viewer_and_reviewer_denied_dashboard_operations_summary_reads",
            "editor_and_admin_allowed_dashboard_operations_summary_reads",
            "viewer_reviewer_and_editor_denied_metrics_kpi_trends",
            "admin_allowed_metrics_kpi_trends",
            "viewer_denied_sensitive_connector_and_export_reads",
            "viewer_denied_sensitive_submission_reads",
            "viewer_reviewer_and_editor_denied_compliance_rule_reads",
            "admin_allowed_compliance_rule_reads",
            "product_admin_allowed_compliance_rule_governance",
            "system_admin_denied_compliance_rule_governance",
            "product_admin_allowed_catalog_product_purge",
            "system_admin_denied_catalog_product_purge",
            "product_admin_allowed_export_job_and_simulation_governance",
            "system_admin_denied_export_job_and_simulation_governance",
            "product_admin_allowed_marketplace_mapping_archive_governance",
            "system_admin_denied_marketplace_mapping_archive_governance",
            "product_admin_allowed_marketplace_readiness_and_preflight_governance",
            "system_admin_denied_marketplace_readiness_and_preflight_governance",
            "product_admin_denied_connector_installation_record_delete",
            "system_admin_allowed_connector_installation_record_delete",
            "product_admin_allowed_taxonomy_governance",
            "system_admin_denied_taxonomy_governance",
            "viewer_and_reviewer_denied_connector_management_writes",
            "editor_connector_reconnect_allowed_after_grant",
            "editor_preview_denied_without_connector_permission",
            "editor_preview_denied_by_sensitive_payload_policy_after_grant",
            "admin_preview_allowed",
            "editor_marketplace_export_denied_by_sensitive_payload_policy",
            "editor_human_issue_inbox_read_unchanged",
            "api_key_principal_allows_explicit_issue_inbox_reads_with_exact_scope",
            "api_key_principal_denies_issue_inbox_reads_without_exact_scope",
            "api_key_principal_denies_issue_inbox_writes_even_with_read_scope",
            "editor_human_bulk_import_reads_unchanged",
            "api_key_principal_allows_explicit_bulk_import_reads_with_exact_scope",
            "api_key_principal_denies_bulk_import_reads_without_exact_scope",
            "api_key_principal_denies_bulk_import_writes_even_with_read_scope",
            "admin_bulk_import_error_rows_retain_full_source_payload",
            "editor_bulk_import_error_rows_redact_sensitive_source_payload",
            "bulk_import_error_report_csv_uses_same_visibility_contract",
            "api_key_principal_denied_human_connector_routes",
            "api_key_principal_denied_human_marketplace_routes",
            "api_key_principal_denied_human_submission_routes",
            "api_key_principal_requires_explicit_scope_for_ai_helper_routes",
            "api_key_principal_denied_human_bulk_operation_routes",
            "api_key_principal_denied_human_audit_routes",
            "api_key_principal_denied_human_billing_detail_routes",
            "api_key_principal_allows_explicit_taxonomy_reads_with_exact_scope",
            "api_key_principal_requires_matching_catalog_scope_for_allowed_routes",
            "api_key_principal_denies_missing_and_unrelated_catalog_scopes",
            "api_key_principal_cannot_use_human_role_fallback_to_bypass_scope_requirements",
            "api_key_principal_keeps_allowed_catalog_reads_but_cannot_access_human_dashboard_billing_account_notification_compliance_or_admin_governance_routes",
            "api_key_principal_denied_account_export_download",
            "policy_shadow_mode_matches_legacy_rbac_on_covered_paths",
            "authorization_denials_audited_with_sanitized_metadata",
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
    console.error("Access policy remediation integration test failed:");
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
          // ignore cleanup failures
        }
      } else {
        apiProcess.kill("SIGTERM");
        await sleep(500);
        if (!apiProcess.killed) {
          apiProcess.kill("SIGKILL");
        }
      }
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
