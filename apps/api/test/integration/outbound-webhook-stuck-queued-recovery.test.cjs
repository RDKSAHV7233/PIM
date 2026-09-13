#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Remediation stream E3 — Scenario 5
 * Stuck-queued outbound delivery recovery.
 *
 * apps/api/src/outbound-webhooks/outbound-webhooks.service.ts exposes
 * recoverStuckQueuedDeliveries() (public method; NO HTTP endpoint) — it is
 * otherwise only driven by a 60s setInterval armed in onApplicationBootstrap
 * (skipped when OUTBOUND_WEBHOOK_RECOVERY_DISABLED=true). The
 * idx_outbound_webhook_deliveries_stuck_queued index backs its scan:
 *   status='queued' AND attempted_at IS NULL
 *   AND created_at < now-60s
 *   AND (last_enqueue_attempt_at IS NULL OR last_enqueue_attempt_at < now-60s)
 * Each match is re-enqueued via enqueueDelivery (sets queue_job_id +
 * last_enqueue_attempt_at) and an outbound_webhook.queued_recovery audit row is
 * written.
 *
 * This test builds the REAL OutboundWebhooksService in-process against the live
 * `pim1` Postgres (memory QueueService, real AuditService, stub PlanUsageService)
 * and invokes recoverStuckQueuedDeliveries() directly.
 *
 * Asserts:
 *   - a delivery stuck 'queued' with an old created_at is recovered:
 *     return {recovered:1,failed:0}; row gains queue_job_id +
 *     last_enqueue_attempt_at; still 'queued' or already re-processed
 *   - a fresh 'queued' delivery (created_at=now) is NOT touched
 *   - a 2nd immediate call recovers 0 (no double re-enqueue within the cutoff)
 *   - an outbound_webhook.queued_recovery audit row is written
 */
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
function resolveDist() {
  const snap = path.join(REPO_ROOT, "apps", "api", ".dist-e3");
  if (fs.existsSync(path.join(snap, "main.js"))) return snap;
  return path.join(REPO_ROOT, "apps", "api", "dist");
}
const DIST = resolveDist();

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
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "vexa-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("QUEUE_BACKEND", "memory");
  process.env.OUTBOUND_WEBHOOK_RECOVERY_DISABLED = "true";
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function assert(c, m) {
  if (!c) throw new Error(m);
}

