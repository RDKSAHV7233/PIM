#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001: forEachTenant against a real PostgreSQL, as the restricted role when the lane provides one.
 *
 * Proves, with rows that must actually be found (a green run with zero rows would fail):
 *   1. each tenant's work sees exactly that tenant's row (positive, non-empty);
 *   2. a query that escapes the transaction loses the tenant context (current_setting is empty), which is why the helper never
 *      hands out the base client;
 *   3. more than 50 tenants (the per-tenant client cap) iterate through ONE client's connections, bounded by the concurrency;
 *   4. several invocations at once (several schedulers) all complete, every tenant exactly once, with no pool timeout.
 */
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const { PrismaClient } = require(path.join(REPO_ROOT, "node_modules", "@prisma", "client"));
const { forEachTenant, TENANT_ITERATION_DEFAULT_CONCURRENCY } = require(path.join(REPO_ROOT, "apps", "api", "dist", "common", "tenant", "tenant-iteration.js"));

const ADMIN_URL = String(process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/pim1?schema=public").trim();
const RESTRICTED_URL = String(process.env.VEXA_RESTRICTED_DATABASE_URL || "").trim();
const APP_NAME = `vexa-iter-test-${Date.now()}`;
const TENANT_COUNT = 60; // more than the 50-client cap of PrismaService.tenant()

function withAppName(url) {
  const u = new URL(url);
  u.searchParams.set("application_name", APP_NAME);
  return u.toString();
}

async function main() {
  const runId = Date.now().toString();
  const admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
  const subject = new PrismaClient({ datasources: { db: { url: withAppName(RESTRICTED_URL || ADMIN_URL) } } });
  const tenants = Array.from({ length: TENANT_COUNT }, (_, i) => `iter-${runId}-${String(i).padStart(2, "0")}`);

  try {
    // This proves RLS behaviour, so the subject must not be able to bypass it. Run it through the restricted-role lane, or set
    // VEXA_RESTRICTED_DATABASE_URL to a NOSUPERUSER NOBYPASSRLS role. A privileged role would see every row and prove nothing.
    const [who] = await subject.$queryRawUnsafe(`SELECT current_user AS name, (r.rolsuper OR r.rolbypassrls) AS privileged FROM pg_roles r WHERE r.rolname = current_user`);
    assert.equal(who.privileged, false, `the subject role "${who.name}" bypasses row level security; set VEXA_RESTRICTED_DATABASE_URL to a restricted role`);

    // Seed as the admin identity: one directory entry and one RLS-protected row per tenant.
    for (const [i, tenantKey] of tenants.entries()) {
      await admin.workspaceDirectory.create({
        data: { tenantKey, workspaceSlug: `iter-${runId.slice(-6)}-${i}`, displayName: `Iteration ${i}`, isActive: i % 7 !== 0 },
      });
      await admin.$executeRawUnsafe(`INSERT INTO workflow_sla (id, tenant_key) VALUES ($1, $2)`, `sla-${tenantKey}`, tenantKey);
    }

    // ---- 1. each tenant sees exactly its own row, and the work is not empty ---------------------------------------------------
    const seen = new Map();
    const summary = await forEachTenant(subject, async (tx, tenantKey) => {
      const rows = await tx.$queryRawUnsafe(`SELECT id, tenant_key FROM workflow_sla`);
      seen.set(tenantKey, rows.map((r) => r.tenant_key));
      return { examinedCount: rows.length, changedCount: 0 };
    });
    assert.equal(summary.overall, "SUCCESS", JSON.stringify(summary.results.filter((r) => r.status === "failed")));
    assert.ok(summary.tenantsEvaluated >= TENANT_COUNT + 1, `expected at least ${TENANT_COUNT + 1} tenants (directory + default), got ${summary.tenantsEvaluated}`);
    for (const tenantKey of tenants) {
      assert.deepEqual(seen.get(tenantKey), [tenantKey], `tenant ${tenantKey} must see exactly its own row`);
    }
    const inactive = tenants.filter((_, i) => i % 7 === 0);
    assert.ok(inactive.length > 0 && inactive.every((t) => seen.has(t)), "inactive tenants are iterated too");
    assert.equal(summary.orphanDetection, "UNVERIFIED_BY_RUNTIME_ROLE");
    console.log(`PASS 1. ${TENANT_COUNT} tenants each saw exactly their own row (${RESTRICTED_URL ? "restricted role" : "admin identity"}; ${summary.tenantsEvaluated} evaluated)`);

    // ---- 2. a query outside the transaction has no tenant context ------------------------------------------------------------
    let insideContext = null;
    let escapedContext = null;
    await forEachTenant(
      subject,
      async (tx, tenantKey) => {
        const [inside] = await tx.$queryRawUnsafe(`SELECT current_setting('app.tenant_key', true) AS ctx`);
        const [escaped] = await subject.$queryRawUnsafe(`SELECT current_setting('app.tenant_key', true) AS ctx`);
        if (tenantKey === tenants[0]) {
          insideContext = inside.ctx;
          escapedContext = escaped.ctx;
        }
        return { examinedCount: 0, changedCount: 0 };
      },
      { tenantKeys: [tenants[0]] },
    );
    assert.equal(insideContext, tenants[0], "inside the transaction the tenant context is set");
    assert.ok(!escapedContext, `a query on another connection must have NO tenant context (got "${escapedContext}")`);
    console.log("PASS 2. inside the transaction the tenant is set; an escaping query has none (so the helper never exposes the base client)");

    // ---- 3. >50 tenants run through one client's connections, bounded by the concurrency -------------------------------------
    let peak = 0;
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        const [row] = await admin.$queryRawUnsafe(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = $1`, APP_NAME);
        peak = Math.max(peak, row.n);
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
    })();
    const bounded = await forEachTenant(subject, async (tx) => {
      const rows = await tx.$queryRawUnsafe(`SELECT 1 FROM workflow_sla`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { examinedCount: rows.length, changedCount: 0 };
    });
    sampling = false;
    await sampler;
    assert.equal(bounded.overall, "SUCCESS");
    const connectionBound = TENANT_ITERATION_DEFAULT_CONCURRENCY + 2; // the transactions in flight, plus the directory read and the sampler's slack
    assert.ok(peak <= connectionBound, `peak connections ${peak} must stay within ${connectionBound} for ${bounded.tenantsEvaluated} tenants (per-tenant clients would open far more)`);
    console.log(`PASS 3. ${bounded.tenantsEvaluated} tenants iterated; peak connections observed ${peak} (bound ${connectionBound})`);

    // ---- 4. several invocations at once: no pool timeout, every tenant exactly once per invocation ---------------------------
    const work = async (tx) => {
      const rows = await tx.$queryRawUnsafe(`SELECT 1 FROM workflow_sla`);
      return { examinedCount: rows.length, changedCount: 0 };
    };
    const runs = await Promise.all([forEachTenant(subject, work), forEachTenant(subject, work), forEachTenant(subject, work)]);
    for (const [index, run] of runs.entries()) {
      assert.equal(run.overall, "SUCCESS", `invocation ${index}: ${JSON.stringify(run.results.filter((r) => r.status === "failed").slice(0, 2))}`);
      assert.equal(new Set(run.results.map((r) => r.tenantKey)).size, run.tenantsEvaluated, `invocation ${index}: every tenant exactly once`);
      assert.ok(tenants.every((t) => run.results.some((r) => r.tenantKey === t && r.examinedCount === 1)), `invocation ${index}: every seeded tenant found its row`);
    }
    console.log(`PASS 4. three simultaneous invocations completed (pool limit ~${os.cpus().length * 2 + 1}); each processed every tenant once`);
    console.log("tenant-iteration integration test passed.");
  } finally {
    await admin.$executeRawUnsafe(`DELETE FROM workflow_sla WHERE id LIKE $1`, `sla-iter-${runId}-%`).catch(() => undefined);
    await admin.workspaceDirectory.deleteMany({ where: { tenantKey: { startsWith: `iter-${runId}-` } } }).catch(() => undefined);
    await subject.$disconnect().catch(() => undefined);
    await admin.$disconnect().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("tenant-iteration integration test failed:");
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
