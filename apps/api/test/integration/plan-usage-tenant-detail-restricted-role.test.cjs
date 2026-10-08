#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001 P2.1b-i: the internal commercial tenant-detail view reads each tenant's plan, usage and connectors under a restricted
 * (NOSUPERUSER, NOBYPASSRLS, non-owner) role, and one tenant's view never contains another tenant's data.
 *
 * Before the change, getTenantDetail read TenantPlanProfile, PlanUsage and connector_installations through the context-free direct
 * client. Under row level security that client sees none of their rows, so the view silently showed a default TRIAL plan, zero usage and
 * no connectors for every tenant. This test builds the real service in a child process whose database environment is the restricted
 * role, in a dedicated throwaway database (migrated here, dropped after), and asks it for two non-default tenants that have different
 * plans, usage, connectors and users, plus a directory tenant with no commercial data.
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
  const dbName = `tdetail_${runId}`;
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

    // ---- seed (as admin) ---------------------------------------------------------------------------------------------------
    const T = { a: `td-a-${runId}`, b: `td-b-${runId}`, c: `td-c-${runId}` };
    const month = new Date().toISOString().slice(0, 7);
    for (const [slot, tenantKey] of Object.entries(T)) {
      await admin.workspaceDirectory.create({ data: { tenantKey, workspaceSlug: `td-${slot}-${runId.slice(-6)}`, displayName: `Detail ${slot}` } });
    }
    await admin.tenantPlanProfile.create({ data: { tenantKey: T.a, planTier: "ENTERPRISE", billingStatus: "active_paid", accessStatus: "active", billingContactEmail: "billing-a@example.com" } });
    await admin.tenantPlanProfile.create({ data: { tenantKey: T.b, planTier: "GROWTH", billingStatus: "past_due", accessStatus: "suspended", suspensionReason: "payment overdue" } });
    await admin.planUsage.create({ data: { tenantKey: T.a, month, planTier: "ENTERPRISE", skuCount: 7000, submissionCount: 11, storageGb: 2 } });
    await admin.planUsage.create({ data: { tenantKey: T.b, month, planTier: "GROWTH", skuCount: 300, submissionCount: 4, storageGb: 0.5 } });
    const install = (tenantKey, id) =>
      admin.$executeRawUnsafe(
        `INSERT INTO connector_installations (id, tenant_key, connector_id, account_alias, status, metadata, installed_by, created_at, updated_at)
         VALUES ($1, $2, 'cdef_amazon_in', $1, 'ACTIVE', '{}'::jsonb, 'detail-test', NOW(), NOW())`,
        id,
        tenantKey,
      );
    await install(T.a, `inst_a1_${runId}`);
    await install(T.a, `inst_a2_${runId}`);
    await install(T.b, `inst_b1_${runId}`);
    for (const [tenantKey, userId, role] of [[T.a, `a-admin-${runId}@example.com`, "admin"], [T.a, `a-editor-${runId}@example.com`, "editor"], [T.b, `b-admin-${runId}@example.com`, "admin"]]) {
      await admin.authIdentity.create({ data: { tenantKey, userId, role } });
    }
    console.log("PASS 1. fixture seeded: tenant A (ENTERPRISE, 7000 SKUs, 2 connectors, 2 users), tenant B (GROWTH past due and suspended, 300 SKUs, 1 connector, 1 user), tenant C (directory row only)");

    // ---- the real service, in a child process whose database environment is the restricted role ----------------------------------------
    const code = `
      const { PrismaService } = require(${JSON.stringify(path.join(DIST, "prisma", "prisma.service.js"))});
      const { PrismaDirectService } = require(${JSON.stringify(path.join(DIST, "prisma", "prisma-direct.service.js"))});
      const { PlanUsageService } = require(${JSON.stringify(path.join(DIST, "billing", "plan-usage.service.js"))});
      (async () => {
        const prisma = new PrismaService();
        await prisma.onModuleInit();
        const direct = new PrismaDirectService();
        await direct.onModuleInit();
        const [who] = await direct.getClient().$queryRawUnsafe("SELECT (rolsuper OR rolbypassrls) AS privileged, current_user AS name FROM pg_roles WHERE rolname = current_user");
        const service = new PlanUsageService(prisma, direct, { getOrSet: async (_k, _t, f) => f() });
        const out = { who, detail: {} };
        for (const key of ${JSON.stringify(Object.values(T))}) {
          out.detail[key] = await service.getTenantDetail(key);
        }
        console.log("RESULT:" + JSON.stringify(out));
        await prisma.onModuleDestroy().catch(() => undefined);
        await direct.onModuleDestroy().catch(() => undefined);
      })().catch((e) => { console.error("CHILD-ERROR:" + (e && e.stack || e)); process.exit(1); });
    `;
    const run = spawnSync(process.execPath, ["-e", code], {
      cwd: REPO_ROOT,
      env: { ...process.env, DATABASE_URL: restrictedUrl, DATABASE_URL_DIRECT: restrictedUrl, DATABASE_URL_POOLED: restrictedUrl, VEXA_RESTRICTED_DATABASE_URL: "", AUTH_MODE: "local" },
      encoding: "utf8",
    });
    assert.equal(run.status, 0, `child failed: ${String(run.stdout).slice(-400)} ${String(run.stderr).slice(-600)}`);
    const line = String(run.stdout).split("\n").find((l) => l.startsWith("RESULT:"));
    assert.ok(line, "the child must print a RESULT line");
    const { who, detail } = JSON.parse(line.slice("RESULT:".length));
    assert.equal(who.privileged, false, `the service must run as the restricted role (saw ${JSON.stringify(who)})`);
    assert.equal(who.name, ROLE);
    console.log("PASS 2. the service ran as the restricted role (not a superuser, not BYPASSRLS)");

    // ---- each tenant's view holds its own plan, usage, connectors and users ----------------------------------------------------------------
    const a = detail[T.a];
    const b = detail[T.b];
    const c = detail[T.c];
    assert.ok(a && b && c, "every directory tenant must have a detail view");
    assert.equal(a.commercial.planTier, "ENTERPRISE", "tenant A's plan must not collapse to the default TRIAL");
    assert.equal(a.commercial.billingStatus, "active_paid");
    assert.equal(a.commercial.billingContactEmail, "billing-a@example.com");
    assert.equal(a.usage.skuCount, 7000);
    assert.equal(a.usage.submissionCount, 11);
    assert.equal(a.connectors.total, 2);
    assert.deepEqual(a.connectors.items.map((i) => i.installationId).sort(), [`inst_a1_${runId}`, `inst_a2_${runId}`]);
    assert.equal(a.usage.userCount, 2);
    console.log("PASS 3. tenant A: ENTERPRISE / active_paid, 7000 SKUs, 2 connectors, 2 users");

    assert.equal(b.commercial.planTier, "GROWTH");
    assert.equal(b.commercial.billingStatus, "past_due");
    assert.equal(b.commercial.accessStatus, "suspended");
    assert.equal(b.commercial.suspensionReason, "payment overdue");
    assert.equal(b.usage.skuCount, 300);
    assert.equal(b.connectors.total, 1);
    assert.deepEqual(b.connectors.items.map((i) => i.installationId), [`inst_b1_${runId}`]);
    assert.equal(b.usage.userCount, 1);
    console.log("PASS 4. tenant B: GROWTH / past_due / suspended, 300 SKUs, 1 connector, 1 user, and none of tenant A's data");

    assert.equal(c.connectors.total, 0);
    assert.equal(c.usage.skuCount, 0);
    assert.equal(c.users.total, 0);
    console.log("PASS 5. tenant C (no commercial data) shows empty sections, not another tenant's");
    console.log("plan-usage tenant-detail restricted-role integration test passed.");
  } finally {
    if (admin) {
      await admin.$disconnect().catch(() => undefined);
    }
    await adminMain.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => undefined);
    await adminMain.$disconnect().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("plan-usage tenant-detail restricted-role integration test failed:");
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