async function build() {
  const { PrismaService } = require(path.join(DIST, "prisma", "prisma.service.js"));
  const { AuditService } = require(path.join(DIST, "audit", "audit.service.js"));
  const { QueueService } = require(path.join(DIST, "queue", "queue.service.js"));
  const { OutboundWebhooksService } = require(path.join(DIST, "outbound-webhooks", "outbound-webhooks.service.js"));

  const prisma = new PrismaService();
  await prisma.onModuleInit();
  const audit = new AuditService(prisma);
  const queue = new QueueService();
  const planUsageStub = {
    async getTenantPlanProfile() {
      return { accessStatus: "active" };
    },
  };
  const svc = new OutboundWebhooksService(prisma, audit, queue, planUsageStub);
  // Neutralise actual job dispatch: recoverStuckQueuedDeliveries() is a GLOBAL
  // sweep (it re-enqueues every eligible row, not just this test's). We only need
  // the DB-visible effects of enqueueDelivery() (status/queue_job_id/
  // last_enqueue_attempt_at); stubbing enqueue keeps this test from processing
  // and mutating unrelated tenants' deliveries via the in-process worker.
  const enqueued = [];
  queue.enqueue = async (name, payload) => {
    enqueued.push({ name, payload });
  };
  return { prisma, queue, svc, enqueued };
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(path.join(DIST, "outbound-webhooks", "outbound-webhooks.service.js"))) {
    throw new Error(`API build output not found under ${DIST}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const tenantKey = `owsq-${runId}`;
  const endpointId = `owep_${runId}`;
  const stuckId = `owdl_stuck_${runId}`;
  const freshId = `owdl_fresh_${runId}`;

  const raw = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL } },
  });

  let built;
  try {
    built = await build();

    await raw.$executeRawUnsafe(
      `
      INSERT INTO outbound_webhook_endpoints
        (id, tenant_key, name, event_type, target_url, signing_secret_encrypted,
         signing_secret_key_version, is_active, created_by, created_at, updated_at)
      VALUES ($1, $2, 'E3 stuck-queued', 'approval_decision', 'http://127.0.0.1:59650/never',
              'ciphertext-unused', 'v1', TRUE, 'e3', NOW(), NOW())
      `,
      endpointId,
      tenantKey,
    );

    async function insertDelivery(id, ageSeconds) {
      await raw.$executeRawUnsafe(
        `
        INSERT INTO outbound_webhook_deliveries
          (id, tenant_key, endpoint_id, event_type, event_id, status, attempt_count,
           request_body, created_at, updated_at, attempted_at, last_enqueue_attempt_at, queue_job_id)
        VALUES ($1, $2, $3, 'approval_decision', $4, 'queued', 0,
                '{"source":"e3"}'::jsonb, NOW() - ($5 || ' seconds')::interval,
                NOW() - ($5 || ' seconds')::interval, NULL, NULL, NULL)
        `,
        id,
        tenantKey,
        endpointId,
        `evt-${id}`,
        String(ageSeconds),
      );
    }
    await insertDelivery(stuckId, 600); // 10 min old -> stuck
    await insertDelivery(freshId, 0); // brand new -> not eligible

    async function getRow(id) {
      const rows = await raw.$queryRawUnsafe(
        `SELECT id, status, attempt_count AS "attemptCount", queue_job_id AS "queueJobId",
                last_enqueue_attempt_at AS "lastEnqueueAttemptAt"
         FROM outbound_webhook_deliveries WHERE tenant_key = $1 AND id = $2`,
        tenantKey,
        id,
      );
      return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    }

    const first = await built.svc.recoverStuckQueuedDeliveries();
    assert(first && typeof first === "object", "recoverStuckQueuedDeliveries must return a summary object");
    // `pim1` is shared: the sweep is global, so `recovered` counts every eligible
    // row, not just this test's. Assert it recovered at least our row.
    assert(Number(first.recovered) >= 1, `expected recovered>=1, got ${JSON.stringify(first)}`);
    assert(
      built.enqueued.some((e) => e.payload && e.payload.deliveryId === stuckId),
      `expected our stuck delivery ${stuckId} to be re-enqueued, enqueued=${JSON.stringify(built.enqueued.map((e) => e.payload && e.payload.deliveryId))}`,
    );

    const stuckAfter = await getRow(stuckId);
    assert(stuckAfter, "stuck delivery row must still exist");
    assert(
      String(stuckAfter.queueJobId || "") === `outbound-webhook:${tenantKey}:${stuckId}`,
      `stuck row must gain queue_job_id from re-enqueue, got ${stuckAfter.queueJobId}`,
    );
    assert(stuckAfter.lastEnqueueAttemptAt, "stuck row must gain last_enqueue_attempt_at");
    assert(String(stuckAfter.status) === "queued", `stuck row must be re-set to queued, got ${stuckAfter.status}`);
    const stuckReenqueuedAt = new Date(stuckAfter.lastEnqueueAttemptAt).getTime();

    const freshAfter = await getRow(freshId);
    assert(freshAfter, "fresh delivery row must still exist");
    assert(!freshAfter.queueJobId, `fresh (not-yet-stuck) row must be untouched, got queue_job_id=${freshAfter.queueJobId}`);
    assert(
      !freshAfter.lastEnqueueAttemptAt,
      `fresh row must not be re-enqueued, got last_enqueue_attempt_at=${freshAfter.lastEnqueueAttemptAt}`,
    );
    assert(String(freshAfter.status) === "queued", `fresh row must stay queued, got ${freshAfter.status}`);

    // A 2nd immediate sweep must NOT re-enqueue our row again (last_enqueue_attempt_at
    // is now within the 60s cutoff).
    built.enqueued.length = 0;
    const second = await built.svc.recoverStuckQueuedDeliveries();
    assert(
      !built.enqueued.some((e) => e.payload && e.payload.deliveryId === stuckId),
      `2nd immediate sweep must not re-enqueue ${stuckId} again, got ${JSON.stringify(built.enqueued.map((e) => e.payload && e.payload.deliveryId))}`,
    );
    const stuckAfter2 = await getRow(stuckId);
    assert(
      new Date(stuckAfter2.lastEnqueueAttemptAt).getTime() === stuckReenqueuedAt,
      "2nd sweep must leave our row's last_enqueue_attempt_at unchanged",
    );

    const auditRows = await raw.$queryRawUnsafe(
      `SELECT metadata FROM audit_logs
       WHERE action = 'outbound_webhook.queued_recovery'
         AND resource_id = 'stuck-queued'
         AND created_at > NOW() - INTERVAL '3 minutes'
       ORDER BY created_at DESC LIMIT 5`,
    );
    assert(
      Array.isArray(auditRows) && auditRows.length >= 1,
      `expected an outbound_webhook.queued_recovery audit row, got ${auditRows.length}`,
    );
    const recoveredCounts = auditRows.map((r) => Number((r.metadata || {}).recovered)).filter((n) => Number.isFinite(n));
    assert(
      recoveredCounts.some((n) => n >= 1),
      `expected a queued_recovery audit row with recovered>=1, got ${JSON.stringify(auditRows.map((r) => r.metadata))}`,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantKey,
          endpointId,
          stuckDeliveryId: stuckId,
          freshDeliveryId: freshId,
          firstSweep: first,
          secondSweep: second,
          validated: [
            "recoverStuckQueuedDeliveries_re_enqueues_old_queued_delivery",
            "recovered_row_gains_queue_job_id_and_last_enqueue_attempt_at",
            "fresh_queued_delivery_within_cutoff_is_left_alone",
            "second_immediate_sweep_does_not_double_re_enqueue",
            "queued_recovery_audit_row_written",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("Outbound webhook stuck-queued recovery test failed:");
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  } finally {
    try {
      await raw.$executeRawUnsafe(`DELETE FROM outbound_webhook_deliveries WHERE tenant_key = $1`, tenantKey);
      await raw.$executeRawUnsafe(`DELETE FROM outbound_webhook_endpoints WHERE tenant_key = $1`, tenantKey);
    } catch {
      /* best effort */
    }
    if (built) {
      await built.queue.onModuleDestroy().catch(() => undefined);
      await built.prisma.onModuleDestroy().catch(() => undefined);
    }
    await raw.$disconnect().catch(() => undefined);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
