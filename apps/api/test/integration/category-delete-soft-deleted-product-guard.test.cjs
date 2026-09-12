#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");

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
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
  setDefaultEnv("APP_ENV", "development");
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

function assertStatus(result, expected, context) {
  if (result.status !== expected) {
    throw new Error(`${context} failed: expected ${expected}, got ${result.status}; payload=${JSON.stringify(result.payload)}`);
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
  const apiPort = 6960 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `category-delete-guard-${runId}`;
  const workspaceSlug = `cdg-${runId}`.slice(0, 24);
  const userId = `category-delete-guard-user-${runId}`;
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Category Delete Guard" },
    }),
  };

  const stderrBuffer = [];
  const apiProcess = spawn("node", [API_ENTRY], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  apiProcess.stderr.on("data", (chunk) => {
    stderrBuffer.push(String(chunk));
    if (stderrBuffer.length > 200) stderrBuffer.shift();
  });

  try {
    await waitForHealth(baseUrl, 300_000);
    const login = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId,
      password: "vexa-pim-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "login");
    const token = String(login.payload?.accessToken ?? "");

    // Regression test for the recurring staging error:
    // "PrismaClientUnknownRequestError: Invalid `prisma.category.delete()` invocation"
    // Root cause: Product.category is onDelete: Restrict at the DB level, but
    // deleteCategory()'s pre-check only counted non-soft-deleted products
    // (deletedAt: null). A soft-deleted product (deleteProduct sets deletedAt but
    // leaves categoryId intact — see catalog.service.ts deleteProduct/purgeProduct)
    // still satisfies the DB's Restrict constraint, so the pre-check passed while the
    // actual category.delete() call hit the FK and threw an unhandled error instead of
    // a clean 400.
    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
      name: `Category Delete Guard ${runId}`,
    });
    assertStatus(category, 201, "create category");
    const categoryId = category.payload.id;

    const product = await apiRequest(baseUrl, "POST", "/products", token, {
      title: `Guard Product ${runId}`,
      description: "Regression fixture for category delete guard",
      brand: "TestBrand",
      categoryId,
    });
    assertStatus(product, 201, "create product");
    const productId = product.payload.id;

    const softDelete = await apiRequest(baseUrl, "DELETE", `/catalog/products/${productId}`, token);
    assertStatus(softDelete, 200, "soft-delete product");

    const deleteAttempt = await apiRequest(baseUrl, "DELETE", `/taxonomy/categories/${categoryId}`, token);
    assertStatus(deleteAttempt, 400, "delete category with only soft-deleted products attached");
    assert(
      /attached products/i.test(String(deleteAttempt.payload?.message ?? "")),
      `expected a clear "attached products" 400 message, got: ${JSON.stringify(deleteAttempt.payload)}`,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          validated: ["category_delete_blocked_by_soft_deleted_product"],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("Category delete soft-deleted-product guard integration test failed:");
    console.error(error instanceof Error ? error.message : String(error));
    const stderr = stderrBuffer.join("");
    if (stderr.trim()) {
      console.error("--- api stderr tail ---");
      console.error(stderr.slice(-4000));
    }
    process.exitCode = 1;
  } finally {
    apiProcess.kill("SIGTERM");
    await sleep(500);
  }
}

run().catch((error) => {
  console.error("Category delete soft-deleted-product guard integration test crashed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
