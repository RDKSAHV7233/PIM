#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
const GOVERNANCE_SCRIPT = path.join(REPO_ROOT, "scripts", "enforce-payload-governance.cjs");

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
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    setDefaultEnv("DATABASE_URL_POOLED", databaseUrl);
    setDefaultEnv("DATABASE_URL_DIRECT", databaseUrl);
  }
  setDefaultEnv("JWT_SECRET", "pim1-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "pim1-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "pim1-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/pim1-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("PIM_DEFAULT_ROLE", "admin");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
  setDefaultEnv("DATA_RETENTION_DAYS_REDACT_PAYLOAD", "90");
  setDefaultEnv("DATA_RETENTION_DAYS_PURGE_PAYLOAD", "365");
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
  const apiPort = 6000 + Math.floor(Math.random() * 120);
  const baseUrl = `http://localhost:${apiPort}/api/v1`;
  const tenantId = `governance-tenant-${runId}`;
  const userId = `governance-user-${runId}`;
  const authIdentityJson = JSON.stringify({
    [userId]: { tenantId, role: "admin" },
  });
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_DEFAULT_ROLE: "admin",
    PIM_AUTH_IDENTITIES_JSON: authIdentityJson,
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
    await waitForHealth(baseUrl, 120_000);

    const login = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      userId,
      tenantId,
      role: "admin",
      password: "pim1-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "login");
    const token = login.payload?.accessToken;
    assert(typeof token === "string" && token.length > 10, "missing access token");

    const install = await apiRequest(baseUrl, "POST", "/connectors/flipkart/install", token, {
      accountAlias: "primary",
    });
    assertStatus(install, 201, "install connector");
    const installationId = install.payload.id;

    const now = Date.now();
    const redactAgeDate = new Date(now - 120 * 24 * 60 * 60 * 1000);
    const purgeAgeDate = new Date(now - 400 * 24 * 60 * 60 * 1000);

    const submissionRedactKey = `gov-redact-${runId}:PUBLISH`;
    const submissionPurgeKey = `gov-purge-${runId}:PUBLISH`;
    const webhookRedactEvent = `gov-redact-event-${runId}`;
    const webhookPurgeEvent = `gov-purge-event-${runId}`;

    // RLS-BYPASS: manual tenant filter
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO connector_submissions (
        id,
        tenant_key,
        installation_id,
        product_id,
        variant_id,
        idempotency_key,
        submission_type,
        source,
        attempt_number,
        status,
        external_ref,
        payload_snapshot,
        payload_snapshot_url,
        channel_errors,
        submitted_at
      ) VALUES
        ($1, $2, $3, 'product-redact', NULL, $4, 'PUBLISH', 'LOCAL_RULES', 1, 'ERROR', NULL, $5::jsonb, $6, '[]'::jsonb, $7),
        ($8, $2, $3, 'product-purge', NULL, $9, 'PUBLISH', 'LOCAL_RULES', 1, 'ERROR', NULL, $10::jsonb, $11, '[]'::jsonb, $12)
      `,
      randomUUID(),
      tenantId,
      installationId,
      submissionRedactKey,
      JSON.stringify({ pii: "redact-me", sample: "payload" }),
      "https://example.com/raw-redact.json",
      redactAgeDate,
      randomUUID(),
      submissionPurgeKey,
      JSON.stringify({ pii: "purge-me", sample: "payload" }),
      "https://example.com/raw-purge.json",
      purgeAgeDate,
    );

    // RLS-BYPASS: manual tenant filter
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO connector_webhook_events (
        id,
        tenant_key,
        installation_id,
        external_event_id,
        event_type,
        payload,
        received_at
      ) VALUES
        ($1, $2, $3, $4, 'LISTING_STATUS', $5::jsonb, $6),
        ($7, $2, $3, $8, 'LISTING_STATUS', $9::jsonb, $10)
      `,
      randomUUID(),
      tenantId,
      installationId,
      webhookRedactEvent,
      JSON.stringify({ pii: "redact-me-webhook" }),
      redactAgeDate,
      randomUUID(),
      webhookPurgeEvent,
      JSON.stringify({ pii: "purge-me-webhook" }),
      purgeAgeDate,
    );

    execFileSync("node", [GOVERNANCE_SCRIPT, "--tenant", tenantId], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DATABASE_URL_POOLED: process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL,
        DATABASE_URL_DIRECT: process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL,
      },
      stdio: "ignore",
    });

    // RLS-BYPASS: manual tenant filter
    const redactedSubmissionRows = await prisma.$queryRawUnsafe(
      `
      SELECT payload_snapshot AS "payloadSnapshot", payload_snapshot_url AS "payloadSnapshotUrl"
      FROM connector_submissions
      WHERE tenant_key = $1 AND idempotency_key = $2
      `,
      tenantId,
      submissionRedactKey,
    );
    assert(Array.isArray(redactedSubmissionRows) && redactedSubmissionRows.length === 1, "expected redacted submission row");
    const redactedSubmission = redactedSubmissionRows[0];
    assert(redactedSubmission.payloadSnapshot?.redacted === true, "submission payload should be redacted");
    assert(redactedSubmission.payloadSnapshotUrl === null, "submission payloadSnapshotUrl should be cleared on redaction");

    // RLS-BYPASS: manual tenant filter
    const purgedSubmissionRows = await prisma.$queryRawUnsafe(
      `
      SELECT id FROM connector_submissions
      WHERE tenant_key = $1 AND idempotency_key = $2
      `,
      tenantId,
      submissionPurgeKey,
    );
    assert(Array.isArray(purgedSubmissionRows) && purgedSubmissionRows.length === 0, "expected purged submission row to be deleted");

    // RLS-BYPASS: manual tenant filter
    const redactedWebhookRows = await prisma.$queryRawUnsafe(
      `
      SELECT payload
      FROM connector_webhook_events
      WHERE tenant_key = $1 AND external_event_id = $2
      `,
      tenantId,
      webhookRedactEvent,
    );
    assert(Array.isArray(redactedWebhookRows) && redactedWebhookRows.length === 1, "expected redacted webhook row");
    const redactedWebhook = redactedWebhookRows[0];
    assert(redactedWebhook.payload?.redacted === true, "webhook payload should be redacted");

    // RLS-BYPASS: manual tenant filter
    const purgedWebhookRows = await prisma.$queryRawUnsafe(
      `
      SELECT id
      FROM connector_webhook_events
      WHERE tenant_key = $1 AND external_event_id = $2
      `,
      tenantId,
      webhookPurgeEvent,
    );
    assert(Array.isArray(purgedWebhookRows) && purgedWebhookRows.length === 0, "expected purged webhook row to be deleted");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          validated: [
            "payload_redaction_after_90_days",
            "payload_purge_after_365_days",
            "raw_payload_urls_cleared_on_redaction",
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
    console.error("Payload governance policy integration test failed:");
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



