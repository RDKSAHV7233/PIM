#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Remediation stream E3 — Scenario 3
 * Outbound webhook retry + attempt-count increments.
 *
 * Runs the REAL API (apps/api/dist/main.js) with the in-memory queue + worker
 * against the live `pim1` Postgres. A local receiver always returns HTTP 500.
 *
 * Per apps/api/src/outbound-webhooks/outbound-webhooks.service.ts the durable
 * model is ONE outbound_webhook_deliveries row per attempt:
 *   - processDelivery() runs once per queued row; on a 5xx it sets
 *     status='failed', response_status=<code>, attempt_count += 1, then rethrows.
 *   - a subsequent worker pass for the same row early-returns (status != 'queued'),
 *     so a single row's attempt_count never climbs past 1 on its own.
 *   - operator-driven retry (POST /admin/webhooks/deliveries/:id/retry) creates a
 *     NEW queued row re-using event_id + request_body and re-enqueues it.
 *
 * Asserts:
 *   - 5xx delivery  -> row status='failed', attempt_count=1, response_status=500,
 *     error_message mentions 500
 *   - retry endpoint -> a NEW delivery row (distinct id), same event_id, which also
 *     runs and fails (attempt_count=1), i.e. the retry attempt is counted
 *   - audit row outbound_webhook.delivery_retry_queued links originalDeliveryId
 *   - the 500 receiver was hit at least twice (once per attempt row)
 */
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
function resolveDist() {
  const snap = path.join(REPO_ROOT, "apps", "api", ".dist-e3");
  if (fs.existsSync(path.join(snap, "main.js"))) return snap;
  return path.join(REPO_ROOT, "apps", "api", "dist");
}
const API_ENTRY = path.join(resolveDist(), "main.js");

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
    if (key && !process.env[key]) process.env[key] = value;
  }
}
function setDefaultEnv(name, value) {
  if (!process.env[name] || String(process.env[name]).trim().length === 0) process.env[name] = value;
}
function prepareEnv() {
  readEnvFile(path.join(REPO_ROOT, ".env"));
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    setDefaultEnv("DATABASE_URL_POOLED", dbUrl);
    setDefaultEnv("DATABASE_URL_DIRECT", dbUrl);
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
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function assert(c, m) {
  if (!c) throw new Error(m);
}
function assertStatus(r, e, c) {
  if (r.status !== e) throw new Error(`${c} failed: expected ${e}, got ${r.status} payload=${JSON.stringify(r.payload)}`);
}
async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${baseUrl}/health`);
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await sleep(400);
  }
  throw new Error(`API not healthy at ${baseUrl}/health within ${timeoutMs}ms`);
}
async function apiRequest(baseUrl, method, route, token, body, extraHeaders = {}) {
  const headers = { Accept: "application/json", ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  const options = { method, headers, signal: AbortSignal.timeout(20_000) };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${route}`, options);
  const text = await res.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: res.status, payload };
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) throw new Error(`API build not found at ${API_ENTRY}`);

  const runId = Date.now().toString();
  const port = 7460 + Math.floor(Math.random() * 130);
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const platformToken = `owra-platform-${runId}`;
  const commercialOpsToken = `owra-commercial-${runId}`;
  const tenantKey = `owra-${runId}`;
  const workspaceSlug = `owra-${runId}`.slice(0, 24);
  const adminUserId = `owra-admin-${runId}@example.com`;

  // Receiver that always 500s, counting hits.
  let receiverHits = 0;
  const receiver = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      receiverHits += 1;
      res.statusCode = 500;
      res.end("boom");
    });
  });
  await new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  const receiverPort = receiver.address().port;
  const receiverUrl = `http://127.0.0.1:${receiverPort}/hook`;

  const env = {
    ...process.env,
    PORT: String(port),
    AUTH_MODE: "db",
    PIM_PLATFORM_ADMIN_TOKEN: platformToken,
    PIM_COMMERCIAL_OPS_TOKEN: commercialOpsToken,
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_AUTH_IDENTITIES_JSON: "",
    PIM_AUTH_WORKSPACES_JSON: "",
    QUEUE_BACKEND: "memory",
    QUEUE_WORKER_ENABLED: "true",
    OUTBOUND_WEBHOOK_RECOVERY_DISABLED: "true",
    // local plaintext HTTP receiver — never in production
    PIM_UNSAFE_HTTP_WEBHOOK_TARGETS: "true",
  };

  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL } },
  });
  const outBuf = [];
  const apiProcess = spawn("node", [API_ENTRY], { cwd: REPO_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  apiProcess.stdout.on("data", (c) => {
    outBuf.push(String(c));
    if (outBuf.length > 2000) outBuf.shift();
  });
  apiProcess.stderr.on("data", (c) => {
    outBuf.push(String(c));
    if (outBuf.length > 2000) outBuf.shift();
  });

  try {
    await waitForHealth(baseUrl, 60_000);

    const provision = await apiRequest(
      baseUrl,
      "POST",
      "/platform/tenants",
      null,
      { tenantKey, workspaceSlug, displayName: `Outbound Retry ${runId}`, initialAdminUserId: adminUserId },
      { "x-pim-platform-admin-token": platformToken },
    );
    assertStatus(provision, 201, "platform tenant provisioning");

    const upgrade = await apiRequest(
      baseUrl,
      "POST",
      "/billing/internal/plan-tier",
      null,
      { tenantKey, planTier: "ENTERPRISE" },
      {
        "x-pim-commercial-ops-token": commercialOpsToken,
        "x-pim-operator-id": "e3-test",
        "x-pim-operator-role": "system",
      },
    );
    assertStatus(upgrade, 201, "upgrade to ENTERPRISE");

    const login = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId: adminUserId,
      password: process.env.PIM_AUTH_PASSWORD,
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "admin login");
    const token = String(login.payload?.accessToken ?? "");
    assert(token.length > 10, "missing admin token");

    const createEndpoint = await apiRequest(baseUrl, "POST", "/admin/webhooks", token, {
      name: "E3 retry endpoint",
      eventType: "approval_decision",
      targetUrl: receiverUrl,
      signingSecret: `e3-secret-${runId}`,
      isActive: true,
    });
    assertStatus(createEndpoint, 201, "create webhook endpoint");
    const endpointId = String(createEndpoint.payload?.id ?? "");
    assert(endpointId.length > 0, "missing endpoint id");

    // Trigger a delivery deterministically via the test-delivery route (forceDelivery:true).
    const testDelivery = await apiRequest(baseUrl, "POST", `/admin/webhooks/${endpointId}/test`, token);
    assertStatus(testDelivery, 200, "send test delivery");
    const deliveryId = String(testDelivery.payload?.id ?? "");
    const eventId = String(testDelivery.payload?.eventId ?? "");
    assert(deliveryId.length > 0, "missing delivery id");

    async function getDelivery(id) {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT id, status, attempt_count AS "attemptCount", response_status AS "responseStatus",
                error_message AS "errorMessage", event_id AS "eventId"
         FROM outbound_webhook_deliveries WHERE tenant_key = $1 AND id = $2`,
        tenantKey,
        id,
      );
      return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    }
    async function waitForStatus(id, statuses, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      let last = null;
      while (Date.now() < deadline) {
        last = await getDelivery(id);
        if (last && statuses.includes(String(last.status))) return last;
        await sleep(250);
      }
      throw new Error(`delivery ${id} did not reach ${statuses.join("/")} in ${timeoutMs}ms (last=${JSON.stringify(last)})`);
    }

    const failed1 = await waitForStatus(deliveryId, ["failed"], 20_000);
    assert(Number(failed1.attemptCount) === 1, `expected attempt_count=1 on first attempt, got ${failed1.attemptCount}`);
    assert(Number(failed1.responseStatus) === 500, `expected response_status=500, got ${failed1.responseStatus}`);
    assert(/500/.test(String(failed1.errorMessage ?? "")), `expected error_message to mention 500, got ${failed1.errorMessage}`);
    const hitsAfterFirst = receiverHits;
    assert(hitsAfterFirst >= 1, `expected receiver hit at least once, got ${hitsAfterFirst}`);

    // Operator-driven retry -> NEW delivery row, re-enqueued, fails again.
    const retry = await apiRequest(baseUrl, "POST", `/admin/webhooks/deliveries/${deliveryId}/retry`, token);
    assertStatus(retry, 200, "retry failed delivery");
    const retryDeliveryId = String(retry.payload?.id ?? "");
    assert(retryDeliveryId.length > 0, "missing retry delivery id");
    assert(retryDeliveryId !== deliveryId, "retry must create a NEW delivery row (one row per attempt)");
    assert(
      String(retry.payload?.eventId ?? "") === eventId,
      `retry row must reuse the original event_id ${eventId}, got ${retry.payload?.eventId}`,
    );

    const failed2 = await waitForStatus(retryDeliveryId, ["failed"], 20_000);
    assert(Number(failed2.attemptCount) === 1, `expected retry row attempt_count=1, got ${failed2.attemptCount}`);
    assert(Number(failed2.responseStatus) === 500, `expected retry row response_status=500, got ${failed2.responseStatus}`);
    assert(receiverHits > hitsAfterFirst, `expected receiver hit again on retry (was ${hitsAfterFirst}, now ${receiverHits})`);

    // Original row is unchanged by the retry (still exactly one recorded attempt).
    const originalAfter = await getDelivery(deliveryId);
    assert(Number(originalAfter.attemptCount) === 1, `original row attempt_count must stay 1, got ${originalAfter.attemptCount}`);
    assert(String(originalAfter.status) === "failed", `original row must remain failed, got ${originalAfter.status}`);

    const auditRows = await prisma.$queryRawUnsafe(
      `SELECT metadata FROM audit_logs
       WHERE tenant_key = $1 AND action = 'outbound_webhook.delivery_retry_queued'`,
      tenantKey,
    );
    assert(Array.isArray(auditRows) && auditRows.length === 1, `expected one delivery_retry_queued audit row, got ${auditRows.length}`);
    const meta = auditRows[0].metadata || {};
    assert(
      String(meta.originalDeliveryId) === deliveryId,
      `retry audit metadata must link originalDeliveryId=${deliveryId}, got ${JSON.stringify(meta)}`,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantKey,
          endpointId,
          firstDeliveryId: deliveryId,
          retryDeliveryId,
          receiverHits,
          validated: [
            "5xx_delivery_marks_row_failed_with_attempt_count_1_and_response_status_500",
            "operator_retry_creates_new_attempt_row_reusing_event_id",
            "retry_attempt_row_executes_and_is_counted",
            "original_attempt_row_is_immutable_after_retry",
            "retry_emits_delivery_retry_queued_audit_linking_original",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("Outbound webhook retry attempts test failed:");
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    console.error("--- API log raw tail ---");
    console.error(outBuf.join("").slice(-6000));
    process.exitCode = 1;
  } finally {
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM outbound_webhook_deliveries WHERE tenant_key = $1`, tenantKey);
      await prisma.$executeRawUnsafe(`DELETE FROM outbound_webhook_endpoints WHERE tenant_key = $1`, tenantKey);
    } catch {
      /* best effort */
    }
    await prisma.$disconnect().catch(() => undefined);
    await new Promise((resolve) => receiver.close(() => resolve(undefined))).catch(() => undefined);
    if (!apiProcess.killed && apiProcess.pid) {
      if (process.platform === "win32") {
        try {
          execFileSync("taskkill", ["/pid", String(apiProcess.pid), "/t", "/f"], { stdio: "ignore" });
        } catch {
          /* ignore */
        }
      } else {
        apiProcess.kill("SIGKILL");
      }
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
