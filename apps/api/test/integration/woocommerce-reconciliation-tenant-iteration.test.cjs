#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001 P2.4b: the WooCommerce reconciliation job reaches the active installations and recent successful submissions of EVERY
 * directory tenant under a restricted (NOSUPERUSER, NOBYPASSRLS, non-owner) role.
 *
 * Before the change the job listed installations, and then each installation's submissions, through the context-free direct client.
 * Under row level security that client sees no tenant's rows, so the job that enforces PIM as the source of truth against live
 * WooCommerce drift would have checked nothing while every tick logged a clean, empty completion. This test runs a real API process
 * as the restricted role in a dedicated throwaway database (migrated here, dropped after), with the first run shortened by
 * WOO_RECONCILE_INITIAL_DELAY_MS.
 *
 * The fixture installations have no stored credentials, so the connector cannot reach any store: every reconciled submission ends in
 * its documented per-submission error path. The test asserts that exactly the in-window submissions of the ACTIVE installations of
 * tenants A, B and the default tenant were reached, that nothing was republished, and that no store was contacted.
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
  const dbName = `woorecon_${runId}`;
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
    const T = { a: `wr-a-${runId}`, b: `wr-b-${runId}`, c: `wr-c-${runId}`, d: "default" };
    for (const [i, tenantKey] of [T.a, T.b, T.c].entries()) {
      await admin.workspaceDirectory.create({ data: { tenantKey, workspaceSlug: `wr-${runId.slice(-6)}-${i}`, displayName: `WooRecon ${i}` } });
    }
    // WooCommerce installations with NO stored credentials: the connector cannot reach a store (no base URL, no keys), so the
    // reconciliation of every submission ends in its documented per-submission error path and no store is ever contacted. What the
    // test observes is that the sweeper REACHED each tenant's installation and submissions under the restricted role, which is
    // what the old context-free reads could not do.
    const ids = { a: `inst_a_${runId}`, b: `inst_b_${runId}`, d: `inst_d_${runId}`, off: `inst_off_a_${runId}` };
    const install = (tenantKey, id, alias, status) =>
      admin.$executeRawUnsafe(
        `INSERT INTO connector_installations (id, tenant_key, connector_id, account_alias, status, metadata, installed_by, created_at, updated_at)
         VALUES ($1, $2, 'cdef_woocommerce', $3, $4, '{}'::jsonb, 'woo-recon-test', NOW(), NOW())`,
        id,
        tenantKey,
        alias,
        status,
      );
    await install(T.a, ids.a, "primary", "ACTIVE");
    await install(T.b, ids.b, "primary", "ACTIVE");
    await install(T.d, ids.d, "primary", "ACTIVE");
    await install(T.a, ids.off, "disabled", "DISABLED");
    const refs = { a: `ext-a-${runId}`, b: `ext-b-${runId}`, d: `ext-d-${runId}`, old: `ext-old-a-${runId}`, off: `ext-off-a-${runId}` };
    const submission = (tenantKey, installationId, externalRef, resolvedHoursAgo) =>
      admin.$executeRawUnsafe(
        `INSERT INTO connector_submissions (id, tenant_key, installation_id, product_id, idempotency_key, submission_type, source, attempt_number, status, external_ref, payload_snapshot, submitted_at, resolved_at, connector_slug)
         VALUES ($1, $2, $3, $4, $5, 'create', 'test', 1, 'SUCCESS', $6, '{"sku":"SKU-1"}'::jsonb, NOW(), NOW() - ($7 || ' hours')::interval, 'woocommerce')`,
        `sub_${externalRef}`,
        tenantKey,
        installationId,
        `prod_${externalRef}`,
        `idem_${externalRef}`,
        externalRef,
        String(resolvedHoursAgo),
      );
    await submission(T.a, ids.a, refs.a, 1);
    await submission(T.b, ids.b, refs.b, 1);
    await submission(T.d, ids.d, refs.d, 1);
    await submission(T.a, ids.a, refs.old, 72); // resolved 72 h ago: outside the 48 h window, must be skipped
    await submission(T.a, ids.off, refs.off, 1); // belongs to a DISABLED installation: must be skipped
    console.log("PASS 1. fixture seeded: a recent successful submission on an active WooCommerce installation in tenant A, tenant B and the default tenant; an out-of-window one and a disabled installation's in A; tenant C with none");

    // ---- a real API process as the restricted role, first reconciliation shortened ----------------------------------------------------
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
        WOO_RECONCILE_DISABLED: "false",
        WOO_RECONCILE_INITIAL_DELAY_MS: "500",
        CONNECTOR_HEARTBEAT_DISABLED: "true",
        PIM_ALLOW_LEGACY_HEADERS: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const fullOutput = [];
    for (const stream of [api.stdout, api.stderr]) {
      stream.on("data", (chunk) => {
        fullOutput.push(String(chunk));
        apiOutput.push(String(chunk));
        if (apiOutput.length > 800) {
          apiOutput.shift();
        }
      });
    }
    await waitForHealth(baseUrl, 90_000, api, () => apiOutput.join("").slice(-1500));

    // ---- the reconciliation must reach every tenant ---------------------------------------------------------------------------------------
    const wanted = [ids.a, ids.b, ids.d];
    const deadline = Date.now() + 60_000;
    let completed = null;
    while (Date.now() < deadline) {
      const text = fullOutput.join("");
      completed = /WooCommerce reconciliation completed\.[^\n]*"checked":(\d+),"republished":(\d+),"errors":(\d+)/.exec(text);
      if (completed) {
        break;
      }
      await sleep(500);
    }
    const text = fullOutput.join("");
    const tail = text.slice(-900);
    assert.ok(completed, `the reconciliation must complete and log its counters; API output tail: ${tail}`);
    // `checked` counts every submission the sweeper reached; with no credentials each ends as "provider read unavailable" (which
    // also counts as an error and blocks any republish). Exactly the 3 in-window submissions of the active installations of A, B and
    // the default tenant must have been reached. Nothing is ever republished, and no store was contacted.
    assert.equal(Number(completed[1]), 3, `exactly the 3 in-window submissions of active installations must be reached (saw checked=${completed[1]})`);
    assert.equal(Number(completed[2]), 0, "nothing may be republished (no credentials, no store)");
    for (const id of wanted) {
      assert.ok(text.includes(id), `the log must show the installation ${id} was reconciled; API output tail: ${tail}`);
    }
    console.log(`PASS 2. the reconciliation (restricted role) reached the active installation of EVERY non-default directory tenant and of the default tenant (checked=${completed[1]}, republished=${completed[2]}, provider-unavailable errors=${completed[3]})`);

    // ---- nothing it should not touch -------------------------------------------------------------------------------------------------------
    assert.ok(!text.includes(refs.old), "a submission resolved outside the 48 h window must not be reconciled");
    assert.ok(!text.includes(ids.off) && !text.includes(refs.off), "a disabled installation's submission must not be reconciled");
    assert.ok(!/https?:\/\/[a-z0-9.-]+\.(?:com|net|org|io)\/wp-json/i.test(text), "no WooCommerce store may be contacted");
    console.log("PASS 3. an out-of-window submission and a disabled installation's submission were left alone; no store was contacted");

    const sessions = await admin.$queryRawUnsafe(`SELECT DISTINCT usename FROM pg_stat_activity WHERE datname = $1 AND application_name = 'vexa-pim-api-restricted'`, dbName);
    assert.ok(sessions.length > 0 && sessions.every((s) => s.usename === ROLE), `the API must have connected as ${ROLE} (saw ${JSON.stringify(sessions)})`);
    console.log("woocommerce reconciliation tenant-iteration integration test passed.");
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
  console.error("woocommerce reconciliation tenant-iteration integration test failed:");
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
