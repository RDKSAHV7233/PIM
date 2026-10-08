#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001 P2.6a: the internal-ops summary reports platform-wide figures that include EVERY tenant under a restricted
 * (NOSUPERUSER, NOBYPASSRLS, non-owner) role.
 *
 * Before the change each card was a single platform-wide query through the context-free direct client. Under row level security that
 * client sees no tenant's rows, so every job, publishing, connector and media figure would have been zero while the card reported
 * itself available. This test builds the real service in a child process whose database environment is the restricted role, in a
 * dedicated throwaway database (migrated here, dropped after), with data in two non-default directory tenants and the default tenant,
 * and checks the exact sums. (The error-authority card reads a separate observability database and is stubbed out.)
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
  const dbName = `opssum_${runId}`;
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
    const T = { a: `os-a-${runId}`, b: `os-b-${runId}`, c: `os-c-${runId}`, d: "default" };
    for (const [i, tenantKey] of [T.a, T.b, T.c].entries()) {
      await admin.workspaceDirectory.create({ data: { tenantKey, workspaceSlug: `os-${runId.slice(-6)}-${i}`, displayName: `OpsSum ${i}` } });
    }
    const parents = {};
    for (const tenantKey of [T.a, T.b, T.d]) {
      const category = await admin.category.create({ data: { tenantKey, name: `Cat ${tenantKey}`, slug: `cat-${tenantKey}`, path: `cat-${tenantKey}` } });
      const product = await admin.product.create({ data: { tenantKey, title: `P ${tenantKey}`, categoryId: category.id, status: "approved" } });
      parents[tenantKey] = { categoryId: category.id, productId: product.id };
    }
    let n = 0;
    const exportJob = (tenantKey, status) =>
      admin.marketplaceExportJob.create({ data: { id: `ej_${runId}_${(n += 1)}`, tenantKey, productId: parents[tenantKey].productId, categoryId: parents[tenantKey].categoryId, channel: "shopify", status } });
    for (const status of ["queued", "queued", "failed", "completed", "completed", "completed"]) await exportJob(T.a, status);
    for (const status of ["processing", "dead_letter", "completed", "completed"]) await exportJob(T.b, status);
    await exportJob(T.d, "completed");
    const importJob = (tenantKey, status, failedRows, deadLetterRows) =>
      admin.bulkImportJob.create({ data: { id: `ij_${runId}_${(n += 1)}`, tenantKey, categoryId: parents[tenantKey].categoryId, sourceFormat: "csv", mapping: {}, status, failedRows, deadLetterRows } });
    await importJob(T.a, "queued", 4, 0);
    await importJob(T.b, "failed", 2, 1);
    const submission = (tenantKey, status) =>
      admin.$executeRawUnsafe(
        `INSERT INTO connector_submissions (id, tenant_key, installation_id, product_id, idempotency_key, submission_type, source, attempt_number, status, payload_snapshot, submitted_at)
         VALUES ($1, $2, 'inst', $3, $4, 'create', 'test', 1, $5, '{}'::jsonb, NOW())`,
        `sub_${runId}_${(n += 1)}`,
        tenantKey,
        parents[tenantKey].productId,
        `idem_${runId}_${n}`,
        status,
      );
    for (const status of ["SUCCESS", "SUCCESS", "ERROR"]) await submission(T.a, status);
    for (const status of ["SUCCESS", "REJECTED"]) await submission(T.b, status);
    const install = (tenantKey, alias, status) =>
      admin.$executeRawUnsafe(
        `INSERT INTO connector_installations (id, tenant_key, connector_id, account_alias, status, metadata, installed_by, created_at, updated_at)
         VALUES ($1, $2, 'cdef_amazon_in', $3, $4, '{}'::jsonb, 'ops-test', NOW(), NOW())`,
        `inst_${runId}_${(n += 1)}`,
        tenantKey,
        alias,
        status,
      );
    await install(T.a, "one", "ACTIVE");
    await install(T.a, "two", "PAUSED");
    await install(T.b, "one", "CREDENTIAL_EXPIRED");
    await install(T.b, "two", "DISABLED");
    await install(T.d, "one", "ACTIVE");
    const media = (tenantKey, k) =>
      admin.mediaAsset.create({ data: { id: `ma_${runId}_${(n += 1)}`, tenantKey, fileName: `f${k}.png`, mimeType: "image/png", storagePath: `media/${tenantKey}/f${k}.png`, sizeBytes: 1, checksum: `s${n}` } });
    await media(T.a, 1);
    await media(T.a, 2);
    await media(T.b, 1);
    await media(T.d, 1);
    console.log("PASS 1. fixture seeded: export jobs, import jobs, submissions, connector installations and media in tenants A and B and the default tenant; tenant C has none");

    // ---- the real service, in a child process whose database environment is the restricted role ------------------------------------------
    const code = `
      const { PrismaDirectService } = require(${JSON.stringify(path.join(DIST, "prisma", "prisma-direct.service.js"))});
      const { InternalOpsSummaryService } = require(${JSON.stringify(path.join(DIST, "internal-ops", "internal-ops-summary.service.js"))});
      (async () => {
        const direct = new PrismaDirectService();
        await direct.onModuleInit();
        const [who] = await direct.getClient().$queryRawUnsafe("SELECT (rolsuper OR rolbypassrls) AS privileged, current_user AS name FROM pg_roles WHERE rolname = current_user");
        const observability = { countOpenP0P1Issues: async () => ({ count: 0, storageAvailable: true }) };
        const warnings = [];
        const logger = { warn: (m, meta) => warnings.push([m, meta && meta.card]), info() {}, error() {}, log() {} };
        const service = new InternalOpsSummaryService(direct, observability, logger);
        const summary = await service.getSummary();
        console.log("RESULT:" + JSON.stringify({ who, summary, warnings }));
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
    const { who, summary, warnings } = JSON.parse(line.slice("RESULT:".length));
    assert.equal(who.privileged, false, `the service must run as the restricted role (saw ${JSON.stringify(who)})`);
    assert.equal(who.name, ROLE);
    assert.deepEqual(warnings, [], "no card may be unavailable");
    console.log("PASS 2. the service ran as the restricted role (not a superuser, not BYPASSRLS) and every card was available");

    // ---- the exact sums over the three tenants ----------------------------------------------------------------------------------------------
    // jobs: active = export queued 2 (A) + processing 1 (B) + import queued 1 (A); failed = export failed 1 (A) + import failed 1 (B); dead letter = export 1 (B)
    assert.equal(summary.jobs.active, 4, "active jobs span tenants A and B");
    assert.equal(summary.jobs.failed, 2);
    assert.equal(summary.jobs.deadLetter, 1);
    assert.equal(summary.imports.failedRows, 6, "import failed rows: A 4 + B 2");
    assert.equal(summary.imports.dlqRows, 1, "import dead-letter rows: B 1");
    console.log("PASS 3. jobs and imports sum over the tenants: 4 active, 2 failed, 1 dead letter, 6 failed rows, 1 dead-letter row");

    assert.deepEqual(summary.publishing.exports, { success: 6, failed: 2, successRate: 75 }, "export jobs: completed A 3 + B 2 + default 1, failed A 1 + dead letter B 1");
    assert.deepEqual(summary.publishing.submissions, { success: 3, failed: 2, successRate: 60 }, "submissions: SUCCESS A 2 + B 1; ERROR A 1 + REJECTED B 1");
    console.log("PASS 4. publishing sums over the tenants: exports 6 ok / 2 failed (75%), submissions 3 ok / 2 failed (60%)");

    assert.equal(summary.connectors.totalInstallations, 5);
    const byStatus = Object.fromEntries(summary.connectors.byStatus.map((row) => [row.status, row.count]));
    assert.deepEqual(byStatus, { active: 2, paused: 1, credential_expired: 1, disabled: 1 });
    assert.equal(summary.readiness.connector.blockingInstallations, 1, "one credential-expired installation (tenant B)");
    assert.equal(summary.readiness.connector.warningInstallations, 1, "one paused installation (tenant A)");
    assert.equal(summary.readiness.connector.affectedTenants, 2, "tenants A and B are affected; the default tenant and tenant C are not");
    console.log("PASS 5. connectors sum over the tenants, and the readiness card counts exactly the 2 affected tenants");

    assert.equal(summary.mediaIntegrity.totalAssets, 4, "media: A 2 + B 1 + default 1");
    console.log("PASS 6. the media card counts the media of every tenant (4)");
    console.log("internal-ops summary restricted-role integration test passed.");
  } finally {
    if (admin) {
      await admin.$disconnect().catch(() => undefined);
    }
    await adminMain.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => undefined);
    await adminMain.$disconnect().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("internal-ops summary restricted-role integration test failed:");
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
