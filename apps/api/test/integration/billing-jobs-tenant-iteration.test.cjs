#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001 I-3: the scheduled billing jobs reach EVERY tenant under a restricted (NOSUPERUSER, NOBYPASSRLS, non-owner) role.
 *
 * A real API process runs as the restricted role, in a dedicated throwaway database (migrated here, dropped after) so the jobs'
 * writes cannot disturb other tests. Both jobs have their boot delay shortened by environment variable.
 *
 * Every assertion is on rows that must really exist: the fixture is seeded with NON-DEFAULT tenants that must be suspended or
 * reminded, the jobs must DISCOVER them, and the jobs must ACT (the profile is suspended and an audit row written; the admin gets an
 * in-app notification). A job that finds nothing, or finds only the default tenant, fails this test. Tenants that must NOT be touched
 * (grace period not over, paying, trial not at a threshold) are asserted untouched.
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
const DAY = 24 * 60 * 60 * 1000;

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
  const dbName = `billjobs_${runId}`;
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
    const T = {
      graceA: `bj-grace-a-${runId}`,
      graceB: `bj-grace-b-${runId}`,
      graceLeft: `bj-grace-left-${runId}`,
      paid: `bj-paid-${runId}`,
      trialA: `bj-trial-a-${runId}`,
      trialFar: `bj-trial-far-${runId}`,
    };
    const directory = Object.values(T);
    for (const [i, tenantKey] of directory.entries()) {
      await admin.workspaceDirectory.create({ data: { tenantKey, workspaceSlug: `bj-${runId.slice(-6)}-${i}`, displayName: `Billing ${i}` } });
    }
    const profile = (tenantKey, fields) =>
      admin.$executeRawUnsafe(
        `INSERT INTO "TenantPlanProfile" ("id", "tenantKey", "planTier", "billingStatus", "accessStatus", "trialEndsAt", "graceEndsAt", "billingContactEmail", "createdAt", "updatedAt")
         VALUES ($1, $2, 'STARTER', $3, $4, $5, $6, $7, NOW(), NOW())`,
        `tpp_${tenantKey}`,
        tenantKey,
        fields.billingStatus,
        fields.accessStatus ?? "active",
        fields.trialEndsAt ?? null,
        fields.graceEndsAt ?? null,
        `${tenantKey}@example.test`,
      );
    await profile(T.graceA, { billingStatus: "past_due", graceEndsAt: new Date(Date.now() - DAY) });
    await profile(T.graceB, { billingStatus: "past_due", graceEndsAt: new Date(Date.now() - 2 * DAY) });
    await profile(T.graceLeft, { billingStatus: "past_due", graceEndsAt: new Date(Date.now() + 3 * DAY) });
    await profile(T.paid, { billingStatus: "active", graceEndsAt: new Date(Date.now() - DAY) });
    await profile(T.trialA, { billingStatus: "trial", trialEndsAt: new Date(Date.now() + 6.5 * DAY) }); // 7 days left: reminder threshold
    await profile(T.trialFar, { billingStatus: "trial", trialEndsAt: new Date(Date.now() + 4 * DAY) }); // not a threshold
    for (const tenantKey of [T.trialA, T.trialFar, T.graceA]) {
      await admin.authIdentity.create({ data: { tenantKey, userId: `admin-${tenantKey}@example.test`, role: "admin", isActive: true } });
    }
    const status = async (tenantKey) => (await admin.$queryRawUnsafe(`SELECT "accessStatus", "suspensionReason" FROM "TenantPlanProfile" WHERE "tenantKey" = $1`, tenantKey))[0];
    assert.equal((await status(T.graceA)).accessStatus, "active");
    assert.equal((await status(T.graceB)).accessStatus, "active");
    console.log("PASS 1. fixture seeded: two expired-grace tenants, one still in grace, one paying, a trial at 7 days, a trial at 4 days");

    // ---- a real API process as the restricted role, boot delays shortened ------------------------------------------------------
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
        GRACE_PERIOD_ESCALATION_INITIAL_DELAY_MS: "500",
        COMMERCIAL_REMINDERS_INITIAL_DELAY_MS: "500",
        CONNECTOR_HEARTBEAT_DISABLED: "true",
        PIM_ALLOW_LEGACY_HEADERS: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [api.stdout, api.stderr]) {
      stream.on("data", (chunk) => {
        apiOutput.push(String(chunk));
        if (apiOutput.length > 600) {
          apiOutput.shift();
        }
      });
    }
    await waitForHealth(baseUrl, 90_000);

    // ---- the jobs must discover and act -------------------------------------------------------------------------------------------
    const notificationsFor = (tenantKey) => admin.$queryRawUnsafe(`SELECT id, event_type AS "eventType" FROM user_notifications WHERE tenant_key = $1`, tenantKey);
    const deadline = Date.now() + 60_000;
    let a;
    let b;
    let remindedA = [];
    while (Date.now() < deadline) {
      a = await status(T.graceA);
      b = await status(T.graceB);
      remindedA = await notificationsFor(T.trialA);
      if (a.accessStatus === "suspended" && b.accessStatus === "suspended" && remindedA.length > 0) {
        break;
      }
      await sleep(500);
    }
    const tail = apiOutput.join("").slice(-700);
    assert.equal(a.accessStatus, "suspended", `grace-period job must suspend the non-default tenant ${T.graceA} (still ${a.accessStatus}); API output tail: ${tail}`);
    assert.equal(b.accessStatus, "suspended", `grace-period job must suspend the non-default tenant ${T.graceB}`);
    assert.equal(a.suspensionReason, "grace_period_expired");
    console.log("PASS 2. grace-period job (restricted role) suspended BOTH expired non-default tenants");

    assert.ok(remindedA.length > 0, `reminders job must create the in-app trial-ending notification for the non-default tenant ${T.trialA}; API output tail: ${tail}`);
    assert.ok(remindedA.every((n) => n.eventType === "trial.ending"));
    assert.equal((await notificationsFor(T.trialFar)).length, 0, "a trial that is not at a threshold gets no reminder");
    console.log("PASS 3. reminders job (restricted role) created the trial-ending notification for the non-default tenant at 7 days, and none for the tenant at 4 days");

    // ---- tenants that must NOT be touched ----------------------------------------------------------------------------------------
    assert.equal((await status(T.graceLeft)).accessStatus, "active", "a tenant still inside its grace period stays active");
    assert.equal((await status(T.paid)).accessStatus, "active", "a paying tenant stays active");
    const audits = await admin.$queryRawUnsafe(`SELECT tenant_key AS "tenantKey" FROM audit_logs WHERE action = 'TENANT_SUSPENDED_GRACE_EXPIRED'`);
    const audited = audits.map((r) => r.tenantKey).sort();
    assert.deepEqual(audited, [T.graceA, T.graceB].sort(), "exactly the two suspended tenants have an audit row (once each: no duplicate per iteration)");
    console.log("PASS 4. untouched tenants stayed active; exactly one audit row per suspended tenant");

    const sessions = await admin.$queryRawUnsafe(`SELECT DISTINCT usename FROM pg_stat_activity WHERE datname = $1 AND application_name = 'vexa-pim-api-restricted'`, dbName);
    assert.ok(sessions.length > 0 && sessions.every((s) => s.usename === ROLE), `the API must have connected as ${ROLE} (saw ${JSON.stringify(sessions)})`);
    console.log("billing-jobs tenant-iteration integration test passed.");
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
  console.error("billing-jobs tenant-iteration integration test failed:");
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
