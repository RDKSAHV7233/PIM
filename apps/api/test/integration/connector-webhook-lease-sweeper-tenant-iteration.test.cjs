#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001 P2.3c: the connector webhook lease sweeper re-drives the stranded events of EVERY directory tenant under a
 * restricted (NOSUPERUSER, NOBYPASSRLS, non-owner) role, each under its own tenant, and touches nothing it should not.
 *
 * Before the change the sweeper read every tenant's events through the context-free direct client. Under row level security that
 * client sees no tenant's rows, so events stranded by a crashed worker would stay stranded forever while the sweep found nothing to
 * do. This test runs a real API process as the restricted role in a dedicated throwaway database (migrated here, dropped after),
 * with the first sweep shortened by CONNECTOR_WEBHOOK_LEASE_SWEEP_INITIAL_DELAY_MS.
 *
 * Fixture: stranded events (expired lease) in two non-default directory tenants (A has two, B has one) and in the default tenant,
 * a still-leased event in A and an already-processed event in B that must be left alone, and a directory tenant (C) with none.
 * A sweeper that finds only the default tenant, or that acts on an event under the wrong tenant, fails this test.
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

/** Resolves when /health answers. Rejects at once if the API process exits, and carries the API's own output on any failure. */
async function waitForHealth(baseUrl, timeoutMs, child, outputTail) {
  let exited = null;
  child.once("exit", (code, signal) => {
    exited = { code, signal };
  });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(`API exited before becoming healthy (code ${exited.code}, signal ${exited.signal}); API output tail:\n${outputTail()}`);
    }
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
  throw new Error(`API did not become healthy at ${baseUrl}/health within ${timeoutMs}ms; API output tail:\n${outputTail()}`);
}

async function main() {
  const runId = Date.now().toString();
  const dbName = `whlease_${runId}`;
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
    const T = { a: `wl-a-${runId}`, b: `wl-b-${runId}`, c: `wl-c-${runId}`, d: "default" };
    for (const [i, tenantKey] of [T.a, T.b, T.c].entries()) {
      await admin.workspaceDirectory.create({ data: { tenantKey, workspaceSlug: `wl-${runId.slice(-6)}-${i}`, displayName: `Lease ${i}` } });
    }
    // Stranded events have no installation, so the re-drive cannot reach a connector and takes the documented failure path: it
    // acquires the row (attempt count +1, lease renewed), then releases it for the next sweep with a `lease recovery:` last_error.
    // That is a real, per-tenant, observable database effect without building a connector fixture.
    const ids = { a1: `wh_a1_${runId}`, a2: `wh_a2_${runId}`, b1: `wh_b1_${runId}`, d1: `wh_d1_${runId}`, fresh: `wh_fresh_a_${runId}`, done: `wh_done_b_${runId}` };
    const event = (tenantKey, id, status, leaseMinutes) =>
      admin.$executeRawUnsafe(
        `INSERT INTO connector_webhook_events (id, tenant_key, installation_id, external_event_id, event_type, payload, processing_status, processing_attempt_count, processing_lease_until, received_at)
         VALUES ($1, $2, $3, $4, 'product.updated', '{"source":"p2-3c"}'::jsonb, $5, 0, NOW() + ($6 || ' minutes')::interval, NOW() - INTERVAL '1 hour')`,
        id,
        tenantKey,
        `inst_${tenantKey}`,
        `ext-${id}`,
        status,
        String(leaseMinutes),
      );
    await event(T.a, ids.a1, "processing", -10);
    await event(T.a, ids.a2, "received", -10);
    await event(T.b, ids.b1, "processing", -10);
    await event(T.d, ids.d1, "processing", -10);
    await event(T.a, ids.fresh, "processing", 10); // lease still valid: must be left alone
    await event(T.b, ids.done, "processed", -10); // terminal: must be left alone

    const getEvent = async (id) => {
      const rows = await admin.$queryRawUnsafe(
        `SELECT id, tenant_key AS "tenantKey", processing_status AS status, processing_attempt_count AS attempts, last_error AS "lastError" FROM connector_webhook_events WHERE id = $1`,
        id,
      );
      return rows[0] ?? null;
    };
    for (const id of Object.values(ids)) {
      assert.equal(Number((await getEvent(id)).attempts), 0, `${id} must start with no recovery attempt`);
    }
    console.log("PASS 1. fixture seeded: stranded events in tenant A (2), tenant B (1) and the default tenant (1), a still-leased event in A, a processed event in B, tenant C with none");

    // ---- a real API process as the restricted role, first sweep shortened ----------------------------------------------------------
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
        CONNECTOR_WEBHOOK_LEASE_SWEEP_INITIAL_DELAY_MS: "500",
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
    await waitForHealth(baseUrl, 90_000, api, () => apiOutput.join("").slice(-1500));

    // ---- the sweeper must discover and act ----------------------------------------------------------------------------------------------
    const stranded = [ids.a1, ids.a2, ids.b1, ids.d1];
    const deadline = Date.now() + 60_000;
    let rows = {};
    while (Date.now() < deadline) {
      rows = Object.fromEntries(await Promise.all(stranded.map(async (id) => [id, await getEvent(id)])));
      if (Object.values(rows).every((row) => Number(row.attempts) >= 1)) {
        break;
      }
      await sleep(500);
    }
    const tail = apiOutput.join("").slice(-900);
    for (const id of stranded) {
      assert.ok(Number(rows[id].attempts) >= 1, `${id} must have been re-driven (attempts=${rows[id].attempts}); API output tail: ${tail}`);
    }
    console.log("PASS 2. the sweeper (restricted role) re-drove the stranded events of EVERY non-default directory tenant and of the default tenant");

    // ---- each event stays with its own tenant and was acted on under it -------------------------------------------------------------
    for (const [id, tenantKey] of [[ids.a1, T.a], [ids.a2, T.a], [ids.b1, T.b], [ids.d1, T.d]]) {
      assert.equal(rows[id].tenantKey, tenantKey, `${id} must stay under ${tenantKey}`);
      assert.match(String(rows[id].lastError), /^lease recovery:/, `${id} must carry the lease-recovery outcome (saw ${rows[id].lastError})`);
      assert.equal(rows[id].status, "received", `${id} must be released for the next sweep (no installation, below the attempt cap)`);
    }
    console.log("PASS 3. every re-driven event stayed on its own tenant and carries the lease-recovery outcome");

    // ---- nothing it should not touch -----------------------------------------------------------------------------------------------
    const fresh = await getEvent(ids.fresh);
    assert.equal(Number(fresh.attempts), 0, "an event whose lease is still valid must not be re-driven");
    assert.equal(fresh.status, "processing");
    const done = await getEvent(ids.done);
    assert.equal(Number(done.attempts), 0, "a processed event must not be re-driven");
    assert.equal(done.status, "processed");
    console.log("PASS 4. a still-leased event and a processed event were left alone");

    const sessions = await admin.$queryRawUnsafe(`SELECT DISTINCT usename FROM pg_stat_activity WHERE datname = $1 AND application_name = 'vexa-pim-api-restricted'`, dbName);
    assert.ok(sessions.length > 0 && sessions.every((s) => s.usename === ROLE), `the API must have connected as ${ROLE} (saw ${JSON.stringify(sessions)})`);
    console.log("webhook lease sweeper tenant-iteration integration test passed.");
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
  console.error("webhook lease sweeper tenant-iteration integration test failed:");
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
