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
  const apiPort = 7100 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `access-policy-${runId}`;
  const workspaceSlug = `ap-${runId}`.slice(0, 24);
  const adminUser = `ap-admin-${runId}`;
  const editorUser = `ap-editor-${runId}`;
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
      [viewerUser]: { tenantId, role: "viewer", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Access Policy Remediation" },
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

    const adminLogin = await login(baseUrl, workspaceSlug, adminUser, authPassword);
    assertStatus(adminLogin, 201, "admin login");
    const adminToken = String(adminLogin.payload?.accessToken ?? "");
    assert(adminToken.length > 10, "missing admin token");

    const editorLogin = await login(baseUrl, workspaceSlug, editorUser, authPassword);
    assertStatus(editorLogin, 201, "editor login");
    const editorToken = String(editorLogin.payload?.accessToken ?? "");
    assert(editorToken.length > 10, "missing editor token");

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

    const installAmazon = await apiRequest(baseUrl, "POST", "/connectors/amazon-in/install", adminToken, {
      accountAlias: "primary",
    });
    assertStatus(installAmazon, 201, "install amazon connector");
    const installationId = String(installAmazon.payload?.id ?? "");
    assert(installationId.length > 10, "missing installation id");

    const viewerInstalledDenied = await apiRequest(baseUrl, "GET", "/connectors/installed?limit=50", viewerToken);
    assertStatus(viewerInstalledDenied, 403, "viewer denied installed connectors");

    const viewerExportJobsDenied = await apiRequest(baseUrl, "GET", "/marketplace/export-jobs", viewerToken);
    assertStatus(viewerExportJobsDenied, 403, "viewer denied export job list");

    const viewerDefinitionsDenied = await apiRequest(baseUrl, "GET", "/connectors/definitions", viewerToken);
    assertStatus(viewerDefinitionsDenied, 403, "viewer denied connector definitions");

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

    const denialRows = await prisma.$queryRawUnsafe(
      `
      SELECT action, resource, metadata
      FROM audit_logs
      WHERE tenant_key = $1
        AND action = 'AUTHORIZATION_DENIED'
      ORDER BY created_at DESC
      LIMIT 50
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

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          validated: [
            "editor_restricted_product_attribute_write_denied",
            "editor_restricted_variant_write_denied",
            "editor_bulk_edit_restricted_field_denied",
            "admin_bulk_edit_restricted_field_allowed",
            "editor_bulk_import_restricted_field_denied",
            "viewer_denied_sensitive_connector_and_export_reads",
            "editor_preview_denied_without_connector_permission",
            "editor_preview_denied_by_sensitive_payload_policy_after_grant",
            "admin_preview_allowed",
            "editor_marketplace_export_denied_by_sensitive_payload_policy",
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
