#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001 P2.2: the outbound-webhook stuck-delivery recovery job re-enqueues the stuck deliveries of EVERY directory tenant
 * under a restricted (NOSUPERUSER, NOBYPASSRLS, non-owner) role, and touches nothing it should not.
 *
 * Before the change, recovery was one scan with no tenant argument. Under row level security that scan sees only the default tenant,
 * so the job would recover one tenant's deliveries and leave every other tenant's stuck while reporting success. This test runs a real
 * API process as the restricted role in a dedicated throwaway database (migrated here, dropped after), with the recovery interval
 * shortened by OUTBOUND_WEBHOOK_RECOVERY_INTERVAL_MS.
 *
 * Fixture: two non-default directory tenants and the default tenant, each with a delivery stuck in `queued` for ten minutes; one of
 * the non-default tenants also has a brand-new delivery that must NOT be recovered; a third directory tenant has no deliveries. A job
 * that finds only the default tenant, or that acts on a row under the wrong tenant, fails this test.
 */
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const DIST = path.join(REPO_ROOT, "apps", "api", "dist");
const { PrismaClient } = require(path.join(REPO_ROOT, "node_modules", "@prisma", "client"));

const ADMIN_URL = String(process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/pim1?schema=public").trim();
const ROLE = "vexa_runtime_ci";
const ROLE_PASSWORD = String(process.env.RESTRICTED_ROLE_PASSWORD || "vexa_runtime_ci_password").replace(/[^A-Za-z0-9_]/g, "");

function urlFor(database, user, password) {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${database}`;
  if (user) {
    u.username = user;
    u.password = password;
  }
  u.searchParams.set("schema", "public");
  return u.toString();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
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

/**
 * A free port chosen by the OS. A random port from a fixed range is NOT safe here: Node's fetch (undici) refuses the WHATWG "bad"
 * ports (6000, 6566, 6665-6669, 6679, 6697, ...) with an immediate "bad port" error, so the health check would retry forever against a
 * perfectly healthy API and time out. OS-assigned ephemeral ports are outside that list.
 */
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function main() {
  const runId = Date.now().toString();
  const dbName = `whrecover_${runId}`;
  const adminMain = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
  let admin = null;
  let api = null;
  const apiOutput = [];

  try {
    await adminMain.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    const dbAdminUrl = urlFor(dbName);
    const prismaCli = require.resolve("prisma/build/index.js", { paths: [REPO_ROOT] });
    const migrate = spawnSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", path.join(REPO_ROOT, "packages", "db", "prisma", "schema.prisma")], {
      cwd: REPO_ROOT,
      env: { ...process.env, DATABASE_URL: dbAdminUrl, DATABASE_URL_POOLED: dbAdminUrl, DATABASE_URL_DIRECT: dbAdminUrl },
      encoding: "utf8",
    });
    assert.equal(migrate.status, 0, `migrations failed: ${String(migrate.stderr || migrate.stdout).slice(-300)}`);
    const grant = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", "ci", "create-restricted-runtime-role.cjs")], {
      cwd: REPO_ROOT,
      env: { ...process.env, DATABASE_URL: dbAdminUrl, RESTRICTED_ROLE_PASSWORD: ROLE_PASSWORD },
      encoding: "utf8",
    });
    assert.equal(grant.status, 0, `restricted role setup failed: ${String(grant.stdout).slice(-300)}`);
    const restrictedUrl = urlFor(dbName, ROLE, ROLE_PASSWORD);
    admin = new PrismaClient({ datasources: { db: { url: dbAdminUrl } } });
    console.log(`PASS 0. isolated database ${dbName} migrated; role ${ROLE} granted`);

    // ---- seed (as admin) ---------------------------------------------------------------------------------------------------
    const T = { a: `wh-a-${runId}`, b: `wh-b-${runId}`, c: `wh-c-${runId}`, d: "default" };
    for (const [i, tenantKey] of [T.a, T.b, T.c].entries()) {
      await admin.workspaceDirectory.create({ data: { tenantKey, workspaceSlug: `wh-${runId.slice(-6)}-${i}`, displayName: `Webhook ${i}` } });
    }
    const endpoint = (tenantKey) =>
      admin.$executeRawUnsafe(
        `INSERT INTO outbound_webhook_endpoints (id, tenant_key, name, event_type, target_url, signing_secret_encrypted, signing_secret_key_version, is_active, created_by, created_at, updated_at)
         VALUES ($1, $2, 'recovery', 'approval_decision', 'http://127.0.0.1:9/never', 'ciphertext-unused', 'v1', TRUE, 'p2-2', NOW(), NOW())`,
        `ep_${tenantKey}`,
        tenantKey,
      );
    const delivery = (tenantKey, id, ageSeconds) =>
      admin.$executeRawUnsafe(
        `INSERT INTO outbound_webhook_deliveries (id, tenant_key, endpoint_id, event_type, event_id, status, attempt_count, request_body, created_at, updated_at, attempted_at, last_enqueue_attempt_at, queue_job_id)
         VALUES ($1, $2, $3, 'approval_decision', $4, 'queued', 0, '{"source":"p2-2"}'::jsonb, NOW() - ($5 || ' seconds')::interval, NOW() - ($5 || ' seconds')::interval, NULL, NULL, NULL)`,
        id,
        tenantKey,
        `ep_${tenantKey}`,
        `evt-${id}`,
        String(ageSeconds),
      );
    for (const tenantKey of [T.a, T.b, T.d]) {
      await endpoint(tenantKey);
    }
    const stuck = { a: `dl_stuck_a_${runId}`, b: `dl_stuck_b_${runId}`, d: `dl_stuck_d_${runId}` };
    const fresh = `dl_fresh_a_${runId}`;
    await delivery(T.a, stuck.a, 600);
    await delivery(T.b, stuck.b, 600);
    await delivery(T.d, stuck.d, 600);
    await delivery(T.a, fresh, 0);

    const getRow = async (id) => {
      const rows = await admin.$queryRawUnsafe(
        `SELECT id, tenant_key AS "tenantKey", queue_job_id AS "queueJobId", last_enqueue_attempt_at AS "lastEnqueueAttemptAt" FROM outbound_webhook_deliveries WHERE id = $1`,
        id,
      );
      return rows[0] ?? null;
    };
    for (const id of [stuck.a, stuck.b, stuck.d, fresh]) {
      assert.equal((await getRow(id)).queueJobId, null, `${id} must start without a queue job`);
    }
    console.log("PASS 1. fixture seeded: a stuck delivery in tenant A, tenant B and the default tenant, a fresh delivery in A, tenant C with none; none has a queue job yet");

    // ---- a real API process as the restricted role, recovery interval shortened ------------------------------------------------
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}/api/v1`;
    api = spawn(process.execPath, [path.join(DIST, "main.js")], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        DATABASE_URL: restrictedUrl,
        DATABASE_URL_DIRECT: restrictedUrl,
        DATABASE_URL_POOLED: restrictedUrl,
        VEXA_RESTRICTED_DATABASE_URL: "",
        DB_POOL_APP_NAME: "vexa-pim-api-restricted",
        QUEUE_WORKER_ENABLED: "true",
        OUTBOUND_WEBHOOK_RECOVERY_INTERVAL_MS: "500",
        CONNECTOR_HEARTBEAT_DISABLED: "true",
        PIM_ALLOW_LEGACY_HEADERS: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [api.stdout, api.stderr]) {
      stream.on("data", (chunk) => {
        apiOutput.push(String(chunk));
        if (apiOutput.length > 800) {
          apiOutput.shift();
        }
      });
    }
    await waitForHealth(baseUrl, 90_000);

    // ---- recovery must discover and act ----------------------------------------------------------------------------------------------
    const expectedJob = (tenantKey, id) => `outbound-webhook:${tenantKey}:${id}`;
    const deadline = Date.now() + 60_000;
    let rows = {};
    while (Date.now() < deadline) {
      rows = { a: await getRow(stuck.a), b: await getRow(stuck.b), d: await getRow(stuck.d) };
      if (rows.a.queueJobId && rows.b.queueJobId && rows.d.queueJobId) {
        break;
      }
      await sleep(500);
    }
    const tail = apiOutput.join("").slice(-900);
    assert.equal(rows.a.queueJobId, expectedJob(T.a, stuck.a), `tenant A's stuck delivery must be recovered under tenant A; API output tail: ${tail}`);
    assert.equal(rows.b.queueJobId, expectedJob(T.b, stuck.b), `tenant B's stuck delivery must be recovered under tenant B; API output tail: ${tail}`);
    assert.equal(rows.d.queueJobId, expectedJob(T.d, stuck.d), "the default tenant's stuck delivery is recovered too");
    for (const key of ["a", "b", "d"]) {
      assert.ok(rows[key].lastEnqueueAttemptAt, `${key}: recovery must stamp last_enqueue_attempt_at`);
    }
    console.log("PASS 2. the recovery job (restricted role) re-enqueued the stuck delivery of EVERY non-default directory tenant and of the default tenant, each under its own tenant");

    // ---- nothing it should not touch ----------------------------------------------------------------------------------------------
    const freshAfter = await getRow(fresh);
    assert.equal(freshAfter.queueJobId, null, "a brand-new queued delivery (inside the 60s cutoff) must not be recovered");
    assert.equal(freshAfter.lastEnqueueAttemptAt, null, "a brand-new delivery must not be stamped");
    console.log("PASS 3. a fresh delivery inside the cutoff was left alone");

    // ---- the job reports what it did -----------------------------------------------------------------------------------------------
    let audit = [];
    const auditDeadline = Date.now() + 15_000;
    while (Date.now() < auditDeadline) {
      audit = await admin.$queryRawUnsafe(`SELECT metadata FROM audit_logs WHERE action = 'outbound_webhook.queued_recovery' AND resource_id = 'stuck-queued'`);
      if (audit.length > 0) {
        break;
      }
      await sleep(500);
    }
    assert.ok(audit.length >= 1, "the job must write its audit entry");
    const totalRecovered = audit.reduce((sum, row) => sum + Number((row.metadata || {}).recovered || 0), 0);
    assert.ok(totalRecovered >= 3, `the audit totals must account for the three recovered deliveries (saw ${totalRecovered})`);
    assert.ok(
      audit.every((row) => Number((row.metadata || {}).tenantsFailed ?? 0) === 0),
      `no tenant may be unreadable: ${JSON.stringify(audit.map((row) => row.metadata))}`,
    );
    assert.ok(
      audit.some((row) => Number((row.metadata || {}).tenantsEvaluated) >= 4),
      "the three directory tenants plus the default tenant were evaluated",
    );
    console.log(`PASS 4. the job reported its totals: ${JSON.stringify(audit[0].metadata)}`);

    const sessions = await admin.$queryRawUnsafe(`SELECT DISTINCT usename FROM pg_stat_activity WHERE datname = $1 AND application_name = 'vexa-pim-api-restricted'`, dbName);
    assert.ok(sessions.length > 0 && sessions.every((s) => s.usename === ROLE), `the API must have connected as ${ROLE} (saw ${JSON.stringify(sessions)})`);
    console.log("outbound-webhook recovery tenant-iteration integration test passed.");
  } finally {
    if (api) {
      api.kill("SIGKILL");
      await sleep(500);
    }
    if (admin) {
      await admin.$disconnect().catch(() => undefined);
    }
    await adminMain.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => undefined);
    await adminMain.$disconnect().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("outbound-webhook recovery tenant-iteration integration test failed:");
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
