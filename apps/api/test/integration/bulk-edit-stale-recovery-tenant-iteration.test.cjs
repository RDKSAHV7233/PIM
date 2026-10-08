#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001 P2.3a: the bulk-edit stale-operation sweeper recovers the stuck operations of EVERY directory tenant under a
 * restricted (NOSUPERUSER, NOBYPASSRLS, non-owner) role, with each tenant's own item counts, and touches nothing it should not.
 *
 * Before the change the sweeper read every tenant's operations through the context-free direct client. Under row level security that
 * client sees no tenant's rows, so stale operations would stay `processing` forever while the sweep found nothing to do. This test
 * runs a real API process as the restricted role in a dedicated throwaway database (migrated here, dropped after), with the first
 * sweep shortened by BULK_EDIT_STALE_RECOVERY_INITIAL_DELAY_MS.
 *
 * Fixture: a stale `processing` operation in each of two non-default directory tenants (A has 2 successful items and 1 failed item,
 * B has 1 successful item) and in the default tenant, plus a FRESH `processing` operation in A that must be left alone, and a
 * directory tenant (C) with no operations. A sweeper that finds only the default tenant, or that writes counts under the wrong
 * tenant, fails this test.
 */
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
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

async function main() {
  const runId = Date.now().toString();
  const dbName = `bestale_${runId}`;
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
    const T = { a: `be-a-${runId}`, b: `be-b-${runId}`, c: `be-c-${runId}`, d: "default" };
    for (const [i, tenantKey] of [T.a, T.b, T.c].entries()) {
      await admin.workspaceDirectory.create({ data: { tenantKey, workspaceSlug: `be-${runId.slice(-6)}-${i}`, displayName: `BulkEdit ${i}` } });
    }
    const ids = { a: `op_stale_a_${runId}`, b: `op_stale_b_${runId}`, d: `op_stale_d_${runId}`, fresh: `op_fresh_a_${runId}` };
    const operation = async (tenantKey, id, ageHours) => {
      await admin.bulkEditOperation.create({ data: { id, tenantKey, status: "processing", scope: {}, updates: {}, requestedCount: 5 } });
      await admin.$executeRawUnsafe(`UPDATE "BulkEditOperation" SET "updatedAt" = NOW() - ($2 || ' hours')::interval WHERE id = $1`, id, String(ageHours));
    };
    const item = (tenantKey, operationId, status) => admin.bulkEditOperationItem.create({ data: { tenantKey, operationId, status, before: {} } });
    await operation(T.a, ids.a, 2);
    await operation(T.b, ids.b, 2);
    await operation(T.d, ids.d, 2);
    await operation(T.a, ids.fresh, 0);
    await item(T.a, ids.a, "success");
    await item(T.a, ids.a, "success");
    await item(T.a, ids.a, "failed");
    await item(T.b, ids.b, "success");

    const getOp = async (id) => {
      const rows = await admin.$queryRawUnsafe(`SELECT id, "tenantKey", status::text AS status, "appliedCount", "failedCount" FROM "BulkEditOperation" WHERE id = $1`, id);
      return rows[0] ?? null;
    };
    for (const id of [ids.a, ids.b, ids.d, ids.fresh]) {
      assert.equal((await getOp(id)).status, "processing", `${id} must start in processing`);
    }
    console.log("PASS 1. fixture seeded: a stale processing operation in tenant A (2 ok + 1 failed items), tenant B (1 ok item) and the default tenant, a fresh one in A, tenant C with none");

    // ---- a real API process as the restricted role, first sweep shortened ----------------------------------------------------------
    const port = 6100 + Math.floor(Math.random() * 800);
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
        BULK_EDIT_STALE_RECOVERY_INITIAL_DELAY_MS: "500",
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

    // ---- the sweeper must discover and act ----------------------------------------------------------------------------------------------
    const deadline = Date.now() + 60_000;
    let rows = {};
    while (Date.now() < deadline) {
      rows = { a: await getOp(ids.a), b: await getOp(ids.b), d: await getOp(ids.d) };
      if (rows.a.status === "failed" && rows.b.status === "failed" && rows.d.status === "failed") {
        break;
      }
      await sleep(500);
    }
    const tail = apiOutput.join("").slice(-900);
    assert.equal(rows.a.status, "failed", `tenant A's stale operation must be recovered; API output tail: ${tail}`);
    assert.equal(rows.b.status, "failed", `tenant B's stale operation must be recovered; API output tail: ${tail}`);
    assert.equal(rows.d.status, "failed", "the default tenant's stale operation is recovered too");
    console.log("PASS 2. the sweeper (restricted role) recovered the stale operation of EVERY non-default directory tenant and of the default tenant");

    // ---- each operation carries only its own tenant's counts -----------------------------------------------------------------------
    assert.deepEqual([rows.a.appliedCount, rows.a.failedCount], [2, 1], "tenant A: 2 successful and 1 failed items");
    assert.deepEqual([rows.b.appliedCount, rows.b.failedCount], [1, 0], "tenant B: 1 successful item, none of A's");
    assert.deepEqual([rows.d.appliedCount, rows.d.failedCount], [0, 0], "default tenant: no items");
    console.log("PASS 3. each recovered operation holds exactly its own tenant's counts: A 2/1, B 1/0, default 0/0");

    // ---- nothing it should not touch -----------------------------------------------------------------------------------------------
    assert.equal((await getOp(ids.fresh)).status, "processing", "a fresh processing operation (inside the staleness threshold) must be left alone");
    console.log("PASS 4. a fresh operation inside the threshold was left alone");

    const sessions = await admin.$queryRawUnsafe(`SELECT DISTINCT usename FROM pg_stat_activity WHERE datname = $1 AND application_name = 'vexa-pim-api-restricted'`, dbName);
    assert.ok(sessions.length > 0 && sessions.every((s) => s.usename === ROLE), `the API must have connected as ${ROLE} (saw ${JSON.stringify(sessions)})`);
    console.log("bulk-edit stale-recovery tenant-iteration integration test passed.");
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
  console.error("bulk-edit stale-recovery tenant-iteration integration test failed:");
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
