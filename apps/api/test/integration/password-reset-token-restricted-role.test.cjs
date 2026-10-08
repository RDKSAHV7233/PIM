#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001 P2.8c: confirming a password reset works for a NON-default tenant's recovery token under a restricted
 * (NOSUPERUSER, NOBYPASSRLS, non-owner) role.
 *
 * AuthRecoveryToken is tenant-keyed and row-level-secured, but the reset link carries only the token, so the tenant is unknown until
 * the token is found. Before the change the lookup (and the writes) went through the context-free direct client; under row level
 * security that sees the default tenant's tokens only, so every other tenant's reset link read as PASSWORD_RESET_TOKEN_INVALID and
 * nobody outside the default tenant could recover an account. This test builds the real AuthService in a child process whose database
 * environment is the restricted role, in a dedicated throwaway database (migrated here, dropped after). Only the collaborators that
 * confirmPasswordReset never uses for the database are stubbed (audit, blocklist, queue, directory alias).
 */
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
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

const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");

async function main() {
  const runId = Date.now().toString();
  const dbName = `pwreset_${runId}`;
  const adminMain = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
  let admin = null;

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
    assert.equal(grant.status, 0, `restricted role setup failed: ${String(grant.stdout).slice(-300)} ${String(grant.stderr).slice(-300)}`);
    const restrictedUrl = urlFor(dbName, ROLE, ROLE_PASSWORD);
    admin = new PrismaClient({ datasources: { db: { url: dbAdminUrl } } });
    console.log(`PASS 0. isolated database ${dbName} migrated; role ${ROLE} granted`);

    // ---- seed (as admin): an identity and a live reset token on two non-default tenants and the default tenant -------------------
    const T = { a: `pw-a-${runId}`, b: `pw-b-${runId}`, d: "default" };
    for (const [i, tenantKey] of [T.a, T.b].entries()) {
      await admin.workspaceDirectory.create({ data: { tenantKey, workspaceSlug: `pw-${runId.slice(-6)}-${i}`, displayName: `PwReset ${i}` } });
    }
    const users = { [T.a]: `a.${runId}@example.test`, [T.b]: `b.${runId}@example.test`, [T.d]: `d.${runId}@example.test` };
    const raw = { [T.a]: `rawtoken-a-${runId}`, [T.b]: `rawtoken-b-${runId}`, [T.d]: `rawtoken-d-${runId}` };
    const oldHash = "$2a$12$oldoldoldoldoldoldoldeuoldoldoldoldoldoldoldoldoldoldold";
    for (const tenantKey of [T.a, T.b, T.d]) {
      await admin.authIdentity.create({ data: { id: `ident_${tenantKey}`, tenantKey, userId: users[tenantKey], role: "admin", isActive: true, passwordHash: oldHash, lockedUntil: new Date(Date.now() + 3600 * 1000) } });
      await admin.authRecoveryToken.create({
        data: { id: `recovery_${tenantKey}`, tenantKey, userId: users[tenantKey], purpose: "password_reset", tokenHash: sha256(raw[tenantKey]), expiresAt: new Date(Date.now() + 3600 * 1000) },
      });
    }
    // an expired token and an already-used token, both on tenant B
    await admin.authRecoveryToken.create({ data: { id: `recovery_expired_${runId}`, tenantKey: T.b, userId: users[T.b], purpose: "password_reset", tokenHash: sha256(`expired-${runId}`), expiresAt: new Date(Date.now() - 1000) } });
    await admin.authRecoveryToken.create({ data: { id: `recovery_used_${runId}`, tenantKey: T.b, userId: users[T.b], purpose: "password_reset", tokenHash: sha256(`used-${runId}`), expiresAt: new Date(Date.now() + 3600 * 1000), usedAt: new Date() } });
    console.log("PASS 1. fixture seeded: an identity and a live reset token on two non-default tenants and the default tenant, plus an expired and a used token");

    // ---- the real service, in a child process whose database environment is the restricted role ------------------------------------------
    const code = `
      const { PrismaService } = require(${JSON.stringify(path.join(DIST, "prisma", "prisma.service.js"))});
      const { PrismaDirectService } = require(${JSON.stringify(path.join(DIST, "prisma", "prisma-direct.service.js"))});
      const { AuthService } = require(${JSON.stringify(path.join(DIST, "auth", "auth.service.js"))});
      (async () => {
        const direct = new PrismaDirectService();
        await direct.onModuleInit();
        const prisma = new PrismaService();
        const [who] = await direct.getClient().$queryRawUnsafe("SELECT (rolsuper OR rolbypassrls) AS privileged, current_user AS name FROM pg_roles WHERE rolname = current_user");
        const stub = {};
        const service = new AuthService(
          { revokeCredentials: async () => undefined }, // jwtBlocklistService
          prisma,
          direct,
          { record: async () => undefined }, // auditService
          { resolveTenantAlias: async (tenantKey) => ({ workspaceSlug: "ws-" + tenantKey }) }, // tenantDirectoryService
          { process() {} }, // queueService
          stub, stub, stub, stub, stub, stub, // authEmail, authExportStorage, planUsage, authPolicy, mfa, metrics
        );
        const attempt = async (token) => {
          try {
            const r = await service.confirmPasswordReset(token, "A-brand-new-password-1");
            return { ok: true, workspaceSlug: r.workspaceSlug };
          } catch (e) {
            return { ok: false, error: (e && e.response && e.response.error) || String(e && e.message) };
          }
        };
        const raw = ${JSON.stringify(raw)};
        const results = {};
        for (const [tenantKey, token] of Object.entries(raw)) results[tenantKey] = await attempt(token);
        const garbage = await attempt("not-a-token");
        const expired = await attempt(${JSON.stringify("expired-" + runId)});
        const used = await attempt(${JSON.stringify("used-" + runId)});
        const reuse = await attempt(raw[${JSON.stringify(T.b)}]);
        // the former lookup, for comparison: no tenant context
        const old = {};
        for (const [tenantKey, token] of Object.entries(raw)) {
          const row = await direct.getClient().authRecoveryToken.findUnique({ where: { tokenHash: require("node:crypto").createHash("sha256").update(token, "utf8").digest("hex") } });
          old[tenantKey] = row ? row.id : null;
        }
        console.log("RESULT:" + JSON.stringify({ who, results, garbage, expired, used, reuse, old }));
        await direct.onModuleDestroy().catch(() => undefined);
        await prisma.onModuleDestroy().catch(() => undefined);
        process.exit(0);
      })().catch((e) => { console.error("CHILD-ERROR:" + (e && e.stack || e)); process.exit(1); });
    `;
    const run = spawnSync(process.execPath, ["-e", code], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: restrictedUrl,
        DATABASE_URL_DIRECT: restrictedUrl,
        DATABASE_URL_POOLED: restrictedUrl,
        VEXA_RESTRICTED_DATABASE_URL: "",
        AUTH_MODE: "local",
        APP_ENV: "test",
        PIM_AUTH_REDIS_DISABLED: "true",
        JWT_BLOCKLIST_REDIS_DISABLED: "true",
      },
      encoding: "utf8",
    });
    assert.equal(run.status, 0, `child failed: ${String(run.stdout).slice(-400)} ${String(run.stderr).slice(-800)}`);
    const line = String(run.stdout).split("\n").find((l) => l.startsWith("RESULT:"));
    assert.ok(line, "the child must print a RESULT line");
    const { who, results, garbage, expired, used, reuse, old } = JSON.parse(line.slice("RESULT:".length));
    assert.equal(who.privileged, false, `the service must run as the restricted role (saw ${JSON.stringify(who)})`);
    assert.equal(who.name, ROLE);
    console.log("PASS 2. the service ran as the restricted role (not a superuser, not BYPASSRLS)");

    // ---- the fixture is sensitive: the former context-free lookup finds the default tenant's token only -------------------------------
    assert.equal(old[T.d], `recovery_${T.d}`, "the former lookup finds the default tenant's token");
    assert.equal(old[T.a], null, "the former lookup does NOT find tenant A's token under the restricted role");
    assert.equal(old[T.b], null, "the former lookup does NOT find tenant B's token under the restricted role");
    console.log("PASS 3. the former context-free lookup finds the default tenant's token only (the bug this fixes)");

    // ---- every tenant's reset completes, with the tenant's own workspace -----------------------------------------------------------------
    for (const tenantKey of [T.a, T.b, T.d]) {
      assert.equal(results[tenantKey].ok, true, `the reset for ${tenantKey} must succeed (saw ${JSON.stringify(results[tenantKey])})`);
      assert.equal(results[tenantKey].workspaceSlug, `ws-${tenantKey}`);
      const [identity] = await admin.$queryRawUnsafe(`SELECT "passwordHash" AS hash, "lockedUntil" AS locked FROM "AuthIdentity" WHERE "tenantKey" = $1`, tenantKey);
      assert.notEqual(identity.hash, oldHash, `the password of ${tenantKey} must be replaced`);
      assert.equal(identity.locked, null, `the lock of ${tenantKey} must be cleared`);
      const [token] = await admin.$queryRawUnsafe(`SELECT "usedAt" AS used FROM "AuthRecoveryToken" WHERE id = $1`, `recovery_${tenantKey}`);
      assert.ok(token.used, `the token of ${tenantKey} must be marked used`);
    }
    console.log("PASS 4. a reset for each of two non-default tenants and the default tenant replaced the password, cleared the lock and consumed the token");

    // ---- unchanged semantics --------------------------------------------------------------------------------------------------------------------
    for (const [label, outcome] of [["garbage", garbage], ["expired", expired], ["used", used], ["reuse", reuse]]) {
      assert.deepEqual(outcome, { ok: false, error: "PASSWORD_RESET_TOKEN_INVALID" }, `${label} token must be invalid (saw ${JSON.stringify(outcome)})`);
    }
    console.log("PASS 5. a garbage, an expired, a used and an already-consumed token are all still PASSWORD_RESET_TOKEN_INVALID");
    console.log("password reset token restricted-role integration test passed.");
  } finally {
    if (admin) {
      await admin.$disconnect().catch(() => undefined);
    }
    await adminMain.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => undefined);
    await adminMain.$disconnect().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("password reset token restricted-role integration test failed:");
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
