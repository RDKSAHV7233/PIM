#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001 (class C, Stripe): the webhook's customer-to-tenant lookup finds a NON-default tenant's customer under a restricted
 * (NOSUPERUSER, NOBYPASSRLS, non-owner) role.
 *
 * Before the change the lookup was one query on TenantPlanProfile through a client with no tenant context. Under row level security
 * that client sees only the default tenant's profile, so an invoice or subscription event for any other tenant's customer resolved to
 * "no tenant", was logged and acknowledged, and billing state was never updated. This test builds the real StripeService in a child
 * process whose database environment is the restricted role, in a dedicated throwaway database (migrated here, dropped after).
 * Nothing contacts Stripe: only the database lookup is exercised.
 *
 * It also proves the fixture is sensitive: the old context-free query, run in the same child, finds the default tenant's customer and
 * NOT the others', so a regression to it fails the assertions below.
 */
const assert = require("node:assert/strict");
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

async function main() {
  const runId = Date.now().toString();
  const dbName = `stripecus_${runId}`;
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

    // ---- seed (as admin): two directory tenants and the default tenant, each with a Stripe customer ------------------------------
    const T = { a: `sc-a-${runId}`, b: `sc-b-${runId}`, d: "default" };
    for (const [i, tenantKey] of [T.a, T.b].entries()) {
      await admin.workspaceDirectory.create({ data: { tenantKey, workspaceSlug: `sc-${runId.slice(-6)}-${i}`, displayName: `StripeCus ${i}` } });
    }
    const customers = { [T.a]: `cus_a_${runId}`, [T.b]: `cus_b_${runId}`, [T.d]: `cus_d_${runId}` };
    for (const tenantKey of [T.a, T.b, T.d]) {
      await admin.tenantPlanProfile.upsert({
        where: { tenantKey },
        create: { tenantKey, planTier: "STARTER", billingStatus: "trial", accessStatus: "active", externalCustomerId: customers[tenantKey] },
        update: { externalCustomerId: customers[tenantKey] },
      });
    }
    console.log("PASS 1. fixture seeded: a Stripe customer on each of two non-default directory tenants and on the default tenant");

    // ---- the real service, in a child process whose database environment is the restricted role -----------------------------------
    const code = `
      const { PrismaService } = require(${JSON.stringify(path.join(DIST, "prisma", "prisma.service.js"))});
      const { PrismaDirectService } = require(${JSON.stringify(path.join(DIST, "prisma", "prisma-direct.service.js"))});
      const { StripeService } = require(${JSON.stringify(path.join(DIST, "billing", "stripe.service.js"))});
      (async () => {
        const direct = new PrismaDirectService();
        await direct.onModuleInit();
        const prisma = new PrismaService();
        const [who] = await direct.getClient().$queryRawUnsafe("SELECT (rolsuper OR rolbypassrls) AS privileged, current_user AS name FROM pg_roles WHERE rolname = current_user");
        const service = new StripeService(prisma, direct);
        const customers = ${JSON.stringify(customers)};
        const resolved = {};
        for (const [tenantKey, customerId] of Object.entries(customers)) {
          resolved[tenantKey] = await service.resolveTenantKeyFromCustomerId(customerId);
        }
        const unknown = await service.resolveTenantKeyFromCustomerId("cus_unknown_${runId}");
        // the former lookup, for comparison: one query with no tenant context
        const oldLookup = {};
        for (const [tenantKey, customerId] of Object.entries(customers)) {
          const rows = await prisma.tenant().$queryRawUnsafe('SELECT "tenantKey" FROM "TenantPlanProfile" WHERE "externalCustomerId" = $1 LIMIT 1', customerId);
          oldLookup[tenantKey] = rows[0] ? rows[0].tenantKey : null;
        }
        console.log("RESULT:" + JSON.stringify({ who, resolved, unknown, oldLookup }));
        await direct.onModuleDestroy().catch(() => undefined);
        await prisma.onModuleDestroy().catch(() => undefined);
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
      },
      encoding: "utf8",
    });
    assert.equal(run.status, 0, `child failed: ${String(run.stdout).slice(-400)} ${String(run.stderr).slice(-600)}`);
    const line = String(run.stdout).split("\n").find((l) => l.startsWith("RESULT:"));
    assert.ok(line, "the child must print a RESULT line");
    const { who, resolved, unknown, oldLookup } = JSON.parse(line.slice("RESULT:".length));
    assert.equal(who.privileged, false, `the service must run as the restricted role (saw ${JSON.stringify(who)})`);
    assert.equal(who.name, ROLE);
    console.log("PASS 2. the service ran as the restricted role (not a superuser, not BYPASSRLS)");

    // ---- the fixture is sensitive: the old context-free lookup sees the default tenant only ----------------------------------------
    assert.equal(oldLookup[T.d], T.d, "the old lookup finds the default tenant's customer");
    assert.equal(oldLookup[T.a], null, "the old lookup does NOT find tenant A's customer under the restricted role");
    assert.equal(oldLookup[T.b], null, "the old lookup does NOT find tenant B's customer under the restricted role");
    console.log("PASS 3. the former context-free lookup resolves only the default tenant's customer (the bug this fixes)");

    // ---- the new lookup resolves every tenant's customer -------------------------------------------------------------------------------
    assert.equal(resolved[T.a], T.a, "tenant A's customer resolves to tenant A");
    assert.equal(resolved[T.b], T.b, "tenant B's customer resolves to tenant B");
    assert.equal(resolved[T.d], T.d, "the default tenant's customer resolves to the default tenant");
    assert.equal(unknown, null, "an unknown customer resolves to no tenant when every tenant was readable");
    console.log("PASS 4. a webhook for a non-default tenant's customer resolves to that tenant; an unknown customer to none");
    console.log("stripe customer tenant resolution restricted-role integration test passed.");
  } finally {
    if (admin) {
      await admin.$disconnect().catch(() => undefined);
    }
    await adminMain.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => undefined);
    await adminMain.$disconnect().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("stripe customer tenant resolution restricted-role integration test failed:");
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
