#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
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

async function createProduct(baseUrl, token, categoryId, runId, suffix) {
  const response = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
    title: `Notification Target Product ${runId}-${suffix}`,
    brand: "Vexa PIM",
    description: "Product used for notification target retargeting coverage",
    categoryId,
    status: "draft",
    attributes: {
      color: "black",
      size: "M",
    },
    hsnCode: "62046200",
    gstRate: 18,
  });
  assertStatus(response, 201, `create product ${suffix}`);
  return response.payload;
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 6760 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantKey = `notifications-retarget-${runId}`;
  const workspaceSlug = `nrt-${runId}`.slice(0, 24);
  const userId = `notifications-retarget-${runId}`;

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantKey,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId: tenantKey, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId: tenantKey, displayName: "Notifications Retarget" },
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

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL,
      },
    },
  });

  try {
    await waitForHealth(baseUrl, 60_000);

    const token = await login(baseUrl, userId, workspaceSlug);
    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
      name: `Notification Retarget Category ${runId}`,
    });
    assertStatus(category, 201, "create category");

    const softDeleteProduct = await createProduct(baseUrl, token, category.payload.id, runId, "soft-delete");
    const purgeProduct = await createProduct(baseUrl, token, category.payload.id, runId, "purge");

    const softDeleteNotificationId = randomUUID();
    const purgeNotificationId = randomUUID();

    await prisma.userNotification.createMany({
      data: [
        {
          id: softDeleteNotificationId,
          tenantKey,
          userId,
          eventType: "publish_failed",
          title: "Channel publish failed",
          message: "Soft-deleted product still has a stale detail link",
          actionUrl: `/products/${softDeleteProduct.id}?tab=channels`,
          actionLabel: "Fix product",
          metadata: {
            productId: softDeleteProduct.id,
            channel: "flipkart",
          },
        },
        {
          id: purgeNotificationId,
          tenantKey,
          userId,
          eventType: "approval_decision",
          title: "Approval decision received",
          message: "Purged product still has a stale detail link",
          actionUrl: `/products/${purgeProduct.id}?tab=quality`,
          actionLabel: "Review approval",
          metadata: {
            productId: purgeProduct.id,
            status: "approved",
          },
        },
      ],
    });

    const deleteSoft = await apiRequest(
      baseUrl,
      "DELETE",
      `/catalog/products/${encodeURIComponent(softDeleteProduct.id)}`,
      token,
    );
    assertStatus(deleteSoft, 200, "soft delete product");

    const softDeletedNotification = await prisma.userNotification.findUnique({
      where: { id: softDeleteNotificationId },
    });
    assert(
      softDeletedNotification?.actionUrl === "/catalog/products" &&
        softDeletedNotification?.actionLabel === "View products",
      `soft delete should retarget product notification; row=${JSON.stringify(softDeletedNotification)}`,
    );

    const deleteForPurge = await apiRequest(
      baseUrl,
      "DELETE",
      `/catalog/products/${encodeURIComponent(purgeProduct.id)}`,
      token,
    );
    assertStatus(deleteForPurge, 200, "soft delete purge-target product");

    const purgeDeleted = await apiRequest(
      baseUrl,
      "DELETE",
      `/catalog/products/${encodeURIComponent(purgeProduct.id)}/purge`,
      token,
    );
    assertStatus(purgeDeleted, 200, "purge product");

    const purgedNotification = await prisma.userNotification.findUnique({
      where: { id: purgeNotificationId },
    });
    assert(
      purgedNotification?.actionUrl === "/catalog/products" &&
        purgedNotification?.actionLabel === "View products",
      `purge should retarget product notification; row=${JSON.stringify(purgedNotification)}`,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantKey,
          validated: [
            "soft_delete_retargets_product_linked_notifications",
            "purge_retargets_product_linked_notifications",
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
    console.error("Notifications product-link retarget integration test failed:");
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
    await prisma.$disconnect();
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
