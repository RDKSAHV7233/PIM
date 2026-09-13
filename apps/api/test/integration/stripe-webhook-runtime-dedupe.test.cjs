#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Remediation stream E3 — Scenario 4
 * Stripe webhook event runtime dedupe (the existing stripe-webhook.test.cjs is
 * a static source-scan; this is a runtime test).
 *
 * Spawns the REAL API (apps/api/dist/main.js) with Stripe billing enabled and a
 * known STRIPE_WEBHOOK_SECRET, then POSTs the SAME Stripe event id twice to
 * POST /api/v1/billing/stripe/webhook with a valid Stripe signature
 * (t=<ts>,v1=<HMAC_SHA256(secret, ts + "." + body)>), which stripe.webhooks
 * .constructEvent verifies offline.
 *
 * Intended assertions (StripeWebhookController + StripeService.reserveWebhookEvent):
 *   - exactly ONE stripe_webhook_events row for the event id
 *   - that row: processing_status='processed', processing_attempt_count=1
 *   - downstream dispatch ran exactly once: TenantPlanProfile.billingStatus
 *     becomes 'cancelled' (updatedBy='stripe:webhook') and the 2nd POST is a
 *     no-op ("duplicate skipped" server log)
 *
 * PREFLIGHT: StripeService.reserveWebhookEvent() takes a pg advisory lock via
 *   await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(...)`)
 * (apps/api/dist/billing/stripe.service.js). @prisma/client 6.19.3 cannot
 * deserialize a void-returning statement through $queryRaw, so the handler
 * throws and the route returns HTTP 500 before any dedupe/dispatch. The test
 * detects that and reports E3-BLOCKED with the evidence.
 */
const fs = require("node:fs");
const path = require("node:path");
const { createHmac, randomUUID } = require("node:crypto");
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
function stripeSig(secret, ts, body) {
  return `t=${ts},v1=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) throw new Error(`API build not found at ${API_ENTRY}`);

  const runId = Date.now().toString();
  const port = 7480 + Math.floor(Math.random() * 120);
  const base = `http://127.0.0.1:${port}`;
  const webhookSecret = `whsec_e3_${runId}`;
  const platformToken = `stripe-e3-platform-${runId}`;
  const commercialOpsToken = `stripe-e3-commercial-${runId}`;
  const tenantKey = `stripe-e3-${runId}`;
  const workspaceSlug = `se3-${runId}`.slice(0, 24);
  const adminUserId = `stripe-e3-admin-${runId}@example.com`;
  const customerId = `cus_e3_${runId}`;
  const eventId = `evt_e3_${runId}`;

  const env = {
    ...process.env,
    PORT: String(port),
    AUTH_MODE: "db",
    APP_ENV: "development",
    FEATURE_STRIPE_BILLING_ENABLED: "true",
    STRIPE_SECRET_KEY: "sk_test_e3_probe",
    STRIPE_WEBHOOK_SECRET: webhookSecret,
    PIM_PLATFORM_ADMIN_TOKEN: platformToken,
    PIM_COMMERCIAL_OPS_TOKEN: commercialOpsToken,
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_AUTH_IDENTITIES_JSON: "",
    PIM_AUTH_WORKSPACES_JSON: "",
    QUEUE_BACKEND: "memory",
  };

  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL } },
  });
  const outBuf = [];
  const apiProcess = spawn("node", [API_ENTRY], { cwd: REPO_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  apiProcess.stdout.on("data", (c) => {
    outBuf.push(String(c));
    if (outBuf.length > 3000) outBuf.shift();
  });
  apiProcess.stderr.on("data", (c) => {
    outBuf.push(String(c));
    if (outBuf.length > 3000) outBuf.shift();
  });

  async function apiRequest(method, route, token, body, extraHeaders = {}) {
    const headers = { Accept: "application/json", ...extraHeaders };
    if (token) headers.Authorization = `Bearer ${token}`;
    const options = { method, headers, signal: AbortSignal.timeout(20_000) };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    const res = await fetch(`${base}${route}`, options);
    const text = await res.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    return { status: res.status, payload };
  }

  try {
    await waitForHealth(`${base}/api/v1`, 60_000);

    // Wire a tenant + Stripe customer so customer.subscription.deleted dispatch
    // has a resolvable target.
    const provision = await apiRequest(
      "POST",
      "/api/v1/platform/tenants",
      null,
      { tenantKey, workspaceSlug, displayName: `Stripe E3 ${runId}`, initialAdminUserId: adminUserId, initialAdminPassword: process.env.PIM_AUTH_PASSWORD },
      { "x-pim-platform-admin-token": platformToken },
    );
    assert(provision.status === 201, `provision tenant: expected 201, got ${provision.status} ${JSON.stringify(provision.payload)}`);
    // Ensure a TenantPlanProfile row exists (platform provisioning does not create one)
    // so customer.subscription.deleted dispatch has a resolvable target.
    const planTier = await apiRequest(
      "POST",
      "/api/v1/billing/internal/plan-tier",
      null,
      { tenantKey, planTier: "ENTERPRISE" },
      {
        "x-pim-commercial-ops-token": commercialOpsToken,
        "x-pim-operator-id": "integration-test",
        "x-pim-operator-role": "system",
      },
    );
    assert(
      planTier.status === 200 || planTier.status === 201,
      `set plan tier: expected 200/201, got ${planTier.status} ${JSON.stringify(planTier.payload)}`,
    );
    const updated = await prisma.$executeRawUnsafe(
      `UPDATE "TenantPlanProfile" SET "externalCustomerId" = $1, "billingStatus" = 'active_paid', "updatedAt" = NOW() WHERE "tenantKey" = $2`,
      customerId,
      tenantKey,
    );
    assert(Number(updated) === 1, `expected to bind externalCustomerId to exactly 1 TenantPlanProfile row, updated ${updated}`);

    const body = JSON.stringify({
      id: eventId,
      object: "event",
      type: "customer.subscription.deleted",
      data: { object: { id: `sub_${runId}`, customer: customerId, status: "canceled", items: { data: [{ id: "si_1" }] }, current_period_end: Math.floor(Date.now() / 1000) } },
    });
    const ts = Math.floor(Date.now() / 1000);
    const headers = { "Content-Type": "application/json", "Stripe-Signature": stripeSig(webhookSecret, ts, body) };

    const first = await fetch(`${base}/api/v1/billing/stripe/webhook`, { method: "POST", headers, body });
    const firstText = await first.text();
    await sleep(400);
    const serverLog = outBuf.join("");

    if (first.status === 500 && /deserialize column of type 'void'|pg_advisory_xact_lock/i.test(serverLog)) {
      console.error(
        "E3-BLOCKED: Stripe webhook runtime dedupe is NOT functional.\n" +
          "POST /api/v1/billing/stripe/webhook -> HTTP 500. StripeService.reserveWebhookEvent()\n" +
          "runs  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(<eventId>,0)::bigint)`)\n" +
          "(apps/api/dist/billing/stripe.service.js) which throws with @prisma/client 6.19.3:\n" +
          "  Failed to deserialize column of type 'void'.\n" +
          "Effect: every Stripe webhook 500s; no stripe_webhook_events row is written; dispatch\n" +
          "never runs; Stripe retries indefinitely. Fix: tx.$executeRaw (verified working) / ::text cast.",
      );
      process.exitCode = 1;
      return;
    }

    assert(first.status === 200, `first webhook POST: expected 200, got ${first.status} ${firstText}`);

    const second = await fetch(`${base}/api/v1/billing/stripe/webhook`, { method: "POST", headers, body });
    const secondText = await second.text();
    assert(second.status === 200, `second webhook POST: expected 200, got ${second.status} ${secondText}`);
    await sleep(400);

    const rows = await prisma.$queryRawUnsafe(
      `SELECT processing_status AS "processingStatus", processing_attempt_count AS "attemptCount",
              processed_at AS "processedAt", tenant_key AS "tenantKey"
       FROM stripe_webhook_events WHERE external_event_id = $1`,
      eventId,
    );
    assert(Array.isArray(rows) && rows.length === 1, `expected exactly 1 stripe_webhook_events row, got ${rows.length}`);
    const row = rows[0];
    assert(String(row.processingStatus) === "processed", `expected processing_status=processed, got ${row.processingStatus}`);
    assert(Number(row.attemptCount) === 1, `expected processing_attempt_count=1 after 2 POSTs, got ${row.attemptCount}`);
    assert(row.processedAt, "expected processed_at set");

    const profile = await prisma.$queryRawUnsafe(
      `SELECT "billingStatus", "updatedBy" FROM "TenantPlanProfile" WHERE "tenantKey" = $1`,
      tenantKey,
    );
    assert(
      Array.isArray(profile) && profile.length === 1 && String(profile[0].billingStatus) === "cancelled",
      `expected dispatch to set billingStatus=cancelled once, got ${JSON.stringify(profile)}`,
    );
    assert(
      String(profile[0].updatedBy) === "stripe:webhook",
      `expected updatedBy=stripe:webhook, got ${profile[0].updatedBy}`,
    );
    assert(
      /duplicate skipped/i.test(outBuf.join("")),
      "expected the 2nd delivery to log a duplicate-skipped message",
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantKey,
          eventId,
          validated: [
            "same_stripe_event_id_posted_twice_yields_single_stripe_webhook_events_row",
            "row_processed_with_attempt_count_1",
            "downstream_dispatch_ran_once_billing_status_cancelled",
            "second_delivery_is_a_logged_no_op",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("Stripe webhook runtime dedupe test failed:");
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    console.error("--- API log raw tail ---");
    console.error(outBuf.join("").slice(-6000));
    process.exitCode = 1;
  } finally {
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM stripe_webhook_events WHERE external_event_id = $1`, eventId);
    } catch {
      /* best effort */
    }
    await prisma.$disconnect().catch(() => undefined);
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
