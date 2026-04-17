#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { createHmac, randomUUID } = require("node:crypto");
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

function resolveAuthPassword() {
  return String(process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password");
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
  setDefaultEnv("R2_PUBLIC_URL", "https://cdn.example.com/vexa-pim-local");
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

async function apiRequest(baseUrl, method, route, token, body, extraHeaders = {}) {
  const headers = { Accept: "application/json", ...extraHeaders };
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
  return { status: response.status, payload };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertStatus(result, expected, context) {
  if (result.status !== expected) {
    throw new Error(
      `${context} failed: expected ${expected}, got ${result.status} payload=${JSON.stringify(result.payload)}`,
    );
  }
}

function sign(secret, timestamp, body) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

async function waitForProcessedWebhook(prisma, tenantId, installationId, eventId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT
        processed_at AS "processedAt",
        submission_id AS "submissionId"
      FROM connector_webhook_events
      WHERE tenant_key = $1
        AND installation_id = $2
        AND external_event_id = $3
      `,
      tenantId,
      installationId,
      eventId,
    );
    if (Array.isArray(rows) && rows.length === 1 && rows[0].processedAt) {
      return rows[0];
    }
    await sleep(150);
  }
  throw new Error(`Webhook ${eventId} was not processed within ${timeoutMs}ms`);
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 7290 + Math.floor(Math.random() * 140);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `amazon-webhook-relay-${runId}`;
  const workspaceSlug = `amzr-${runId}`.slice(0, 24);
  const userId = `amazon-webhook-relay-user-${runId}`;
  const authPassword = resolveAuthPassword();
  const webhookSecret = `amazon-webhook-secret-${runId}`;
  const relayToken = `amazon-relay-token-${runId}`;
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Amazon Webhook Relay Test" },
    }),
    PIM_AUTH_PASSWORD: authPassword,
    PIM_AMAZON_WEBHOOK_SECRET: webhookSecret,
    PIM_CONNECTOR_WEBHOOK_RELAY_TOKEN: relayToken,
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
      userId,
      workspaceSlug,
      password: authPassword,
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "login");
    const token = String(login.payload?.accessToken ?? "");
    assert(token.length > 10, "missing access token");

    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
      name: `Amazon Webhook Relay Category ${runId}`,
    });
    assertStatus(category, 201, "create category");
    const categoryId = String(category.payload.id);

    const product = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
      title: `Amazon Webhook Relay Product ${runId}`,
      description: "Amazon webhook relay integration test.",
      brand: "Vexa PIM",
      categoryId,
      status: "draft",
      attributes: {
        color: "black",
      },
      hsnCode: "62046200",
      gstRate: 12,
    });
    assertStatus(product, 201, "create product");
    const productId = String(product.payload.id);

    const variant = await apiRequest(
      baseUrl,
      "POST",
      `/catalog/products/${encodeURIComponent(productId)}/variants`,
      token,
      {
        skuCode: `AMZR-${runId}`,
        attributes: {},
        mrp: 1999,
        sellingPrice: 1499,
        inventoryQty: 8,
        status: "draft",
      },
    );
    assertStatus(variant, 201, "create variant");
    const sku = `AMZR-${runId}`;

    const install = await apiRequest(baseUrl, "POST", "/connectors/amazon-in/install", token, {
      accountAlias: `relay-${runId}`,
      externalAccountRef: `seller-${runId}`,
    });
    assertStatus(install, 201, "install amazon connector");
    const installationId = String(install.payload.id);

    const submissionId = randomUUID();
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
        submitted_at,
        resolved_at
      ) VALUES (
        $1, $2, $3, $4, NULL, $5, 'PUBLISH', 'LIVE_API', 1, 'PENDING', $6, '{}'::jsonb, NULL, '[]'::jsonb, NOW(), NULL
      )
      `,
      submissionId,
      tenantId,
      installationId,
      productId,
      `amazon-webhook-relay-job-${runId}:PUBLISH`,
      "amz-webhook-relay-external-1",
    );

    const body = {
      detail: {
        NotificationType: "LISTINGS_ITEM_STATUS_CHANGE",
        NotificationMetadata: {
          NotificationId: `evt-amz-relay-${runId}`,
        },
        Payload: {
          SellerId: `seller-${runId}`,
          MarketplaceId: "A21TJRUUN4KGV",
          Sku: sku,
          Status: ["BUYABLE"],
        },
      },
    };
    const canonicalBody = JSON.stringify(body);
    const timestamp = new Date().toISOString();

    const unauthorized = await apiRequest(
      baseUrl,
      "POST",
      `/connector-webhooks/relay/${encodeURIComponent(tenantId)}/installations/${encodeURIComponent(installationId)}`,
      null,
      body,
      {
        "x-pim-connector-relay-token": "wrong-token",
        "x-pim1-webhook-timestamp": timestamp,
        "x-pim1-webhook-signature": sign(webhookSecret, timestamp, canonicalBody),
      },
    );
    assertStatus(unauthorized, 401, "relay webhook unauthorized guard");

    const queued = await apiRequest(
      baseUrl,
      "POST",
      `/connector-webhooks/relay/${encodeURIComponent(tenantId)}/installations/${encodeURIComponent(installationId)}`,
      null,
      body,
      {
        "x-pim-connector-relay-token": relayToken,
        "x-pim1-webhook-timestamp": timestamp,
        "x-pim1-webhook-signature": sign(webhookSecret, timestamp, canonicalBody),
      },
    );
    assertStatus(queued, 202, "relay webhook enqueue");
    assert(queued.payload?.queued === true, "expected queued relay response");
    assert(String(queued.payload?.adapter ?? "") === "relay_http", "expected relay_http adapter response");

    const webhook = await waitForProcessedWebhook(
      prisma,
      tenantId,
      installationId,
      `evt-amz-relay-${runId}`,
      8_000,
    );
    assert(
      String(webhook.submissionId) === submissionId,
      `expected relay webhook to resolve submission ${submissionId}, got ${String(webhook.submissionId)}`,
    );

    const submissionRows = await prisma.$queryRawUnsafe(
      `
      SELECT
        status,
        channel_errors AS "channelErrors",
        resolved_at AS "resolvedAt"
      FROM connector_submissions
      WHERE tenant_key = $1
        AND id = $2
      `,
      tenantId,
      submissionId,
    );
    assert(Array.isArray(submissionRows) && submissionRows.length === 1, "expected relay-updated submission row");
    const submission = submissionRows[0];
    assert(
      String(submission.status) === "SUCCESS",
      `expected SUCCESS submission after relay webhook, got ${String(submission.status)}`,
    );
    assert(submission.resolvedAt, "expected resolvedAt after relay webhook");
    assert(
      Array.isArray(submission.channelErrors) && submission.channelErrors.length === 0,
      `expected no relay channel errors, got ${JSON.stringify(submission.channelErrors)}`,
    );

    const webhookRows = await prisma.$queryRawUnsafe(
      `
      SELECT COUNT(*)::int AS count
      FROM connector_webhook_events
      WHERE tenant_key = $1
        AND installation_id = $2
      `,
      tenantId,
      installationId,
    );
    assert(
      Array.isArray(webhookRows) && webhookRows[0]?.count === 1,
      `expected one persisted relay webhook row, got ${JSON.stringify(webhookRows)}`,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          installationId,
          submissionId,
          validated: [
            "amazon_webhook_relay_controller_requires_internal_relay_token",
            "amazon_webhook_relay_controller_enqueues_signed_events_for_queue_processing",
            "amazon_webhook_relay_controller_preserves_submission_resolution_flow",
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
    console.error("Amazon webhook relay controller integration test failed:");
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
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
