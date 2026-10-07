#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001 D1: the PUBLIC media file route under a restricted (NOSUPERUSER, NOBYPASSRLS, non-owner) role.
 *
 * The route used to look an asset up by id with the context-free client. Under row level security that client sees only the
 * default tenant, so every other tenant's images would 404. Two real API processes run as the restricted role in a throwaway
 * database:
 *
 *   A. WITHOUT MEDIA_URL_SIGNING_KEY (rollout compatibility): the default tenant's asset is served, and a NON-default tenant's asset
 *      is a 404. This pins the failure the signed token exists to fix.
 *   B. WITH the key: a valid token serves the non-default tenant's asset (the bytes are compared), and every other request is refused
 *      with the same answer or finds nothing: no token, a token for another asset, an expired token, a token naming another tenant.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const DIST = path.join(REPO_ROOT, "apps", "api", "dist");
const { PrismaClient } = require(path.join(REPO_ROOT, "node_modules", "@prisma", "client"));

const ADMIN_URL = String(process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/pim1?schema=public").trim();
const ROLE = "vexa_runtime_ci";
const ROLE_PASSWORD = String(process.env.RESTRICTED_ROLE_PASSWORD || "vexa_runtime_ci_password").replace(/[^A-Za-z0-9_]/g, "");
const SIGNING_KEY = "integration-test-media-signing-key-0123456789";

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
  const dbName = `mediatok_${runId}`;
  const adminMain = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
  const children = [];
  let admin = null;
  const files = [];

  const startApi = async (extraEnv) => {
    const port = 6300 + Math.floor(Math.random() * 600);
    const baseUrl = `http://127.0.0.1:${port}/api/v1`;
    const restrictedUrl = urlFor(dbName, ROLE, ROLE_PASSWORD);
    const output = [];
    const child = spawn(process.execPath, [path.join(DIST, "main.js")], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        DATABASE_URL: restrictedUrl,
        DATABASE_URL_DIRECT: restrictedUrl,
        DATABASE_URL_POOLED: restrictedUrl,
        VEXA_RESTRICTED_DATABASE_URL: "",
        DB_POOL_APP_NAME: "vexa-pim-api-restricted",
        CONNECTOR_HEARTBEAT_DISABLED: "true",
        PIM_ALLOW_LEGACY_HEADERS: "false",
        MEDIA_URL_SIGNING_KEY: "",
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk) => {
        output.push(String(chunk));
        if (output.length > 300) {
          output.shift();
        }
      });
    }
    children.push(child);
    await waitForHealth(baseUrl, 90_000);
    return { baseUrl, child, output };
  };

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
    admin = new PrismaClient({ datasources: { db: { url: dbAdminUrl } } });
    console.log(`PASS 0. isolated database ${dbName} migrated; role ${ROLE} granted`);

    // ---- seed (as admin): one asset for a NON-default tenant and one for the default tenant, each with a real file -------------
    const tenantB = `media-b-${runId}`;
    const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`tenant-b-${runId}`)]);
    const PNG_DEFAULT = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`default-${runId}`)]);
    const seedAsset = async (id, tenantKey, bytes) => {
      const file = path.join(os.tmpdir(), `${id}.png`);
      fs.writeFileSync(file, bytes);
      files.push(file);
      await admin.$executeRawUnsafe(
        `INSERT INTO media_assets (id, tenant_key, entity_type, file_name, mime_type, storage_path, size_bytes, checksum, metadata, created_at, updated_at)
         VALUES ($1, $2, 'product', 'image.png', 'image/png', $3, $4, 'checksum', '{}'::jsonb, NOW(), NOW())`,
        id,
        tenantKey,
        file,
        bytes.length,
      );
    };
    const assetB = `asset-b-${runId}`;
    const assetOther = `asset-other-${runId}`;
    const assetDefault = `asset-default-${runId}`;
    await seedAsset(assetB, tenantB, PNG);
    await seedAsset(assetOther, tenantB, PNG);
    await seedAsset(assetDefault, "default", PNG_DEFAULT);

    // ---- A. no signing key: the failure the token fixes -------------------------------------------------------------------------
    const legacy = await startApi({});
    const fetchFile = async (base, id, query = "") => {
      const response = await fetch(`${base}/media/assets/${id}/file${query}`, { redirect: "manual" });
      return { status: response.status, body: Buffer.from(await response.arrayBuffer()), type: response.headers.get("content-type") };
    };
    const legacyDefault = await fetchFile(legacy.baseUrl, assetDefault);
    assert.equal(legacyDefault.status, 200, `default tenant's asset must be served without a key (got ${legacyDefault.status})`);
    assert.ok(legacyDefault.body.equals(PNG_DEFAULT), "the default tenant's bytes are served");
    const legacyB = await fetchFile(legacy.baseUrl, assetB);
    assert.equal(legacyB.status, 404, `WITHOUT a signing key a NON-default tenant's asset is a 404 under row level security (got ${legacyB.status})`);
    console.log("PASS A. no signing key, restricted role: the default tenant's image is served (200) and a non-default tenant's image is a 404: the failure the token fixes");
    legacy.child.kill("SIGKILL");
    await sleep(500);

    // ---- B. with the key: the token carries the tenant ---------------------------------------------------------------------------
    const { signMediaToken } = require(path.join(DIST, "media", "media-url-token.js"));
    const env = { MEDIA_URL_SIGNING_KEY: SIGNING_KEY };
    const strict = await startApi(env);
    const token = (tenantKey, assetId, extra = {}) => signMediaToken({ tenantKey, assetId, ...extra }, env);

    const ok = await fetchFile(strict.baseUrl, assetB, `?t=${token(tenantB, assetB)}`);
    assert.equal(ok.status, 200, `a valid token must serve the non-default tenant's asset (got ${ok.status}); API tail: ${strict.output.join("").slice(-500)}`);
    assert.ok(ok.body.equals(PNG), "the bytes served are exactly the non-default tenant's file");
    assert.equal(ok.type, "image/png");
    console.log("PASS B1. with the key, a valid token serves the NON-default tenant's image under the restricted role; bytes match");

    const refused = [
      ["no token", await fetchFile(strict.baseUrl, assetB)],
      ["a token for another asset", await fetchFile(strict.baseUrl, assetB, `?t=${token(tenantB, assetOther)}`)],
      ["an expired token", await fetchFile(strict.baseUrl, assetB, `?t=${token(tenantB, assetB, { nowMs: Date.now() - 30 * 24 * 3600 * 1000 })}`)],
      ["garbage", await fetchFile(strict.baseUrl, assetB, "?t=not-a-token")],
      ["the default tenant's asset without a token", await fetchFile(strict.baseUrl, assetDefault)],
    ];
    for (const [label, result] of refused) {
      assert.equal(result.status, 401, `${label} must be refused with 401 (got ${result.status})`);
      assert.ok(!result.body.equals(PNG) && !result.body.equals(PNG_DEFAULT), `${label} must not serve any bytes`);
    }
    const wrongTenant = await fetchFile(strict.baseUrl, assetB, `?t=${token("some-other-tenant", assetB)}`);
    assert.equal(wrongTenant.status, 404, `a token naming ANOTHER tenant must not find this tenant's asset (got ${wrongTenant.status})`);
    assert.ok(!wrongTenant.body.equals(PNG), "no bytes leak to another tenant's token");
    const okDefault = await fetchFile(strict.baseUrl, assetDefault, `?t=${token("default", assetDefault)}`);
    assert.equal(okDefault.status, 200, "the default tenant's asset is served with its own token");
    assert.ok(okDefault.body.equals(PNG_DEFAULT));
    console.log("PASS B2. with the key, no token / wrong asset / expired / garbage are 401 with no bytes; another tenant's token finds nothing (404); the default tenant works with its own token");

    const sessions = await admin.$queryRawUnsafe(`SELECT DISTINCT usename FROM pg_stat_activity WHERE datname = $1 AND application_name = 'vexa-pim-api-restricted'`, dbName);
    assert.ok(sessions.length > 0 && sessions.every((s) => s.usename === ROLE), `the API must have connected as ${ROLE} (saw ${JSON.stringify(sessions)})`);
    console.log("media public-file token integration test passed.");
  } finally {
    for (const child of children) {
      child.kill("SIGKILL");
    }
    await sleep(500);
    for (const file of files) {
      fs.rmSync(file, { force: true });
    }
    if (admin) {
      await admin.$disconnect().catch(() => undefined);
    }
    await adminMain.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => undefined);
    await adminMain.$disconnect().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("media public-file token integration test failed:");
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
