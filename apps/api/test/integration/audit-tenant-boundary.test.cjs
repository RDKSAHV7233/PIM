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
  const apiPort = 6710 + Math.floor(Math.random() * 100);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantA = `audit-boundary-a-${runId}`;
  const tenantB = `audit-boundary-b-${runId}`;
  const workspaceSlugA = `aba-${runId}`.slice(0, 24);
  const workspaceSlugB = `abb-${runId}`.slice(0, 24);
  const adminA = `audit-boundary-admin-a-${runId}@example.com`;
  const adminB = `audit-boundary-admin-b-${runId}@example.com`;
  const sharedActorId = `shared-audit-actor-${runId}`;

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
      [workspaceSlugA]: { tenantId: tenantA, displayName: "Audit Boundary A" },
      [workspaceSlugB]: { tenantId: tenantB, displayName: "Audit Boundary B" },
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

    const tokenA = await login(baseUrl, adminA, workspaceSlugA);
    const tokenB = await login(baseUrl, adminB, workspaceSlugB);

    const auditAId = randomUUID();
    const auditBId = randomUUID();
    await prisma.auditLog.createMany({
      data: [
        {
          id: auditAId,
          tenantKey: tenantA,
          actorId: sharedActorId,
          actorRole: "admin",
          action: "POST",
          resource: "/api/v1/catalog/products",
          resourceId: `product-a-${runId}`,
          metadata: { model: "Product" },
        },
        {
          id: auditBId,
          tenantKey: tenantB,
          actorId: sharedActorId,
          actorRole: "admin",
          action: "POST",
          resource: "/api/v1/catalog/products",
          resourceId: `product-b-${runId}`,
          metadata: { model: "Product" },
        },
      ],
    });

    const logsA = await apiRequest(
      baseUrl,
      "GET",
      `/audit/logs?actorId=${encodeURIComponent(sharedActorId)}&limit=20`,
      tokenA,
    );
    const logsB = await apiRequest(
      baseUrl,
      "GET",
      `/audit/logs?actorId=${encodeURIComponent(sharedActorId)}&limit=20`,
      tokenB,
    );
    assertStatus(logsA, 200, "tenant A audit logs");
    assertStatus(logsB, 200, "tenant B audit logs");

    assert(
      Array.isArray(logsA.payload) && logsA.payload.some((row) => row.id === auditAId),
      `tenant A must see own audit row; payload=${JSON.stringify(logsA.payload)}`,
    );
    assert(
      Array.isArray(logsA.payload) && logsA.payload.every((row) => row.id !== auditBId),
      `tenant A must not see tenant B audit row; payload=${JSON.stringify(logsA.payload)}`,
    );
    assert(
      Array.isArray(logsB.payload) && logsB.payload.some((row) => row.id === auditBId),
      `tenant B must see own audit row; payload=${JSON.stringify(logsB.payload)}`,
    );
    assert(
      Array.isArray(logsB.payload) && logsB.payload.every((row) => row.id !== auditAId),
      `tenant B must not see tenant A audit row; payload=${JSON.stringify(logsB.payload)}`,
    );

    const eventsA = await apiRequest(
      baseUrl,
      "GET",
      `/audit/events?actorId=${encodeURIComponent(sharedActorId)}&entityType=product&limit=20`,
      tokenA,
    );
    const eventsB = await apiRequest(
      baseUrl,
      "GET",
      `/audit/events?actorId=${encodeURIComponent(sharedActorId)}&entityType=product&limit=20`,
      tokenB,
    );
    assertStatus(eventsA, 200, "tenant A audit events");
    assertStatus(eventsB, 200, "tenant B audit events");

    assert(
      Array.isArray(eventsA.payload?.items) && eventsA.payload.items.some((row) => row.id === auditAId && row.entityType === "product"),
      `tenant A must see own product audit event; payload=${JSON.stringify(eventsA.payload)}`,
    );
    assert(
      Array.isArray(eventsA.payload?.items) && eventsA.payload.items.every((row) => row.id !== auditBId),
      `tenant A must not see tenant B audit event; payload=${JSON.stringify(eventsA.payload)}`,
    );
    assert(
      Array.isArray(eventsB.payload?.items) && eventsB.payload.items.some((row) => row.id === auditBId && row.entityType === "product"),
      `tenant B must see own product audit event; payload=${JSON.stringify(eventsB.payload)}`,
    );
    assert(
      Array.isArray(eventsB.payload?.items) && eventsB.payload.items.every((row) => row.id !== auditAId),
      `tenant B must not see tenant A audit event; payload=${JSON.stringify(eventsB.payload)}`,
    );

    console.log(JSON.stringify({
      status: "ok",
      tenantA,
      tenantB,
      validated: [
        "audit_logs_list_is_tenant_scoped",
        "audit_events_explorer_is_tenant_scoped",
      ],
      checkedAt: new Date().toISOString(),
    }, null, 2));
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const stdout = stdoutBuffer.join("").slice(-4000);
    const stderr = stderrBuffer.join("").slice(-4000);
    console.error("Audit tenant boundary integration test failed:");
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
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
