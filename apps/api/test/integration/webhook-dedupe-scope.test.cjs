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

async function apiRequest(baseUrl, method, route, token, body, extraHeaders) {
  const headers = { Accept: "application/json", ...(extraHeaders ?? {}) };
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertStatus(result, expected, context) {
  if (result.status !== expected) {
    throw new Error(`${context} failed: expected ${expected}, got ${result.status} payload=${JSON.stringify(result.payload)}`);
  }
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 5200 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `webhook-dedupe-tenant-${runId}`;
  const workspaceSlug = `webhook-${runId}`.slice(0, 24);
  const userId = `webhook-dedupe-user-${runId}`;
  const commercialToken = `commercial-ops-${runId}`;
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Webhook Dedupe" },
    }),
    PIM_AUTH_PASSWORD: "vexa-pim-demo-password",
    PIM_COMMERCIAL_OPS_TOKEN: commercialToken,
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
      db: { url: process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL },
    },
  });

  try {
    await waitForHealth(baseUrl, 60_000);

    const login = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId,
      password: "vexa-pim-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "login");
    const token = login.payload?.accessToken;
    assert(typeof token === "string" && token.length > 10, "missing access token");

    const setPlanTier = await commercialPlanRequest(baseUrl, commercialToken, tenantId, "ENTERPRISE");
    assert(
      setPlanTier.status === 200 || setPlanTier.status === 201,
      `set plan tier failed: expected 200/201, got ${setPlanTier.status} payload=${JSON.stringify(setPlanTier.payload)}`,
    );

    // Amazon-IN is now in PLANNED launch stage; use flipkart instead.
    const installPrimary = await apiRequest(baseUrl, "POST", "/connectors/flipkart/install", token, {
      accountAlias: "primary",
    });
    assertStatus(installPrimary, 201, "install flipkart primary");

    const installSecondary = await apiRequest(baseUrl, "POST", "/connectors/flipkart/install", token, {
      accountAlias: "secondary",
    });
    assertStatus(installSecondary, 201, "install flipkart secondary");

    const eventId = `evt-${runId}`;
    const insertSql = `
      INSERT INTO connector_webhook_events (
        id,
        tenant_key,
        installation_id,
        external_event_id,
        event_type,
        payload,
        received_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
      RETURNING id
    `;

    // RLS-BYPASS: manual tenant filter
    await prisma.$queryRawUnsafe(
      insertSql,
      randomUUID(),
      tenantId,
      installPrimary.payload.id,
      eventId,
      "LISTING_STATUS",
      JSON.stringify({ source: "test", duplicate: 1 }),
    );

    // Same external_event_id for a different installation must succeed.
    // RLS-BYPASS: manual tenant filter
    await prisma.$queryRawUnsafe(
      insertSql,
      randomUUID(),
      tenantId,
      installSecondary.payload.id,
      eventId,
      "LISTING_STATUS",
      JSON.stringify({ source: "test", duplicate: 2 }),
    );

    let duplicateRejected = false;
    try {
      // Same installation + same external_event_id must fail.
      // RLS-BYPASS: manual tenant filter
      await prisma.$queryRawUnsafe(
        insertSql,
        randomUUID(),
        tenantId,
        installPrimary.payload.id,
        eventId,
        "LISTING_STATUS",
        JSON.stringify({ source: "test", duplicate: 3 }),
      );
    } catch (error) {
      duplicateRejected = true;
      const code = error && typeof error === "object" ? error.code : null;
      const dbCode = error && typeof error === "object" && error.meta ? error.meta.code : null;
      const isUniqueViolation = code === "23505" || (code === "P2010" && dbCode === "23505");
      assert(
        isUniqueViolation,
        `expected unique violation 23505, got code=${String(code)} dbCode=${String(dbCode)}`,
      );
    }
    assert(duplicateRejected, "expected duplicate webhook event for same installation to be rejected");

    // RLS-BYPASS: manual tenant filter
    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT installation_id AS "installationId", external_event_id AS "externalEventId"
      FROM connector_webhook_events
      WHERE tenant_key = $1 AND external_event_id = $2
      ORDER BY installation_id ASC
      `,
      tenantId,
      eventId,
    );

    assert(Array.isArray(rows) && rows.length === 2, `expected 2 accepted rows for scoped dedupe, got ${rows.length}`);
    assert(
      rows.every((row) => row.externalEventId === eventId),
      "expected all stored rows to match test external_event_id",
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          externalEventId: eventId,
          validated: [
            "unique_scope_is_installation_plus_event_id",
            "cross_installation_same_event_id_allowed",
            "same_installation_duplicate_event_id_rejected",
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
    console.error("Webhook dedupe scope integration test failed:");
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
          // ignore
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



