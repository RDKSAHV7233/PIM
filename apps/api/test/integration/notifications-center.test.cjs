#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");

function getAuthPassword() {
  return process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password";
}

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

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 6200 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `notifications-tenant-${runId}`;
  const workspaceSlug = `notify-${runId}`.slice(0, 24);
  const adminUserId = `notifications-admin-${runId}`;
  const editorUserId = `notifications-editor-${runId}`;
  const reviewerUserId = `notifications-reviewer-${runId}`;
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [adminUserId]: { tenantId, role: "admin", workspaceSlug },
      [editorUserId]: { tenantId, role: "editor", workspaceSlug },
      [reviewerUserId]: { tenantId, role: "reviewer", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Notifications workspace" },
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
    if (stdoutBuffer.length > 200) stdoutBuffer.shift();
  });
  apiProcess.stderr.on("data", (chunk) => {
    stderrBuffer.push(String(chunk));
    if (stderrBuffer.length > 200) stderrBuffer.shift();
  });

  const prisma = new PrismaClient({
    datasources: {
      db: { url: process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL },
    },
  });

  try {
    await waitForHealth(baseUrl, 60_000);

    const adminLogin = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId: adminUserId,
      password: getAuthPassword(),
      expiresInMinutes: 30,
    });
    assertStatus(adminLogin, 201, "admin login");
    const adminToken = String(adminLogin.payload?.accessToken ?? "");

    const editorLogin = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId: editorUserId,
      password: getAuthPassword(),
      expiresInMinutes: 30,
    });
    assertStatus(editorLogin, 201, "editor login");
    const editorToken = String(editorLogin.payload?.accessToken ?? "");

    const reviewerLogin = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId: reviewerUserId,
      password: getAuthPassword(),
      expiresInMinutes: 30,
    });
    assertStatus(reviewerLogin, 201, "reviewer login");
    const reviewerToken = String(reviewerLogin.payload?.accessToken ?? "");

    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", adminToken, {
      name: `Notifications Category ${runId}`,
    });
    assertStatus(category, 201, "create category");
    const categoryId = category.payload.id;

    const importJob = await apiRequest(baseUrl, "POST", "/bulk-import/jobs", editorToken, {
      categoryId,
      sourceFormat: "json",
      sourceName: "Broken catalog upload",
      rows: [{}],
      maxRetries: 1,
    });
    assertStatus(importJob, 201, "create bulk import job");

    const processedImport = await apiRequest(baseUrl, "POST", `/bulk-import/jobs/${importJob.payload.id}/process`, editorToken, {
      chunkSize: 10,
    });
    assertStatus(processedImport, 201, "process bulk import job");

    const importNotifications = await apiRequest(baseUrl, "GET", "/notifications?limit=20", editorToken);
    assertStatus(importNotifications, 200, "list notifications after import failure");
    const importNotification = importNotifications.payload.items.find((item) => item.eventType === "import_failed");
    assert(importNotification, "expected import_failed notification for triggering editor");
    assert(
      String(importNotification.actionUrl || "").includes(`/operations/imports?bulkJobId=${importJob.payload.id}`),
      "import_failed notification must deep-link to the import repair view",
    );

    const product = await apiRequest(baseUrl, "POST", "/catalog/products", editorToken, {
      title: `Approval Notification Product ${runId}`,
      brand: "Vexa PIM",
      description: "ready for approval",
      categoryId,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 18,
      attributes: {},
    });
    assertStatus(product, 201, "create clean product");

    const inReview = await apiRequest(baseUrl, "PATCH", `/catalog/products/${product.payload.id}`, editorToken, {
      expectedVersion: product.payload.version,
      title: product.payload.title,
      description: product.payload.description,
      brand: product.payload.brand,
      categoryId: product.payload.categoryId,
      hsnCode: product.payload.hsnCode,
      gstRate: product.payload.gstRate,
      attributes: product.payload.attributes,
      status: "in_review",
    });
    assertStatus(inReview, 200, "move product to in_review");

    const approved = await apiRequest(baseUrl, "POST", `/catalog/products/${product.payload.id}/review-decision`, reviewerToken, {
      status: "approved",
    });
    assertStatus(approved, 201, "reviewer approve product");

    const decisionNotifications = await apiRequest(baseUrl, "GET", "/notifications?limit=20", editorToken);
    assertStatus(decisionNotifications, 200, "list notifications after approval decision");
    const approvalNotification = decisionNotifications.payload.items.find((item) => item.eventType === "approval_decision");
    assert(approvalNotification, "expected approval_decision notification for submitting editor");

    const installConnector = await apiRequest(baseUrl, "POST", "/connectors/flipkart/install", adminToken, {
      accountAlias: `notify-${runId}`,
    });
    assertStatus(installConnector, 201, "install flipkart connector");

    const exportJob = await apiRequest(baseUrl, "POST", `/marketplace/products/${product.payload.id}/export-jobs`, adminToken, {
      channel: "flipkart",
      maxRetries: 1,
    });
    assertStatus(exportJob, 201, "create export job");

    const processedExport = await apiRequest(baseUrl, "POST", `/marketplace/export-jobs/${exportJob.payload.id}/process`, adminToken);
    assertStatus(processedExport, 201, "process export job");
    assert(
      ["dead_letter", "failed"].includes(String(processedExport.payload?.status ?? "")),
      `expected failed or dead_letter export job, got ${String(processedExport.payload?.status)}`,
    );

    const publishNotifications = await apiRequest(baseUrl, "GET", "/notifications?limit=20", adminToken);
    assertStatus(publishNotifications, 200, "list admin notifications after publish failure");
    const publishNotification = publishNotifications.payload.items.find((item) => item.eventType === "publish_failed");
    assert(publishNotification, "expected publish_failed notification for export job creator");
    assert(
      String(publishNotification.actionUrl || "").includes(`/products/${product.payload.id}?tab=channels`),
      "publish_failed notification must deep-link to the product channels tab",
    );

    const unreadBefore = Number(publishNotifications.payload.unreadCount ?? 0);
    const markRead = await apiRequest(baseUrl, "PATCH", `/notifications/${importNotification.id}/read`, editorToken, {});
    assertStatus(markRead, 200, "mark notification read");
    const afterRead = await apiRequest(baseUrl, "GET", "/notifications?limit=20", editorToken);
    assertStatus(afterRead, 200, "list notifications after read");
    const unreadAfter = Number(afterRead.payload.unreadCount ?? 0);
    assert(unreadAfter === Math.max(0, unreadBefore - 1), "unread count must decrement after marking a notification read");

    await prisma.$executeRawUnsafe(
      `
      INSERT INTO user_notifications (
        id, tenant_key, user_id, event_type, title, message, action_url, action_label, metadata
      ) VALUES
        ($1, $2, $3, 'import_failed', 'Import failed', 'Should be hidden from reviewer view', '/operations/imports', 'View import', '{"debug":"hidden"}'::jsonb),
        ($4, $2, $3, 'approval_decision', 'Approval decision received', 'Visible reviewer approval item', '/quality/approvals', 'Review approval', '{"productId":"review-product","debug":"hidden"}'::jsonb)
      `,
      randomUUID(),
      tenantId,
      reviewerUserId,
      randomUUID(),
    );

    const reviewerNotifications = await apiRequest(baseUrl, "GET", "/notifications?limit=20", reviewerToken);
    assertStatus(reviewerNotifications, 200, "list reviewer notifications");
    assert(Array.isArray(reviewerNotifications.payload.items), "reviewer notifications payload must contain items array");
    assert(reviewerNotifications.payload.items.length >= 1, "reviewer notifications must contain approval item");
    assert(
      reviewerNotifications.payload.items.every((item) => item.eventType === "approval_decision"),
      "reviewer view must filter out non-approval notifications",
    );
    const reviewerApprovalNotification = reviewerNotifications.payload.items.find((item) => item.eventType === "approval_decision");
    assert(reviewerApprovalNotification, "reviewer approval notification should remain visible");
    assert(
      reviewerApprovalNotification.metadata &&
        reviewerApprovalNotification.metadata.productId === "review-product" &&
        reviewerApprovalNotification.metadata.debug === undefined,
      `expected reviewer notification metadata to be centrally redacted, got ${JSON.stringify(reviewerApprovalNotification)}`,
    );

    console.log(JSON.stringify({
      status: "ok",
      validated: [
        "import_failure_notifies_triggering_user",
        "approval_decision_notifies_submitting_editor",
        "publish_failure_notifies_export_job_creator",
        "notification_unread_count_decrements_on_read",
        "reviewer_view_filters_to_approval_notifications",
        "reviewer_notification_metadata_is_centrally_redacted",
      ],
      checkedAt: new Date().toISOString(),
    }, null, 2));
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const stdout = stdoutBuffer.join("").slice(-4000);
    const stderr = stderrBuffer.join("").slice(-4000);
    console.error("Notifications center integration test failed:");
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
