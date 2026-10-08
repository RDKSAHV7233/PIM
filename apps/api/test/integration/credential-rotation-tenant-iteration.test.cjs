#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001: credential rotation reaches every tenant under a restricted (NOSUPERUSER, NOBYPASSRLS, non-owner) role.
 *
 * It runs in a dedicated, throwaway database (migrated here, then dropped) because rotating key versions changes every stale
 * credential it can see, which would corrupt other integration tests sharing the lane database. Both rotation entry points run as
 * the restricted role:
 *
 *   A. the operator procedure (ConnectorCredentialEncryptionService.rotateKey), dry run first, then for real;
 *   B. the automatic startup rotation of a real API process (ConnectorHeartbeatService -> rotateAllCredentials).
 *
 * Every assertion is on rows that must really be there: a non-default tenant's credential goes v1 -> v2 and still decrypts to the
 * original secret; the default tenant's already-current credential is byte-identical afterwards; an undecryptable credential is left
 * alone and the run is reported degraded (PARTIAL_FAILURE), never as success. "No error" is not accepted as proof.
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
const KEY_V1 = "pim1-ci-rotation-key-v1-minimum-32-chars";
const KEY_V2 = "pim1-ci-rotation-key-v2-minimum-32-chars";

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

const keyEnv = (current) => ({
  CREDENTIAL_ENCRYPTION_KEY_V1: KEY_V1,
  CREDENTIAL_ENCRYPTION_KEY_V2: KEY_V2,
  CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION: String(current),
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadService(currentVersion, adminClient) {
  Object.assign(process.env, keyEnv(currentVersion));
  const { LoggerService } = require(path.join(DIST, "common", "logging", "logger.service.js"));
  const { ConnectorCredentialEncryptionService } = require(path.join(DIST, "connector-installer", "credential-encryption.service.js"));
  // Hand-built with the admin client: this is the seeding side of the test, not the code under test.
  return new ConnectorCredentialEncryptionService({ getClient: () => adminClient }, new LoggerService());
}

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
  const dbName = `rotiter_${runId}`;
  const adminMain = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
  let admin = null;
  let api = null;
  const apiOutput = [];

  try {
    // ---- an isolated, migrated database with the restricted role granted exactly as the lane grants it ---------------------------
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

    // ---- seed (as admin): a default tenant, three non-default tenants in the directory ---------------------------------------
    const tenants = { a: `rotiter-a-${runId}`, b: `rotiter-b-${runId}`, c: `rotiter-c-${runId}`, d: "default" };
    for (const [slot, tenantKey] of Object.entries(tenants)) {
      if (slot !== "d") {
        await admin.workspaceDirectory.create({ data: { tenantKey, workspaceSlug: `rotiter-${slot}-${runId.slice(-6)}`, displayName: `Rotation ${slot}` } });
      }
      await admin.$executeRawUnsafe(
        `INSERT INTO connector_installations (id, tenant_key, connector_id, account_alias, status, metadata, installed_by, created_at, updated_at)
         VALUES ($1, $2, 'cdef_amazon_in', 'primary', 'ACTIVE', '{}'::jsonb, 'rotation-test', NOW(), NOW())`,
        `inst_${slot}_${runId}`,
        tenantKey,
      );
    }
    const asV1 = loadService(1, admin);
    await asV1.storeCredential({ tenantKey: tenants.a, installationId: `inst_a_${runId}`, credentialType: "refresh_token", plainValue: "secret-a" });
    await asV1.storeCredential({ tenantKey: tenants.b, installationId: `inst_b_${runId}`, credentialType: "refresh_token", plainValue: "secret-b" });
    await asV1.storeCredential({ tenantKey: tenants.b, installationId: `inst_b_${runId}`, credentialType: "access_token", plainValue: "will-be-corrupted" });
    await admin.$executeRawUnsafe(`UPDATE connector_credentials SET encrypted_value = 'enc::v0:not-valid-ciphertext' WHERE id = $1`, `inst_b_${runId}:access_token`);
    const asV2 = loadService(2, admin);
    await asV2.storeCredential({ tenantKey: tenants.d, installationId: `inst_d_${runId}`, credentialType: "refresh_token", plainValue: "secret-d" });

    const readRow = async (id) => (await admin.$queryRawUnsafe(`SELECT id, encrypted_value AS "encryptedValue", key_version AS "keyVersion" FROM connector_credentials WHERE id = $1`, id))[0];
    const ids = { a: `inst_a_${runId}:refresh_token`, bGood: `inst_b_${runId}:refresh_token`, bBad: `inst_b_${runId}:access_token`, c: `inst_c_${runId}:refresh_token`, d: `inst_d_${runId}:refresh_token` };
    const defaultBefore = await readRow(ids.d);
    const badBefore = await readRow(ids.bBad);
    assert.equal((await readRow(ids.a)).keyVersion, "v1");
    assert.equal(defaultBefore.keyVersion, "v2", "the default tenant's credential starts on the current version");

    // ---- A. the operator procedure as the restricted role ---------------------------------------------------------------------
    const cli = (dryRun) => {
      const code = `
        const { PrismaDirectService } = require(${JSON.stringify(path.join(DIST, "prisma", "prisma-direct.service.js"))});
        const { LoggerService } = require(${JSON.stringify(path.join(DIST, "common", "logging", "logger.service.js"))});
        const { ConnectorCredentialEncryptionService } = require(${JSON.stringify(path.join(DIST, "connector-installer", "credential-encryption.service.js"))});
        (async () => {
          const direct = new PrismaDirectService();
          await direct.onModuleInit();
          const [who] = await direct.getClient().$queryRawUnsafe("SELECT (rolsuper OR rolbypassrls) AS privileged FROM pg_roles WHERE rolname = current_user");
          const service = new ConnectorCredentialEncryptionService(direct, new LoggerService());
          const result = await service.rotateKey({ fromVersion: 1, toVersion: 2, dryRun: ${dryRun} });
          console.log("RESULT:" + JSON.stringify({ privileged: who.privileged, status: result.status, rotated: result.rotated, failed: result.failed, orphan: result.tenants.orphanDetection, tenants: result.tenants.results.map((t) => [t.tenantKey, t.status, t.examinedCount, t.changedCount]) }));
          await direct.onModuleDestroy();
        })().catch((e) => { console.error("CLI-ERROR:" + (e && e.message)); process.exit(1); });
      `;
      const run = spawnSync(process.execPath, ["-e", code], {
        cwd: REPO_ROOT,
        env: { ...process.env, ...keyEnv(2), DATABASE_URL: restrictedUrl, DATABASE_URL_DIRECT: restrictedUrl, DATABASE_URL_POOLED: restrictedUrl, VEXA_RESTRICTED_DATABASE_URL: "" },
        encoding: "utf8",
      });
      assert.equal(run.status, 0, `rotation CLI failed: ${String(run.stdout).slice(-300)} ${String(run.stderr).slice(-300)}`);
      const line = String(run.stdout).split("\n").find((l) => l.startsWith("RESULT:"));
      assert.ok(line, "the CLI must print a RESULT line");
      return JSON.parse(line.slice("RESULT:".length));
    };

    const dry = cli(true);
    assert.equal(dry.privileged, false, "the CLI must run as the restricted role");
    assert.equal(dry.rotated, 2, `dry run must find the 2 rotatable stale credentials of tenants a and b (got ${dry.rotated})`);
    assert.equal(dry.failed, 1, "and report the undecryptable one as a failure");
    assert.equal(dry.status, "PARTIAL_FAILURE");
    assert.equal((await readRow(ids.a)).keyVersion, "v1", "a dry run writes nothing");
    console.log("PASS A1. dry run as the restricted role found the 2 rotatable stale credentials across two non-default tenants, flagged the corrupt one, and wrote nothing");

    const real = cli(false);
    assert.equal(real.status, "PARTIAL_FAILURE", "an undecryptable credential must make the run PARTIAL_FAILURE, never SUCCESS");
    assert.equal(real.rotated, 2, "tenant a's credential and tenant b's good credential rotate");
    assert.equal(real.failed, 1);
    assert.equal(real.orphan, "UNVERIFIED_BY_RUNTIME_ROLE");
    const a = await readRow(ids.a);
    assert.equal(a.keyVersion, "v2");
    assert.equal(asV2.decrypt(a.encryptedValue, a.keyVersion), "secret-a", "the rotated credential still decrypts to the original secret");
    const bGood = await readRow(ids.bGood);
    assert.equal(bGood.keyVersion, "v2");
    assert.equal(asV2.decrypt(bGood.encryptedValue, bGood.keyVersion), "secret-b");
    assert.deepEqual(await readRow(ids.bBad), badBefore, "the undecryptable credential is left exactly as it was");
    assert.deepEqual(await readRow(ids.d), defaultBefore, "the default tenant's already-current credential is byte-identical");
    console.log("PASS A2. rotateKey as the restricted role: tenants a and b rotated and re-decrypt; corrupt row untouched; default tenant unaffected; PARTIAL_FAILURE surfaced");

    // ---- B. the automatic startup rotation of a real API process --------------------------------------------------------------
    await asV1.storeCredential({ tenantKey: tenants.c, installationId: `inst_c_${runId}`, credentialType: "refresh_token", plainValue: "secret-c" });
    assert.equal((await readRow(ids.c)).keyVersion, "v1");
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}/api/v1`;
    api = spawn(process.execPath, [path.join(DIST, "main.js")], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        ...keyEnv(2),
        PORT: String(port),
        DATABASE_URL: restrictedUrl,
        DATABASE_URL_DIRECT: restrictedUrl,
        DATABASE_URL_POOLED: restrictedUrl,
        VEXA_RESTRICTED_DATABASE_URL: "", // this test points the API at its own database and role; the lane preload must not redirect it
        DB_POOL_APP_NAME: "vexa-pim-api-restricted",
        CONNECTOR_HEARTBEAT_INITIAL_DELAY_MS: "500",
        PIM_ALLOW_LEGACY_HEADERS: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [api.stdout, api.stderr]) {
      stream.on("data", (chunk) => {
        apiOutput.push(String(chunk));
        if (apiOutput.length > 400) {
          apiOutput.shift();
        }
      });
    }
    await waitForHealth(baseUrl, 90_000);

    const deadline = Date.now() + 60_000;
    let c = await readRow(ids.c);
    while (c.keyVersion !== "v2" && Date.now() < deadline) {
      await sleep(500);
      c = await readRow(ids.c);
    }
    assert.equal(c.keyVersion, "v2", `the API's startup rotation must re-encrypt tenant c's credential (still ${c.keyVersion}); API output tail: ${apiOutput.join("").slice(-600)}`);
    assert.equal(asV2.decrypt(c.encryptedValue, c.keyVersion), "secret-c");
    assert.deepEqual(await readRow(ids.d), defaultBefore, "startup rotation leaves the default tenant's current credential byte-identical");
    assert.deepEqual(await readRow(ids.bBad), badBefore, "startup rotation leaves the undecryptable credential alone");

    const output = apiOutput.join("");
    assert.ok(/connector\.credential\.rotation_degraded/.test(output) && /PARTIAL_FAILURE/.test(output), "the API must surface the still-undecryptable credential as a degraded rotation, not as success");
    const sessions = await admin.$queryRawUnsafe(`SELECT DISTINCT usename FROM pg_stat_activity WHERE datname = $1 AND application_name = 'vexa-pim-api-restricted'`, dbName);
    assert.ok(sessions.length > 0 && sessions.every((s) => s.usename === ROLE), `the API must have connected as ${ROLE} (saw ${JSON.stringify(sessions)})`);
    console.log("PASS B. API startup rotation as the restricted role re-encrypted tenant c; default tenant byte-identical; degraded rotation surfaced");
    console.log("credential-rotation tenant-iteration integration test passed.");
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
  console.error("credential-rotation tenant-iteration integration test failed:");
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
