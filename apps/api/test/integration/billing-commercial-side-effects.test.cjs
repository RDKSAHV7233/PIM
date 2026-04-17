#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const DIST_APP_MODULE = path.join(REPO_ROOT, "apps", "api", "dist", "app.module.js");

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

function prepareEnv(runtimeDir, outboxDir) {
  readEnvFile(path.join(REPO_ROOT, ".env"));
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (databaseUrl) {
    setDefaultEnv("DATABASE_URL_POOLED", databaseUrl);
    setDefaultEnv("DATABASE_URL_DIRECT", databaseUrl);
  }
  setDefaultEnv("AUTH_MODE", "db");
  process.env.PIM_AUTH_IDENTITIES_JSON = "";
  process.env.PIM_AUTH_WORKSPACES_JSON = "";
  setDefaultEnv("JWT_SECRET", "vexa-pim-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "vexa-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
  setDefaultEnv("PIM_ALLOW_LEGACY_HEADERS", "false");
  setDefaultEnv("PIM_AUTH_PASSWORD", "vexa-pim-demo-password");
  setDefaultEnv("PIM_WEB_BASE_URL", "http://localhost:3000");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
  process.env.AUTH_EMAIL_PROVIDER = "file";
  process.env.AUTH_EMAIL_OUTBOX_DIR = outboxDir;
  process.chdir(runtimeDir);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForOutboxCount(outboxDir, expectedCount, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entries = fs.existsSync(outboxDir) ? fs.readdirSync(outboxDir) : [];
    if (entries.length >= expectedCount) {
      return entries;
    }
    await sleep(100);
  }
  return fs.existsSync(outboxDir) ? fs.readdirSync(outboxDir) : [];
}

async function waitForFirstOutboxPayload(outboxDir, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entries = fs.existsSync(outboxDir) ? fs.readdirSync(outboxDir) : [];
    for (const entry of entries) {
      try {
        const filePath = path.join(outboxDir, entry);
        const contents = fs.readFileSync(filePath, "utf8");
        if (!contents.trim()) {
          continue;
        }
        return JSON.parse(contents);
      } catch {
        // File may still be mid-write; retry.
      }
    }
    await sleep(100);
  }
  return null;
}

