#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001 P2.8b: the platform-operator views of upgrade requests (listing, overview, and the status action that finds a
 * request by id) include NON-default tenants under a restricted (NOSUPERUSER, NOBYPASSRLS, non-owner) role.
 *
 * Before the change each was a query through the context-free direct client with no tenant filter. Under row level security that
 * client sees only the default tenant's requests, so the operator queue would list almost nothing, the overview counts would be
 * wrong, and an operator could not act on another tenant's request (it read as "not found"). This test builds the real service in
 * a child process whose database environment is the restricted role, in a dedicated throwaway database (migrated here, dropped
 * after). The status action used is "acknowledged", which needs no plan change; the write goes through the tenant's own client.
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
  const dbName = `commreq_${runId}`;
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

    // ---- seed (as admin): upgrade requests over two non-default directory tenants and the default tenant ------------------------
    const T = { a: `cr-a-${runId}`, b: `cr-b-${runId}`, d: "default" };
    for (const [i, tenantKey] of [T.a, T.b].entries()) {
      await admin.workspaceDirectory.create({ data: { tenantKey, workspaceSlug: `cr-${runId.slice(-6)}-${i}`, displayName: `CommReq ${i}` } });
    }
    const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000);
    const request = (id, tenantKey, status, createdHoursAgo, requestType = "upgrade") =>
      admin.tenantCommercialRequest.create({
        data: {
          id: `${id}_${runId}`,
          tenantKey,
          requestType,
          status,
          requestedBy: "owner@example.test",
          requesterRole: "admin",
          currentPlanTier: "STARTER",
          requestedPlanTier: "GROWTH",
          currentBillingStatus: "trial",
          currentAccessStatus: "active",
          createdAt: hoursAgo(createdHoursAgo),
        },
      });
    await request("d1", T.d, "open", 1); // fresh
    await request("a1", T.a, "open", 72); // open for 3 days: stale
    await request("a2", T.a, "acknowledged", 24 * 5); // acknowledged for 5 days: stale
    await request("b1", T.b, "open", 2);
    await request("b2", T.b, "resolved", 24 * 20);
    await request("b3", T.b, "open", 3, "storage_limit_overage"); // an overage flag, not an upgrade request
    console.log("PASS 1. fixture seeded: 5 upgrade requests (default 1, A 2, B 2) and one overage flag for B");

    // ---- the real service, in a child process whose database environment is the restricted role ------------------------------------------
    const code = `
      const { PrismaService } = require(${JSON.stringify(path.join(DIST, "prisma", "prisma.service.js"))});
      const { PrismaDirectService } = require(${JSON.stringify(path.join(DIST, "prisma", "prisma-direct.service.js"))});
      const { CommercialRequestsService } = require(${JSON.stringify(path.join(DIST, "billing", "commercial-requests.service.js"))});
      (async () => {
        const direct = new PrismaDirectService();
        await direct.onModuleInit();
        const prisma = new PrismaService();
        const [who] = await direct.getClient().$queryRawUnsafe("SELECT (rolsuper OR rolbypassrls) AS privileged, current_user AS name FROM pg_roles WHERE rolname = current_user");
        // the plan-usage service is only needed to apply a plan change, which "acknowledged" never does
        const service = new CommercialRequestsService(prisma, direct, {});
        const list = await service.listUpgradeRequestsInternal({});
        const listA = await service.listUpgradeRequestsInternal({ tenantKey: ${JSON.stringify(T.a)} });
        const overview = await service.getUpgradeRequestOverviewInternal();
        const acted = await service.updateUpgradeRequestStatusInternal(${JSON.stringify("a1_" + runId)}, "acknowledged", "ops_1");
        // the former listing query, for comparison: no tenant context
        const old = await direct.getClient().tenantCommercialRequest.findMany({ where: { requestType: "upgrade" } });
        console.log("RESULT:" + JSON.stringify({ who, list: list.map((i) => i.id), listA: listA.map((i) => i.id), overview, actedId: acted.item.id, actedStatus: acted.item.status, oldIds: old.map((r) => r.id) }));
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
    const { who, list, listA, overview, actedId, actedStatus, oldIds } = JSON.parse(line.slice("RESULT:".length));
    assert.equal(who.privileged, false, `the service must run as the restricted role (saw ${JSON.stringify(who)})`);
    assert.equal(who.name, ROLE);
    console.log("PASS 2. the service ran as the restricted role (not a superuser, not BYPASSRLS)");

    // ---- the fixture is sensitive: the old context-free query sees the default tenant's request only -----------------------------------
    assert.deepEqual(oldIds, [`d1_${runId}`], "the former query sees only the default tenant's request under the restricted role");
    console.log("PASS 3. the former context-free listing returns the default tenant's request only (the bug this fixes)");

    // ---- listing, overview and action see every tenant ------------------------------------------------------------------------------------
    const expectedIds = ["d1", "b1", "a1", "a2", "b2"].map((id) => `${id}_${runId}`); // newest first
    assert.deepEqual(list, expectedIds, "the listing includes every tenant's upgrade requests, newest first, without the overage flag");
    assert.deepEqual(listA, [`a1_${runId}`, `a2_${runId}`], "the tenant filter reads that tenant only");
    assert.equal(overview.totalRequests, 5);
    assert.equal(overview.openRequests, 3, "d1, a1, b1");
    assert.equal(overview.acknowledgedRequests, 1, "a2");
    assert.equal(overview.resolvedRequests, 1, "b2");
    assert.equal(overview.staleOpenRequests, 1, "a1 (3 days open)");
    assert.equal(overview.staleAcknowledgedRequests, 1, "a2 (5 days acknowledged)");
    assert.equal(overview.attentionRequiredRequests, 2);
    assert.ok(overview.oldestActiveRequestCreatedAt, "the oldest active request is reported");
    console.log("PASS 4. the listing and the overview cover the default tenant and both non-default tenants");

    assert.equal(actedId, `a1_${runId}`);
    assert.equal(actedStatus, "acknowledged");
    const [after] = await admin.$queryRawUnsafe(`SELECT status FROM tenant_commercial_requests WHERE id = $1`, `a1_${runId}`);
    assert.equal(after.status, "acknowledged", "the operator acted on a non-default tenant's request and the write is stored");
    console.log("PASS 5. an operator found and acknowledged a non-default tenant's request under the restricted role");
    console.log("commercial requests restricted-role integration test passed.");
  } finally {
    if (admin) {
      await admin.$disconnect().catch(() => undefined);
    }
    await adminMain.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => undefined);
    await adminMain.$disconnect().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("commercial requests restricted-role integration test failed:");
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
