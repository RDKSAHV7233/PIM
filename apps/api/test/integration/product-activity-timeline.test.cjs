#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

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
    const index = line.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^"|"$/g, "");
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
      // retry
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
    signal: AbortSignal.timeout(15_000),
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

function assertStatus(result, expected, context) {
  if (result.status !== expected) {
    throw new Error(
      `${context} failed: expected ${expected}, got ${result.status} payload=${JSON.stringify(result.payload)}`,
    );
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 5820 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `activity-timeline-${runId}`;
  const workspaceSlug = `at-${runId}`.slice(0, 24);
  const userId = `at-user-${runId}`;
  const viewerUserId = `at-viewer-${runId}`;
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin", workspaceSlug },
      [viewerUserId]: { tenantId, role: "viewer", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Activity Timeline Workspace" },
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
    await waitForHealth(baseUrl, 60_000);

    // Login as admin
    const login = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId,
      password: process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "login");
    const token = String(login.payload?.accessToken ?? "");
    assert(token.length > 10, "missing access token from login");

    // Login as viewer
    const viewerLogin = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId: viewerUserId,
      password: process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(viewerLogin, 201, "viewer login");
    const viewerToken = String(viewerLogin.payload?.accessToken ?? "");
    assert(viewerToken.length > 10, "missing viewer access token");

    // Create category
    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
      name: `Activity Timeline Category ${runId}`,
    });
    assertStatus(category, 201, "create category");
    const categoryId = String(category.payload?.id ?? "");
    assert(categoryId.length > 0, "missing category id");

    // Create product
    const createProduct = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
      title: `Activity Timeline Product ${runId}`,
      brand: "TestBrand",
      description: "Test product for activity timeline",
      categoryId,
      status: "draft",
      attributes: {},
    });
    assertStatus(createProduct, 201, "create product");
    const productId = String(createProduct.payload?.id ?? "");
    assert(productId.length > 0, "missing product id");

    // Update the product to generate more audit log entries
    const updateProduct = await apiRequest(baseUrl, "PATCH", `/catalog/products/${productId}`, token, {
      expectedVersion: createProduct.payload.version,
      title: `Updated Activity Timeline Product ${runId}`,
      description: "Updated description",
      brand: "UpdatedBrand",
      categoryId,
      status: "in_review",
      attributes: {},
    });
    assertStatus(updateProduct, 200, "update product");

    // GET /activity → 200, { productId, total, events: [...] }
    const activity = await apiRequest(baseUrl, "GET", `/catalog/products/${productId}/activity`, token);
    assertStatus(activity, 200, "get product activity");
    assert(activity.payload?.productId === productId, "activity.productId must match");
    assert(typeof activity.payload?.total === "number", "activity.total must be a number");
    assert(Array.isArray(activity.payload?.events), "activity.events must be an array");
    assert(activity.payload.total >= 1, `activity.total must be >= 1, got ${activity.payload.total}`);

    // Each event has required fields
    const firstEvent = activity.payload.events[0];
    assert(typeof firstEvent?.id === "string", "event must have id");
    assert(typeof firstEvent?.actorId === "string", "event must have actorId");
    assert(typeof firstEvent?.actorRole === "string", "event must have actorRole");
    assert(typeof firstEvent?.action === "string", "event must have action");
    assert(typeof firstEvent?.createdAt === "string", "event must have createdAt");

    // Viewer role can GET activity (200)
    const viewerActivity = await apiRequest(baseUrl, "GET", `/catalog/products/${productId}/activity`, viewerToken);
    assertStatus(viewerActivity, 200, "viewer can GET product activity");

    // Non-existent product → 404
    const notFound = await apiRequest(baseUrl, "GET", "/catalog/products/nonexistent-product-id/activity", token);
    assertStatus(notFound, 404, "non-existent product activity must return 404");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          productId,
          activityTotal: activity.payload.total,
          validated: [
            "get_product_activity_200",
            "activity_has_productId_total_events",
            "events_have_required_fields",
            "total_gte_1",
            "viewer_can_get_activity",
            "nonexistent_product_404",
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
    console.error("Product activity timeline integration test failed:");
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
          // ignore cleanup
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
