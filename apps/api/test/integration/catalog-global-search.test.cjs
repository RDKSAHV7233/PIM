#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
let stdoutBuffer = [];
let stderrBuffer = [];

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
    if (key && !process.env[key]) process.env[key] = value;
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
  setDefaultEnv("JWT_SECRET", "vexa-pim-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "vexa-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
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
      if (response.ok) return;
    } catch {}
    await sleep(400);
  }
  throw new Error(`API did not become healthy at ${baseUrl}/health within ${timeoutMs}ms`);
}

async function apiRequest(baseUrl, method, route, token, body) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const options = { method, headers, signal: AbortSignal.timeout(20_000) };
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
  if (!condition) throw new Error(message);
}

function assertStatus(result, expected, context) {
  if (result.status !== expected) {
    throw new Error(`${context} failed: expected ${expected}, got ${result.status}; payload=${JSON.stringify(result.payload)}`);
  }
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 6300 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantA = `catalog-search-tenant-a-${runId}`;
  const tenantB = `catalog-search-tenant-b-${runId}`;
  const workspaceSlugA = `csa-${runId}`.slice(0, 24);
  const workspaceSlugB = `csb-${runId}`.slice(0, 24);
  const adminA = `catalog-admin-a-${runId}`;
  const reviewerA = `catalog-reviewer-a-${runId}`;
  const adminB = `catalog-admin-b-${runId}`;
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantA,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [adminA]: { tenantId: tenantA, role: "admin", workspaceSlug: workspaceSlugA },
      [reviewerA]: { tenantId: tenantA, role: "reviewer", workspaceSlug: workspaceSlugA },
      [adminB]: { tenantId: tenantB, role: "admin", workspaceSlug: workspaceSlugB },
    }),
    PIM_TENANT_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlugA]: { tenantId: tenantA, displayName: "Catalog Search A" },
      [workspaceSlugB]: { tenantId: tenantB, displayName: "Catalog Search B" },
    }),
  };

  const apiProcess = spawn("node", [API_ENTRY], { cwd: REPO_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  stdoutBuffer = [];
  stderrBuffer = [];
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

    const adminALogin = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug: workspaceSlugA,
      userId: adminA,
      password: "vexa-pim-demo-password",
      expiresInMinutes: 30,
    });
    const reviewerALogin = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug: workspaceSlugA,
      userId: reviewerA,
      password: "vexa-pim-demo-password",
      expiresInMinutes: 30,
    });
    const adminBLogin = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug: workspaceSlugB,
      userId: adminB,
      password: "vexa-pim-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(adminALogin, 201, "tenant A admin login");
    assertStatus(reviewerALogin, 201, "tenant A reviewer login");
    assertStatus(adminBLogin, 201, "tenant B admin login");

    const adminAToken = String(adminALogin.payload.accessToken);
    const reviewerAToken = String(reviewerALogin.payload.accessToken);
    const adminBToken = String(adminBLogin.payload.accessToken);

    const categoryA = await apiRequest(baseUrl, "POST", "/taxonomy/categories", adminAToken, { name: `Search Category A ${runId}` });
    const categoryB = await apiRequest(baseUrl, "POST", "/taxonomy/categories", adminBToken, { name: `Search Category B ${runId}` });
    assertStatus(categoryA, 201, "create tenant A category");
    assertStatus(categoryB, 201, "create tenant B category");

    const titleProduct = await apiRequest(baseUrl, "POST", "/catalog/products", adminAToken, {
      title: `Aurora Search Jacket ${runId}`,
      brand: "Vexa PIM",
      description: "title search coverage",
      categoryId: categoryA.payload.id,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 18,
      attributes: {},
    });
    assertStatus(titleProduct, 201, "create title search product");

    const skuProduct = await apiRequest(baseUrl, "POST", "/catalog/products", adminAToken, {
      title: `Variant Search Product ${runId}`,
      brand: "Vexa PIM",
      description: "sku search coverage",
      categoryId: categoryA.payload.id,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 18,
      attributes: {},
    });
    assertStatus(skuProduct, 201, "create sku search product");

    const variant = await apiRequest(baseUrl, "POST", `/catalog/products/${skuProduct.payload.id}/variants`, adminAToken, {
      skuCode: `SKU-SEARCH-${runId}`,
      attributes: { size: "M" },
      mrp: 999,
      sellingPrice: 899,
      inventoryQty: 8,
      status: "draft",
    });
    assertStatus(variant, 201, "create searchable variant");

    const otherTenantProduct = await apiRequest(baseUrl, "POST", "/catalog/products", adminBToken, {
      title: `Aurora Search Jacket ${runId}`,
      brand: "Vexa PIM",
      description: "tenant isolation coverage",
      categoryId: categoryB.payload.id,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 18,
      attributes: {},
    });
    assertStatus(otherTenantProduct, 201, "create tenant B product");

    const titleSearch = await apiRequest(baseUrl, "GET", `/catalog/products/search?q=${encodeURIComponent(`Aurora Search Jacket ${runId}`)}`, adminAToken);
    assertStatus(titleSearch, 200, "title search");
    assert(titleSearch.payload.some((item) => item.id === titleProduct.payload.id), "title search must return the matching product in tenant A");
    assert(!titleSearch.payload.some((item) => item.id === otherTenantProduct.payload.id), "title search must not leak tenant B products");

    const skuSearch = await apiRequest(baseUrl, "GET", `/catalog/products/search?q=${encodeURIComponent(`SKU-SEARCH-${runId}`)}`, adminAToken);
    assertStatus(skuSearch, 200, "sku search");
    const skuHit = skuSearch.payload.find((item) => item.id === skuProduct.payload.id);
    assert(skuHit, "SKU search must return the product owning the matching variant SKU");
    assert(skuHit.matchedSku === `SKU-SEARCH-${runId}`, "SKU search must return the matched SKU in the payload");

    const reviewerSearch = await apiRequest(baseUrl, "GET", `/catalog/products/search?q=${encodeURIComponent(`Aurora Search Jacket ${runId}`)}`, reviewerAToken);
    assertStatus(reviewerSearch, 200, "reviewer search access");
    assert(reviewerSearch.payload.some((item) => item.id === titleProduct.payload.id), "reviewer must be able to search tenant products");

    const emptySearch = await apiRequest(baseUrl, "GET", "/catalog/products/search?q=", adminAToken);
    assertStatus(emptySearch, 200, "empty search");
    assert(Array.isArray(emptySearch.payload) && emptySearch.payload.length === 0, "empty search must return an empty array");

    console.log(JSON.stringify({
      status: "ok",
      validated: [
        "catalog_search_matches_title_queries",
        "catalog_search_matches_variant_sku_queries",
        "catalog_search_is_tenant_scoped",
        "reviewer_role_can_use_catalog_search"
      ],
      checkedAt: new Date().toISOString()
    }, null, 2));
  } finally {
    apiProcess.kill();
    await sleep(800);
  }
}

run().catch((error) => {
  console.error("[catalog-global-search.test] FAILED");
  console.error(error instanceof Error ? error.message : String(error));
  try {
    if (typeof stdoutBuffer !== "undefined" && stdoutBuffer.length > 0) {
      console.error("[catalog-global-search.test] stdout tail:");
      console.error(stdoutBuffer.join(""));
    }
    if (typeof stderrBuffer !== "undefined" && stderrBuffer.length > 0) {
      console.error("[catalog-global-search.test] stderr tail:");
      console.error(stderrBuffer.join(""));
    }
  } catch {}
  process.exit(1);
});
