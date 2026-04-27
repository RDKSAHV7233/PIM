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
  const editorUser = `ap-editor-${runId}`;
  const reviewerUser = `ap-reviewer-${runId}`;
  const viewerUser = `ap-viewer-${runId}`;
  const commercialToken = `commercial-ops-${runId}`;
  const authPassword = "vexa-pim-demo-password";

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [adminUser]: { tenantId, role: "admin", workspaceSlug },
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

    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", adminToken, {
      name: `Access Policy Category ${runId}`,
    });
    assertStatus(category, 201, "create category");

    const product = await apiRequest(baseUrl, "POST", "/catalog/products", adminToken, {
      title: `Access Policy Product ${runId}`,
      brand: "Aarika Looms",
      description: "Access policy remediation test product",
      categoryId: category.payload.id,
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

    const editorRestrictedProductUpdate = await apiRequest(
      baseUrl,
      "PATCH",
      `/catalog/products/${product.payload.id}`,
      editorToken,
      {
        expectedVersion: product.payload.version,
        title: product.payload.title,
        description: product.payload.description,
        brand: product.payload.brand,
        categoryId: product.payload.categoryId,
        hsnCode: product.payload.hsnCode,
        gstRate: product.payload.gstRate,
        status: product.payload.status,
        attributes: {
          ...(product.payload.attributes ?? {}),
          pricing: {
            ...((product.payload.attributes ?? {}).pricing ?? {}),
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

    const editorVariantUpdate = await apiRequest(
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
    assertStatus(editorVariantUpdate, 403, "editor restricted variant update denied");
    assert(
      String(editorVariantUpdate.payload?.error ?? "") === "ACCESS_POLICY_DENIED",
      `expected ACCESS_POLICY_DENIED for restricted variant update, got ${JSON.stringify(editorVariantUpdate.payload)}`,
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

    const apiKeyTaxonomyDenied = await apiRequest(
      baseUrl,
      "GET",
      "/taxonomy/categories?all=true",
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyTaxonomyDenied, 403, "api key denied taxonomy metadata read by default");
    assert(
      String(apiKeyTaxonomyDenied.payload?.reason ?? "") === "API_CLIENT_FORBIDDEN",
      `expected API_CLIENT_FORBIDDEN for api key taxonomy metadata, got ${JSON.stringify(apiKeyTaxonomyDenied.payload)}`,
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
      String(apiKeyAutoSuggestionDenied.payload?.reason ?? "") === "API_CLIENT_FORBIDDEN",
      `expected API_CLIENT_FORBIDDEN for api key auto suggestion reads, got ${JSON.stringify(apiKeyAutoSuggestionDenied.payload)}`,
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
      String(apiKeyRejectionScoreDenied.payload?.reason ?? "") === "API_CLIENT_FORBIDDEN",
      `expected API_CLIENT_FORBIDDEN for api key rejection intelligence score, got ${JSON.stringify(apiKeyRejectionScoreDenied.payload)}`,
    );

    const apiKeyBulkImportJobsDenied = await apiRequest(
      baseUrl,
      "GET",
      "/bulk-import/jobs",
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyBulkImportJobsDenied, 403, "api key denied bulk import jobs");
    assert(
      String(apiKeyBulkImportJobsDenied.payload?.reason ?? "") === "API_CLIENT_FORBIDDEN",
      `expected API_CLIENT_FORBIDDEN for api key bulk import jobs, got ${JSON.stringify(apiKeyBulkImportJobsDenied.payload)}`,
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

    const apiKeyIssueInboxDenied = await apiRequest(
      baseUrl,
      "GET",
      "/issues/inbox?pagination=cursor&limit=5",
      null,
      undefined,
      { "x-pim-api-key": editorApiKeyValue },
    );
    assertStatus(apiKeyIssueInboxDenied, 403, "api key denied issue inbox");
    assert(
      String(apiKeyIssueInboxDenied.payload?.reason ?? "") === "API_CLIENT_FORBIDDEN",
      `expected API_CLIENT_FORBIDDEN for api key issue inbox, got ${JSON.stringify(apiKeyIssueInboxDenied.payload)}`,
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
            "editor_restricted_variant_write_denied",
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
            "viewer_and_reviewer_denied_connector_management_writes",
            "editor_connector_reconnect_allowed_after_grant",
            "editor_preview_denied_without_connector_permission",
            "editor_preview_denied_by_sensitive_payload_policy_after_grant",
            "admin_preview_allowed",
            "editor_marketplace_export_denied_by_sensitive_payload_policy",
            "api_key_principal_denied_human_connector_routes",
            "api_key_principal_denied_human_marketplace_routes",
            "api_key_principal_denied_human_submission_routes",
            "api_key_principal_denied_human_ai_helper_routes",
            "api_key_principal_denied_human_bulk_operation_routes",
            "api_key_principal_denied_human_audit_routes",
            "api_key_principal_denied_human_billing_detail_routes",
            "api_key_principal_denied_human_taxonomy_reads_without_explicit_api_allow",
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
