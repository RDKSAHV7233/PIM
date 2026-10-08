#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001 P2.6b: the internal-ops watchdogs (stuck jobs, auth-email job failures) count the jobs and events of EVERY tenant
 * under a restricted (NOSUPERUSER, NOBYPASSRLS, non-owner) role, and record their alert state in the global ops_alert_states table.
 *
 * Before the change both counts were single platform-wide queries through the context-free direct client. Under row level security
 * that client sees no tenant's rows, so the counts would always be zero: no stuck job and no burst of failed auth emails could ever
 * raise an alert, and every healthy-looking evaluation would also reset the alert's breach state. This test builds the real service
 * in a child process whose database environment is the restricted role, in a dedicated throwaway database (migrated here, dropped
 * after). Alert delivery is stubbed (a recording queue), so nothing is sent anywhere.
 *
 * Fixture: stuck jobs and failed-auth-email events spread over two non-default directory tenants and the default tenant, where NO
 * single tenant is over the auth-email threshold on its own; only the sum is.
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
  const dbName = `opsalert_${runId}`;
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
    const T = { a: `oa-a-${runId}`, b: `oa-b-${runId}`, c: `oa-c-${runId}`, d: "default" };
    for (const [i, tenantKey] of [T.a, T.b, T.c].entries()) {
      await admin.workspaceDirectory.create({ data: { tenantKey, workspaceSlug: `oa-${runId.slice(-6)}-${i}`, displayName: `OpsAlert ${i}` } });
    }
    const parents = {};
    for (const tenantKey of [T.a, T.b]) {
      const category = await admin.category.create({ data: { tenantKey, name: `Cat ${tenantKey}`, slug: `cat-${tenantKey}`, path: `cat-${tenantKey}` } });
      const product = await admin.product.create({ data: { tenantKey, title: `P ${tenantKey}`, categoryId: category.id, status: "approved" } });
      parents[tenantKey] = { categoryId: category.id, productId: product.id };
    }
    let n = 0;
    // Stuck = still active and last updated between 30 days and 6 hours ago. Twelve hours ago is stuck; just now is not.
    const exportJob = async (tenantKey, hoursAgo) => {
      const id = `ej_${runId}_${(n += 1)}`;
      await admin.marketplaceExportJob.create({ data: { id, tenantKey, productId: parents[tenantKey].productId, categoryId: parents[tenantKey].categoryId, channel: "shopify", status: "queued" } });
      await admin.$executeRawUnsafe(`UPDATE "MarketplaceExportJob" SET "updatedAt" = NOW() - ($2 || ' hours')::interval WHERE id = $1`, id, String(hoursAgo));
    };
    const importJob = async (tenantKey, hoursAgo) => {
      const id = `ij_${runId}_${(n += 1)}`;
      await admin.bulkImportJob.create({ data: { id, tenantKey, categoryId: parents[tenantKey].categoryId, sourceFormat: "csv", mapping: {}, status: "queued" } });
      await admin.$executeRawUnsafe(`UPDATE "BulkImportJob" SET "updatedAt" = NOW() - ($2 || ' hours')::interval WHERE id = $1`, id, String(hoursAgo));
    };
    await exportJob(T.a, 12);
    await exportJob(T.b, 12);
    await exportJob(T.b, 12);
    await importJob(T.b, 12);
    await exportJob(T.a, 0); // updated just now: not stuck
    const kpi = (tenantKey, minutesAgo) =>
      admin.$executeRawUnsafe(
        `INSERT INTO kpi_metric_events (id, tenant_key, metric_key, metric_value, tags, observed_at) VALUES ($1, $2, 'auth.email.job_failed', 1, '{}'::jsonb, NOW() - ($3 || ' minutes')::interval)`,
        `kpi_${runId}_${(n += 1)}`,
        tenantKey,
        String(minutesAgo),
      );
    await kpi(T.a, 1);
    await kpi(T.a, 2);
    await kpi(T.b, 1);
    await kpi(T.b, 3);
    await kpi(T.d, 1);
    await kpi(T.a, 60); // an hour ago: outside the 15 minute window
    console.log("PASS 1. fixture seeded: 3 stuck export jobs and 1 stuck import job over tenants A and B (plus a fresh one), 5 recent failed auth-email events over A, B and the default tenant (no tenant over the threshold alone)");

    // ---- the real service, in a child process whose database environment is the restricted role ------------------------------------------
    const code = `
      const { PrismaDirectService } = require(${JSON.stringify(path.join(DIST, "prisma", "prisma-direct.service.js"))});
      const { InternalOpsAlertsService } = require(${JSON.stringify(path.join(DIST, "internal-ops", "internal-ops-alerts.service.js"))});
      (async () => {
        const direct = new PrismaDirectService();
        await direct.onModuleInit();
        const [who] = await direct.getClient().$queryRawUnsafe("SELECT (rolsuper OR rolbypassrls) AS privileged, current_user AS name FROM pg_roles WHERE rolname = current_user");
        const enqueued = [];
        const queue = { enqueue: async (name, payload) => { enqueued.push({ name, type: payload && payload.envelope && payload.envelope.alertType, envelope: payload && payload.envelope }); }, processWithBackpressure() {} };
        const warnings = [];
        const logger = { info() {}, error() {}, log() {}, warn: (m) => warnings.push(String(m)) };
        const service = new InternalOpsAlertsService(direct, { get: () => queue }, logger);
        const stuck = await service.evaluateStuckJobs(new Date());
        const authEmail = await service.evaluateAuthEmailJobFailures(new Date());
        console.log("RESULT:" + JSON.stringify({ who, stuck, authEmail, enqueued, warnings }));
        await direct.onModuleDestroy().catch(() => undefined);
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
        OPS_ALERT_WEBHOOK_URL: "http://127.0.0.1:9/never-called",
        PIM_WEB_BASE_URL: "https://ops.vexa.test",
      },
      encoding: "utf8",
    });
    assert.equal(run.status, 0, `child failed: ${String(run.stdout).slice(-400)} ${String(run.stderr).slice(-600)}`);
    const line = String(run.stdout).split("\n").find((l) => l.startsWith("RESULT:"));
    assert.ok(line, "the child must print a RESULT line");
    const { who, stuck, authEmail, enqueued, warnings } = JSON.parse(line.slice("RESULT:".length));
    assert.equal(who.privileged, false, `the service must run as the restricted role (saw ${JSON.stringify(who)})`);
    assert.equal(who.name, ROLE);
    assert.deepEqual(warnings, [], `neither evaluation may fail open (saw ${JSON.stringify(warnings)})`);
    console.log("PASS 2. the service ran as the restricted role (not a superuser, not BYPASSRLS) and neither evaluation failed open");

    // ---- the stuck-job watchdog sees every tenant ------------------------------------------------------------------------------------------------
    assert.equal(stuck.stuckCount, 4, "3 stuck exports (A 1, B 2) + 1 stuck import (B 1); the job updated just now is not stuck");
    assert.equal(stuck.alerted, true);
    assert.equal(stuck.reason, "queued");
    const stuckAlert = enqueued.find((e) => e.type === "stuck_jobs_threshold_exceeded");
    assert.ok(stuckAlert, "a stuck-jobs alert must have been queued");
    assert.equal(stuckAlert.envelope.stuckExportCount, 3);
    assert.equal(stuckAlert.envelope.stuckImportCount, 1);
    console.log("PASS 3. the stuck-job watchdog counted 4 stuck jobs across tenants A and B and queued its alert");

    // ---- the auth-email watchdog sums the tenants before comparing with the threshold ------------------------------------------------------------
    assert.equal(authEmail.failureCount, 5, "A 2 + B 2 + default 1 within the 15 minute window; the hour-old event is outside it");
    assert.equal(authEmail.alerted, true, "5 exceeds the threshold of 3 in total although no tenant exceeds it alone");
    assert.ok(enqueued.find((e) => e.type === "auth_email_job_failure_threshold_exceeded"), "an auth-email failure alert must have been queued");
    console.log("PASS 4. the auth-email watchdog counted 5 recent failures across tenants and queued its alert");

    // ---- the global alert-state table works under the restricted role ----------------------------------------------------------------------------
    const states = await admin.$queryRawUnsafe(`SELECT alert_key AS key, alert_type AS type, last_sent_at AS "lastSentAt", cooldown_until AS cooldown FROM ops_alert_states ORDER BY alert_key`);
    const keys = states.map((s) => s.key);
    assert.ok(keys.some((k) => /stuck/.test(k)), `a stuck-jobs alert state must be recorded (saw ${keys.join(", ")})`);
    assert.ok(keys.some((k) => /auth/.test(k)), `an auth-email alert state must be recorded (saw ${keys.join(", ")})`);
    assert.ok(states.every((s) => s.lastSentAt !== null && s.cooldown !== null), "each recorded alert state carries its send time and cooldown");
    console.log("PASS 5. the global ops_alert_states table recorded both alerts with their cooldowns, written under the restricted role");
    console.log("internal-ops alerts restricted-role integration test passed.");
  } finally {
    if (admin) {
      await admin.$disconnect().catch(() => undefined);
    }
    await adminMain.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => undefined);
    await adminMain.$disconnect().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("internal-ops alerts restricted-role integration test failed:");
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
