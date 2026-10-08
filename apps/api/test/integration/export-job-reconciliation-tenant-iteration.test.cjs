#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001 P2.3d: the export-job reconciliation fails the stale active export jobs of EVERY directory tenant under a
 * restricted (NOSUPERUSER, NOBYPASSRLS, non-owner) role, each under its own tenant, and touches nothing it should not.
 *
 * Before the change the reconciliation read every tenant's jobs through the context-free direct client. Under row level security
 * that client sees no tenant's rows, so jobs stuck queued/processing/retrying would stay active forever while the run reported
 * nothing to do. This test runs a real API process as the restricted role in a dedicated throwaway database (migrated here, dropped
 * after), with the first run shortened by EXPORT_JOB_RECONCILE_INITIAL_DELAY_MS.
 *
 * Fixture: stale active export jobs (older than the 30 minute threshold) in two non-default directory tenants (A has two, B has one)
 * and in the default tenant, a fresh active job in A and a completed job in B that must be left alone, and a directory tenant (C)
 * with none. A run that finds only the default tenant, or that fails a job under the wrong tenant, fails this test.
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
  const dbName = `exrecon_${runId}`;
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
    const T = { a: `ej-a-${runId}`, b: `ej-b-${runId}`, c: `ej-c-${runId}`, d: "default" };
    for (const [i, tenantKey] of [T.a, T.b, T.c].entries()) {
      await admin.workspaceDirectory.create({ data: { tenantKey, workspaceSlug: `ej-${runId.slice(-6)}-${i}`, displayName: `Export ${i}` } });
    }
    const parents = {};
    for (const tenantKey of [T.a, T.b, T.d]) {
      const category = await admin.category.create({ data: { tenantKey, name: `Cat ${tenantKey}`, slug: `cat-${tenantKey}`, path: `cat-${tenantKey}` } });
      const product = await admin.product.create({ data: { tenantKey, title: `P ${tenantKey}`, categoryId: category.id, status: "approved" } });
      parents[tenantKey] = { categoryId: category.id, productId: product.id };
    }
    const ids = { a1: `ej_a1_${runId}`, a2: `ej_a2_${runId}`, b1: `ej_b1_${runId}`, d1: `ej_d1_${runId}`, fresh: `ej_fresh_a_${runId}`, done: `ej_done_b_${runId}` };
    const job = async (tenantKey, id, status, ageMinutes) => {
      await admin.marketplaceExportJob.create({
        data: { id, tenantKey, productId: parents[tenantKey].productId, categoryId: parents[tenantKey].categoryId, channel: "shopify", status },
      });
      await admin.$executeRawUnsafe(`UPDATE "MarketplaceExportJob" SET "updatedAt" = NOW() - ($2 || ' minutes')::interval WHERE id = $1`, id, String(ageMinutes));
    };
    await job(T.a, ids.a1, "queued", 120);
    await job(T.a, ids.a2, "processing", 120);
    await job(T.b, ids.b1, "retrying", 120);
    await job(T.d, ids.d1, "queued", 120);
    await job(T.a, ids.fresh, "processing", 1); // inside the staleness threshold: must be left alone
    await job(T.b, ids.done, "completed", 120); // terminal: must be left alone

    const getJob = async (id) => {
      const rows = await admin.$queryRawUnsafe(`SELECT id, "tenantKey", status::text AS status, "failureReason" FROM "MarketplaceExportJob" WHERE id = $1`, id);
      return rows[0] ?? null;
    };
    const initial = { [ids.a1]: "queued", [ids.a2]: "processing", [ids.b1]: "retrying", [ids.d1]: "queued", [ids.fresh]: "processing", [ids.done]: "completed" };
    for (const [id, status] of Object.entries(initial)) {
      assert.equal((await getJob(id)).status, status, `${id} must start ${status}`);
    }
    console.log("PASS 1. fixture seeded: stale active export jobs in tenant A (2), tenant B (1) and the default tenant (1), a fresh job in A, a completed job in B, tenant C with none");

    // ---- a real API process as the restricted role, first run shortened --------------------------------------------------------------
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
        EXPORT_JOB_RECONCILE_INITIAL_DELAY_MS: "500",
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

    // ---- the reconciliation must discover and act -------------------------------------------------------------------------------------
    const stale = [ids.a1, ids.a2, ids.b1, ids.d1];
    const deadline = Date.now() + 60_000;
    let rows = {};
    while (Date.now() < deadline) {
      rows = Object.fromEntries(await Promise.all(stale.map(async (id) => [id, await getJob(id)])));
      if (Object.values(rows).every((row) => row.status === "failed")) {
        break;
      }
      await sleep(500);
    }
    const tail = apiOutput.join("").slice(-900);
    for (const id of stale) {
      assert.equal(rows[id].status, "failed", `${id} must be reconciled to failed (saw ${rows[id].status}); API output tail: ${tail}`);
    }
    console.log("PASS 2. the reconciliation (restricted role) failed the stale export jobs of EVERY non-default directory tenant and of the default tenant");

    // ---- each job stays with its own tenant and carries the reconciliation reason ---------------------------------------------------------
    for (const [id, tenantKey] of [[ids.a1, T.a], [ids.a2, T.a], [ids.b1, T.b], [ids.d1, T.d]]) {
      assert.equal(rows[id].tenantKey, tenantKey, `${id} must stay under ${tenantKey}`);
      assert.match(String(rows[id].failureReason), /^Reconciled:/, `${id} must carry the reconciliation reason (saw ${rows[id].failureReason})`);
    }
    console.log("PASS 3. every reconciled job stayed on its own tenant and carries the reconciliation reason");

    // ---- nothing it should not touch -----------------------------------------------------------------------------------------------
    assert.equal((await getJob(ids.fresh)).status, "processing", "a job inside the staleness threshold must be left alone");
    assert.equal((await getJob(ids.done)).status, "completed", "a completed job must be left alone");
    console.log("PASS 4. a fresh active job and a completed job were left alone");

    const sessions = await admin.$queryRawUnsafe(`SELECT DISTINCT usename FROM pg_stat_activity WHERE datname = $1 AND application_name = 'vexa-pim-api-restricted'`, dbName);
    assert.ok(sessions.length > 0 && sessions.every((s) => s.usename === ROLE), `the API must have connected as ${ROLE} (saw ${JSON.stringify(sessions)})`);
    console.log("export-job reconciliation tenant-iteration integration test passed.");
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
  console.error("export-job reconciliation tenant-iteration integration test failed:");
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
