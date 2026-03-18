#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createHmac } = require("node:crypto");
const { spawn, execFileSync, execSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
const SCHEMA_PATH = path.join(REPO_ROOT, "packages", "db", "prisma", "schema.prisma");
const MIGRATION_FILE = path.join(
  REPO_ROOT,
  "packages",
  "db",
  "prisma",
  "migrations",
  "20260318153000_outbound_webhooks_foundation",
  "migration.sql",
);

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
    const raw = line.slice(idx + 1).trim();
    const value = raw.replace(/^"|"$/g, "");
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
  setDefaultEnv("JWT_SECRET", "pim1-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "pim1-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("PIM_AUTH_PASSWORD", "pim1-demo-password");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "pim1-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/pim1-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
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
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, payload };
}

async function login(baseUrl, workspaceSlug, userId) {
  return apiRequest(baseUrl, "POST", "/auth/login", null, {
    workspaceSlug,
    userId,
    password: process.env.PIM_AUTH_PASSWORD,
    expiresInMinutes: 30,
  });
}

function createPrisma() {
  const url = String(process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL ?? "").trim();
  if (!url) {
    throw new Error("DATABASE_URL is required for outbound-webhooks integration test.");
  }
  return new PrismaClient({ datasources: { db: { url } } });
}

function runMigrations() {
  const env = {
    ...process.env,
    DATABASE_URL: String(process.env.DATABASE_URL ?? "").trim(),
    DATABASE_URL_POOLED: String(process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL ?? "").trim(),
    DATABASE_URL_DIRECT: String(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? "").trim(),
  };
  const command =
    process.platform === "win32"
      ? `npx prisma db execute --schema "${SCHEMA_PATH}" --file "${MIGRATION_FILE}"`
      : `npx prisma db execute --schema '${SCHEMA_PATH}' --file '${MIGRATION_FILE}'`;
  execSync(command, {
    cwd: REPO_ROOT,
    stdio: "ignore",
    env,
  });
}

