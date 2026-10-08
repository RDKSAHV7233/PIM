#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001 P2.4: the connector credential heartbeat validates the installations of EVERY directory tenant under a restricted
 * (NOSUPERUSER, NOBYPASSRLS, non-owner) role, and records each outcome under that installation's own tenant.
 *
 * Before the change the heartbeat listed installations with one query through the context-free direct client and wrote each outcome
 * through it too. Under row level security that client sees and updates no tenant's rows, so no credential would ever be validated
 * or marked expired while every tick reported cleanly. This test runs a real API process as the restricted role in a dedicated
 * throwaway database (migrated here, dropped after), with the first heartbeat shortened by CONNECTOR_HEARTBEAT_INITIAL_DELAY_MS.
 *
 * Fixture: installations in two non-default directory tenants (A has an active and a credential-expired one, B one) and in the
 * default tenant, a disabled installation in A that must be left alone, and a directory tenant (C) with none. A heartbeat that
 * finds only the default tenant, or that loses a recorded outcome, fails this test.
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
  const dbName = `hbeat_${runId}`;
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
    const T = { a: `hb-a-${runId}`, b: `hb-b-${runId}`, c: `hb-c-${runId}`, d: "default" };
    for (const [i, tenantKey] of [T.a, T.b, T.c].entries()) {
      await admin.workspaceDirectory.create({ data: { tenantKey, workspaceSlug: `hb-${runId.slice(-6)}-${i}`, displayName: `Heartbeat ${i}` } });
    }
    // Installations have no stored credentials, so validation takes the documented no-credentials path without any network call:
    // the heartbeat classifies each one and records an attempt (time, outcome, reason) on the installation row. That is a real,
    // per-tenant, observable database write, and it is the write that was silently lost under row level security.
    const ids = { a1: `inst_a1_${runId}`, a2: `inst_a2_${runId}`, b1: `inst_b1_${runId}`, d1: `inst_d1_${runId}`, off: `inst_off_a_${runId}` };
    const install = (tenantKey, id, alias, status) =>
      admin.$executeRawUnsafe(
        `INSERT INTO connector_installations (id, tenant_key, connector_id, account_alias, status, metadata, installed_by, created_at, updated_at)
         VALUES ($1, $2, 'cdef_amazon_in', $3, $4, '{}'::jsonb, 'heartbeat-test', NOW(), NOW())`,
        id,
        tenantKey,
        alias,
        status,
      );
    await install(T.a, ids.a1, "primary", "ACTIVE");
    await install(T.a, ids.a2, "secondary", "CREDENTIAL_EXPIRED");
    await install(T.b, ids.b1, "primary", "ACTIVE");
    await install(T.d, ids.d1, "primary", "ACTIVE");
    await install(T.a, ids.off, "disabled", "DISABLED"); // never validated

    const getInstall = async (id) => {
      const rows = await admin.$queryRawUnsafe(
        `SELECT id, tenant_key AS "tenantKey", status, last_validation_attempt_at AS "attemptAt", last_validation_outcome AS outcome
         FROM connector_installations WHERE id = $1`,
        id,
      );
      return rows[0] ?? null;
    };
    for (const id of Object.values(ids)) {
      assert.equal((await getInstall(id)).attemptAt, null, `${id} must start with no validation attempt`);
    }
    console.log("PASS 1. fixture seeded: installations in tenant A (active + credential-expired), tenant B and the default tenant, a disabled one in A, tenant C with none; none has a validation attempt yet");

    // ---- a real API process as the restricted role, first heartbeat shortened --------------------------------------------------------
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
        CONNECTOR_HEARTBEAT_DISABLED: "false",
        CONNECTOR_HEARTBEAT_INITIAL_DELAY_MS: "500",
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

    // ---- the heartbeat must discover and record -----------------------------------------------------------------------------------------
    const checked = [ids.a1, ids.a2, ids.b1, ids.d1];
    const deadline = Date.now() + 60_000;
    let rows = {};
    while (Date.now() < deadline) {
      rows = Object.fromEntries(await Promise.all(checked.map(async (id) => [id, await getInstall(id)])));
      if (Object.values(rows).every((row) => row.attemptAt !== null)) {
        break;
      }
      await sleep(500);
    }
    const tail = apiOutput.join("").slice(-900);
    for (const id of checked) {
      assert.ok(rows[id].attemptAt !== null, `${id} must have a recorded validation attempt; API output tail: ${tail}`);
      assert.ok(rows[id].outcome, `${id} must have a recorded outcome (saw ${rows[id].outcome})`);
    }
    console.log("PASS 2. the heartbeat (restricted role) validated and recorded an outcome for the installations of EVERY non-default directory tenant and of the default tenant (outcomes: " + [...new Set(checked.map((id) => rows[id].outcome))].join(", ") + ")");

    // ---- each installation stays with its own tenant; nothing it should not touch ---------------------------------------------------
    for (const [id, tenantKey] of [[ids.a1, T.a], [ids.a2, T.a], [ids.b1, T.b], [ids.d1, T.d]]) {
      assert.equal(rows[id].tenantKey, tenantKey, `${id} must stay under ${tenantKey}`);
    }
    assert.equal((await getInstall(ids.off)).attemptAt, null, "a disabled installation must not be validated");
    console.log("PASS 3. every validated installation stayed on its own tenant; the disabled installation was left alone");

    const sessions = await admin.$queryRawUnsafe(`SELECT DISTINCT usename FROM pg_stat_activity WHERE datname = $1 AND application_name = 'vexa-pim-api-restricted'`, dbName);
    assert.ok(sessions.length > 0 && sessions.every((s) => s.usename === ROLE), `the API must have connected as ${ROLE} (saw ${JSON.stringify(sessions)})`);
    console.log("connector heartbeat tenant-iteration integration test passed.");
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
  console.error("connector heartbeat tenant-iteration integration test failed:");
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
