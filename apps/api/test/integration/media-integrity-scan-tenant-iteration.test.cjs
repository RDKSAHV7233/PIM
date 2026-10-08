#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001 P2.5: the scheduled media-integrity scan examines the media of EVERY directory tenant under a restricted
 * (NOSUPERUSER, NOBYPASSRLS, non-owner) role, with each tenant's own cursor.
 *
 * Before the change the scan was one global, cursor-paginated read of every tenant's media through the context-free direct client.
 * Under row level security that client sees no tenant's media, so the scan would have examined nothing and reported complete, clean
 * coverage. This test runs a real API process as the restricted role in a dedicated throwaway database (migrated here, dropped
 * after), with the scheduled scan enabled and its first run shortened by MEDIA_INTEGRITY_SCAN_INITIAL_DELAY_MS, and asserts on the
 * run row the scan records.
 *
 * Every media row has a deliberately malformed storage path, so the scan classifies it as an invalid path without probing object
 * storage: no network is used and the expected totals are exact. A scan that finds only the default tenant, or that reports
 * coverage for media it never read, fails this test.
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
  const dbName = `mediaint_${runId}`;
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
    const T = { a: `mi-a-${runId}`, b: `mi-b-${runId}`, c: `mi-c-${runId}`, d: "default" };
    for (const [i, tenantKey] of [T.a, T.b, T.c].entries()) {
      await admin.workspaceDirectory.create({ data: { tenantKey, workspaceSlug: `mi-${runId.slice(-6)}-${i}`, displayName: `MediaInt ${i}` } });
    }
    // Every media row has a deliberately MALFORMED storage path. The scan classifies it as an invalid path without ever probing
    // object storage, so no network is used and the outcome is exact: each row examined is one invalid path.
    const category = await admin.category.create({ data: { tenantKey: T.a, name: "Cat A", slug: `cat-a-${runId}`, path: `cat-a-${runId}` } });
    const product = await admin.product.create({ data: { tenantKey: T.a, title: "Active product A", categoryId: category.id, status: "approved" } });
    const media = (tenantKey, n, extra = {}) =>
      admin.mediaAsset.create({
        data: { id: `ma_${tenantKey}_${n}`, tenantKey, fileName: `f${n}.png`, mimeType: "image/png", storagePath: `bad path ${tenantKey} ${n}`, sizeBytes: 10, checksum: `sum${n}`, ...extra },
      });
    await media(T.a, 1, { productId: product.id }); // linked to an approved product: counts as an active-product impact
    await media(T.a, 2);
    await media(T.b, 1);
    await media(T.d, 1);
    const scanRuns = () =>
      admin.$queryRawUnsafe(
        `SELECT status, rows_examined AS "rowsExamined", rows_eligible AS "rowsEligible", coverage_complete AS "complete", continuation_pending AS "continuation", totals, by_storage_kind AS "byKind", impact, error_message AS "error", completed_at AS "completedAt" FROM media_integrity_scan_runs ORDER BY started_at DESC`,
      );
    assert.equal((await scanRuns()).length, 0, "no scan run may exist before the API starts");
    console.log("PASS 1. fixture seeded: 2 media rows in tenant A (one linked to an approved product), 1 in tenant B, 1 in the default tenant, tenant C with none; no scan run yet");

    // ---- a real API process as the restricted role, scheduled scan enabled with a 500 ms first run ---------------------------------------
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
        MEDIA_INTEGRITY_SCHEDULE_ENABLED: "true",
        MEDIA_INTEGRITY_SCAN_INITIAL_DELAY_MS: "500",
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

    // ---- the scheduled scan must reach every tenant's media ---------------------------------------------------------------------------------
    const deadline = Date.now() + 60_000;
    let run = null;
    while (Date.now() < deadline) {
      const runs = await scanRuns();
      run = runs.find((r) => r.completedAt !== null) ?? null;
      if (run) {
        break;
      }
      await sleep(500);
    }
    const tail = apiOutput.join("").slice(-900);
    assert.ok(run, `the scheduled scan must complete and record its run; API output tail: ${tail}`);
    assert.equal(run.error, null, `the scan must not fail (saw ${run.error})`);
    assert.equal(Number(run.rowsExamined), 4, `all four media rows of the three tenants must be examined (saw ${run.rowsExamined}); API output tail: ${tail}`);
    assert.equal(Number(run.rowsEligible), 4);
    assert.equal(run.complete, true, "coverage must be complete");
    assert.equal(run.continuation, false);
    console.log("PASS 2. the scheduled scan (restricted role) examined the media of EVERY non-default directory tenant and of the default tenant (4 of 4 rows, complete coverage)");

    // ---- the recorded totals are exactly this fixture's ---------------------------------------------------------------------------------------
    assert.equal(Number(run.totals.invalidPath), 4, "each malformed path is one invalid path");
    assert.equal(Number(run.byKind.malformed), 4);
    assert.equal(Number(run.impact.affectedTenantCount), 3, "tenants A, B and the default tenant are affected; tenant C has no media");
    assert.equal(Number(run.impact.activeProductImpactCount), 1, "only tenant A's media linked to an approved product counts as an active-product impact");
    assert.equal(Number(run.impact.unreadableTenantCount), 0, "no tenant may be unreadable");
    assert.equal(run.status, "partial", "defects were found, so the run is not reported ok");
    console.log("PASS 3. the run recorded exactly the fixture: 4 invalid paths in 4 malformed rows, 3 affected tenants, 1 active-product impact, 0 unreadable tenants");

    // ---- each tenant has its own finished cursor ------------------------------------------------------------------------------------------------
    const checkpoints = await admin.$queryRawUnsafe(`SELECT checkpoint_key AS key, cursor_id AS "cursorId", rows_eligible AS eligible FROM media_integrity_scan_checkpoints WHERE checkpoint_key LIKE 'media-integrity:default::%'`);
    const byTenant = Object.fromEntries(checkpoints.map((c) => [c.key.split("::")[1], c]));
    assert.equal(byTenant[T.a].eligible, 2);
    assert.equal(byTenant[T.b].eligible, 1);
    assert.equal(byTenant[T.d].eligible, 1);
    assert.ok(Object.values(byTenant).every((c) => c.cursorId === null), "a finished cycle clears every tenant's cursor");
    assert.equal(byTenant[T.c], undefined, "a tenant with no media keeps no checkpoint");
    console.log("PASS 4. each tenant with media has its own checkpoint (A 2, B 1, default 1 rows) with a cleared cursor; tenant C has none");

    const sessions = await admin.$queryRawUnsafe(`SELECT DISTINCT usename FROM pg_stat_activity WHERE datname = $1 AND application_name = 'vexa-pim-api-restricted'`, dbName);
    assert.ok(sessions.length > 0 && sessions.every((s) => s.usename === ROLE), `the API must have connected as ${ROLE} (saw ${JSON.stringify(sessions)})`);
    console.log("media integrity scan tenant-iteration integration test passed.");
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
  console.error("media integrity scan tenant-iteration integration test failed:");
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
