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

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 6640 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantA = `notifications-boundary-a-${runId}`;
  const tenantB = `notifications-boundary-b-${runId}`;
  const workspaceSlugA = `nba-${runId}`.slice(0, 24);
  const workspaceSlugB = `nbb-${runId}`.slice(0, 24);
  const userA = `notifications-boundary-a-${runId}`;
  const userB = `notifications-boundary-b-${runId}`;

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantA,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userA]: { tenantId: tenantA, role: "admin", workspaceSlug: workspaceSlugA },
      [userB]: { tenantId: tenantB, role: "admin", workspaceSlug: workspaceSlugB },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlugA]: { tenantId: tenantA, displayName: "Notifications Boundary A" },
      [workspaceSlugB]: { tenantId: tenantB, displayName: "Notifications Boundary B" },
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

    const tokenA = await login(baseUrl, userA, workspaceSlugA);
    const tokenB = await login(baseUrl, userB, workspaceSlugB);

    const notificationAId = randomUUID();
    const notificationBId = randomUUID();
    await prisma.userNotification.createMany({
      data: [
        {
          id: notificationAId,
          tenantKey: tenantA,
          userId: userA,
          eventType: "publish_failed",
          title: "Tenant A notification",
          message: "Visible only to tenant A",
          actionUrl: "/products/a?tab=channels",
          actionLabel: "Fix product",
          metadata: {},
        },
        {
          id: notificationBId,
          tenantKey: tenantB,
          userId: userB,
          eventType: "publish_failed",
          title: "Tenant B notification",
          message: "Visible only to tenant B",
          actionUrl: "/products/b?tab=channels",
          actionLabel: "Fix product",
          metadata: {},
        },
      ],
    });

    const listA = await apiRequest(baseUrl, "GET", "/notifications?limit=20", tokenA);
    const listB = await apiRequest(baseUrl, "GET", "/notifications?limit=20", tokenB);
    assertStatus(listA, 200, "tenant A list notifications");
    assertStatus(listB, 200, "tenant B list notifications");

    assert(
      Array.isArray(listA.payload?.items) && listA.payload.items.some((item) => item.id === notificationAId),
      `tenant A must see own notification; payload=${JSON.stringify(listA.payload)}`,
    );
    assert(
      Array.isArray(listA.payload?.items) && listA.payload.items.every((item) => item.id !== notificationBId),
      `tenant A must not see tenant B notification; payload=${JSON.stringify(listA.payload)}`,
    );
    assert(
      Array.isArray(listB.payload?.items) && listB.payload.items.some((item) => item.id === notificationBId),
      `tenant B must see own notification; payload=${JSON.stringify(listB.payload)}`,
    );
    assert(
      Array.isArray(listB.payload?.items) && listB.payload.items.every((item) => item.id !== notificationAId),
      `tenant B must not see tenant A notification; payload=${JSON.stringify(listB.payload)}`,
    );

    const crossTenantRead = await apiRequest(
      baseUrl,
      "PATCH",
      `/notifications/${encodeURIComponent(notificationAId)}/read`,
      tokenB,
      {},
    );
    assertStatus(crossTenantRead, 404, "tenant B mark tenant A notification read");

    const ownRead = await apiRequest(
      baseUrl,
      "PATCH",
      `/notifications/${encodeURIComponent(notificationAId)}/read`,
      tokenA,
      {},
    );
    assertStatus(ownRead, 200, "tenant A mark own notification read");

    const afterRead = await apiRequest(baseUrl, "GET", "/notifications?limit=20", tokenA);
    assertStatus(afterRead, 200, "tenant A list notifications after read");
    const ownNotification = Array.isArray(afterRead.payload?.items)
      ? afterRead.payload.items.find((item) => item.id === notificationAId)
      : null;
    assert(ownNotification?.readAt, `tenant A notification should be marked read; payload=${JSON.stringify(afterRead.payload)}`);

    console.log(JSON.stringify({
      status: "ok",
      tenantA,
      tenantB,
      validated: [
        "notifications_list_is_tenant_scoped",
        "notifications_mark_read_is_tenant_scoped",
      ],
      checkedAt: new Date().toISOString(),
    }, null, 2));
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const stdout = stdoutBuffer.join("").slice(-4000);
    const stderr = stderrBuffer.join("").slice(-4000);
    console.error("Notifications tenant boundary integration test failed:");
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
