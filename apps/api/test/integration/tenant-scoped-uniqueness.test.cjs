#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
const DEFAULT_API_HEALTH_TIMEOUT_MS = REPO_ROOT.startsWith("/mnt/") ? 600_000 : 240_000;
const API_HEALTH_TIMEOUT_MS = Number.parseInt(
  process.env.PIM_INTEGRATION_API_HEALTH_TIMEOUT_MS || String(DEFAULT_API_HEALTH_TIMEOUT_MS),
  10,
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
    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^"|"$/g, "");
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
  setDefaultEnv("PIM_DEFAULT_ROLE", "admin");
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
      // Retry until timeout.
    }
    await sleep(400);
  }
  throw new Error(`API did not become healthy at ${baseUrl}/health within ${timeoutMs}ms`);
}

async function apiRequest(baseUrl, method, route, token, body) {
  const headers = { Accept: "application/json" };
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
  return {
    status: response.status,
    payload,
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertStatus(result, expected, context) {
  if (result.status !== expected) {
    throw new Error(
      `${context} failed: expected ${expected}, got ${result.status}; payload=${JSON.stringify(result.payload)}`,
    );
  }
}

async function login(baseUrl, userId, workspaceSlug) {
  const response = await apiRequest(baseUrl, "POST", "/auth/login", null, {
    userId,
    workspaceSlug,
    password: process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password",
    expiresInMinutes: 30,
  });
  assertStatus(response, 201, `login ${userId}`);
  const token = String(response.payload?.accessToken ?? "");
  assert(token.length > 10, `missing access token for ${userId}`);
  return token;
}

async function createProduct(baseUrl, token, categoryId, title) {
  const response = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
    title,
    brand: "Vexa PIM",
    description: "tenant scoped uniqueness coverage",
    categoryId,
    status: "draft",
    hsnCode: "62046200",
    gstRate: 18,
    attributes: {},
  });
  assertStatus(response, 201, `create product ${title}`);
  return response.payload;
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2Z0xkAAAAASUVORK5CYII=";

  const runId = Date.now().toString();
  const apiPort = 6400 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantA = `tenant-unique-a-${runId}`;
  const tenantB = `tenant-unique-b-${runId}`;
  const workspaceSlugA = `tua-${runId}`.slice(0, 24);
  const workspaceSlugB = `tub-${runId}`.slice(0, 24);
  const adminA = `tenant-unique-admin-a-${runId}`;
  const adminB = `tenant-unique-admin-b-${runId}`;

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantA,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [adminA]: { tenantId: tenantA, role: "admin", workspaceSlug: workspaceSlugA },
      [adminB]: { tenantId: tenantB, role: "admin", workspaceSlug: workspaceSlugB },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlugA]: { tenantId: tenantA, displayName: "Tenant Uniqueness A" },
      [workspaceSlugB]: { tenantId: tenantB, displayName: "Tenant Uniqueness B" },
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
    if (stdoutBuffer.length > 200) {
      stdoutBuffer.shift();
    }
  });
  apiProcess.stderr.on("data", (chunk) => {
    stderrBuffer.push(String(chunk));
    if (stderrBuffer.length > 200) {
      stderrBuffer.shift();
    }
  });

  try {
    await waitForHealth(
      baseUrl,
      Number.isFinite(API_HEALTH_TIMEOUT_MS) ? API_HEALTH_TIMEOUT_MS : DEFAULT_API_HEALTH_TIMEOUT_MS,
    );

    const tokenA = await login(baseUrl, adminA, workspaceSlugA);
    const tokenB = await login(baseUrl, adminB, workspaceSlugB);

    const sharedCategoryName = `Shared Tenant Category ${runId}`;
    const categoryA = await apiRequest(baseUrl, "POST", "/taxonomy/categories", tokenA, {
      name: sharedCategoryName,
    });
    const categoryB = await apiRequest(baseUrl, "POST", "/taxonomy/categories", tokenB, {
      name: sharedCategoryName,
    });
    assertStatus(categoryA, 201, "create tenant A category");
    assertStatus(categoryB, 201, "create tenant B category");
    assert(
      categoryA.payload.slug === categoryB.payload.slug,
      `cross-tenant identical category slugs should be allowed; tenantA=${categoryA.payload.slug} tenantB=${categoryB.payload.slug}`,
    );

    const duplicateCategorySameTenant = await apiRequest(baseUrl, "POST", "/taxonomy/categories", tokenA, {
      name: sharedCategoryName,
    });
    assertStatus(duplicateCategorySameTenant, 201, "create duplicate category in same tenant");
    assert(
      duplicateCategorySameTenant.payload.slug === `${categoryA.payload.slug}-1`,
      `same-tenant duplicate category should suffix slug; payload=${JSON.stringify(duplicateCategorySameTenant.payload)}`,
    );

    const productA = await createProduct(baseUrl, tokenA, categoryA.payload.id, `Tenant A Product ${runId}`);
    const productB = await createProduct(baseUrl, tokenB, categoryB.payload.id, `Tenant B Product ${runId}`);
    const duplicateTenantProduct = await createProduct(
      baseUrl,
      tokenA,
      duplicateCategorySameTenant.payload.id,
      `Tenant A Duplicate Product ${runId}`,
    );

    const sharedSku = `TSKU-${runId}`;
    const variantA = await apiRequest(baseUrl, "POST", `/catalog/products/${productA.id}/variants`, tokenA, {
      skuCode: sharedSku,
      attributes: { color: "red" },
      inventoryQty: 3,
      status: "draft",
    });
    const variantB = await apiRequest(baseUrl, "POST", `/catalog/products/${productB.id}/variants`, tokenB, {
      skuCode: sharedSku,
      attributes: { color: "blue" },
      inventoryQty: 7,
      status: "draft",
    });
    assertStatus(variantA, 201, "create tenant A variant");
    assertStatus(variantB, 201, "create tenant B variant");
    assert(
      variantA.payload.skuCode === sharedSku && variantB.payload.skuCode === sharedSku,
      `cross-tenant identical skuCode should be allowed; tenantA=${JSON.stringify(variantA.payload)} tenantB=${JSON.stringify(variantB.payload)}`,
    );

    const mediaA = await apiRequest(baseUrl, "POST", "/media/bulk-associations", tokenA, {
      rows: [
        {
          skuCode: sharedSku,
          contentBase64: tinyPngBase64,
          mimeType: "image/png",
          fileName: `tenant-a-${runId}.png`,
        },
      ],
    });
    const mediaB = await apiRequest(baseUrl, "POST", "/media/bulk-associations", tokenB, {
      rows: [
        {
          skuCode: sharedSku,
          contentBase64: tinyPngBase64,
          mimeType: "image/png",
          fileName: `tenant-b-${runId}.png`,
        },
      ],
    });
    assertStatus(mediaA, 201, "associate media for tenant A shared sku");
    assertStatus(mediaB, 201, "associate media for tenant B shared sku");
    assert(
      mediaA.payload?.successRows === 1 && mediaA.payload?.failedRows === 0,
      `tenant A media association must succeed for shared sku; payload=${JSON.stringify(mediaA.payload)}`,
    );
    assert(
      mediaB.payload?.successRows === 1 && mediaB.payload?.failedRows === 0,
      `tenant B media association must succeed for shared sku; payload=${JSON.stringify(mediaB.payload)}`,
    );

    const tenantAAssets = await apiRequest(
      baseUrl,
      "GET",
      `/media/assets?variantId=${encodeURIComponent(variantA.payload.id)}`,
      tokenA,
    );
    const tenantBAssets = await apiRequest(
      baseUrl,
      "GET",
      `/media/assets?variantId=${encodeURIComponent(variantB.payload.id)}`,
      tokenB,
    );
    const tenantAWrongAssets = await apiRequest(
      baseUrl,
      "GET",
      `/media/assets?variantId=${encodeURIComponent(variantB.payload.id)}`,
      tokenA,
    );
    const tenantBWrongAssets = await apiRequest(
      baseUrl,
      "GET",
      `/media/assets?variantId=${encodeURIComponent(variantA.payload.id)}`,
      tokenB,
    );
    assertStatus(tenantAAssets, 200, "list tenant A assets");
    assertStatus(tenantBAssets, 200, "list tenant B assets");
    assertStatus(tenantAWrongAssets, 200, "list tenant A assets with tenant B variant id");
    assertStatus(tenantBWrongAssets, 200, "list tenant B assets with tenant A variant id");
    assert(
      Array.isArray(tenantAAssets.payload) &&
        tenantAAssets.payload.some((asset) => asset.variantId === variantA.payload.id),
      `tenant A asset list must contain the tenant A variant asset; payload=${JSON.stringify(tenantAAssets.payload)}`,
    );
    assert(
      Array.isArray(tenantBAssets.payload) &&
        tenantBAssets.payload.some((asset) => asset.variantId === variantB.payload.id),
      `tenant B asset list must contain the tenant B variant asset; payload=${JSON.stringify(tenantBAssets.payload)}`,
    );
    assert(
      Array.isArray(tenantAWrongAssets.payload) && tenantAWrongAssets.payload.length === 0,
      `tenant A must not see assets resolved against tenant B variant ids; payload=${JSON.stringify(tenantAWrongAssets.payload)}`,
    );
    assert(
      Array.isArray(tenantBWrongAssets.payload) && tenantBWrongAssets.payload.length === 0,
      `tenant B must not see assets resolved against tenant A variant ids; payload=${JSON.stringify(tenantBWrongAssets.payload)}`,
    );

    const duplicateVariantSameTenant = await apiRequest(
      baseUrl,
      "POST",
      `/catalog/products/${duplicateTenantProduct.id}/variants`,
      tokenA,
      {
        skuCode: sharedSku,
        attributes: { color: "green" },
        inventoryQty: 1,
        status: "draft",
      },
    );
    assertStatus(duplicateVariantSameTenant, 400, "reject duplicate variant sku in same tenant");
    assert(
      JSON.stringify(duplicateVariantSameTenant.payload).includes("SKU code already exists"),
      `same-tenant duplicate sku must remain blocked; payload=${JSON.stringify(duplicateVariantSameTenant.payload)}`,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantA,
          tenantB,
          validated: [
            "category_slug_uniqueness_is_tenant_scoped",
            "same_tenant_category_slug_collision_still_suffixes",
            "variant_sku_uniqueness_is_tenant_scoped",
            "same_tenant_variant_sku_collision_still_blocks",
            "bulk_media_association_resolves_shared_sku_within_tenant",
            "media_assets_do_not_leak_across_tenants_for_shared_sku",
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
    console.error("Tenant-scoped uniqueness integration test failed:");
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
      if (process.platform === "win32") {
        try {
          execFileSync("taskkill", ["/pid", String(apiProcess.pid), "/t", "/f"], { stdio: "ignore" });
        } catch {
          // Ignore cleanup failures.
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
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
