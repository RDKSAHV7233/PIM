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
  const { PrismaService } = require(path.join(REPO_ROOT, "apps", "api", "dist", "prisma", "prisma.service.js"));
  const { PrismaDirectService } = require(path.join(REPO_ROOT, "apps", "api", "dist", "prisma", "prisma-direct.service.js"));
  const { LoggerService } = require(path.join(REPO_ROOT, "apps", "api", "dist", "common", "logging", "logger.service.js"));
  const { AmazonConnector } = require(path.join(REPO_ROOT, "apps", "api", "dist", "connectors", "amazon", "amazon.connector.js"));
  const { FlipkartConnector } = require(path.join(REPO_ROOT, "apps", "api", "dist", "connectors", "flipkart", "flipkart.connector.js"));
  const { MeeshoConnector } = require(path.join(REPO_ROOT, "apps", "api", "dist", "connectors", "meesho", "meesho.connector.js"));
  const { ConnectorRegistry } = require(path.join(REPO_ROOT, "apps", "api", "dist", "connector-framework", "connector.registry.js"));
  const { ConnectorWebhookIngestionService } = require(path.join(REPO_ROOT, "apps", "api", "dist", "connector-framework", "connector-webhook-ingestion.service.js"));

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
  const apiPort = 7390 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `amazon-webhook-backlog-${runId}`;
  const workspaceSlug = `amzb-${runId}`.slice(0, 24);
  const userId = `amazon-webhook-backlog-user-${runId}`;
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
      [workspaceSlug]: { tenantId, displayName: "Amazon Webhook Backlog Resolution Test" },
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
      name: `Amazon Webhook Backlog Category ${runId}`,
    });
    assertStatus(category, 201, "create category");
    const categoryId = String(category.payload.id);

    const install = await apiRequest(baseUrl, "POST", "/connectors/amazon-in/install", token, {
      accountAlias: `webhook-backlog-${runId}`,
      externalAccountRef: `seller-${runId}`,
    });
    assertStatus(install, 201, "install amazon connector");
    const installationId = String(install.payload.id);

    const decoyCount = 60;
    const decoyProducts = [];
    const decoyVariants = [];
    const decoySubmissions = [];
    for (let index = 0; index < decoyCount; index += 1) {
      const productId = randomUUID();
      const variantId = randomUUID();
      const submissionId = randomUUID();
      decoyProducts.push({
        id: productId,
        tenantKey: tenantId,
        title: `Webhook Backlog Decoy ${index}`,
        description: "decoy product for backlog resolution",
        brand: "Vexa PIM",
        status: "draft",
        version: 1,
        categoryId,
        attributes: { color: "black" },
        hsnCode: "62046200",
        gstRate: 12,
      });
      decoyVariants.push({
        id: variantId,
        tenantKey: tenantId,
        productId,
        skuCode: `AMZ-QUEUE-DECOY-${runId}-${index}`,
        attributes: {},
        mrp: 999,
        sellingPrice: 799,
        inventoryQty: 5,
        status: "draft",
      });
      decoySubmissions.push({
        id: submissionId,
        tenantKey: tenantId,
        installationId,
        productId,
        variantId: null,
        idempotencyKey: `amazon-webhook-backlog-decoy-${runId}-${index}`,
        submissionType: "PUBLISH",
        source: "LIVE_API",
        attemptNumber: 1,
        status: "PENDING",
        externalRef: `amz-webhook-backlog-decoy-${runId}-${index}`,
        payloadSnapshot: {},
        payloadSnapshotUrl: null,
        channelErrors: [],
      });
    }

    await prisma.product.createMany({ data: decoyProducts });
    await prisma.variant.createMany({ data: decoyVariants });
    await prisma.connectorSubmission.createMany({ data: decoySubmissions });

    const targetProductId = randomUUID();
    const targetVariantId = randomUUID();
    const targetSubmissionId = randomUUID();
    const targetSku = `AMZ-BACKLOG-${runId}`;
    await prisma.product.create({
      data: {
        id: targetProductId,
        tenantKey: tenantId,
        title: `Amazon Webhook Target ${runId}`,
        description: "target product for backlog resolution",
        brand: "Vexa PIM",
        status: "draft",
        version: 1,
        categoryId,
        attributes: { color: "navy" },
        hsnCode: "62046200",
        gstRate: 12,
      },
    });
    await prisma.variant.create({
      data: {
        id: targetVariantId,
        tenantKey: tenantId,
        productId: targetProductId,
        skuCode: targetSku,
        attributes: {},
        mrp: 1999,
        sellingPrice: 1499,
        inventoryQty: 8,
        status: "draft",
      },
    });
    await prisma.connectorSubmission.create({
      data: {
        id: targetSubmissionId,
        tenantKey: tenantId,
        installationId,
        productId: targetProductId,
        variantId: null,
        idempotencyKey: `amazon-webhook-backlog-target-${runId}`,
        submissionType: "PUBLISH",
        source: "LIVE_API",
        attemptNumber: 1,
        status: "PENDING",
        externalRef: `amz-webhook-backlog-target-${runId}`,
        payloadSnapshot: {},
        payloadSnapshotUrl: null,
        channelErrors: [],
      },
    });

    scopedServices = await createIngestionService();

    const body = JSON.stringify({
      detail: {
        NotificationType: "LISTINGS_ITEM_ISSUES_CHANGE",
        NotificationMetadata: {
          NotificationId: `evt-amz-backlog-${runId}`,
        },
        Payload: {
          SellerId: `seller-${runId}`,
          MarketplaceId: "A21TJRUUN4KGV",
          Sku: targetSku,
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

    const result = await scopedServices.ingestion.ingest({
      tenantKey: tenantId,
      installationId,
      rawBody: Buffer.from(body, "utf8"),
      headers,
    });

    assert(result.accepted === true, "expected webhook to be accepted");
    assert(result.duplicate === false, "expected webhook not to be duplicate");
    assert(
      result.submissionId === targetSubmissionId,
      `expected target submission ${targetSubmissionId}, got ${String(result.submissionId)}`,
    );
    assert(result.status === "SUPPRESSED", `expected SUPPRESSED status, got ${String(result.status)}`);

    const updatedSubmission = await prisma.connectorSubmission.findUnique({
      where: { id: targetSubmissionId },
      select: {
        status: true,
        resolvedAt: true,
      },
    });
    assert(updatedSubmission, "expected updated target submission");
    assert(
      String(updatedSubmission.status) === "SUPPRESSED",
      `expected target submission status SUPPRESSED, got ${String(updatedSubmission.status)}`,
    );
    assert(updatedSubmission.resolvedAt, "expected resolvedAt on target submission");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          installationId,
          targetSubmissionId,
          decoyCount,
          validated: [
            "amazon_webhook_resolution_matches_target_submission_under_pending_backlog",
            "amazon_webhook_resolution_keeps_submission_updates_correct_under_pending_backlog",
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
    console.error("Amazon webhook backlog resolution integration test failed:");
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
