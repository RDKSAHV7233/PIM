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

async function createIngestionService() {
  const { PrismaService } = require(path.join(
    REPO_ROOT,
    "apps",
    "api",
    "dist",
    "prisma",
    "prisma.service.js",
  ));
  const { PrismaDirectService } = require(path.join(
    REPO_ROOT,
    "apps",
    "api",
    "dist",
    "prisma",
    "prisma-direct.service.js",
  ));
  const { LoggerService } = require(path.join(
    REPO_ROOT,
    "apps",
    "api",
    "dist",
    "common",
    "logging",
    "logger.service.js",
  ));
  const { AmazonConnector } = require(path.join(
    REPO_ROOT,
    "apps",
    "api",
    "dist",
    "connectors",
    "amazon",
    "amazon.connector.js",
  ));
  const { FlipkartConnector } = require(path.join(
    REPO_ROOT,
    "apps",
    "api",
    "dist",
    "connectors",
    "flipkart",
    "flipkart.connector.js",
  ));
  const { MeeshoConnector } = require(path.join(
    REPO_ROOT,
    "apps",
    "api",
    "dist",
    "connectors",
    "meesho",
    "meesho.connector.js",
  ));
  const { ConnectorRegistry } = require(path.join(
    REPO_ROOT,
    "apps",
    "api",
    "dist",
    "connector-framework",
    "connector.registry.js",
  ));
  const { ConnectorWebhookIngestionService } = require(path.join(
    REPO_ROOT,
    "apps",
    "api",
    "dist",
    "connector-framework",
    "connector-webhook-ingestion.service.js",
  ));

  const prisma = new PrismaService();
  const prismaDirect = new PrismaDirectService();
  const logger = new LoggerService();
  await prisma.onModuleInit();
  await prismaDirect.onModuleInit();

  const registry = new ConnectorRegistry(
    prisma,
    logger,
    new AmazonConnector(prismaDirect, logger),
    new FlipkartConnector(prismaDirect, logger),
    new MeeshoConnector(),
  );
  await registry.onModuleInit();

  return {
    prisma,
    prismaDirect,
    ingestion: new ConnectorWebhookIngestionService(prisma, registry, logger),
  };
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 7210 + Math.floor(Math.random() * 160);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `amazon-webhook-${runId}`;
  const workspaceSlug = `amzw-${runId}`.slice(0, 24);
  const userId = `amazon-webhook-user-${runId}`;
  const authPassword = resolveAuthPassword();
  const webhookSecret = `amazon-webhook-secret-${runId}`;
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Amazon Webhook Ingestion Test" },
    }),
    PIM_AUTH_PASSWORD: authPassword,
    PIM_AMAZON_WEBHOOK_SECRET: webhookSecret,
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

  let scopedServices;
  const previousWebhookSecret = process.env.PIM_AMAZON_WEBHOOK_SECRET;

  try {
    await waitForHealth(baseUrl, 60_000);
    process.env.PIM_AMAZON_WEBHOOK_SECRET = webhookSecret;

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
      name: `Amazon Webhook Category ${runId}`,
    });
    assertStatus(category, 201, "create category");
    const categoryId = String(category.payload.id);

    const product = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
      title: `Amazon Webhook Product ${runId}`,
      description: "Amazon webhook ingestion test.",
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
        skuCode: `AMZW-${runId}`,
        attributes: {},
        mrp: 1999,
        sellingPrice: 1499,
        inventoryQty: 8,
        status: "draft",
      },
    );
    assertStatus(variant, 201, "create variant");
    const sku = `AMZW-${runId}`;

    const install = await apiRequest(baseUrl, "POST", "/connectors/amazon-in/install", token, {
      accountAlias: `webhook-${runId}`,
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
      `amazon-webhook-job-${runId}:PUBLISH`,
      "amz-webhook-external-1",
    );

    scopedServices = await createIngestionService();

    const body = JSON.stringify({
      detail: {
        NotificationType: "LISTINGS_ITEM_ISSUES_CHANGE",
        NotificationMetadata: {
          NotificationId: `evt-amz-${runId}`,
        },
        Payload: {
          SellerId: `seller-${runId}`,
          MarketplaceId: "A21TJRUUN4KGV",
          Sku: sku,
          Severities: ["ERROR"],
          EnforcementActions: ["LISTING_SUPPRESSED"],
        },
      },
    });
    const timestamp = new Date().toISOString();
    const headers = {
      "x-pim1-webhook-timestamp": timestamp,
      "x-pim1-webhook-signature": sign(webhookSecret, timestamp, body),
    };

    const first = await scopedServices.ingestion.ingest({
      tenantKey: tenantId,
      installationId,
      rawBody: Buffer.from(body, "utf8"),
      headers,
    });

    assert(first.accepted === true, "expected webhook to be accepted");
    assert(first.duplicate === false, "expected first webhook not to be duplicate");
    assert(first.eventId === `evt-amz-${runId}`, `unexpected event id ${String(first.eventId)}`);
    assert(first.eventType === "LISTINGS_ITEM_ISSUES_CHANGE", `unexpected event type ${String(first.eventType)}`);
    assert(first.submissionId === submissionId, `expected submission ${submissionId}, got ${String(first.submissionId)}`);
    assert(first.status === "SUPPRESSED", `expected SUPPRESSED status, got ${String(first.status)}`);

    const second = await scopedServices.ingestion.ingest({
      tenantKey: tenantId,
      installationId,
      rawBody: Buffer.from(body, "utf8"),
      headers,
    });

    assert(second.accepted === true, "expected duplicate webhook to still be accepted");
    assert(second.duplicate === true, "expected second webhook to be duplicate");
    assert(second.submissionId === null, "expected duplicate webhook not to reprocess submission");

    const invalid = await scopedServices.ingestion.ingest({
      tenantKey: tenantId,
      installationId,
      rawBody: Buffer.from(body, "utf8"),
      headers: {
        "x-pim1-webhook-timestamp": timestamp,
        "x-pim1-webhook-signature": "sha256=invalid",
      },
    });
    assert(invalid.accepted === false, "expected invalid signature to be rejected");
    assert(invalid.reason === "invalid_signature_or_payload", `unexpected invalid reason ${String(invalid.reason)}`);

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
    assert(Array.isArray(submissionRows) && submissionRows.length === 1, "expected updated submission row");
    const submission = submissionRows[0];
    assert(String(submission.status) === "SUPPRESSED", `expected stored SUPPRESSED status, got ${String(submission.status)}`);
    assert(submission.resolvedAt, "expected resolvedAt after webhook processing");
    assert(Array.isArray(submission.channelErrors) && submission.channelErrors.length === 1, `expected one stored channel error, got ${JSON.stringify(submission.channelErrors)}`);
    assert(String(submission.channelErrors[0].code) === "LISTING_SUPPRESSED", `unexpected stored issue code ${String(submission.channelErrors[0].code)}`);

    const webhookRows = await prisma.$queryRawUnsafe(
      `
      SELECT
        external_event_id AS "externalEventId",
        event_type AS "eventType",
        submission_id AS "submissionId",
        processed_at AS "processedAt"
      FROM connector_webhook_events
      WHERE tenant_key = $1
        AND installation_id = $2
      ORDER BY received_at DESC
      `,
      tenantId,
      installationId,
    );
    assert(Array.isArray(webhookRows) && webhookRows.length === 1, `expected one stored webhook row, got ${webhookRows.length}`);
    const webhook = webhookRows[0];
    assert(String(webhook.externalEventId) === `evt-amz-${runId}`, `unexpected stored event id ${String(webhook.externalEventId)}`);
    assert(String(webhook.eventType) === "LISTINGS_ITEM_ISSUES_CHANGE", `unexpected stored event type ${String(webhook.eventType)}`);
    assert(String(webhook.submissionId) === submissionId, `expected stored submission id ${submissionId}, got ${String(webhook.submissionId)}`);
    assert(webhook.processedAt, "expected processedAt to be set");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          installationId,
          submissionId,
          validated: [
            "amazon_webhook_ingestion_dedupes_by_installation_and_event_id",
            "amazon_webhook_ingestion_resolves_pending_submission_by_installation_and_sku",
            "amazon_invalid_signature_is_rejected_before_persistence",
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
    console.error("Amazon webhook ingestion integration test failed:");
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
    if (scopedServices) {
      await scopedServices.prisma.onModuleDestroy().catch(() => undefined);
      await scopedServices.prismaDirect.onModuleDestroy().catch(() => undefined);
    }
    await prisma.$disconnect();
    if (previousWebhookSecret === undefined) {
      delete process.env.PIM_AMAZON_WEBHOOK_SECRET;
    } else {
      process.env.PIM_AMAZON_WEBHOOK_SECRET = previousWebhookSecret;
    }
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
