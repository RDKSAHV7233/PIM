#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001 P2.3b: the bulk-import stale-row sweeper resets the stuck rows of EVERY directory tenant under a restricted
 * (NOSUPERUSER, NOBYPASSRLS, non-owner) role, each on its own tenant and job, and touches nothing it should not.
 *
 * Before the change the sweeper read and wrote every tenant's rows through the context-free direct client. Under row level security
 * that client sees no tenant's rows, so rows stuck at `processing` would stay stuck forever while the sweep found nothing to do. This
 * test runs a real API process as the restricted role in a dedicated throwaway database (migrated here, dropped after), with the
 * first sweep shortened by BULK_IMPORT_STALE_ROW_RECOVERY_INITIAL_DELAY_MS.
 *
 * Fixture: stale `processing` rows in two non-default directory tenants (A has two, B has one) and in the default tenant, a FRESH
 * `processing` row in A that must be left alone, and a directory tenant (C) with no rows. A sweeper that finds only the default
 * tenant, or that resets a row under the wrong tenant or job, fails this test.
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
  const dbName = `bistale_${runId}`;
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
    const T = { a: `bi-a-${runId}`, b: `bi-b-${runId}`, c: `bi-c-${runId}`, d: "default" };
    for (const [i, tenantKey] of [T.a, T.b, T.c].entries()) {
      await admin.workspaceDirectory.create({ data: { tenantKey, workspaceSlug: `bi-${runId.slice(-6)}-${i}`, displayName: `BulkImport ${i}` } });
    }
    const jobs = {};
    for (const tenantKey of [T.a, T.b, T.d]) {
      const category = await admin.category.create({ data: { tenantKey, name: `Cat ${tenantKey}`, slug: `cat-${tenantKey}`, path: `cat-${tenantKey}` } });
      // The job itself stays in `processing` (its worker crashed): the sweeper resets the stuck ROWS and re-drives the job, which then
      // returns early because the job is not claimable. The observable effect is the row reset, per tenant.
      jobs[tenantKey] = await admin.bulkImportJob.create({
        data: { tenantKey, categoryId: category.id, sourceFormat: "csv", mapping: {}, status: "processing", totalRows: 3 },
      });
    }
    const rowIds = { a1: `row_a1_${runId}`, a2: `row_a2_${runId}`, b1: `row_b1_${runId}`, d1: `row_d1_${runId}`, fresh: `row_fresh_a_${runId}` };
    const row = async (tenantKey, id, rowNumber, ageHours) => {
      await admin.bulkImportRow.create({ data: { id, tenantKey, jobId: jobs[tenantKey].id, rowNumber, payload: {}, status: "processing" } });
      await admin.$executeRawUnsafe(`UPDATE "BulkImportRow" SET "lastAttemptAt" = NOW() - ($2 || ' hours')::interval WHERE id = $1`, id, String(ageHours));
    };
    await row(T.a, rowIds.a1, 1, 2);
    await row(T.a, rowIds.a2, 2, 2);
    await row(T.b, rowIds.b1, 1, 2);
    await row(T.d, rowIds.d1, 1, 2);
    await row(T.a, rowIds.fresh, 3, 0);

    const getRow = async (id) => {
      const rows = await admin.$queryRawUnsafe(`SELECT id, "tenantKey", "jobId", status::text AS status FROM "BulkImportRow" WHERE id = $1`, id);
      return rows[0] ?? null;
    };
    for (const id of Object.values(rowIds)) {
      assert.equal((await getRow(id)).status, "processing", `${id} must start in processing`);
    }
    console.log("PASS 1. fixture seeded: stale processing rows in tenant A (2), tenant B (1) and the default tenant (1), a fresh processing row in A, tenant C with none");

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
        BULK_IMPORT_STALE_ROW_RECOVERY_INITIAL_DELAY_MS: "500",
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
    const stale = [rowIds.a1, rowIds.a2, rowIds.b1, rowIds.d1];
    const deadline = Date.now() + 60_000;
    let statuses = {};
    while (Date.now() < deadline) {
      statuses = Object.fromEntries(await Promise.all(stale.map(async (id) => [id, (await getRow(id)).status])));
      if (Object.values(statuses).every((status) => status === "retrying")) {
        break;
      }
      await sleep(500);
    }
    const tail = apiOutput.join("").slice(-900);
    assert.deepEqual(
      statuses,
      { [rowIds.a1]: "retrying", [rowIds.a2]: "retrying", [rowIds.b1]: "retrying", [rowIds.d1]: "retrying" },
      `every stale row of every directory tenant and of the default tenant must be reset; API output tail: ${tail}`,
    );
    console.log("PASS 2. the sweeper (restricted role) reset the stale rows of EVERY non-default directory tenant and of the default tenant");

    // ---- each row stays with its own tenant and job; nothing it should not touch ----------------------------------------------------
    for (const [id, tenantKey] of [[rowIds.a1, T.a], [rowIds.a2, T.a], [rowIds.b1, T.b], [rowIds.d1, T.d]]) {
      const after = await getRow(id);
      assert.equal(after.tenantKey, tenantKey, `${id} must stay under ${tenantKey}`);
      assert.equal(after.jobId, jobs[tenantKey].id, `${id} must stay on its own tenant's job`);
    }
    assert.equal((await getRow(rowIds.fresh)).status, "processing", "a fresh processing row (inside the staleness threshold) must be left alone");
    console.log("PASS 3. every reset row stayed on its own tenant and job; a fresh row inside the threshold was left alone");

    const sessions = await admin.$queryRawUnsafe(`SELECT DISTINCT usename FROM pg_stat_activity WHERE datname = $1 AND application_name = 'vexa-pim-api-restricted'`, dbName);
    assert.ok(sessions.length > 0 && sessions.every((s) => s.usename === ROLE), `the API must have connected as ${ROLE} (saw ${JSON.stringify(sessions)})`);
    console.log("bulk-import stale-row tenant-iteration integration test passed.");
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
  console.error("bulk-import stale-row tenant-iteration integration test failed:");
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
