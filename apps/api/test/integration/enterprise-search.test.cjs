#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * RG-C6 integration test — enterprise-scale catalog search.
 *
 * Validates GET /catalog/products/advanced-search with faceted filtering
 * (status, categoryId, brand, q) and cursor pagination. 7 assertions.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || /^\s*#/.test(line)) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^"|"$/g, "");
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
      if (response.ok) return;
    } catch {
      // retry
    }
    await sleep(400);
  }
  throw new Error(`API did not become healthy at ${baseUrl}/health within ${timeoutMs}ms`);
}

async function apiRequest(baseUrl, method, route, token, body) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const options = { method, headers, signal: AbortSignal.timeout(15_000) };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${route}`, options);
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { status: response.status, payload };
}

function assertStatus(result, expected, context) {
  if (result.status !== expected) {
    throw new Error(
      `${context}: expected HTTP ${expected}, got ${result.status}. payload=${JSON.stringify(result.payload)}`,
    );
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 5800 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `enterprise-search-${runId}`;
  const workspaceSlug = `es-${runId}`.slice(0, 24);
  const userId = `es-user-${runId}`;

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Enterprise Search Workspace" },
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
    if (stdoutBuffer.length > 200) stdoutBuffer.shift();
  });
  apiProcess.stderr.on("data", (chunk) => {
    stderrBuffer.push(String(chunk));
    if (stderrBuffer.length > 200) stderrBuffer.shift();
  });

  try {
    await waitForHealth(baseUrl, 60_000);

    // ── Login ────────────────────────────────────────────────────────────────
    const login = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId,
      password: process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "login");
    const token = String(login.payload?.accessToken ?? "");
    assert(token.length > 10, "missing access token");

    // ── Create two categories ────────────────────────────────────────────────
    const catA = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
      name: `Electronics ${runId}`,
    });
    assertStatus(catA, 201, "create category A");
    const categoryIdA = String(catA.payload?.id ?? "");
    assert(categoryIdA.length > 0, "missing category A id");

    const catB = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
      name: `Apparel ${runId}`,
    });
    assertStatus(catB, 201, "create category B");
    const categoryIdB = String(catB.payload?.id ?? "");
    assert(categoryIdB.length > 0, "missing category B id");

    // ── Seed products ────────────────────────────────────────────────────────
    // P1: Electronics, brand=Acme, draft
    const p1 = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
      title: `Wireless Headphones ${runId}`,
      brand: "Acme",
      description: "Premium audio experience",
      categoryId: categoryIdA,
      attributes: {},
    });
    assertStatus(p1, 201, "create product 1");
    const p1Id = String(p1.payload?.id ?? "");

    // P2: Electronics, brand=Zeta, draft → transition to in_review
    const p2 = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
      title: `Smart Watch ${runId}`,
      brand: "Zeta",
      description: "Track your fitness",
      categoryId: categoryIdA,
      attributes: {},
    });
    assertStatus(p2, 201, "create product 2");
    const p2Id = String(p2.payload?.id ?? "");
    const toReview = await apiRequest(baseUrl, "PATCH", `/catalog/products/${p2Id}`, token, {
      expectedVersion: p2.payload.version,
      title: p2.payload.title,
      description: p2.payload.description,
      brand: p2.payload.brand,
      categoryId: p2.payload.categoryId,
      status: "in_review",
      attributes: p2.payload.attributes ?? {},
    });
    assertStatus(toReview, 200, "transition P2 to in_review");

    // P3: Apparel, brand=Acme, draft
    const p3 = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
      title: `Cotton T-Shirt ${runId}`,
      brand: "Acme",
      description: "Comfortable everyday wear",
      categoryId: categoryIdB,
      attributes: {},
    });
    assertStatus(p3, 201, "create product 3");
    const p3Id = String(p3.payload?.id ?? "");

    // ── ASSERTION 1: Unauthenticated request returns 401 ────────────────────
    const unauth = await apiRequest(baseUrl, "GET", "/catalog/products/advanced-search", null);
    assertStatus(unauth, 401, "[A1] unauthenticated advanced-search");

    // ── ASSERTION 2: No filters returns all 3 products ───────────────────────
    const allProducts = await apiRequest(
      baseUrl, "GET", "/catalog/products/advanced-search", token,
    );
    assertStatus(allProducts, 200, "[A2] advanced-search no filters");
    assert(
      Array.isArray(allProducts.payload?.items),
      "[A2] items must be array",
    );
    assert(
      allProducts.payload.items.length >= 3,
      `[A2] expected ≥3 items, got ${allProducts.payload.items.length}`,
    );
    assert(
      typeof allProducts.payload.limit === "number",
      "[A2] response must include numeric limit",
    );
    assert(
      "nextCursor" in allProducts.payload,
      "[A2] response must include nextCursor field",
    );

    // ── ASSERTION 3: Status filter returns only draft products ───────────────
    const draftSearch = await apiRequest(
      baseUrl, "GET",
      "/catalog/products/advanced-search?status=draft",
      token,
    );
    assertStatus(draftSearch, 200, "[A3] status=draft filter");
    const draftItems = draftSearch.payload?.items ?? [];
    assert(
      draftItems.every((p) => p.status === "draft"),
      "[A3] all items must have status=draft",
    );
    const draftIds = draftItems.map((p) => p.id);
    assert(draftIds.includes(p1Id), "[A3] P1 (draft) must appear in draft results");
    assert(draftIds.includes(p3Id), "[A3] P3 (draft) must appear in draft results");
    assert(!draftIds.includes(p2Id), "[A3] P2 (in_review) must NOT appear in draft results");

    // ── ASSERTION 4: Brand filter is case-insensitive ────────────────────────
    const brandSearch = await apiRequest(
      baseUrl, "GET",
      "/catalog/products/advanced-search?brand=acme",
      token,
    );
    assertStatus(brandSearch, 200, "[A4] brand=acme filter");
    const brandItems = brandSearch.payload?.items ?? [];
    const brandIds = brandItems.map((p) => p.id);
    assert(brandIds.includes(p1Id), "[A4] P1 (brand=Acme) must appear");
    assert(brandIds.includes(p3Id), "[A4] P3 (brand=Acme) must appear");
    assert(!brandIds.includes(p2Id), "[A4] P2 (brand=Zeta) must NOT appear");

    // ── ASSERTION 5: Category filter ─────────────────────────────────────────
    const catSearch = await apiRequest(
      baseUrl, "GET",
      `/catalog/products/advanced-search?categoryId=${encodeURIComponent(categoryIdA)}`,
      token,
    );
    assertStatus(catSearch, 200, "[A5] categoryId filter");
    const catItems = catSearch.payload?.items ?? [];
    const catIds = catItems.map((p) => p.id);
    assert(catIds.includes(p1Id), "[A5] P1 (Electronics) must appear");
    assert(catIds.includes(p2Id), "[A5] P2 (Electronics) must appear");
    assert(!catIds.includes(p3Id), "[A5] P3 (Apparel) must NOT appear");

    // ── ASSERTION 6: Full-text query filter ──────────────────────────────────
    const qSearch = await apiRequest(
      baseUrl, "GET",
      `/catalog/products/advanced-search?q=${encodeURIComponent("Headphones")}`,
      token,
    );
    assertStatus(qSearch, 200, "[A6] q=Headphones filter");
    const qItems = qSearch.payload?.items ?? [];
    const qIds = qItems.map((p) => p.id);
    assert(qIds.includes(p1Id), "[A6] P1 title contains 'Headphones', must appear");
    assert(!qIds.includes(p2Id), "[A6] P2 does not match 'Headphones', must NOT appear");

    // ── ASSERTION 7: Cursor pagination (limit=1) produces nextCursor ─────────
    const page1 = await apiRequest(
      baseUrl, "GET",
      "/catalog/products/advanced-search?limit=1",
      token,
    );
    assertStatus(page1, 200, "[A7] page1 limit=1");
    assert(
      page1.payload?.items?.length === 1,
      `[A7] expected 1 item on page1, got ${page1.payload?.items?.length}`,
    );
    const cursor = page1.payload?.nextCursor;
    assert(typeof cursor === "string" && cursor.length > 0, "[A7] nextCursor must be a non-empty string when more pages exist");

    // Fetch page 2 using the cursor
    const page2 = await apiRequest(
      baseUrl, "GET",
      `/catalog/products/advanced-search?limit=1&cursor=${encodeURIComponent(cursor)}`,
      token,
    );
    assertStatus(page2, 200, "[A7] page2 with cursor");
    assert(
      page2.payload?.items?.length === 1,
      `[A7] expected 1 item on page2, got ${page2.payload?.items?.length}`,
    );
    assert(
      page2.payload.items[0].id !== page1.payload.items[0].id,
      "[A7] page2 item must be different from page1 item",
    );

    console.log(
      JSON.stringify({
        status: "ok",
        suite: "enterprise-search",
        assertions: 7,
        productsSeeded: [p1Id, p2Id, p3Id],
      }, null, 2),
    );
  } finally {
    apiProcess.kill("SIGTERM");
    await sleep(1_200);
    if (!apiProcess.killed) apiProcess.kill("SIGKILL");
  }
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
