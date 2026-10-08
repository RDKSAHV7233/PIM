#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001 P2.1a: the nightly usage rollup reaches EVERY directory tenant under a restricted
 * (NOSUPERUSER, NOBYPASSRLS, non-owner) role, and each tenant's PlanUsage row holds only that tenant's own counts.
 *
 * Before the change, tenant discovery was a no-argument DISTINCT scan across six tables. Under row level security that scan sees only
 * the default tenant, so the job would roll up one tenant and report success. This test runs a real API process as the restricted
 * role in a dedicated throwaway database (migrated here, dropped after), with the first rollup shortened by
 * PLAN_USAGE_ROLLUP_INITIAL_DELAY_MS.
 *
 * Every assertion is on rows that must really exist. The fixture has three NON-DEFAULT tenants with different data, one of which has
 * a directory row and no data at all (the old scan could never find it). A rollup that finds only the default tenant, or that mixes
 * one tenant's counts into another's row, fails this test.
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
const GIB = 1024 * 1024 * 1024;

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
  const dbName = `planusage_${runId}`;
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
    const T = { a: `pu-a-${runId}`, b: `pu-b-${runId}`, c: `pu-c-${runId}` };
    const directory = Object.values(T);
    for (const [i, tenantKey] of directory.entries()) {
      await admin.workspaceDirectory.create({ data: { tenantKey, workspaceSlug: `pu-${runId.slice(-6)}-${i}`, displayName: `Usage ${i}` } });
    }
    const category = async (tenantKey) =>
      admin.category.create({ data: { tenantKey, name: `Cat ${tenantKey}`, slug: `cat-${tenantKey}`, path: `cat-${tenantKey}` } });
    const product = async (tenantKey, categoryId, n) =>
      admin.product.create({ data: { tenantKey, title: `P${n} ${tenantKey}`, categoryId, status: "approved" } });
    const variant = (tenantKey, productId, sku, status) =>
      admin.variant.create({ data: { tenantKey, productId, skuCode: `${sku}-${tenantKey}`, status } });
    const media = (tenantKey, sizeBytes, n) =>
      admin.mediaAsset.create({
        data: { id: `ma_${tenantKey}_${n}`, tenantKey, fileName: `f${n}.png`, mimeType: "image/png", storagePath: `storage/${tenantKey}/f${n}.png`, sizeBytes, checksum: `sum${n}` },
      });

    // Tenant A: 2 sellable variants + 1 draft (not counted), 1 GiB media, 1 export job this month.
    const catA = await category(T.a);
    const prodA = await product(T.a, catA.id, 1);
    await variant(T.a, prodA.id, "A1", "approved");
    await variant(T.a, prodA.id, "A2", "active");
    await variant(T.a, prodA.id, "A3", "draft");
    await media(T.a, GIB, 1);
    await admin.marketplaceExportJob.create({ data: { tenantKey: T.a, productId: prodA.id, categoryId: catA.id, channel: "shopify" } });
    // Tenant B: 1 sellable variant, 0.5 GiB media, no export job.
    const catB = await category(T.b);
    const prodB = await product(T.b, catB.id, 1);
    await variant(T.b, prodB.id, "B1", "approved");
    await media(T.b, GIB / 2, 1);
    // Tenant C: a directory row and NO data of any kind (the old cross-table scan could never discover it).

    const month = new Date().toISOString().slice(0, 7);
    const usage = (tenantKey) =>
      admin.$queryRawUnsafe(
        `SELECT "skuCount", "submissionCount", "storageGb", "connectorInstallationsCount" FROM "PlanUsage" WHERE "tenantKey" = $1 AND "month" = $2`,
        tenantKey,
        month,
      );
    for (const tenantKey of [...directory, "default"]) {
      assert.equal((await usage(tenantKey)).length, 0, `no PlanUsage row may exist for ${tenantKey} before the rollup`);
    }
    console.log("PASS 1. fixture seeded: tenant A (2 sellable SKUs, 1 GiB, 1 export), tenant B (1 sellable SKU, 0.5 GiB), tenant C (directory row only); no PlanUsage rows yet");

    // ---- a real API process as the restricted role, first rollup shortened -------------------------------------------------------
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
        PLAN_USAGE_ROLLUP_INITIAL_DELAY_MS: "500",
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

    // ---- the rollup must discover and act ------------------------------------------------------------------------------------------
    const deadline = Date.now() + 60_000;
    let rows = {};
    while (Date.now() < deadline) {
      rows = { a: await usage(T.a), b: await usage(T.b), c: await usage(T.c), d: await usage("default") };
      if (rows.a.length && rows.b.length && rows.c.length && rows.d.length) {
        break;
      }
      await sleep(500);
    }
    const tail = apiOutput.join("").slice(-900);
    for (const [label, tenantKey] of [["A", T.a], ["B", T.b], ["C", T.c]]) {
      assert.equal(rows[label.toLowerCase()].length, 1, `the rollup must create a PlanUsage row for the non-default tenant ${tenantKey}; API output tail: ${tail}`);
    }
    assert.equal(rows.d.length, 1, "the default tenant is rolled up too");
    console.log("PASS 2. the rollup (restricted role) wrote a PlanUsage row for EVERY non-default directory tenant, including the one with no data, and for the default tenant");

    // ---- each row holds only that tenant's own counts (no cross-tenant mixing) -----------------------------------------------------
    const a = rows.a[0];
    const b = rows.b[0];
    const c = rows.c[0];
    assert.equal(Number(a.skuCount), 2, "tenant A has exactly 2 sellable SKUs (the draft variant is not counted and B's variant is not A's)");
    assert.equal(Number(a.submissionCount), 1, "tenant A has exactly 1 export job this month");
    assert.ok(Math.abs(Number(a.storageGb) - 1) < 1e-6, `tenant A storage is 1 GiB (saw ${a.storageGb})`);
    assert.equal(Number(b.skuCount), 1, "tenant B has exactly 1 sellable SKU");
    assert.equal(Number(b.submissionCount), 0, "tenant B has no export job: A's job must not leak into B");
    assert.ok(Math.abs(Number(b.storageGb) - 0.5) < 1e-6, `tenant B storage is 0.5 GiB (saw ${b.storageGb})`);
    assert.equal(Number(c.skuCount), 0);
    assert.equal(Number(c.submissionCount), 0);
    assert.equal(Number(c.storageGb), 0);
    console.log("PASS 3. every tenant's PlanUsage row holds exactly its own counts: A 2 SKUs / 1 export / 1 GiB, B 1 SKU / 0 exports / 0.5 GiB, C all zero");

    // ---- the job reports what it did, and no tenant failed ------------------------------------------------------------------------
    const output = apiOutput.join("");
    const summary = /Nightly usage rollup (complete|degraded): directory=(\d+) evaluated=(\d+) succeeded=(\d+) failed=(\d+)/.exec(output);
    assert.ok(summary, `the job must log its result; API output tail: ${output.slice(-600)}`);
    assert.equal(summary[1], "complete", `the rollup must not be degraded: ${summary[0]}`);
    assert.ok(Number(summary[3]) >= 4, `at least the three directory tenants and the default tenant were evaluated (saw ${summary[3]})`);
    assert.equal(Number(summary[5]), 0, "no tenant failed");
    console.log(`PASS 4. the job reported its result: ${summary[0]}`);

    const sessions = await admin.$queryRawUnsafe(`SELECT DISTINCT usename FROM pg_stat_activity WHERE datname = $1 AND application_name = 'vexa-pim-api-restricted'`, dbName);
    assert.ok(sessions.length > 0 && sessions.every((s) => s.usename === ROLE), `the API must have connected as ${ROLE} (saw ${JSON.stringify(sessions)})`);
    console.log("plan-usage rollup tenant-iteration integration test passed.");
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
  console.error("plan-usage rollup tenant-iteration integration test failed:");
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