async function waitForWebhook(state, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (state.received) {
      return state.received;
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for outbound webhook after ${timeoutMs}ms`);
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }
  runMigrations();

  const runId = Date.now().toString();
  const port = 7120 + Math.floor(Math.random() * 120);
  const webhookState = { received: null };
  const webhookServer = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      let payload = null;
      try {
        payload = bodyText ? JSON.parse(bodyText) : null;
      } catch {
        payload = bodyText;
      }
      webhookState.received = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        bodyText,
        payload,
      };
      res.statusCode = 204;
      res.end();
    });
  });
  await new Promise((resolve) => webhookServer.listen(0, "127.0.0.1", resolve));
  const webhookAddress = webhookServer.address();
  const webhookPort = typeof webhookAddress === "object" && webhookAddress ? webhookAddress.port : 0;
  const webhookUrl = `http://127.0.0.1:${webhookPort}/hooks/approval`;
  const signingSecret = `outbound-webhook-secret-${runId}`;

  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const platformToken = `outbound-webhooks-${runId}`;
  const tenantKey = `outbound-webhooks-${runId}`;
  const workspaceSlug = `ow-${runId}`.slice(0, 24);
  const displayName = `Outbound Webhooks ${runId}`;
  const adminUserId = `outbound-admin-${runId}@example.com`;
  const editorUserId = `outbound-editor-${runId}@example.com`;
  const viewerUserId = `outbound-viewer-${runId}@example.com`;

  const env = {
    ...process.env,
    PORT: String(port),
    AUTH_MODE: "db",
    PIM_PLATFORM_ADMIN_TOKEN: platformToken,
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_AUTH_IDENTITIES_JSON: "",
    PIM_AUTH_WORKSPACES_JSON: "",
    QUEUE_BACKEND: "memory",
    QUEUE_WORKER_ENABLED: "true",
  };

  const prisma = createPrisma();
  const stdoutBuffer = [];
  const stderrBuffer = [];
  let adminToken = null;
  const apiProcess = spawn("node", [API_ENTRY], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  apiProcess.stdout.on("data", (chunk) => {
    stdoutBuffer.push(String(chunk));
    if (stdoutBuffer.length > 200) stdoutBuffer.shift();
  });
  apiProcess.stderr.on("data", (chunk) => {
    stderrBuffer.push(String(chunk));
    if (stderrBuffer.length > 200) stderrBuffer.shift();
  });

  let categoryId = null;
  let productId = null;
  let approvalEndpointId = null;
  let importEndpointId = null;
  let publishEndpointId = null;

  try {
    await waitForHealth(baseUrl, 60_000);

    const provision = await apiRequest(
      baseUrl,
      "POST",
      "/platform/tenants",
      null,
      { tenantKey, workspaceSlug, displayName, initialAdminUserId: adminUserId },
      { "x-pim-platform-admin-token": platformToken },
    );
    assertStatus(provision, 201, "platform tenant provisioning");

    const adminLogin = await login(baseUrl, workspaceSlug, adminUserId);
    assertStatus(adminLogin, 201, "admin login");
    adminToken = String(adminLogin.payload?.accessToken ?? "");
    assert(adminToken.length > 10, "missing admin access token");

    const createViewer = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminToken, {
      userId: viewerUserId,
      role: "viewer",
    });
    assertStatus(createViewer, 201, "create viewer for access gating");

    const createEditor = await apiRequest(baseUrl, "POST", "/admin/workspace/users", adminToken, {
      userId: editorUserId,
      role: "editor",
    });
    assertStatus(createEditor, 201, "create editor for notification coverage");

    const viewerLogin = await login(baseUrl, workspaceSlug, viewerUserId);
    assertStatus(viewerLogin, 201, "viewer login");
    const viewerToken = String(viewerLogin.payload?.accessToken ?? "");

    const editorLogin = await login(baseUrl, workspaceSlug, editorUserId);
    assertStatus(editorLogin, 201, "editor login");
    const editorToken = String(editorLogin.payload?.accessToken ?? "");

    const createApprovalWebhook = await apiRequest(baseUrl, "POST", "/admin/webhooks", adminToken, {
      name: "Approval decisions",
      eventType: "approval_decision",
      targetUrl: webhookUrl,
      signingSecret,
      isActive: true,
    });
    assertStatus(createApprovalWebhook, 201, "create approval webhook endpoint");
    approvalEndpointId = String(createApprovalWebhook.payload?.id ?? "");
    assert(approvalEndpointId.length > 0, "missing approval webhook endpoint id");

    const createImportWebhook = await apiRequest(baseUrl, "POST", "/admin/webhooks", adminToken, {
      name: "Import failures",
      eventType: "import_failed",
      targetUrl: webhookUrl,
      signingSecret,
      isActive: true,
    });
    assertStatus(createImportWebhook, 201, "create import_failed webhook endpoint");
    importEndpointId = String(createImportWebhook.payload?.id ?? "");
    assert(importEndpointId.length > 0, "missing import_failed webhook endpoint id");

    const createPublishWebhook = await apiRequest(baseUrl, "POST", "/admin/webhooks", adminToken, {
      name: "Publish failures",
      eventType: "publish_failed",
      targetUrl: webhookUrl,
      signingSecret,
      isActive: true,
    });
    assertStatus(createPublishWebhook, 201, "create publish_failed webhook endpoint");
    publishEndpointId = String(createPublishWebhook.payload?.id ?? "");
    assert(publishEndpointId.length > 0, "missing publish_failed webhook endpoint id");

    const listWebhooks = await apiRequest(baseUrl, "GET", "/admin/webhooks", adminToken);
    assertStatus(listWebhooks, 200, "list outbound webhooks");
    assert(Array.isArray(listWebhooks.payload), "webhook list payload must be an array");
    assert(listWebhooks.payload.some((row) => row.id === approvalEndpointId), "approval webhook endpoint must be listed");
    assert(listWebhooks.payload.some((row) => row.id === importEndpointId), "import webhook endpoint must be listed");
    assert(listWebhooks.payload.some((row) => row.id === publishEndpointId), "publish webhook endpoint must be listed");

    const viewerListAttempt = await apiRequest(baseUrl, "GET", "/admin/webhooks", viewerToken);
    assertStatus(viewerListAttempt, 403, "viewer denied outbound webhook admin route");

    webhookState.received = null;
    const sendTestWebhook = await apiRequest(baseUrl, "POST", `/admin/webhooks/${approvalEndpointId}/test`, adminToken);
    assertStatus(sendTestWebhook, 200, "send outbound webhook test delivery");
    const testDeliveryId = String(sendTestWebhook.payload?.id ?? "");
    const testEventId = String(sendTestWebhook.payload?.eventId ?? "");
    assert(testDeliveryId.length > 0, "missing test delivery id");
    assert(testEventId.length > 0, "missing test event id");

    const testReceived = await waitForWebhook(webhookState, 15_000);
    assert(testReceived.method === "POST", `expected POST webhook test delivery, got ${testReceived.method}`);
    assert(testReceived.payload && testReceived.payload.type === "approval_decision", "test webhook payload must be approval_decision");
    assert(testReceived.payload && testReceived.payload.source === "test", "test webhook payload must be marked as test");
    assert(testReceived.payload && testReceived.payload.id === testEventId, "test webhook payload id must match delivery event id");
    const testTimestamp = String(testReceived.headers["x-pim1-webhook-timestamp"] ?? "");
    const testSignature = String(testReceived.headers["x-pim1-webhook-signature"] ?? "");
    assert(testTimestamp.length > 0, "missing test webhook timestamp header");
    assert(testSignature.startsWith("sha256="), "missing test webhook signature prefix");
    const expectedTestSignature = createHmac("sha256", signingSecret)
      .update(`${testTimestamp}.${testReceived.bodyText}`)
      .digest("hex");
    assert(testSignature === `sha256=${expectedTestSignature}`, "test webhook signature mismatch");

    const createCategory = await apiRequest(baseUrl, "POST", "/taxonomy/categories", adminToken, {
      name: `Webhook Category ${runId}`,
    });
    assertStatus(createCategory, 201, "create category");
    categoryId = String(createCategory.payload?.id ?? "");
    assert(categoryId.length > 0, "missing category id");

    const importJob = await apiRequest(baseUrl, "POST", "/bulk-import/jobs", editorToken, {
      categoryId,
      sourceFormat: "json",
      sourceName: "Broken catalog upload",
      rows: [{}],
      maxRetries: 1,
    });
    assertStatus(importJob, 201, "create bulk import job");

    webhookState.received = null;
    const processedImport = await apiRequest(baseUrl, "POST", `/bulk-import/jobs/${importJob.payload.id}/process`, editorToken, {
      chunkSize: 10,
    });
    assertStatus(processedImport, 201, "process bulk import job");

    const importReceived = await waitForWebhook(webhookState, 15_000);
    assert(importReceived.method === "POST", `expected POST import_failed webhook delivery, got ${importReceived.method}`);
    assert(importReceived.payload && importReceived.payload.type === "import_failed", "import webhook payload must be import_failed");
    assert(importReceived.payload && importReceived.payload.userId === editorUserId.toLowerCase(), "import webhook payload must target the editor");
    assert(
      String(importReceived.payload?.metadata?.bulkJobId ?? "") === String(importJob.payload.id),
      "import webhook metadata must include bulkJobId",
    );
    const importTimestamp = String(importReceived.headers["x-pim1-webhook-timestamp"] ?? "");
    const importSignature = String(importReceived.headers["x-pim1-webhook-signature"] ?? "");
    assert(importTimestamp.length > 0, "missing import webhook timestamp header");
    assert(importSignature.startsWith("sha256="), "missing import webhook signature prefix");
    const expectedImportSignature = createHmac("sha256", signingSecret)
      .update(`${importTimestamp}.${importReceived.bodyText}`)
      .digest("hex");
    assert(importSignature === `sha256=${expectedImportSignature}`, "import webhook signature mismatch");

    const createProduct = await apiRequest(baseUrl, "POST", "/catalog/products", editorToken, {
      title: `Webhook Product ${runId}`,
      brand: "WebhookBrand",
      description: "Webhook integration validation product ready for approval",
      categoryId,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 18,
      attributes: {},
    });
    assertStatus(createProduct, 201, "create product");
    productId = String(createProduct.payload?.id ?? "");
    assert(productId.length > 0, "missing product id");
    const productVersion = Number(createProduct.payload?.version ?? 1);

    const submitForReview = await apiRequest(baseUrl, "PATCH", `/catalog/products/${productId}`, editorToken, {
      expectedVersion: productVersion,
      title: `Webhook Product ${runId}`,
      brand: "WebhookBrand",
      description: "Webhook integration validation product ready for approval",
      categoryId,
      hsnCode: "62046200",
      gstRate: 18,
      attributes: {},
      status: "in_review",
    });
    assertStatus(submitForReview, 200, "submit product for review");

    webhookState.received = null;
    const approveProduct = await apiRequest(baseUrl, "POST", `/catalog/products/${productId}/review-decision`, adminToken, {
      status: "approved",
      note: "approve for outbound webhook test",
    });
    assertStatus(approveProduct, 201, "approve product to trigger webhook");

    const received = await waitForWebhook(webhookState, 15_000);
    assert(received.method === "POST", `expected POST webhook delivery, got ${received.method}`);
    assert(received.payload && received.payload.type === "approval_decision", "webhook payload must be approval_decision");
    assert(received.payload && received.payload.userId === editorUserId.toLowerCase(), "webhook payload must target the submitting editor");
    const timestamp = String(received.headers["x-pim1-webhook-timestamp"] ?? "");
    const signature = String(received.headers["x-pim1-webhook-signature"] ?? "");
    assert(timestamp.length > 0, "missing webhook timestamp header");
    assert(signature.startsWith("sha256="), "missing webhook signature prefix");
    const expectedSignature = createHmac("sha256", signingSecret)
      .update(`${timestamp}.${received.bodyText}`)
      .digest("hex");
    assert(signature === `sha256=${expectedSignature}`, "webhook signature mismatch");

    const installConnector = await apiRequest(baseUrl, "POST", "/connectors/flipkart/install", adminToken, {
      accountAlias: `webhook-${runId}`,
    });
    assertStatus(installConnector, 201, "install flipkart connector");

    const exportJob = await apiRequest(baseUrl, "POST", `/marketplace/products/${productId}/export-jobs`, editorToken, {
      channel: "flipkart",
      maxRetries: 1,
    });
    assertStatus(exportJob, 201, "create export job");

    webhookState.received = null;
    const processedExport = await apiRequest(baseUrl, "POST", `/marketplace/export-jobs/${exportJob.payload.id}/process`, editorToken);
    assertStatus(processedExport, 201, "process export job");
    assert(
      ["dead_letter", "failed"].includes(String(processedExport.payload?.status ?? "")),
      `expected failed or dead_letter export job, got ${String(processedExport.payload?.status)}`,
    );

    const publishReceived = await waitForWebhook(webhookState, 15_000);
    assert(publishReceived.method === "POST", `expected POST publish_failed webhook delivery, got ${publishReceived.method}`);
    assert(publishReceived.payload && publishReceived.payload.type === "publish_failed", "publish webhook payload must be publish_failed");
    assert(publishReceived.payload && publishReceived.payload.userId === editorUserId.toLowerCase(), "publish webhook payload must target the editor");
    assert(
      String(publishReceived.payload?.metadata?.exportJobId ?? "") === String(exportJob.payload.id),
      "publish webhook metadata must include exportJobId",
    );
    const publishTimestamp = String(publishReceived.headers["x-pim1-webhook-timestamp"] ?? "");
    const publishSignature = String(publishReceived.headers["x-pim1-webhook-signature"] ?? "");
    assert(publishTimestamp.length > 0, "missing publish webhook timestamp header");
    assert(publishSignature.startsWith("sha256="), "missing publish webhook signature prefix");
    const expectedPublishSignature = createHmac("sha256", signingSecret)
      .update(`${publishTimestamp}.${publishReceived.bodyText}`)
      .digest("hex");
    assert(publishSignature === `sha256=${expectedPublishSignature}`, "publish webhook signature mismatch");

    const listDeliveries = await apiRequest(baseUrl, "GET", "/admin/webhooks/deliveries", adminToken);
    assertStatus(listDeliveries, 200, "list outbound webhook deliveries");
    assert(Array.isArray(listDeliveries.payload), "delivery list payload must be an array");
    const testDelivery = listDeliveries.payload.find((row) => row.id === testDeliveryId);
    assert(testDelivery, "expected queued test delivery row");
    assert(testDelivery.status === "delivered", `expected delivered test webhook row, got ${testDelivery.status}`);
    assert(Number(testDelivery.responseStatus) === 204, `expected test responseStatus=204, got ${testDelivery.responseStatus}`);
    const delivery = listDeliveries.payload.find(
      (row) => row.endpointId === approvalEndpointId && row.eventType === "approval_decision" && row.id !== testDeliveryId,
    );
    assert(delivery, "expected delivery row for approval_decision");
    assert(delivery.status === "delivered", `expected delivered webhook row, got ${delivery.status}`);
    assert(Number(delivery.responseStatus) === 204, `expected responseStatus=204, got ${delivery.responseStatus}`);
    const importDelivery = listDeliveries.payload.find(
      (row) => row.endpointId === importEndpointId && row.eventType === "import_failed",
    );
    assert(importDelivery, "expected delivery row for import_failed");
    assert(importDelivery.status === "delivered", `expected delivered import webhook row, got ${importDelivery.status}`);
    assert(Number(importDelivery.responseStatus) === 204, `expected import responseStatus=204, got ${importDelivery.responseStatus}`);
    const publishDelivery = listDeliveries.payload.find(
      (row) => row.endpointId === publishEndpointId && row.eventType === "publish_failed",
    );
    assert(publishDelivery, "expected delivery row for publish_failed");
    assert(publishDelivery.status === "delivered", `expected delivered publish webhook row, got ${publishDelivery.status}`);
    assert(Number(publishDelivery.responseStatus) === 204, `expected publish responseStatus=204, got ${publishDelivery.responseStatus}`);

    const updateWebhook = await apiRequest(baseUrl, "PATCH", `/admin/webhooks/${approvalEndpointId}`, adminToken, {
      isActive: false,
      name: "Approval decisions paused",
    });
    assertStatus(updateWebhook, 200, "deactivate outbound webhook endpoint");
    assert(updateWebhook.payload?.isActive === false, "webhook endpoint must be inactive after patch");

    const deleteApprovalWebhook = await apiRequest(baseUrl, "DELETE", `/admin/webhooks/${approvalEndpointId}`, adminToken);
    assertStatus(deleteApprovalWebhook, 200, "delete approval webhook endpoint");
    const deleteImportWebhook = await apiRequest(baseUrl, "DELETE", `/admin/webhooks/${importEndpointId}`, adminToken);
    assertStatus(deleteImportWebhook, 200, "delete import webhook endpoint");
    const deletePublishWebhook = await apiRequest(baseUrl, "DELETE", `/admin/webhooks/${publishEndpointId}`, adminToken);
    assertStatus(deletePublishWebhook, 200, "delete publish webhook endpoint");

    const auditRows = await prisma.$queryRawUnsafe(
      `
      SELECT action
      FROM audit_logs
      WHERE tenant_key = $1
        AND action IN (
          'outbound_webhook.created',
          'outbound_webhook.test_requested',
          'outbound_webhook.updated',
          'outbound_webhook.deleted'
        )
      `,
      tenantKey,
    );
    const actions = Array.isArray(auditRows) ? auditRows.map((row) => String(row.action ?? "")) : [];
    assert(actions.includes("outbound_webhook.created"), "expected outbound_webhook.created audit row");
    assert(actions.includes("outbound_webhook.test_requested"), "expected outbound_webhook.test_requested audit row");
    assert(actions.includes("outbound_webhook.updated"), "expected outbound_webhook.updated audit row");
    assert(actions.includes("outbound_webhook.deleted"), "expected outbound_webhook.deleted audit row");

    console.log(JSON.stringify({
      status: "ok",
      tenantKey,
      workspaceSlug,
      validated: [
        "admin_can_manage_outbound_webhook_endpoints",
        "viewer_forbidden_from_outbound_webhook_admin_routes",
        "admin_can_send_signed_outbound_webhook_test_deliveries",
        "import_failed_notifications_trigger_signed_outbound_webhooks",
        "approval_decision_triggers_signed_outbound_webhook_delivery",
        "publish_failed_notifications_trigger_signed_outbound_webhooks",
        "delivery_history_records_successful_delivery",
        "webhook_admin_mutations_emit_audit_rows"
      ],
      checkedAt: new Date().toISOString(),
    }, null, 2));
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const stdout = stdoutBuffer.join("").slice(-4000);
    const stderr = stderrBuffer.join("").slice(-4000);
    console.error("Outbound webhooks integration test failed:");
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
    if (productId) {
      await apiRequest(baseUrl, "DELETE", `/catalog/products/${productId}`, adminToken).catch(() => undefined);
    }
    if (categoryId) {
      await apiRequest(baseUrl, "DELETE", `/taxonomy/categories/${categoryId}`, adminToken).catch(() => undefined);
    }
    await prisma.$disconnect().catch(() => undefined);
    await new Promise((resolve) => webhookServer.close(() => resolve(undefined))).catch(() => undefined);
    if (!apiProcess.killed && apiProcess.pid) {
      if (process.platform === "win32") {
        try {
          execFileSync("taskkill", ["/pid", String(apiProcess.pid), "/t", "/f"], { stdio: "ignore" });
        } catch {
          // ignore
        }
      } else {
        apiProcess.kill("SIGTERM");
      }
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
