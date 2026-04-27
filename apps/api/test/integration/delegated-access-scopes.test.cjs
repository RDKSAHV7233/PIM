#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9oN0b1sAAAAASUVORK5CYII=";

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
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

function assertStatusIn(result, expected, context) {
  if (!expected.includes(result.status)) {
    throw new Error(`${context} failed: expected one of ${expected.join(", ")}, got ${result.status}; payload=${JSON.stringify(result.payload)}`);
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

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 7450 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantA = `scope-a-${runId}`;
  const workspaceA = `scope-a-${runId}`.slice(0, 24);
  const adminA = `scope-admin-${runId}`;
  const categoryUser = `scope-cat-${runId}`;
  const brandUser = `scope-brand-${runId}`;
  const channelUser = `scope-channel-${runId}`;
  const comboUser = `scope-combo-${runId}`;
  const channelOnlyUser = `scope-channel-only-${runId}`;
  const accountOnlyUser = `scope-account-only-${runId}`;
  const tenantB = `scope-b-${runId}`;
  const workspaceB = `scope-b-${runId}`.slice(0, 24);
  const adminB = `scope-b-admin-${runId}`;
  const commercialToken = `commercial-ops-${runId}`;
  const authPassword = "vexa-pim-demo-password";

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantA,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [adminA]: { tenantId: tenantA, role: "admin", workspaceSlug: workspaceA },
      [categoryUser]: { tenantId: tenantA, role: "editor", workspaceSlug: workspaceA },
      [brandUser]: { tenantId: tenantA, role: "editor", workspaceSlug: workspaceA },
      [channelUser]: { tenantId: tenantA, role: "editor", workspaceSlug: workspaceA },
      [comboUser]: { tenantId: tenantA, role: "editor", workspaceSlug: workspaceA },
      [channelOnlyUser]: { tenantId: tenantA, role: "editor", workspaceSlug: workspaceA },
      [accountOnlyUser]: { tenantId: tenantA, role: "editor", workspaceSlug: workspaceA },
      [adminB]: { tenantId: tenantB, role: "admin", workspaceSlug: workspaceB },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceA]: { tenantId: tenantA, displayName: "Delegated Access A" },
      [workspaceB]: { tenantId: tenantB, displayName: "Delegated Access B" },
    }),
    PIM_AUTH_PASSWORD: authPassword,
    PIM_COMMERCIAL_OPS_TOKEN: commercialToken,
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

    const adminALogin = await login(baseUrl, workspaceA, adminA, authPassword);
    const categoryLogin = await login(baseUrl, workspaceA, categoryUser, authPassword);
    const brandLogin = await login(baseUrl, workspaceA, brandUser, authPassword);
    const channelLogin = await login(baseUrl, workspaceA, channelUser, authPassword);
    const comboLogin = await login(baseUrl, workspaceA, comboUser, authPassword);
    const channelOnlyLogin = await login(baseUrl, workspaceA, channelOnlyUser, authPassword);
    const accountOnlyLogin = await login(baseUrl, workspaceA, accountOnlyUser, authPassword);
    const adminBLogin = await login(baseUrl, workspaceB, adminB, authPassword);
    assertStatus(adminALogin, 201, "tenant A admin login");
    assertStatus(categoryLogin, 201, "category user login");
    assertStatus(brandLogin, 201, "brand user login");
    assertStatus(channelLogin, 201, "channel user login");
    assertStatus(comboLogin, 201, "combo user login");
    assertStatus(channelOnlyLogin, 201, "channel-only user login");
    assertStatus(accountOnlyLogin, 201, "account-only user login");
    assertStatus(adminBLogin, 201, "tenant B admin login");

    const adminAToken = String(adminALogin.payload?.accessToken ?? "");
    const categoryToken = String(categoryLogin.payload?.accessToken ?? "");
    const brandToken = String(brandLogin.payload?.accessToken ?? "");
    const channelToken = String(channelLogin.payload?.accessToken ?? "");
    const comboToken = String(comboLogin.payload?.accessToken ?? "");
    const channelOnlyToken = String(channelOnlyLogin.payload?.accessToken ?? "");
    const accountOnlyToken = String(accountOnlyLogin.payload?.accessToken ?? "");
    const adminBToken = String(adminBLogin.payload?.accessToken ?? "");

    const setEnterpriseA = await commercialPlanRequest(baseUrl, commercialToken, tenantA, "ENTERPRISE");
    const setEnterpriseB = await commercialPlanRequest(baseUrl, commercialToken, tenantB, "ENTERPRISE");
    assertStatusIn(setEnterpriseA, [200, 201], "set enterprise A");
    assertStatusIn(setEnterpriseB, [200, 201], "set enterprise B");

    const createCategoryUser = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminAToken, {
      userId: categoryUser,
      role: "editor",
    });
    const createBrandUser = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminAToken, {
      userId: brandUser,
      role: "editor",
    });
    const createChannelUser = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminAToken, {
      userId: channelUser,
      role: "editor",
    });
    const createComboUser = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminAToken, {
      userId: comboUser,
      role: "editor",
    });
    const createChannelOnlyUser = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminAToken, {
      userId: channelOnlyUser,
      role: "editor",
    });
    const createAccountOnlyUser = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminAToken, {
      userId: accountOnlyUser,
      role: "editor",
    });
    assertStatusIn(createCategoryUser, [201, 409], "create category scope user");
    assertStatusIn(createBrandUser, [201, 409], "create brand scope user");
    assertStatusIn(createChannelUser, [201, 409], "create channel scope user");
    assertStatusIn(createComboUser, [201, 409], "create combo scope user");
    assertStatusIn(createChannelOnlyUser, [201, 409], "create channel-only scope user");
    assertStatusIn(createAccountOnlyUser, [201, 409], "create account-only scope user");

    const categoryA1 = await apiRequest(baseUrl, "POST", "/taxonomy/categories", adminAToken, { name: `Category A1 ${runId}` });
    const categoryA2 = await apiRequest(baseUrl, "POST", "/taxonomy/categories", adminAToken, { name: `Category A2 ${runId}` });
    const categoryB1 = await apiRequest(baseUrl, "POST", "/taxonomy/categories", adminBToken, { name: `Category B1 ${runId}` });
    assertStatus(categoryA1, 201, "create category A1");
    assertStatus(categoryA2, 201, "create category A2");
    assertStatus(categoryB1, 201, "create category B1");

    const productA1Alpha = await apiRequest(baseUrl, "POST", "/catalog/products", adminAToken, {
      title: `Scoped Product A1 Alpha ${runId}`,
      brand: "Alpha Brand",
      description: "Intersection product",
      categoryId: categoryA1.payload.id,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 7,
      attributes: {},
    });
    const productA1Beta = await apiRequest(baseUrl, "POST", "/catalog/products", adminAToken, {
      title: `Scoped Product A1 Beta ${runId}`,
      brand: "Beta Brand",
      description: "Category-only match",
      categoryId: categoryA1.payload.id,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 7,
      attributes: {},
    });
    const productA2Alpha = await apiRequest(baseUrl, "POST", "/catalog/products", adminAToken, {
      title: `Scoped Product A2 Alpha ${runId}`,
      brand: "Alpha Brand",
      description: "Brand-only match",
      categoryId: categoryA2.payload.id,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 18,
      attributes: {},
    });
    const productA2Beta = await apiRequest(baseUrl, "POST", "/catalog/products", adminAToken, {
      title: `Scoped Product A2 Beta ${runId}`,
      brand: "Beta Brand",
      description: "Out-of-scope beta product",
      categoryId: categoryA2.payload.id,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 18,
      attributes: {},
    });
    assertStatus(productA1Alpha, 201, "create product A1 alpha");
    assertStatus(productA1Beta, 201, "create product A1 beta");
    assertStatus(productA2Alpha, 201, "create product A2 alpha");
    assertStatus(productA2Beta, 201, "create product A2 beta");

    const mediaA1Alpha = await apiRequest(baseUrl, "POST", "/media/assets", adminAToken, {
      productId: productA1Alpha.payload.id,
      fileName: "alpha.png",
      mimeType: "image/png",
      contentBase64: TINY_PNG,
      width: 1200,
      height: 1200,
    });
    const mediaA1Beta = await apiRequest(baseUrl, "POST", "/media/assets", adminAToken, {
      productId: productA1Beta.payload.id,
      fileName: "beta.png",
      mimeType: "image/png",
      contentBase64: TINY_PNG,
      width: 1200,
      height: 1200,
    });
    assertStatus(mediaA1Alpha, 201, "create media A1 alpha");
    assertStatus(mediaA1Beta, 201, "create media A1 beta");

    let connectorDefinition = await prisma.connectorDefinition.findFirst({
      where: { slug: "shopify" },
      select: { id: true, slug: true },
    });
    if (!connectorDefinition) {
      connectorDefinition = await prisma.connectorDefinition.create({
        data: {
          id: randomUUID(),
          slug: "shopify",
          displayName: "Shopify",
          authType: "oauth",
          capabilities: ["PUBLISH"],
          connectorVersion: "1.0.0",
          isActive: true,
        },
        select: { id: true, slug: true },
      });
    }

    const installationA1 = randomUUID();
    const installationA2 = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO connector_installations (id, tenant_key, connector_id, account_alias, status, metadata, installed_at, installed_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', '{}'::jsonb, NOW(), $5, NOW(), NOW()),
              ($6, $2, $3, $7, 'ACTIVE', '{}'::jsonb, NOW(), $5, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      installationA1,
      tenantA,
      connectorDefinition.id,
      "scope-primary",
      adminA,
      installationA2,
      "scope-secondary",
    );

    const scopeCategory = await apiRequest(baseUrl, "POST", "/admin/workspace/access-scopes", adminAToken, {
      subjectType: "user",
      subjectId: categoryUser,
      scopeType: "category",
      categoryId: categoryA1.payload.id,
      actions: ["view", "edit", "create", "import", "bulk_edit"],
    });
    const scopeBrand = await apiRequest(baseUrl, "POST", "/admin/workspace/access-scopes", adminAToken, {
      subjectType: "user",
      subjectId: brandUser,
      scopeType: "brand",
      scopeValue: "Alpha Brand",
      actions: ["view", "edit", "bulk_edit"],
    });
    const scopeComboCategory = await apiRequest(baseUrl, "POST", "/admin/workspace/access-scopes", adminAToken, {
      subjectType: "user",
      subjectId: comboUser,
      scopeType: "category",
      categoryId: categoryA1.payload.id,
      actions: ["view", "edit", "create", "import", "bulk_edit"],
    });
    const scopeComboBrand = await apiRequest(baseUrl, "POST", "/admin/workspace/access-scopes", adminAToken, {
      subjectType: "user",
      subjectId: comboUser,
      scopeType: "brand",
      scopeValue: "Alpha Brand",
      actions: ["view", "edit", "create", "import", "bulk_edit"],
    });
    const scopeChannelCategory = await apiRequest(baseUrl, "POST", "/admin/workspace/access-scopes", adminAToken, {
      subjectType: "user",
      subjectId: channelUser,
      scopeType: "category",
      categoryId: categoryA1.payload.id,
      actions: ["view", "edit", "export"],
    });
    const scopeChannel = await apiRequest(baseUrl, "POST", "/admin/workspace/access-scopes", adminAToken, {
      subjectType: "user",
      subjectId: channelUser,
      scopeType: "channel",
      scopeValue: "shopify",
      actions: ["view", "edit", "export", "manage_connector", "preview_connector_payload"],
    });
    const scopeChannelOnly = await apiRequest(baseUrl, "POST", "/admin/workspace/access-scopes", adminAToken, {
      subjectType: "user",
      subjectId: channelOnlyUser,
      scopeType: "channel",
      scopeValue: "shopify",
      actions: ["view", "edit", "export", "manage_connector", "preview_connector_payload"],
    });
    const scopeConnectorAccount = await apiRequest(baseUrl, "POST", "/admin/workspace/access-scopes", adminAToken, {
      subjectType: "user",
      subjectId: channelUser,
      scopeType: "connector_account",
      connectorInstallationId: installationA1,
      actions: ["manage_connector", "preview_connector_payload"],
    });
    const scopeAccountOnly = await apiRequest(baseUrl, "POST", "/admin/workspace/access-scopes", adminAToken, {
      subjectType: "user",
      subjectId: accountOnlyUser,
      scopeType: "connector_account",
      connectorInstallationId: installationA1,
      actions: ["manage_connector", "preview_connector_payload"],
    });
    const scopeTenantB = await apiRequest(baseUrl, "POST", "/admin/workspace/access-scopes", adminBToken, {
      subjectType: "role",
      subjectId: "editor",
      scopeType: "category",
      categoryId: categoryB1.payload.id,
      actions: ["view"],
    });
    assertStatus(scopeCategory, 201, "create category scope assignment");
    assertStatus(scopeBrand, 201, "create brand scope assignment");
    assertStatus(scopeComboCategory, 201, "create combo category scope assignment");
    assertStatus(scopeComboBrand, 201, "create combo brand scope assignment");
    assertStatus(scopeChannelCategory, 201, "create channel user category scope assignment");
    assertStatus(scopeChannel, 201, "create channel scope assignment");
    assertStatus(scopeChannelOnly, 201, "create channel-only scope assignment");
    assertStatus(scopeConnectorAccount, 201, "create connector account scope assignment");
    assertStatus(scopeAccountOnly, 201, "create account-only scope assignment");
    assertStatus(scopeTenantB, 201, "create tenant B scope assignment");

    for (const pendingScopeType of ["vendor", "owner", "supplier", "locale", "market", "catalog", "team", "assignee"]) {
      const pendingScopeAttempt = await apiRequest(baseUrl, "POST", "/admin/workspace/access-scopes", adminAToken, {
        subjectType: "user",
        subjectId: comboUser,
        scopeType: pendingScopeType,
        scopeValue: `${pendingScopeType}-value`,
        actions: ["view"],
      });
      assertStatusIn(pendingScopeAttempt, [400, 403], `reject pending scope dimension ${pendingScopeType}`);
      assert(
        ["ACCESS_SCOPE_DIMENSION_REQUIRES_ENFORCEMENT", "Unsupported scope type."].includes(
          String(pendingScopeAttempt.payload?.error ?? pendingScopeAttempt.payload?.message ?? ""),
        ),
        `expected explicit pending-scope rejection for ${pendingScopeType}, got ${JSON.stringify(pendingScopeAttempt.payload)}`,
      );
    }

    const validateScopedProductA1Alpha = await apiRequest(
      baseUrl,
      "POST",
      `/compliance/products/${productA1Alpha.payload.id}/validate`,
      adminAToken,
      {},
    );
    const validateScopedProductA1Beta = await apiRequest(
      baseUrl,
      "POST",
      `/compliance/products/${productA1Beta.payload.id}/validate`,
      adminAToken,
      {},
    );
    assertStatus(validateScopedProductA1Alpha, 201, "validate scoped product A1 alpha");
    assertStatus(validateScopedProductA1Beta, 201, "validate scoped product A1 beta");

    const tenantAAssignments = await apiRequest(baseUrl, "GET", "/admin/workspace/access-scopes", adminAToken);
    assertStatus(tenantAAssignments, 200, "list tenant A scope assignments");
    assert(
      Array.isArray(tenantAAssignments.payload) &&
        tenantAAssignments.payload.every((item) => item.tenantKey === tenantA),
      "tenant A scope list should only include tenant A assignments",
    );

    const crossTenantDelete = await apiRequest(
      baseUrl,
      "DELETE",
      `/admin/workspace/access-scopes/${encodeURIComponent(scopeTenantB.payload.id)}`,
      adminAToken,
    );
    assertStatus(crossTenantDelete, 404, "cross-tenant access scope delete denied");

    const categoryOnlyList = await apiRequest(baseUrl, "GET", "/catalog/products?slim=true", categoryToken);
    assertStatus(categoryOnlyList, 200, "category-only list");
    assert(Array.isArray(categoryOnlyList.payload?.items), "category-only list should be paginated");
    assert(categoryOnlyList.payload.items.length === 0, `expected 0 category-only products under intersection semantics, got ${categoryOnlyList.payload.items.length}`);

    const categoryOnlyDetailDenied = await apiRequest(baseUrl, "GET", `/catalog/products/${productA1Alpha.payload.id}`, categoryToken);
    assertStatus(categoryOnlyDetailDenied, 403, "category-only product detail denied when brand dimension is active");

    const categoryOnlyUpdateDenied = await apiRequest(baseUrl, "PATCH", `/catalog/products/${productA1Alpha.payload.id}`, categoryToken, {
      expectedVersion: productA1Alpha.payload.version,
      title: `Scoped Product A1 Alpha Updated ${runId}`,
      brand: productA1Alpha.payload.brand,
      description: productA1Alpha.payload.description,
      categoryId: productA1Alpha.payload.categoryId,
      status: productA1Alpha.payload.status,
      hsnCode: productA1Alpha.payload.hsnCode,
      gstRate: productA1Alpha.payload.gstRate,
      attributes: productA1Alpha.payload.attributes ?? {},
    });
    assertStatus(categoryOnlyUpdateDenied, 403, "category-only product update denied when brand dimension is active");

    const brandOnlyList = await apiRequest(baseUrl, "GET", "/catalog/products?slim=true", brandToken);
    assertStatus(brandOnlyList, 200, "brand-only list");
    assert(Array.isArray(brandOnlyList.payload?.items), "brand-only list should be paginated");
    assert(brandOnlyList.payload.items.length === 0, `expected 0 brand-only products under intersection semantics, got ${brandOnlyList.payload.items.length}`);

    const brandOnlyBulkEditDenied = await apiRequest(baseUrl, "POST", "/bulk-edit/apply", brandToken, {
      scope: { productIds: [productA1Alpha.payload.id] },
      updates: { title: `Brand Only Title ${runId}` },
    });
    assertStatus(brandOnlyBulkEditDenied, 403, "brand-only bulk edit denied when category dimension is active");

    const comboList = await apiRequest(baseUrl, "GET", "/catalog/products?slim=true", comboToken);
    assertStatus(comboList, 200, "combo list");
    assert(Array.isArray(comboList.payload?.items), "combo list should be paginated");
    assert(comboList.payload.items.length === 1, `expected 1 combo product under intersection semantics, got ${comboList.payload.items.length}`);
    assert(comboList.payload.items[0].id === productA1Alpha.payload.id, "combo list should return only category A1 + Alpha brand");

    const comboDetailAllowed = await apiRequest(baseUrl, "GET", `/catalog/products/${productA1Alpha.payload.id}`, comboToken);
    const comboDetailCategoryOnlyDenied = await apiRequest(baseUrl, "GET", `/catalog/products/${productA1Beta.payload.id}`, comboToken);
    const comboDetailBrandOnlyDenied = await apiRequest(baseUrl, "GET", `/catalog/products/${productA2Alpha.payload.id}`, comboToken);
    const comboAliasDetailAllowed = await apiRequest(baseUrl, "GET", `/products/${productA1Alpha.payload.id}`, comboToken);
    const comboAliasDetailDenied = await apiRequest(baseUrl, "GET", `/products/${productA1Beta.payload.id}`, comboToken);
    const comboAiTitleAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/auto-suggestions/products/${productA1Alpha.payload.id}/title-suggestion`,
      comboToken,
    );
    const comboAiTitleDenied = await apiRequest(
      baseUrl,
      "GET",
      `/auto-suggestions/products/${productA1Beta.payload.id}/title-suggestion`,
      comboToken,
    );
    const comboRejectionScoreAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/rejection-intelligence/products/${productA1Alpha.payload.id}/score?channel=shopify`,
      comboToken,
    );
    const comboRejectionScoreDenied = await apiRequest(
      baseUrl,
      "GET",
      `/rejection-intelligence/products/${productA1Beta.payload.id}/score?channel=shopify`,
      comboToken,
    );
    assertStatus(comboDetailAllowed, 200, "combo product detail allowed");
    assertStatus(comboDetailCategoryOnlyDenied, 403, "combo product detail denied for category-only match");
    assertStatus(comboDetailBrandOnlyDenied, 403, "combo product detail denied for brand-only match");
    assertStatus(comboAliasDetailAllowed, 200, "legacy product alias detail allowed in scope");
    assertStatus(comboAliasDetailDenied, 403, "legacy product alias detail denied out of scope");
    assertStatus(comboAiTitleAllowed, 200, "auto-suggestion direct read allowed in scope");
    assertStatus(comboAiTitleDenied, 403, "auto-suggestion direct read denied out of scope");
    assertStatus(comboRejectionScoreAllowed, 200, "rejection intelligence direct read allowed in scope");
    assertStatus(comboRejectionScoreDenied, 403, "rejection intelligence direct read denied out of scope");

    const comboProductIssuesAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/compliance/products/${productA1Alpha.payload.id}/issues`,
      comboToken,
    );
    const comboProductIssuesDenied = await apiRequest(
      baseUrl,
      "GET",
      `/compliance/products/${productA1Beta.payload.id}/issues`,
      comboToken,
    );
    assertStatus(comboProductIssuesAllowed, 200, "combo compliance product issues allowed");
    assert(
      Array.isArray(comboProductIssuesAllowed.payload) && comboProductIssuesAllowed.payload.length >= 1,
      `expected scoped product issues for combo user, got ${JSON.stringify(comboProductIssuesAllowed.payload)}`,
    );
    assertStatus(comboProductIssuesDenied, 403, "combo compliance product issues denied out of scope");

    const comboValidateAllowed = await apiRequest(
      baseUrl,
      "POST",
      `/compliance/products/${productA1Alpha.payload.id}/validate`,
      comboToken,
      {},
    );
    const comboValidateDenied = await apiRequest(
      baseUrl,
      "POST",
      `/compliance/products/${productA1Beta.payload.id}/validate`,
      comboToken,
      {},
    );
    assertStatus(comboValidateAllowed, 201, "combo compliance validate allowed in scope");
    assertStatus(comboValidateDenied, 403, "combo compliance validate denied out of scope");

    const comboIssueInbox = await apiRequest(baseUrl, "GET", "/issues/inbox?pagination=cursor&limit=25", comboToken);
    assertStatus(comboIssueInbox, 200, "combo issue inbox scoped");
    assert(Array.isArray(comboIssueInbox.payload?.items), "combo issue inbox should return items array");
    assert(comboIssueInbox.payload.items.length >= 1, "combo issue inbox should include scoped issues");
    assert(
      comboIssueInbox.payload.items.every((item) => item.productId === productA1Alpha.payload.id),
      `combo issue inbox must only contain fully scoped products, got ${JSON.stringify(comboIssueInbox.payload.items)}`,
    );

    const adminProductA1BetaIssues = await apiRequest(
      baseUrl,
      "GET",
      `/compliance/products/${productA1Beta.payload.id}/issues`,
      adminAToken,
    );
    assertStatus(adminProductA1BetaIssues, 200, "admin can read beta product issues");
    assert(
      Array.isArray(adminProductA1BetaIssues.payload) && adminProductA1BetaIssues.payload.length >= 1,
      `expected beta issues for admin, got ${JSON.stringify(adminProductA1BetaIssues.payload)}`,
    );

    const comboResolveScopedWarning = await apiRequest(baseUrl, "POST", "/issues/inbox/resolve", comboToken, {
      issueIds: [comboIssueInbox.payload.items[0].issueId],
    });
    assertStatus(comboResolveScopedWarning, 201, "combo resolve scoped warning allowed");
    assert(
      Number(comboResolveScopedWarning.payload?.resolved ?? 0) >= 1,
      `expected combo scoped warning resolution to succeed, got ${JSON.stringify(comboResolveScopedWarning.payload)}`,
    );

    const comboResolveOutOfScopeWarningDenied = await apiRequest(baseUrl, "POST", "/issues/inbox/resolve", comboToken, {
      issueIds: [adminProductA1BetaIssues.payload[0].id],
    });
    assertStatus(comboResolveOutOfScopeWarningDenied, 403, "combo resolve out-of-scope warning denied");

    const comboUpdateAllowed = await apiRequest(baseUrl, "PATCH", `/catalog/products/${productA1Alpha.payload.id}`, comboToken, {
      expectedVersion: productA1Alpha.payload.version,
      title: `Scoped Product A1 Alpha Updated ${runId}`,
      brand: productA1Alpha.payload.brand,
      description: productA1Alpha.payload.description,
      categoryId: productA1Alpha.payload.categoryId,
      status: productA1Alpha.payload.status,
      hsnCode: productA1Alpha.payload.hsnCode,
      gstRate: productA1Alpha.payload.gstRate,
      attributes: productA1Alpha.payload.attributes ?? {},
    });
    assertStatus(comboUpdateAllowed, 200, "combo product update allowed");

    const comboUpdateCategoryOnlyDenied = await apiRequest(baseUrl, "PATCH", `/catalog/products/${productA1Beta.payload.id}`, comboToken, {
      expectedVersion: productA1Beta.payload.version,
      title: `Scoped Product A1 Beta Updated ${runId}`,
      brand: productA1Beta.payload.brand,
      description: productA1Beta.payload.description,
      categoryId: productA1Beta.payload.categoryId,
      status: productA1Beta.payload.status,
      hsnCode: productA1Beta.payload.hsnCode,
      gstRate: productA1Beta.payload.gstRate,
      attributes: productA1Beta.payload.attributes ?? {},
    });
    const comboUpdateBrandOnlyDenied = await apiRequest(baseUrl, "PATCH", `/catalog/products/${productA2Alpha.payload.id}`, comboToken, {
      expectedVersion: productA2Alpha.payload.version,
      title: `Scoped Product A2 Alpha Updated ${runId}`,
      brand: productA2Alpha.payload.brand,
      description: productA2Alpha.payload.description,
      categoryId: productA2Alpha.payload.categoryId,
      status: productA2Alpha.payload.status,
      hsnCode: productA2Alpha.payload.hsnCode,
      gstRate: productA2Alpha.payload.gstRate,
      attributes: productA2Alpha.payload.attributes ?? {},
    });
    assertStatus(comboUpdateCategoryOnlyDenied, 403, "combo product update denied for category-only match");
    assertStatus(comboUpdateBrandOnlyDenied, 403, "combo product update denied for brand-only match");

    const comboRepairDryRunAllowed = await apiRequest(
      baseUrl,
      "POST",
      `/auto-suggestions/products/${productA1Alpha.payload.id}/repair`,
      comboToken,
      { apply: false },
    );
    const comboRepairDryRunDenied = await apiRequest(
      baseUrl,
      "POST",
      `/auto-suggestions/products/${productA1Beta.payload.id}/repair`,
      comboToken,
      { apply: false },
    );
    assertStatus(comboRepairDryRunAllowed, 201, "auto-suggestion repair dry-run allowed in scope");
    assertStatus(comboRepairDryRunDenied, 403, "auto-suggestion repair dry-run denied out of scope");

    const comboMediaAllowed = await apiRequest(baseUrl, "GET", `/media/assets?productId=${encodeURIComponent(productA1Alpha.payload.id)}`, comboToken);
    const comboMediaDenied = await apiRequest(baseUrl, "GET", `/media/assets/${encodeURIComponent(mediaA1Beta.payload.id)}`, comboToken);
    assertStatus(comboMediaAllowed, 200, "combo media list allowed");
    assert(Array.isArray(comboMediaAllowed.payload) && comboMediaAllowed.payload.length === 1, "combo media list should only include intersection-matching asset");
    assertStatus(comboMediaDenied, 403, "combo media detail denied for category-only match");

    const mappingAllowed = await apiRequest(baseUrl, "POST", `/marketplace/categories/${categoryA1.payload.id}/templates`, channelToken, {
      name: `Scoped Shopify Template ${runId}`,
      channel: "shopify",
      requiredFields: ["title"],
      fieldMap: { title: "title" },
      isDefault: true,
    });
    const mappingDenied = await apiRequest(baseUrl, "POST", `/marketplace/categories/${categoryA1.payload.id}/templates`, channelToken, {
      name: `Denied Amazon Template ${runId}`,
      channel: "amazon",
      requiredFields: ["title"],
      fieldMap: { title: "item_name" },
      isDefault: false,
    });
    const mappingChannelOnlyDenied = await apiRequest(baseUrl, "POST", `/marketplace/categories/${categoryA1.payload.id}/templates`, channelOnlyToken, {
      name: `Denied Shopify Template ${runId}`,
      channel: "shopify",
      requiredFields: ["title"],
      fieldMap: { title: "title" },
      isDefault: false,
    });
    assertStatusIn(mappingAllowed, [200, 201], "channel-scoped template create allowed");
    assertStatus(mappingDenied, 403, "channel-scoped template create denied outside channel");
    assertStatus(mappingChannelOnlyDenied, 403, "channel-only template create denied when category dimension is active");

    const connectorListScoped = await apiRequest(baseUrl, "GET", "/connectors/installed", channelToken);
    const connectorListChannelOnly = await apiRequest(baseUrl, "GET", "/connectors/installed", channelOnlyToken);
    const connectorListAccountOnly = await apiRequest(baseUrl, "GET", "/connectors/installed", accountOnlyToken);
    assertStatus(connectorListScoped, 200, "connector list scoped");
    assertStatus(connectorListChannelOnly, 200, "connector list channel-only");
    assertStatus(connectorListAccountOnly, 200, "connector list account-only");
    assert(Array.isArray(connectorListScoped.payload?.items), "connector list should be paginated");
    assert(connectorListScoped.payload.items.length === 1, `expected one connector account in scope, got ${connectorListScoped.payload.items.length}`);
    assert(Array.isArray(connectorListChannelOnly.payload?.items) && connectorListChannelOnly.payload.items.length === 0, "channel-only user should not access connector accounts when connector-account dimension is active");
    assert(Array.isArray(connectorListAccountOnly.payload?.items) && connectorListAccountOnly.payload.items.length === 0, "account-only user should not access connector accounts when channel dimension is active");
    assert(connectorListScoped.payload.items[0].id === installationA1, "connector list should only include assigned connector installation");

    const connectorPreviewDenied = await apiRequest(baseUrl, "POST", `/connectors/${installationA2}/payload-preview`, channelToken, {
      productId: productA1Alpha.payload.id,
      channel: "shopify",
    });
    const connectorPreviewChannelOnlyDenied = await apiRequest(baseUrl, "POST", `/connectors/${installationA1}/payload-preview`, channelOnlyToken, {
      productId: productA1Alpha.payload.id,
      channel: "shopify",
    });
    const connectorPreviewAccountOnlyDenied = await apiRequest(baseUrl, "POST", `/connectors/${installationA1}/payload-preview`, accountOnlyToken, {
      productId: productA1Alpha.payload.id,
      channel: "shopify",
    });
    assertStatus(connectorPreviewDenied, 403, "connector preview denied outside assigned connector account");
    assertStatus(connectorPreviewChannelOnlyDenied, 403, "connector preview denied for channel-only user when connector-account dimension is active");
    assertStatus(connectorPreviewAccountOnlyDenied, 403, "connector preview denied for account-only user when channel dimension is active");

    const adminProductDetail = await apiRequest(baseUrl, "GET", `/catalog/products/${productA2Beta.payload.id}`, adminAToken);
    const adminConnectors = await apiRequest(baseUrl, "GET", "/connectors/installed", adminAToken);
    assertStatus(adminProductDetail, 200, "admin override product detail");
    assertStatus(adminConnectors, 200, "admin connector list");
    assert(adminConnectors.payload.items.length >= 2, "admin should see all tenant connector installations");

    const deniedAuditRows = await prisma.auditLog.findMany({
      where: {
        tenantKey: tenantA,
        action: "AUTHORIZATION_DENIED",
      },
      orderBy: [{ createdAt: "desc" }],
      take: 20,
    });
    assert(deniedAuditRows.length > 0, "expected delegated-access denials to be audited");
    const scopeDenied = deniedAuditRows.find((row) => String(row.metadata?.reasonCode ?? "").includes("SCOPE_DENIED"));
    assert(scopeDenied, `expected scope denial audit row, got ${JSON.stringify(deniedAuditRows.map((row) => row.metadata))}`);
    assert(!JSON.stringify(scopeDenied.metadata ?? {}).toLowerCase().includes("authorization"), "audit metadata must not include raw authorization header values");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          validated: [
            "tenant_safe_access_scope_assignment_admin_api",
            "product_scope_dimensions_intersect_when_category_and_brand_are_active",
            "product_list_and_direct_access_require_intersection_match",
            "legacy_product_alias_direct_access_respects_scope_intersection",
            "ai_helper_direct_reads_respect_scope_intersection",
            "compliance_product_issue_reads_respect_scope_intersection",
            "compliance_validate_route_respects_scope_intersection",
            "issue_inbox_list_only_returns_fully_scoped_products",
            "issue_inbox_resolution_respects_scope_intersection",
            "product_write_protection_requires_intersection_match",
            "ai_repair_edit_paths_respect_scope_intersection",
            "media_access_requires_product_scope_intersection_match",
            "channel_scoped_mapping_enforcement_requires_active_category_and_channel_match",
            "connector_account_and_channel_scopes_intersect_when_both_are_active",
            "future_scope_dimensions_are_representable_but_safely_rejected_until_enforced",
            "admin_override_within_tenant_boundary",
            "scope_denials_are_audited",
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
    console.error("Delegated access integration test failed:");
    console.error(details);
    if (stdout) {
      console.error("--- API stdout tail ---");
      console.error(stdout);
    }
    if (stderr) {
      console.error("--- API stderr tail ---");
      console.error(stderr);
    }
    throw error;
  } finally {
    apiProcess.kill("SIGTERM");
    try {
      await prisma.$disconnect();
    } catch {
      // ignore
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
