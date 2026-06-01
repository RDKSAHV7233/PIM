#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

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
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");  // Set L: auth middleware Redis gate
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("AUTH_MODE", "local");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
  setDefaultEnv("QUEUE_BACKEND", "memory");
  setDefaultEnv("QUEUE_WORKER_ENABLED", "true");
  setDefaultEnv("PIM_AUTH_PASSWORD", "vexa-pim-demo-password");
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
  const headers = {
    Accept: "application/json",
    ...extraHeaders,
  };
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
  return { status: response.status, payload, headers: response.headers };
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
  const port = 6900 + Math.floor(Math.random() * 100);
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const tenantId = `audit-explorer-${runId}`;
  const workspaceSlug = `auditx-${runId}`.slice(0, 24);
  const adminUserId = `audit-admin-${runId}@example.com`;
  const editorUserId = `audit-editor-${runId}@example.com`;
  const commercialToken = `audit-commercial-${runId}`;
  const today = new Date().toISOString().slice(0, 10);

  const env = {
    ...process.env,
    PORT: String(port),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [adminUserId]: { tenantId, role: "admin", workspaceSlug },
      [editorUserId]: { tenantId, role: "editor", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Audit Explorer" },
    }),
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
    if (stdoutBuffer.length > 200) stdoutBuffer.shift();
  });
  apiProcess.stderr.on("data", (chunk) => {
    stderrBuffer.push(String(chunk));
    if (stderrBuffer.length > 200) stderrBuffer.shift();
  });

  try {
    await waitForHealth(baseUrl, 60_000);

    const adminLogin = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId: adminUserId,
      password: process.env.PIM_AUTH_PASSWORD,
      expiresInMinutes: 30,
    });
    assertStatus(adminLogin, 201, "admin login");
    const adminToken = String(adminLogin.payload?.accessToken ?? "");

    const editorLogin = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId: editorUserId,
      password: process.env.PIM_AUTH_PASSWORD,
      expiresInMinutes: 30,
    });
    assertStatus(editorLogin, 201, "editor login");
    const editorToken = String(editorLogin.payload?.accessToken ?? "");

    const category = await apiRequest(
      baseUrl,
      "POST",
      "/taxonomy/categories",
      adminToken,
      { name: `Audit Explorer Category ${runId}` },
    );
    assertStatus(category, 201, "create category");

    const commercialUpdate = await apiRequest(
      baseUrl,
      "POST",
      "/billing/internal/commercial-state",
      null,
      {
        tenantKey: tenantId,
        billingStatus: "past_due",
      },
      {
        "x-pim-commercial-ops-token": commercialToken,
        "x-pim-operator-id": "ops-commercial",
        "x-pim-operator-role": "commercial_ops",
      },
    );
    assert(
      commercialUpdate.status === 200 || commercialUpdate.status === 201,
      `internal commercial update failed: ${JSON.stringify(commercialUpdate)}`,
    );

    const commercialFiltered = await apiRequest(
      baseUrl,
      "GET",
      `/audit/events?entityType=plan&action=TENANT_BILLING_STATUS_SET&limit=25`,
      adminToken,
    );
    assertStatus(commercialFiltered, 200, "commercial audit explorer query");
    assert(
      Array.isArray(commercialFiltered.payload?.items),
      `expected commercial explorer items array, got ${JSON.stringify(commercialFiltered.payload)}`,
    );
    const commercialRow = commercialFiltered.payload.items.find(
      (row) => row && row.resourceId === tenantId && row.action === "TENANT_BILLING_STATUS_SET",
    );
    assert(
      commercialRow,
      `expected commercial audit row for ${tenantId}, got ${JSON.stringify(commercialFiltered.payload.items)}`,
    );
    assert(commercialRow.entityType === "plan", `expected commercial entityType=plan, got ${JSON.stringify(commercialRow)}`);

    const commercialByResource = await apiRequest(
      baseUrl,
      "GET",
      `/audit/events?entityType=plan&resourceId=${encodeURIComponent(tenantId)}&limit=25`,
      adminToken,
    );
    assertStatus(commercialByResource, 200, "commercial audit explorer resource filter");
    assert(
      Array.isArray(commercialByResource.payload?.items) &&
        commercialByResource.payload.items.some((row) => row && row.resourceId === tenantId),
      `expected plan audit events filtered by resourceId=${tenantId}, got ${JSON.stringify(commercialByResource.payload)}`,
    );

    const filtered = await apiRequest(
      baseUrl,
      "GET",
      `/audit/events?actorId=${encodeURIComponent(adminUserId)}&entityType=category&action=POST&dateFrom=${encodeURIComponent(today)}&limit=25`,
      adminToken,
    );
    assertStatus(filtered, 200, "filtered audit explorer query");
    assert(Array.isArray(filtered.payload?.items), `expected explorer items array, got ${JSON.stringify(filtered.payload)}`);
    const categoryRow = filtered.payload.items.find((row) => row && row.resourceId === category.payload.id);
    assert(categoryRow, `expected category audit row for ${category.payload.id}, got ${JSON.stringify(filtered.payload.items)}`);
    assert(categoryRow.entityType === "category", `expected entityType=category, got ${JSON.stringify(categoryRow)}`);
    assert(filtered.payload.limit === 25, `expected limit=25, got ${JSON.stringify(filtered.payload)}`);

    const exportResult = await apiRequest(
      baseUrl,
      "GET",
      `/audit/events/export?actorId=${encodeURIComponent(adminUserId)}&entityType=category&limit=25`,
      adminToken,
      undefined,
      { Accept: "text/csv" },
    );
    assertStatus(exportResult, 200, "audit explorer export");
    const csv = String(exportResult.payload ?? "");
    assert(csv.includes("timestamp,actorId,actorRole,entityType,action,resource,resourceId,metadata"), "expected csv header row");
    assert(csv.includes(category.payload.id), `expected category id in csv export, got ${csv}`);

    const editorDenied = await apiRequest(baseUrl, "GET", "/audit/events?limit=25", editorToken);
    assertStatus(editorDenied, 403, "editor audit explorer denial");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          workspaceSlug,
          validated: [
            "admin_can_filter_commercial_audit_events_as_plan_entity_type",
            "admin_can_filter_audit_events_by_resource_id",
            "admin_can_filter_audit_events_by_actor_action_entity_and_date",
            "admin_can_export_filtered_audit_events_as_csv",
            "non_admin_roles_are_denied_audit_explorer_access",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error("Audit explorer API integration test failed:");
    console.error(details);
    if (stdoutBuffer.length) {
      console.error("--- API stdout tail ---");
      console.error(stdoutBuffer.join("").slice(-4000));
    }
    if (stderrBuffer.length) {
      console.error("--- API stderr tail ---");
      console.error(stderrBuffer.join("").slice(-4000));
    }
    process.exitCode = 1;
  } finally {
    if (!apiProcess.killed && apiProcess.pid) {
      if (process.platform === "win32") {
        try {
          execFileSync("taskkill", ["/pid", String(apiProcess.pid), "/t", "/f"], { stdio: "ignore" });
        } catch {
          // ignore cleanup failures
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