async function startWebhookReceiver() {
  const calls = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      calls.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to resolve webhook receiver address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls,
    close: async () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function run() {
  if (!fs.existsSync(DIST_APP_MODULE)) {
    throw new Error(`API build output not found at ${DIST_APP_MODULE}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const tenantKey = `billing-side-${runId}`;
  const workspaceSlug = `bsf-${runId}`.slice(0, 24);
  const adminUserId = `admin-${runId}@example.com`;
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "pim1-commercial-side-effects-runtime-"));
  const outboxDir = path.join(runtimeDir, "auth-email-outbox");
  fs.mkdirSync(outboxDir, { recursive: true });
  const originalCwd = process.cwd();
  prepareEnv(runtimeDir, outboxDir);

  const receiver = await startWebhookReceiver();

  const { NestFactory } = require("@nestjs/core");
  const { AppModule } = require(DIST_APP_MODULE);
  const { PrismaService } = require(path.join(REPO_ROOT, "apps", "api", "dist", "prisma", "prisma.service.js"));
  const { TenantDirectoryService } = require(
    path.join(REPO_ROOT, "apps", "api", "dist", "common", "tenant", "tenant-directory.service.js"),
  );
  const { PlanUsageService } = require(
    path.join(REPO_ROOT, "apps", "api", "dist", "billing", "plan-usage.service.js"),
  );
  const { AuthService } = require(path.join(REPO_ROOT, "apps", "api", "dist", "auth", "auth.service.js"));
  const { OutboundWebhooksService } = require(
    path.join(REPO_ROOT, "apps", "api", "dist", "outbound-webhooks", "outbound-webhooks.service.js"),
  );

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    const prisma = app.get(PrismaService);
    const tenantDirectoryService = app.get(TenantDirectoryService);
    const planUsageService = app.get(PlanUsageService);
    const authService = app.get(AuthService);
    const outboundWebhooksService = app.get(OutboundWebhooksService);

    await tenantDirectoryService.provisionWorkspace({
      tenantKey,
      workspaceSlug,
      displayName: `Billing Side Effects ${runId}`,
      initialAdminUserId: adminUserId,
    });

    const endpoint = await outboundWebhooksService.createEndpoint(tenantKey, adminUserId, "admin", {
      name: `Commercial control ${runId}`,
      eventType: "approval_decision",
      targetUrl: `${receiver.baseUrl}/webhooks/vexa-pim`,
      signingSecret: "commercial-side-effect-secret",
      isActive: true,
    });

    const suspendedDeliveryId = `delivery_skip_${runId}`;
    await prisma.tenant(tenantKey).outboundWebhookDelivery.create({
      data: {
        id: suspendedDeliveryId,
        tenantKey,
        endpointId: endpoint.id,
        eventType: "approval_decision",
        eventId: `evt_skip_${runId}`,
        status: "queued",
        requestBody: {
          id: `evt_skip_${runId}`,
          type: "approval_decision",
          source: "test",
          occurredAt: new Date().toISOString(),
          tenantKey,
          userId: adminUserId,
          title: "Suspended delivery",
          message: "This should be skipped while suspended.",
          actionUrl: null,
          actionLabel: null,
          metadata: { scenario: "suspended" },
        },
      },
    });

    const suspendedExportId = `exp_skip_${runId}`;
    await prisma.tenant(tenantKey).accountExportRequest.create({
      data: {
        id: suspendedExportId,
        tenantKey,
        userId: adminUserId,
        actorRole: "admin",
        format: "json",
        status: "queued",
        estimatedReadyInSeconds: 120,
      },
    });

    const suspendedProfile = await planUsageService.updateCommercialStateForTenant(
      tenantKey,
      {
        accessStatus: "suspended",
        suspensionReason: "non_payment",
      },
      "ops-commercial",
    );
    assert(suspendedProfile.accessStatus === "suspended", "tenant should be suspended before worker processing");

    await outboundWebhooksService.processDelivery({
      tenantKey,
      endpointId: endpoint.id,
      deliveryId: suspendedDeliveryId,
      forceDelivery: true,
    });
    await authService.processAccountExportJob({
      jobId: suspendedExportId,
      tenantId: tenantKey,
      userId: adminUserId,
      format: "json",
    });

    const skippedDelivery = await prisma.tenant(tenantKey).outboundWebhookDelivery.findUnique({
      where: { id: suspendedDeliveryId },
      select: {
        status: true,
        attemptCount: true,
        errorMessage: true,
        attemptedAt: true,
        deliveredAt: true,
        responseStatus: true,
      },
    });
    assert(skippedDelivery?.status === "skipped", "suspended delivery should be marked skipped");
    assert(skippedDelivery?.errorMessage === "tenant_suspended", "suspended delivery should record tenant_suspended");
    assert(Number(skippedDelivery?.attemptCount ?? 0) === 1, "suspended delivery should increment attempt count");
    assert(Boolean(skippedDelivery?.attemptedAt), "suspended delivery should record attemptedAt");
    assert(skippedDelivery?.deliveredAt === null, "suspended delivery should not mark deliveredAt");
    assert(skippedDelivery?.responseStatus === null, "suspended delivery should not record response status");
    assert(receiver.calls.length === 0, "suspended delivery should not hit the webhook endpoint");

    const skippedExport = await prisma.tenant(tenantKey).accountExportRequest.findUnique({
      where: { id: suspendedExportId },
      select: {
        status: true,
        estimatedReadyInSeconds: true,
        artifactPath: true,
        completedAt: true,
        failedAt: true,
        errorMessage: true,
      },
    });
    assert(skippedExport?.status === "skipped", "suspended export should be marked skipped");
    assert(skippedExport?.errorMessage === "tenant_suspended", "suspended export should record tenant_suspended");
    assert(Number(skippedExport?.estimatedReadyInSeconds ?? -1) === 0, "suspended export should clear ETA");
    assert(skippedExport?.artifactPath === null, "suspended export should not create an artifact");
    assert(skippedExport?.completedAt === null, "suspended export should not complete");
    assert(Boolean(skippedExport?.failedAt), "suspended export should record a terminal timestamp");

    const outboxAfterSkip = fs.existsSync(outboxDir) ? fs.readdirSync(outboxDir) : [];
    assert(outboxAfterSkip.length === 0, "suspended export should not send ready email");

    const skippedPrivacyStatus = await authService.getAccountPrivacyStatus(adminUserId, tenantKey);
    assert(skippedPrivacyStatus.latestExport?.status === "skipped", "privacy status should surface skipped export state");
    assert(
      skippedPrivacyStatus.latestExport?.errorMessage === "tenant_suspended",
      "privacy status should expose tenant_suspended for skipped export",
    );

    const resumedProfile = await planUsageService.updateCommercialStateForTenant(
      tenantKey,
      {
        accessStatus: "active",
      },
      "ops-commercial",
    );
    assert(resumedProfile.accessStatus === "active", "tenant should resume before second processing pass");

    const resumedDeliveryId = `delivery_ok_${runId}`;
    await prisma.tenant(tenantKey).outboundWebhookDelivery.create({
      data: {
        id: resumedDeliveryId,
        tenantKey,
        endpointId: endpoint.id,
        eventType: "approval_decision",
        eventId: `evt_ok_${runId}`,
        status: "queued",
        requestBody: {
          id: `evt_ok_${runId}`,
          type: "approval_decision",
          source: "test",
          occurredAt: new Date().toISOString(),
          tenantKey,
          userId: adminUserId,
          title: "Resumed delivery",
          message: "This should deliver after resume.",
          actionUrl: null,
          actionLabel: null,
          metadata: { scenario: "resumed" },
        },
      },
    });

    const resumedExportId = `exp_ok_${runId}`;
    await prisma.tenant(tenantKey).accountExportRequest.create({
      data: {
        id: resumedExportId,
        tenantKey,
        userId: adminUserId,
        actorRole: "admin",
        format: "json",
        status: "queued",
        estimatedReadyInSeconds: 120,
      },
    });

    await outboundWebhooksService.processDelivery({
      tenantKey,
      endpointId: endpoint.id,
      deliveryId: resumedDeliveryId,
      forceDelivery: true,
    });
    await authService.processAccountExportJob({
      jobId: resumedExportId,
      tenantId: tenantKey,
      userId: adminUserId,
      format: "json",
    });

    const deliveredRow = await prisma.tenant(tenantKey).outboundWebhookDelivery.findUnique({
      where: { id: resumedDeliveryId },
      select: {
        status: true,
        attemptCount: true,
        deliveredAt: true,
        errorMessage: true,
        responseStatus: true,
      },
    });
    assert(deliveredRow?.status === "delivered", "resumed delivery should be delivered");
    assert(Number(deliveredRow?.attemptCount ?? 0) === 1, "resumed delivery should increment attempt count");
    assert(Boolean(deliveredRow?.deliveredAt), "resumed delivery should set deliveredAt");
    assert(deliveredRow?.errorMessage === null, "resumed delivery should clear errorMessage");
    assert(Number(deliveredRow?.responseStatus ?? 0) === 200, "resumed delivery should record HTTP 200");
    assert(receiver.calls.length === 1, "resumed delivery should reach the webhook endpoint exactly once");

    const completedExport = await prisma.tenant(tenantKey).accountExportRequest.findUnique({
      where: { id: resumedExportId },
      select: {
        status: true,
        artifactPath: true,
        artifactFileName: true,
        completedAt: true,
        errorMessage: true,
      },
    });
    assert(completedExport?.status === "completed", "resumed export should complete");
    assert(Boolean(completedExport?.artifactPath), "resumed export should create an artifact");
    assert(Boolean(completedExport?.completedAt), "resumed export should set completedAt");
    assert(completedExport?.errorMessage === null, "resumed export should clear errorMessage");

    const outboxEntries = await waitForOutboxCount(outboxDir, 1, 5_000);
    assert(outboxEntries.length >= 1, "resumed export should queue a ready email");
    const emailPayload = await waitForFirstOutboxPayload(outboxDir, 5_000);
    assert(emailPayload, "resumed export should produce a readable ready email payload");
    assert(emailPayload.category === "account_export_ready", "ready email should use account_export_ready category");

    const download = await authService.downloadAccountExport(resumedExportId, adminUserId, tenantKey);
    assert(download.kind === "binary", "resumed export should be downloadable from local fallback storage");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantKey,
          validated: [
            "suspended_webhook_delivery_is_marked_skipped_without_network_delivery",
            "suspended_account_export_is_marked_skipped_without_ready_email",
            "privacy_status_surfaces_skipped_export_state",
            "resumed_webhook_delivery_succeeds_again",
            "resumed_account_export_completes_and_sends_ready_email",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close().catch(() => undefined);
    await receiver.close().catch(() => undefined);
    process.chdir(originalCwd);
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error("Billing commercial side-effects integration test failed:");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
