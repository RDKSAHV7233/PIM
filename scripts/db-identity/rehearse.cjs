#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001 I1: the identity-model rehearsal.
 *
 *   REHEARSAL_ADMIN_URL=postgresql://postgres:***@localhost:PORT/postgres  node scripts/db-identity/rehearse.cjs [--keep]
 *   REHEARSAL_DOCKER_CONTAINER=name   optional: run pg_dump and pg_restore inside that container instead of from PATH
 *
 * It builds a database that **reproduces the ownership split observed in production** (a superuser `vexa_app_v2` owning the 15 tables,
 * 2 functions and 9 enum types in packages/db/identity/production-ownership-split.v1.json, `postgres` owning everything else), then
 * proves the transfer to the target model *from that starting state*, and every property the model claims. Only `localhost`,
 * `127.0.0.1` and `::1` are accepted: this never touches production, and never reads a production credential.
 *
 * pg_dump and pg_restore must exist. A rehearsal that cannot run the backup proof fails; it does not skip.
 */
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const zlib = require("node:zlib");
const path = require("node:path");
const lib = require("./lib.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const MODEL_DIR = path.join(ROOT, "packages", "db", "identity");
const manifest = JSON.parse(fs.readFileSync(path.join(MODEL_DIR, "identity-model.v1.json"), "utf8"));
const fixture = JSON.parse(fs.readFileSync(path.join(MODEL_DIR, "production-ownership-split.v1.json"), "utf8"));
const KEEP = process.argv.includes("--keep");
const CONTAINER = String(process.env.REHEARSAL_DOCKER_CONTAINER || "").trim();

const adminRaw = String(process.env.REHEARSAL_ADMIN_URL || "").trim();
if (!adminRaw) {
  console.error("REHEARSAL_ADMIN_URL is required (a local PostgreSQL superuser URL). The target is never guessed.");
  process.exit(2);
}
const adminUrl = new URL(adminRaw);
if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(adminUrl.hostname)) {
  console.error("The rehearsal only runs against a local database. Refusing.");
  process.exit(3);
}
const HOST = adminUrl.hostname;
const PORT = adminUrl.port || "5432";
const ADMIN_USER = decodeURIComponent(adminUrl.username);
const ADMIN_PASS = decodeURIComponent(adminUrl.password);

const PRODLIKE = "rehearsal_prodlike";
const FRESH = "rehearsal_fresh";
const RESTORED = "rehearsal_restored";
const RESTORED_PLAIN = "rehearsal_restored_plain";
const OLD_OWNER = fixture.currentOwner;
const MIGRATOR = lib.ROLES.migrator.name;
const RUNTIME = lib.ROLES.runtime.name;
const BACKUP = lib.ROLES.backup.name;
const REPORTER = lib.ROLES.reporter.name;
const OPS = lib.ROLES.ops.name;
const rehearsalPassword = (role) => `${role}_rehearsal_password`;

const urlFor = (db, user, pass) => `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${HOST}:${PORT}/${db}?schema=public`;
const adminFor = (db) => urlFor(db, ADMIN_USER, ADMIN_PASS);

const { PrismaClient } = require("@prisma/client");
const clients = [];
function open(db, user, pass) {
  const client = new PrismaClient({ datasources: { db: { url: urlFor(db, user, pass) } }, log: [] });
  clients.push(client);
  return client;
}
const asAdmin = (db) => open(db, ADMIN_USER, ADMIN_PASS);
const asRole = (db, role) => open(db, role, rehearsalPassword(role));

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? `   ${String(detail).slice(0, 300)}` : ""}`);
  return ok;
}
const section = (title) => console.log(`\n## ${title}`);
const tail = (s) => String(s || "").trim().split("\n").slice(-3).join(" | ");

const DENIED = /42501|permission denied|must be owner|row-level security|must be member|permission to set role|only roles with/i;
/** True only when the statement was refused for a privilege reason; a syntax or other error is reported, not counted as a denial. */
async function denied(client, statement) {
  try {
    await client.$executeRawUnsafe(statement);
    return { ok: false, why: "the statement succeeded" };
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    return DENIED.test(message) ? { ok: true } : { ok: false, why: message.split("\n").slice(-1)[0] };
  }
}
async function expectDenied(name, client, statement) {
  const r = await denied(client, statement);
  check(name, r.ok, r.why);
}
async function expectAllowed(name, client, statement) {
  try {
    await client.$executeRawUnsafe(statement);
    check(name, true);
  } catch (error) {
    check(name, false, String(error && error.message ? error.message : error).split("\n").slice(-1)[0]);
  }
}
const rows = (client, statement) => client.$queryRawUnsafe(statement);
/** Runs statements on one connection, with the tenant context the application sets. */
async function inTenant(client, tenant, fn) {
  return client.$transaction(async (tx) => {
    if (tenant !== null) {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_key', '${tenant}', true)`);
    }
    return fn(tx);
  });
}

function tool(mode, db, extra = [], env = {}) {
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, "tool.cjs"), mode, ...extra], {
    cwd: ROOT,
    env: { ...process.env, DB_IDENTITY_ADMIN_URL: adminFor(db), ...env },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return { status: r.status, out: r.stdout || "", err: r.stderr || "" };
}

function migrate(db, user, pass) {
  const url = urlFor(db, user, pass);
  const prismaCli = require.resolve("prisma/build/index.js", { paths: [ROOT] });
  const r = cp.spawnSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", path.join(ROOT, "packages", "db", "prisma", "schema.prisma")], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: url, DATABASE_URL_POOLED: url, DATABASE_URL_DIRECT: url },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return { status: r.status, out: r.stdout || "", err: r.stderr || "" };
}

/** pg_dump / pg_restore: from PATH, or inside a container. Missing binaries are a failure, never a skip. */
function pg(binary, args, { user, pass, input }) {
  const base = CONTAINER
    ? ["docker", ["exec", "-i", "-e", `PGPASSWORD=${pass}`, CONTAINER, binary, "-h", "localhost", "-p", "5432", "-U", user, ...args]]
    : [binary, ["-h", HOST, "-p", PORT, "-U", user, ...args]];
  const r = cp.spawnSync(base[0], base[1], { env: { ...process.env, PGPASSWORD: pass }, input, maxBuffer: 256 * 1024 * 1024 });
  return { status: r.error ? -1 : r.status, stdout: r.stdout || Buffer.alloc(0), stderr: r.error ? String(r.error.message) : String(r.stderr || "") };
}

async function recreate(db) {
  const a = asAdmin("postgres");
  await a.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
  await a.$executeRawUnsafe(`CREATE DATABASE "${db}"`);
}

const SEEDED = ["workflow_sla", "ai_platform_controls", "ai_platform_budget_periods", "ops_alert_states", "Product", "Variant", "connector_submissions", "media_assets"];
async function fingerprint(client) {
  const out = {};
  for (const t of SEEDED) {
    const [r] = await rows(client, `SELECT count(*)::int AS n, coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '') AS h FROM public."${t}" x`);
    out[t] = `${r.n}:${r.h}`;
  }
  return out;
}
const sameFingerprint = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function ownersOf(client) {
  const objects = await rows(
    client,
    `SELECT 'table' AS kind, c.relname AS name, pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
     UNION ALL SELECT 'type', t.typname, pg_get_userbyid(t.typowner) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype = 'e'
     UNION ALL SELECT 'function', p.proname, pg_get_userbyid(p.proowner) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prokind = 'f'`,
  );
  return objects;
}

async function main() {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "db-identity-"));
  const before = path.join(workdir, "before.json");
  try {
    // ---------------------------------------------------------------------------------------------------------------------------
    section("R1 build a database that reproduces the production ownership split");
    await recreate(PRODLIKE);
    const m1 = migrate(PRODLIKE, ADMIN_USER, ADMIN_PASS);
    check("every migration applies as the database owner (the way the first deploys ran)", m1.status === 0, tail(m1.err || m1.out));
    const pl = asAdmin(PRODLIKE);
    const exists = await rows(pl, `SELECT 1 FROM pg_roles WHERE rolname = '${OLD_OWNER}'`);
    await pl.$executeRawUnsafe(`${exists.length ? "ALTER" : "CREATE"} ROLE "${OLD_OWNER}" WITH LOGIN SUPERUSER PASSWORD '${rehearsalPassword(OLD_OWNER)}'`);
    for (const t of fixture.tables) {
      await pl.$executeRawUnsafe(`ALTER TABLE public."${t}" OWNER TO "${OLD_OWNER}"`);
    }
    for (const t of fixture.enumTypes) {
      await pl.$executeRawUnsafe(`ALTER TYPE public."${t}" OWNER TO "${OLD_OWNER}"`);
    }
    for (const f of fixture.functions) {
      const found = await rows(pl, `SELECT pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = '${f}'`);
      check(`function ${f} exists exactly once`, found.length === 1, `found ${found.length}`);
      await pl.$executeRawUnsafe(`ALTER FUNCTION public."${f}"(${found[0].args}) OWNER TO "${OLD_OWNER}"`);
    }
    await pl.$executeRawUnsafe(`INSERT INTO workflow_sla (id, tenant_key) VALUES ('sla-a','tenant-a'), ('sla-b','tenant-b'), ('sla-d','default')`);
    // the singleton control row ('global') is created by its own migration
    await pl.$executeRawUnsafe(`INSERT INTO ai_platform_budget_periods (id, period_key, period_started_at, period_ends_at) VALUES ('p1','2026-10', now(), now() + interval '30 days')`);
    await pl.$executeRawUnsafe(`INSERT INTO ops_alert_states (id, alert_key, alert_type, first_observed_at, last_observed_at, updated_at) VALUES ('o1','k','t', now(), now(), now())`);
    // Rows for the reporter and the backfill: three tenants of products, one variant (so two products are variant-less, as the backfill
    // expects), two connector submissions and two media assets. Referentially valid on purpose: the dump of this database is restored
    // in R7, and a restore rejects orphan rows.
    await pl.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`INSERT INTO "WorkspaceDirectory" (id, "tenantKey", "workspaceSlug", "displayName", "updatedAt") VALUES ('ws-a','tenant-a','tenant-a','Tenant A', now()), ('ws-b','tenant-b','tenant-b','Tenant B', now())`);
      await tx.$executeRawUnsafe(`INSERT INTO "Category" (id, name, slug, path, "tenantKey", "updatedAt") VALUES ('cat-a','A','cat-a','/cat-a','tenant-a', now()), ('cat-b','B','cat-b','/cat-b','tenant-b', now()), ('cat-d','D','cat-d','/cat-d','default', now())`);
      await tx.$executeRawUnsafe(`INSERT INTO "Product" (id, title, "categoryId", "tenantKey", "updatedAt") VALUES ('prod-a','A','cat-a','tenant-a', now()), ('prod-b','B','cat-b','tenant-b', now()), ('prod-d','D','cat-d','default', now())`);
      await tx.$executeRawUnsafe(`INSERT INTO "Variant" (id, "productId", "skuCode", "tenantKey", "updatedAt") VALUES ('var-a','prod-a','SKU-A','tenant-a', now())`);
      await tx.$executeRawUnsafe(`INSERT INTO connector_submissions (id, installation_id, product_id, idempotency_key, submission_type, source, status, payload_snapshot, tenant_key) VALUES ('sub-a','inst-a','prod-a','idem-a','PUBLISH','manual','SUCCESS','{}','tenant-a'), ('sub-b','inst-b','prod-b','idem-b','PUBLISH','manual','SUCCESS','{}','tenant-b')`);
      await tx.$executeRawUnsafe(`INSERT INTO media_assets (id, file_name, mime_type, storage_path, size_bytes, checksum, tenant_key) VALUES ('med-a','a.png','image/png','a/a.png',1,'c-a','tenant-a'), ('med-b','b.png','image/png','b/b.png',1,'c-b','tenant-b')`);
    });
    const seeded = await fingerprint(pl);
    check("seed rows written (3 tenants of workflow_sla and of products, the control row, one budget period, one alert state)", seeded.workflow_sla.startsWith("3:") && seeded.ai_platform_controls.startsWith("1:"));

    // ---------------------------------------------------------------------------------------------------------------------------
    section("R2 the starting state matches the observed production split, and is not yet the target");
    const snap = tool("snapshot", PRODLIKE, ["--out", before]);
    check("snapshot taken", snap.status === 0, tail(snap.err));
    const start = JSON.parse(fs.readFileSync(before, "utf8")).objects;
    const ownedBy = (kind, owner) => start.filter((o) => o.kind === kind && o.owner === owner).map((o) => o.name).sort();
    check("exactly the 15 fixture tables are owned by the old superuser role", JSON.stringify(ownedBy("table", OLD_OWNER)) === JSON.stringify([...fixture.tables].sort()), JSON.stringify(ownedBy("table", OLD_OWNER)));
    check("exactly the 2 fixture functions are owned by the old role", JSON.stringify(ownedBy("function", OLD_OWNER)) === JSON.stringify([...fixture.functions].sort()));
    check("exactly the 9 fixture enum types are owned by the old role", JSON.stringify(ownedBy("type", OLD_OWNER)) === JSON.stringify([...fixture.enumTypes].sort()));
    const tableCount = start.filter((o) => o.kind === "table").length;
    check(`the schema has ${fixture.expectedTotals.tables} application tables plus _prisma_migrations`, tableCount === fixture.expectedTotals.tables + 1, `got ${tableCount}`);
    check(`every other table is owned by the database owner (${tableCount - fixture.tables.length} tables)`, start.filter((o) => o.kind === "table" && o.owner !== OLD_OWNER).every((o) => o.owner === ADMIN_USER));
    const v0 = tool("verify", PRODLIKE);
    check("the target-model verifier FAILS on the starting state (roles missing, ownership wrong)", v0.status === 1, `exit ${v0.status}`);

    // ---------------------------------------------------------------------------------------------------------------------------
    section("R3 transfer to the target model from that state");
    const cr = tool("create-roles", PRODLIKE);
    check("create-roles", cr.status === 0, tail(cr.err));
    const plan = tool("plan-ownership", PRODLIKE);
    check("plan-ownership is read-only and lists the statements", plan.status === 0 && plan.out.includes("ALTER TABLE") && plan.out.startsWith("--"), tail(plan.err));
    const ao = tool("apply-ownership", PRODLIKE);
    const aoJson = ao.status === 0 ? JSON.parse(ao.out.trim().split("\n").pop()) : {};
    check("apply-ownership (one transaction)", ao.status === 0, tail(ao.err));
    const after = await ownersOf(pl);
    check("every table, type and function is now owned by the migrator", after.every((o) => o.owner === MIGRATOR));
    check("nothing is owned by the old role any more", after.every((o) => o.owner !== OLD_OWNER));
    void aoJson;
    const ag = tool("apply-grants", PRODLIKE);
    check("apply-grants", ag.status === 0, tail(ag.err));
    const v1 = tool("verify", PRODLIKE);
    check("the target-model verifier PASSES", v1.status === 0, tail(v1.out));
    const afterTransfer = await fingerprint(pl);
    check("the ownership transfer rewrote no data (row counts and content hashes unchanged)", sameFingerprint(seeded, afterTransfer));

    // ---------------------------------------------------------------------------------------------------------------------------
    section("R4 idempotency");
    check("create-roles again", tool("create-roles", PRODLIKE).status === 0);
    const ao2 = tool("apply-ownership", PRODLIKE);
    const ao2Json = ao2.status === 0 ? JSON.parse(ao2.out.trim().split("\n").pop()) : {};
    check("apply-ownership again changes nothing (0 statements)", ao2.status === 0 && ao2Json.statements === 0, tail(ao2.out));
    check("apply-grants again", tool("apply-grants", PRODLIKE).status === 0);
    check("verify again", tool("verify", PRODLIKE).status === 0);

    // ---------------------------------------------------------------------------------------------------------------------------
    section("R5 rollback restores the exact original ownership, and the old role still works");
    const rb = tool("rollback-ownership", PRODLIKE, ["--snapshot", before]);
    const rbJson = rb.status === 0 ? JSON.parse(rb.out.trim().split("\n").pop()) : {};
    check("rollback-ownership reports restored", rb.status === 0 && rbJson.restored === true, tail(rb.out || rb.err));
    const restoredOwners = await ownersOf(pl);
    const key = (o) => `${o.kind}:${o.name}=${o.owner}`;
    const startKeys = start.filter((o) => o.kind !== "function").map(key).sort();
    const nowKeys = restoredOwners.filter((o) => o.kind !== "function").map(key).sort();
    check("tables and types are back to exactly their original owners (63 + 15 split)", JSON.stringify(startKeys) === JSON.stringify(nowKeys));
    check("verify FAILS again on the rolled-back state (ownership is wrong again)", tool("verify", PRODLIKE).status === 1);
    const oldRole = asRole(PRODLIKE, OLD_OWNER);
    const [who] = await rows(oldRole, `SELECT current_user AS u, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su`);
    check("the old role is untouched by the whole round trip (still a working superuser)", who.u === OLD_OWNER && who.su === true);
    await expectAllowed("the old role can still write the control row (rollback target is functional)", oldRole, `UPDATE ai_platform_controls SET kill_switch = kill_switch`);
    check("rollback also left the data unchanged", sameFingerprint(seeded, await fingerprint(pl)));
    check("re-apply forward after the rollback", tool("apply-ownership", PRODLIKE).status === 0 && tool("apply-grants", PRODLIKE).status === 0 && tool("verify", PRODLIKE).status === 0);

    // ---------------------------------------------------------------------------------------------------------------------------
    section("R6 the runtime role: CRUD where granted, tenant isolation, and nothing else");
    const rt = asRole(PRODLIKE, RUNTIME);
    const [rtAttr] = await rows(rt, `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
    check("the runtime role is not a superuser and does not bypass RLS", rtAttr.rolsuper === false && rtAttr.rolbypassrls === false);
    const a = await inTenant(rt, "tenant-a", (tx) => tx.$queryRawUnsafe(`SELECT id FROM workflow_sla ORDER BY id`));
    const b = await inTenant(rt, "tenant-b", (tx) => tx.$queryRawUnsafe(`SELECT id FROM workflow_sla ORDER BY id`));
    const none = await inTenant(rt, null, (tx) => tx.$queryRawUnsafe(`SELECT id FROM workflow_sla ORDER BY id`));
    check("tenant-a sees only tenant-a rows", a.length === 1 && a[0].id === "sla-a", JSON.stringify(a));
    check("tenant-b sees only tenant-b rows", b.length === 1 && b[0].id === "sla-b", JSON.stringify(b));
    check("with no tenant context the runtime sees only the default tenant (the documented fallback)", none.length === 1 && none[0].id === "sla-d", JSON.stringify(none));
    try {
      await inTenant(rt, "tenant-c", async (tx) => {
        await tx.$executeRawUnsafe(`INSERT INTO workflow_sla (id, tenant_key) VALUES ('sla-c','tenant-c')`);
        await tx.$executeRawUnsafe(`UPDATE workflow_sla SET review_target_days = 9 WHERE id = 'sla-c'`);
        const n = await tx.$executeRawUnsafe(`DELETE FROM workflow_sla WHERE id = 'sla-c'`);
        if (n !== 1) {
          throw new Error(`deleted ${n}`);
        }
      });
      check("INSERT, UPDATE and DELETE of an own-tenant row all succeed", true);
    } catch (error) {
      check("INSERT, UPDATE and DELETE of an own-tenant row all succeed", false, String(error.message).split("\n").slice(-1)[0]);
    }
    const cross = await (async () => {
      try {
        await inTenant(rt, "tenant-a", (tx) => tx.$executeRawUnsafe(`INSERT INTO workflow_sla (id, tenant_key) VALUES ('sla-x','tenant-b')`));
        return { ok: false, why: "cross-tenant insert succeeded" };
      } catch (error) {
        return DENIED.test(String(error.message)) ? { ok: true } : { ok: false, why: String(error.message).split("\n").slice(-1)[0] };
      }
    })();
    check("a cross-tenant INSERT is rejected by row level security", cross.ok, cross.why);
    const crossUpdate = await inTenant(rt, "tenant-a", (tx) => tx.$executeRawUnsafe(`UPDATE workflow_sla SET review_target_days = 7 WHERE id = 'sla-b'`));
    check("a cross-tenant UPDATE matches zero rows", crossUpdate === 0, `rows ${crossUpdate}`);
    const crossDelete = await inTenant(rt, "tenant-a", (tx) => tx.$executeRawUnsafe(`DELETE FROM workflow_sla WHERE id = 'sla-b'`));
    check("a cross-tenant DELETE matches zero rows", crossDelete === 0, `rows ${crossDelete}`);
    const rowSecurityOff = await (async () => {
      try {
        await rt.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL row_security = off`);
          await tx.$queryRawUnsafe(`SELECT id FROM workflow_sla`);
        });
        return { ok: false, why: "SET row_security = off was honoured" };
      } catch (error) {
        return DENIED.test(String(error.message)) ? { ok: true } : { ok: false, why: String(error.message).split("\n").slice(-1)[0] };
      }
    })();
    check("the runtime cannot switch row security off for itself", rowSecurityOff.ok, rowSecurityOff.why);
    await expectDenied("runtime cannot CREATE TABLE", rt, `CREATE TABLE public.rt_ddl (id int)`);
    await expectDenied("runtime cannot ALTER TABLE", rt, `ALTER TABLE public.workflow_sla ADD COLUMN rt_ddl int`);
    await expectDenied("runtime cannot DROP TABLE", rt, `DROP TABLE public.workflow_sla`);
    await expectDenied("runtime cannot TRUNCATE", rt, `TRUNCATE public.workflow_sla`);
    await expectDenied("runtime cannot disable row level security", rt, `ALTER TABLE public.workflow_sla DISABLE ROW LEVEL SECURITY`);
    await expectDenied("runtime cannot drop a policy", rt, `DROP POLICY IF EXISTS tenant_isolation_workflow_sla ON public.workflow_sla`);
    await expectDenied("runtime cannot create roles", rt, `CREATE ROLE rt_made_this`);
    await expectDenied("runtime cannot SET ROLE to the migrator", rt, `SET ROLE "${MIGRATOR}"`);
    await expectDenied("runtime cannot read _prisma_migrations", rt, `SELECT count(*) FROM public._prisma_migrations`);
    const ctl = await rows(rt, `SELECT id FROM ai_platform_controls`);
    check("runtime can READ the platform control row", ctl.length === 1);
    await expectDenied("runtime cannot UPDATE the kill switch (control row)", rt, `UPDATE ai_platform_controls SET kill_switch = false`);
    await expectDenied("runtime cannot INSERT a control row", rt, `INSERT INTO ai_platform_controls (id) VALUES ('rogue')`);
    await expectDenied("runtime cannot DELETE the control row", rt, `DELETE FROM ai_platform_controls`);
    await expectAllowed("runtime can UPDATE budget counters", rt, `UPDATE ai_platform_budget_periods SET request_count = request_count`);
    await expectDenied("runtime cannot INSERT a budget period", rt, `INSERT INTO ai_platform_budget_periods (id, period_key, period_started_at, period_ends_at) VALUES ('p-rogue','x', now(), now())`);
    await expectDenied("runtime cannot DELETE a budget period", rt, `DELETE FROM ai_platform_budget_periods`);
    check("runtime proofs left the seeded data unchanged", sameFingerprint(seeded, await fingerprint(pl)));

    // ---------------------------------------------------------------------------------------------------------------------------
    section("R7 the backup role: reads everything, writes nothing, and a dump restores completely");
    const bk = asRole(PRODLIKE, BACKUP);
    const seen = await rows(bk, `SELECT count(*)::int AS n FROM workflow_sla`);
    check("backup sees ALL tenants (3 rows) while the runtime saw one", seen[0].n === 3);
    await expectDenied("backup cannot INSERT", bk, `INSERT INTO workflow_sla (id, tenant_key) VALUES ('bk','default')`);
    await expectDenied("backup cannot UPDATE", bk, `UPDATE workflow_sla SET review_target_days = 1`);
    await expectDenied("backup cannot DELETE", bk, `DELETE FROM workflow_sla`);
    await expectDenied("backup cannot CREATE TABLE", bk, `CREATE TABLE public.bk_ddl (id int)`);
    const dump = path.join(workdir, "backup.dump");
    const d = pg("pg_dump", ["-Fc", "-d", PRODLIKE], { user: BACKUP, pass: rehearsalPassword(BACKUP) });
    check("pg_dump as vexa_backup succeeds (pg_dump must exist: this check never skips)", d.status === 0 && d.stdout.length > 1000, `${d.status} ${d.stderr.slice(0, 200)}`);
    fs.writeFileSync(dump, d.stdout);
    await recreate(RESTORED);
    const r = pg("pg_restore", ["--no-owner", "--no-privileges", "-d", RESTORED], { user: ADMIN_USER, pass: ADMIN_PASS, input: d.stdout });
    check("pg_restore of that dump into an empty database succeeds", r.status === 0, `${r.status} ${r.stderr.slice(0, 300)}`);
    const restored = asAdmin(RESTORED);
    check("the restored database matches the source: same row counts and content hashes for every seeded table", sameFingerprint(seeded, await fingerprint(restored)));
    const [rt1] = await rows(pl, `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`);
    const [rt2] = await rows(restored, `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`);
    check("the restored database has every table", rt1.n === rt2.n, `${rt1.n} vs ${rt2.n}`);

    // ---------------------------------------------------------------------------------------------------------------------------
    section("R7b the reporter role: reads the report tables across every tenant, writes nothing, reaches nothing else");
    const rp = asRole(PRODLIKE, REPORTER);
    const [rpAttr] = await rows(rp, `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
    check("the reporter is not a superuser and bypasses RLS (a report spans tenants), and nothing else about it is privileged", rpAttr.rolsuper === false && rpAttr.rolbypassrls === true);
    const count = async (client, table) => (await rows(client, `SELECT count(*)::int AS n FROM public."${table}"`))[0].n;
    check("the reporter sees ALL tenants' products (3 rows) where a tenant-bound role sees one", (await count(rp, "Product")) === 3);
    check("the reporter reads the variants, the connector submissions and the media assets across tenants", (await count(rp, "Variant")) === 1 && (await count(rp, "connector_submissions")) === 2 && (await count(rp, "media_assets")) === 2);
    await expectDenied("reporter cannot INSERT a product", rp, `INSERT INTO "Product" (id, title, "categoryId", "updatedAt") VALUES ('rp-x','x','c', now())`);
    await expectDenied("reporter cannot UPDATE a product", rp, `UPDATE "Product" SET title = 'x'`);
    await expectDenied("reporter cannot DELETE a variant", rp, `DELETE FROM "Variant"`);
    await expectDenied("reporter cannot TRUNCATE a report table", rp, `TRUNCATE "Product" CASCADE`);
    await expectDenied("reporter cannot CREATE TABLE", rp, `CREATE TABLE public.rp_ddl (id int)`);
    await expectDenied("reporter cannot read an ordinary table outside its reports", rp, `SELECT * FROM workflow_sla`);
    await expectDenied("reporter cannot read the kill switch", rp, `SELECT * FROM ai_platform_controls`);
    await expectDenied("reporter cannot read _prisma_migrations", rp, `SELECT count(*) FROM public._prisma_migrations`);
    await expectDenied("reporter cannot SET ROLE to the migrator", rp, `SET ROLE "${MIGRATOR}"`);
    await expectDenied("reporter cannot SET ROLE to the backup role", rp, `SET ROLE "${BACKUP}"`);
    check("reporter proofs left the seeded data unchanged", sameFingerprint(seeded, await fingerprint(pl)));

    // ---------------------------------------------------------------------------------------------------------------------------
    section("R8 the ops role: the platform control tables and nothing else");
    const op = asRole(PRODLIKE, OPS);
    await expectAllowed("ops can write the kill switch row", op, `UPDATE ai_platform_controls SET kill_switch = true, updated_by = 'rehearsal'`);
    await expectAllowed("ops can create a budget period", op, `INSERT INTO ai_platform_budget_periods (id, period_key, period_started_at, period_ends_at) VALUES ('p2','2026-11', now(), now() + interval '30 days')`);
    await expectAllowed("ops can delete a budget period", op, `DELETE FROM ai_platform_budget_periods WHERE id = 'p2'`);
    await expectDenied("ops cannot read an ordinary table", op, `SELECT * FROM workflow_sla`);
    await expectDenied("ops cannot write an ordinary table", op, `UPDATE workflow_sla SET review_target_days = 1`);
    await expectDenied("ops cannot CREATE TABLE", op, `CREATE TABLE public.ops_ddl (id int)`);
    await pl.$executeRawUnsafe(`UPDATE ai_platform_controls SET updated_by = NULL`);

    // ---------------------------------------------------------------------------------------------------------------------------
    section("R8b the ops role as the sellable-SKU backfill uses it: one tenant at a time, read products, create variants, nothing more");
    const [opAttr] = await rows(op, `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
    check("ops is not a superuser and does NOT bypass RLS (so a backfill must iterate tenants)", opAttr.rolsuper === false && opAttr.rolbypassrls === false);
    const opB = await inTenant(op, "tenant-b", (tx) => tx.$queryRawUnsafe(`SELECT id FROM "Product" ORDER BY id`));
    check("under tenant-b the backfill reads only tenant-b's product", opB.length === 1 && opB[0].id === "prod-b", JSON.stringify(opB));
    const opNone = await inTenant(op, null, (tx) => tx.$queryRawUnsafe(`SELECT id FROM "Product" ORDER BY id`));
    check("with no tenant context a backfill would see only the default tenant, so iterating tenants is mandatory, not optional", opNone.length === 1 && opNone[0].id === "prod-d", JSON.stringify(opNone));
    try {
      await inTenant(op, "tenant-b", (tx) => tx.$executeRawUnsafe(`INSERT INTO "Variant" (id, "productId", "skuCode", "tenantKey", "updatedAt") VALUES ('var-b','prod-b','SKU-B','tenant-b', now())`));
      check("under tenant-b ops can create tenant-b's missing variant", true);
    } catch (error) {
      check("under tenant-b ops can create tenant-b's missing variant", false, String(error.message).split("\n").slice(-1)[0]);
    }
    const opCross = await (async () => {
      try {
        await inTenant(op, "tenant-a", (tx) => tx.$executeRawUnsafe(`INSERT INTO "Variant" (id, "productId", "skuCode", "tenantKey", "updatedAt") VALUES ('var-x','prod-b','SKU-X','tenant-b', now())`));
        return { ok: false, why: "a cross-tenant variant insert succeeded" };
      } catch (error) {
        return DENIED.test(String(error.message)) ? { ok: true } : { ok: false, why: String(error.message).split("\n").slice(-1)[0] };
      }
    })();
    check("under tenant-a ops cannot create a variant for tenant-b (row level security)", opCross.ok, opCross.why);
    check("ops reads the tenant directory (that is where the backfill lists tenants)", (await rows(op, `SELECT count(*)::int AS n FROM "WorkspaceDirectory"`))[0].n === 2);
    await expectDenied("ops cannot INSERT into the tenant directory", op, `INSERT INTO "WorkspaceDirectory" (id, "tenantKey", "workspaceSlug", "displayName", "updatedAt") VALUES ('ws-x','tenant-x','tenant-x','X', now())`);
    await expectDenied("ops cannot UPDATE the tenant directory", op, `UPDATE "WorkspaceDirectory" SET "displayName" = 'x'`);
    await expectDenied("ops cannot DELETE from the tenant directory", op, `DELETE FROM "WorkspaceDirectory"`);
    await expectDenied("ops cannot UPDATE a product", op, `UPDATE "Product" SET title = 'x'`);
    await expectDenied("ops cannot DELETE a product", op, `DELETE FROM "Product"`);
    await expectDenied("ops cannot UPDATE a variant", op, `UPDATE "Variant" SET "skuCode" = 'x'`);
    await expectDenied("ops cannot DELETE a variant", op, `DELETE FROM "Variant"`);
    await expectDenied("ops cannot read the connector submissions", op, `SELECT * FROM connector_submissions`);
    await expectDenied("ops cannot read the media assets", op, `SELECT * FROM media_assets`);
    await pl.$executeRawUnsafe(`DELETE FROM "Variant" WHERE id = 'var-b'`);
    check("ops proofs left the seeded data unchanged", sameFingerprint(seeded, await fingerprint(pl)));

    // ---------------------------------------------------------------------------------------------------------------------------
    section("R8c the real operator scripts with the real roles: the backfill iterates tenants as vexa_ops, the reports run as vexa_reporter, anything else is refused");
    const runScript = (script, env, args = []) => {
      const r = cp.spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...args], {
        cwd: ROOT,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ...env },
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      });
      return { status: r.status, out: r.stdout || "", err: r.stderr || "" };
    };
    const noPassword = (r, role) => !(r.out + r.err).includes(rehearsalPassword(role));
    const jsonOf = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
    const urlAs = (role) => urlFor(PRODLIKE, role, rehearsalPassword(role));
    const outFile = (name) => path.join(workdir, name);
    // Two of the seeded products become sellable: prod-b (tenant-b) and prod-d (default). prod-a already has its variant.
    await pl.$executeRawUnsafe(`UPDATE "Product" SET status = 'approved' WHERE id IN ('prod-b','prod-d')`);
    const variantCount = async () => (await rows(pl, `SELECT count(*)::int AS n FROM "Variant"`))[0].n;

    // the failure mode this item exists to prevent: the original single pass, run as the restricted role
    const single = runScript("sellable-sku-variantless-backfill.cjs", { DATABASE_URL: urlAs(OPS) }, ["--output", outFile("bf-single.json")]);
    check("the ORIGINAL single pass as vexa_ops reports success but sees only the default tenant (1 of the 2 candidates): this is why ops mode iterates", single.status === 0 && jsonOf(outFile("bf-single.json")).candidateCount === 1, tail(single.err));

    const dry = runScript("sellable-sku-variantless-backfill.cjs", { OPS_DATABASE_URL: urlAs(OPS) }, ["--output", outFile("bf-dry.json")]);
    const dryReport = dry.status === 0 ? jsonOf(outFile("bf-dry.json")) : {};
    check("OPS_DATABASE_URL dry run: iterates the directory plus the default tenant (3 tenants) and finds BOTH candidates across tenants", dry.status === 0 && dryReport.mode === "dry_run" && dryReport.tenantIteration.tenantsEvaluated === 3 && dryReport.candidateCount === 2, tail(dry.err));
    check("the dry run says what it cannot prove (orphan tenants are invisible to a restricted role) and failed no tenant", !!dryReport.tenantIteration && dryReport.tenantIteration.orphanDetection === "UNVERIFIED_BY_OPS_ROLE" && dryReport.tenantIteration.tenantsFailed === 0);
    check("the dry run created nothing", (await variantCount()) === 1);

    const write = runScript("sellable-sku-variantless-backfill.cjs", { OPS_DATABASE_URL: urlAs(OPS), CONFIRM_SELLABLE_SKU_BACKFILL: "true" }, ["--confirm", "--output", outFile("bf-write.json")]);
    const writeReport = write.status === 0 ? jsonOf(outFile("bf-write.json")) : {};
    check("the write run as vexa_ops creates both variants (summary created = 2, no errors)", write.status === 0 && writeReport.summary.created === 2 && writeReport.summary.error === 0, tail(write.err));
    const made = await rows(pl, `SELECT "productId", "tenantKey" FROM "Variant" WHERE "productId" IN ('prod-b','prod-d') ORDER BY "productId"`);
    check("each created variant carries its own product's tenant (tenant-b and default), written under that tenant's context", made.length === 2 && made[0].tenantKey === "tenant-b" && made[1].tenantKey === "default", JSON.stringify(made));
    const again = runScript("sellable-sku-variantless-backfill.cjs", { OPS_DATABASE_URL: urlAs(OPS), CONFIRM_SELLABLE_SKU_BACKFILL: "true" }, ["--confirm", "--output", outFile("bf-again.json")]);
    check("a second write run finds nothing to do (idempotent)", again.status === 0 && jsonOf(outFile("bf-again.json")).candidateCount === 0);
    check("no run printed the ops password", [single, dry, write, again].every((r) => noPassword(r, OPS)));

    // a wrong credential is refused before any read or write
    await pl.$executeRawUnsafe(`DELETE FROM "Variant" WHERE "productId" IN ('prod-b','prod-d')`);
    for (const [label, role] of [["the runtime", RUNTIME], ["the reporter", REPORTER], ["the backup role", BACKUP]]) {
      const bad = runScript("sellable-sku-variantless-backfill.cjs", { OPS_DATABASE_URL: urlAs(role), CONFIRM_SELLABLE_SKU_BACKFILL: "true" }, ["--confirm", "--output", outFile("bf-bad.json")]);
      check(`OPS_DATABASE_URL pointing at ${label} is refused by the identity check and writes nothing`, bad.status !== 0 && /operator identity check failed/.test(bad.err) && noPassword(bad, role) && (await variantCount()) === 1, tail(bad.err));
    }

    // the reports
    const aud = runScript("sellable-sku-variantless-audit-report.cjs", { REPORTER_DATABASE_URL: urlAs(REPORTER) }, ["--output", outFile("audit.json")]);
    const audReport = aud.status === 0 ? jsonOf(outFile("audit.json")) : {};
    check("the audit report as vexa_reporter spans tenants (2 variant-less sellable products, in 2 tenants)", aud.status === 0 && !!audReport.totals && audReport.totals.sellableVariantlessProducts === 2 && Object.keys(audReport.variantlessProductsByTenant || {}).length === 2, tail(aud.err));
    const med = runScript("media-integrity-readonly-report.cjs", { REPORTER_DATABASE_URL: urlAs(REPORTER) }, ["--output", outFile("media.json")]);
    check("the media-integrity report as vexa_reporter reads media assets across tenants (2 rows examined)", med.status === 0 && jsonOf(outFile("media.json")).totals.rowsExamined === 2, tail(med.err));
    for (const [script, label] of [["sellable-sku-variantless-audit-report.cjs", "audit report"], ["media-integrity-readonly-report.cjs", "media report"]]) {
      for (const [who, role] of [["the runtime", RUNTIME], ["ops", OPS], ["the backup role", BACKUP]]) {
        const bad = runScript(script, { REPORTER_DATABASE_URL: urlAs(role) }, ["--output", outFile("rep-bad.json")]);
        check(`REPORTER_DATABASE_URL pointing at ${who} is refused for the ${label}`, bad.status !== 0 && /operator identity check failed/.test(bad.err) && noPassword(bad, role), tail(bad.err));
      }
    }
    check("no report printed the reporter password", [aud, med].every((r) => noPassword(r, REPORTER)));
    await pl.$executeRawUnsafe(`UPDATE "Product" SET status = 'draft' WHERE id IN ('prod-b','prod-d')`);
    check("the operator-script proofs left the seeded data unchanged", sameFingerprint(seeded, await fingerprint(pl)));

    // ---------------------------------------------------------------------------------------------------------------------------
    section("R7c the backup in its production format (plain SQL, gzipped), restored the way the runbook says, and the identity pre-flight");
    const backupRunner = require("../r2-backup-run.cjs");
    const restoreTest = require("../r2-restore-test.cjs");
    // The daily backup runs `pg_dump --format=plain --no-owner --no-privileges`; the restore is `gunzip | psql`. R7 used the custom format,
    // which is not what production writes, so this is the proof that matters.
    const plainDump = pg("pg_dump", ["--format=plain", "--no-owner", "--no-privileges", "-d", PRODLIKE], { user: BACKUP, pass: rehearsalPassword(BACKUP) });
    check("pg_dump as vexa_backup with the daily backup's own flags (plain SQL) succeeds", plainDump.status === 0 && plainDump.stdout.length > 1000, `${plainDump.status} ${plainDump.stderr.slice(0, 200)}`);
    const gzipped = zlib.gzipSync(plainDump.stdout);
    const sqlText = zlib.gunzipSync(gzipped);
    check("the dump ends with pg_dump's completion trailer, which the restore test looks for", sqlText.toString("utf8").slice(-4096).includes(restoreTest.TRAILER));
    await recreate(RESTORED_PLAIN);
    const plainRestore = pg("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate", "--single-transaction", "-d", RESTORED_PLAIN], { user: ADMIN_USER, pass: ADMIN_PASS, input: sqlText });
    check("gunzip | psql restores the plain-SQL backup in one transaction with no error", plainRestore.status === 0, `${plainRestore.status} ${plainRestore.stderr.slice(0, 200)}`);
    const restoredPlain = asAdmin(RESTORED_PLAIN);
    check("the restored database matches the source: same row counts and content hashes, including products, variants, submissions and media", sameFingerprint(seeded, await fingerprint(restoredPlain)));
    const factsRows = await rows(restoredPlain, restoreTest.FACTS_SQL);
    const facts = JSON.parse(factsRows[0].facts);
    const ctxOk = { restoreExit: plainRestore.status, trailerSeen: sqlText.toString("utf8").slice(-4096).includes(restoreTest.TRAILER), ageHours: 0, maxAgeHours: 36 };
    const verdicts = restoreTest.evaluateRestore(facts, ctxOk, manifest);
    check(`the restore test's own verdicts all pass on this restore (${verdicts.length} checks)`, verdicts.every((v) => v.ok), JSON.stringify(verdicts.filter((v) => !v.ok)));
    check("and they fail when the restore is wrong: a truncated dump, a failed psql, and a restore with no policies", !restoreTest.evaluateRestore(facts, { ...ctxOk, trailerSeen: false }, manifest).every((v) => v.ok) && !restoreTest.evaluateRestore(facts, { ...ctxOk, restoreExit: 3 }, manifest).every((v) => v.ok) && !restoreTest.evaluateRestore({ ...facts, policies: 0, rlsTables: 0 }, ctxOk, manifest).every((v) => v.ok));
    const [restoredCount] = await rows(restoredPlain, `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public'`);
    const [sourceCount] = await rows(pl, `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public'`);
    check("every row level security policy came back (the dump kept them although it dropped owners and privileges)", restoredCount.n === sourceCount.n && sourceCount.n > 0, `${restoredCount.n} vs ${sourceCount.n}`);

    // The identity pre-flight the backup job runs when it is given the dedicated credential: this exact statement, against the real roles.
    const identityOf = async (client) => {
      const r = await rows(client, backupRunner.BACKUP_IDENTITY_SQL);
      return r[0] ? { name: r[0].name, super: r[0].super, bypassrls: r[0].bypassrls } : null;
    };
    const asBackup = await identityOf(bk);
    check("the identity statement returns vexa_backup, not a superuser, bypassing RLS, and the pre-flight accepts it", backupRunner.evaluateBackupIdentity(asBackup, "vexa_backup").ok === true, JSON.stringify(asBackup));
    for (const [label, client] of [["the runtime role", rt], ["the reporter", rp], ["ops", op], ["the migrator", asRole(PRODLIKE, MIGRATOR)], ["a superuser (the old application role)", asAdmin(PRODLIKE)]]) {
      const verdict = backupRunner.evaluateBackupIdentity(await identityOf(client), "vexa_backup");
      check(`the pre-flight REFUSES ${label} as the backup credential`, verdict.ok === false, JSON.stringify(verdict));
    }

    // ---------------------------------------------------------------------------------------------------------------------------
    section("R9 a new migration as the migrator on the transferred database");
    const mig = migrate(PRODLIKE, MIGRATOR, rehearsalPassword(MIGRATOR));
    check("prisma migrate deploy as vexa_migrator on the transferred database succeeds (no pending migrations)", mig.status === 0, tail(mig.err || mig.out));
    const mg = asRole(PRODLIKE, MIGRATOR);
    await expectAllowed("migrator can create a new table (a new migration)", mg, `CREATE TABLE public.rehearsal_new_table (id text PRIMARY KEY, tenant_key text NOT NULL DEFAULT 'default')`);
    await expectAllowed("migrator can enable and force RLS and add the policy", mg, `ALTER TABLE public.rehearsal_new_table ENABLE ROW LEVEL SECURITY`);
    await mg.$executeRawUnsafe(`ALTER TABLE public.rehearsal_new_table FORCE ROW LEVEL SECURITY`);
    await mg.$executeRawUnsafe(`CREATE POLICY tenant_isolation_rehearsal_new_table ON public.rehearsal_new_table USING (tenant_key = COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'))`);
    await expectDenied("a table added by a migration is NOT reachable by the runtime until it is classified (fails closed: no default privileges)", rt, `SELECT * FROM public.rehearsal_new_table`);
    const vNew = tool("verify", PRODLIKE);
    check("the verifier FAILS the unclassified table (this is the CI gate that forces the manifest update)", vNew.status === 1 && vNew.out.includes("classified in the runtime grants manifest"), tail(vNew.out));
    const dBad = pg("pg_dump", ["-Fc", "-d", PRODLIKE], { user: BACKUP, pass: rehearsalPassword(BACKUP) });
    check("a backup taken before the new table is granted FAILS LOUDLY (it does not silently omit the table)", dBad.status !== 0 && /permission denied/i.test(dBad.stderr), `${dBad.status} ${dBad.stderr.slice(0, 200)}`);
    const candidate = JSON.parse(JSON.stringify(manifest));
    candidate.runtime.tables.rehearsal_new_table = "crud";
    const candidateFile = path.join(workdir, "candidate-manifest.json");
    fs.writeFileSync(candidateFile, JSON.stringify(candidate));
    const env = { DB_IDENTITY_MANIFEST: candidateFile };
    check("apply-grants with the manifest that classifies the new table", tool("apply-grants", PRODLIKE, [], env).status === 0);
    check("the verifier passes with the updated manifest", tool("verify", PRODLIKE, [], env).status === 0);
    await mg.$executeRawUnsafe(`INSERT INTO rehearsal_new_table (id, tenant_key) VALUES ('n-a','tenant-a'), ('n-b','tenant-b')`);
    const na = await inTenant(rt, "tenant-a", (tx) => tx.$queryRawUnsafe(`SELECT id FROM rehearsal_new_table`));
    check("the runtime now reaches the new table, still tenant-isolated by its policy", na.length === 1 && na[0].id === "n-a", JSON.stringify(na));
    const dOk = pg("pg_dump", ["-Fc", "-d", PRODLIKE], { user: BACKUP, pass: rehearsalPassword(BACKUP) });
    check("the backup succeeds again once the new table is granted (apply-grants must run right after migrate in the deploy)", dOk.status === 0, `${dOk.status} ${dOk.stderr.slice(0, 200)}`);

    // ---------------------------------------------------------------------------------------------------------------------------
    section("R9c the deploy runner in its opt-in mode: migrate as the migrator, then grant as the migrator, and refuse before changing a grant");
    const runRunner = (extraEnv) => {
      const r = cp.spawnSync(process.execPath, [path.join(ROOT, "scripts", "prisma-migrate-deploy.cjs")], {
        cwd: ROOT,
        env: { ...process.env, MIGRATION_DATABASE_URL: "", DATABASE_URL_DIRECT: "", DATABASE_URL: "", DB_IDENTITY_MANIFEST: "", ...extraEnv },
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      });
      return { status: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
    };
    const toolAs = (db, user, pass, extraEnv) =>
      cp.spawnSync(process.execPath, [path.join(__dirname, "tool.cjs"), "apply-grants"], {
        cwd: ROOT,
        env: { ...process.env, DB_IDENTITY_ADMIN_URL: urlFor(db, user, pass), DB_IDENTITY_ALLOW_REMOTE_APPLY_GRANTS: "1", ...extraEnv },
        encoding: "utf8",
      });
    const migratorUrl = urlFor(PRODLIKE, MIGRATOR, rehearsalPassword(MIGRATOR));
    const runtimeUrl = urlFor(PRODLIKE, RUNTIME, rehearsalPassword(RUNTIME));
    const reachesNewTable = async () => (await inTenant(rt, "tenant-a", (tx) => tx.$queryRawUnsafe(`SELECT id FROM rehearsal_new_table`))).length === 1;

    const asRuntime = runRunner({ DATABASE_URL_DIRECT: runtimeUrl });
    check("a deploy that still migrates with the runtime credential FAILS after the transfer (the runtime cannot run migrations)", asRuntime.status !== 0, tail(asRuntime.out));

    const okRun = runRunner({ MIGRATION_DATABASE_URL: migratorUrl, DATABASE_URL_DIRECT: runtimeUrl, DB_IDENTITY_MANIFEST: candidateFile });
    check("the opt-in deploy succeeds as the migrator even though a runtime URL is also present", okRun.status === 0 && okRun.out.includes("using MIGRATION_DATABASE_URL") && okRun.out.includes("strict verify"), tail(okRun.out));
    check("the deploy output never contains a password", !okRun.out.includes(rehearsalPassword(MIGRATOR)) && !okRun.out.includes(rehearsalPassword(RUNTIME)));
    check("the runtime still reaches the classified new table after the deploy's grants", await reachesNewTable());

    const unclassified = runRunner({ MIGRATION_DATABASE_URL: migratorUrl });
    check("a deploy whose migrations added a table the manifest does not classify FAILS (loudly, in the deploy)", unclassified.status !== 0 && /not classified in the grants manifest/.test(unclassified.out), tail(unclassified.out));
    check("and it refused BEFORE changing any grant: the running application still reaches the table", await reachesNewTable());

    const strictOnly = { DB_IDENTITY_MANIFEST: candidateFile };
    const asRt = toolAs(PRODLIKE, RUNTIME, rehearsalPassword(RUNTIME), strictOnly);
    check("strict apply-grants refuses to run as the runtime role", asRt.status === 3 && /only as vexa_migrator/.test(asRt.stderr), tail(asRt.stderr));
    const asSuper = toolAs(PRODLIKE, ADMIN_USER, ADMIN_PASS, strictOnly);
    check("strict apply-grants refuses to run as a superuser", asSuper.status === 3 && /only as vexa_migrator/.test(asSuper.stderr), tail(asSuper.stderr));
    const beforeOwnership = toolAs(RESTORED, MIGRATOR, rehearsalPassword(MIGRATOR), strictOnly);
    check("strict apply-grants refuses before the ownership transfer is complete", beforeOwnership.status === 3 && /ownership transfer is not complete/.test(beforeOwnership.stderr), tail(beforeOwnership.stderr));
    check("none of those refusals changed a grant", await reachesNewTable());
    const localNoFlag = cp.spawnSync(process.execPath, [path.join(__dirname, "tool.cjs"), "apply-grants"], {
      cwd: ROOT,
      env: { ...process.env, DB_IDENTITY_ADMIN_URL: adminFor(PRODLIKE), DB_IDENTITY_ALLOW_REMOTE_APPLY_GRANTS: "", DB_IDENTITY_MANIFEST: candidateFile },
      encoding: "utf8",
    });
    check("without the runner's flag the tool behaves exactly as before (local, no strict checks)", localNoFlag.status === 0 && !/strict verify/.test(localNoFlag.stdout || ""), tail(localNoFlag.stderr));

    // ---------------------------------------------------------------------------------------------------------------------------
    section("R9b data-fixing migrations: why the migrator has BYPASSRLS");
    const fixAll = await mg.$executeRawUnsafe(`UPDATE workflow_sla SET review_target_days = 5`);
    check("a data-fixing migration run as the migrator reaches every tenant (3 rows)", fixAll === 3, `rows ${fixAll}`);
    await pl.$executeRawUnsafe(`ALTER ROLE "${MIGRATOR}" NOBYPASSRLS`);
    const mgNo = asRole(PRODLIKE, MIGRATOR);
    const fixOne = await mgNo.$executeRawUnsafe(`UPDATE workflow_sla SET review_target_days = 6`);
    check("FINDING reproduced: the same statement as a NOBYPASSRLS owner reaches only the default tenant (1 row), silently", fixOne === 1, `rows ${fixOne}`);
    await pl.$executeRawUnsafe(`ALTER ROLE "${MIGRATOR}" BYPASSRLS`);
    await pl.$executeRawUnsafe(`UPDATE workflow_sla SET review_target_days = 3`);

    // ---------------------------------------------------------------------------------------------------------------------------
    section("R10 a fresh database built entirely as the non-superuser migrator");
    await recreate(FRESH);
    check("create-roles on the fresh database", tool("create-roles", FRESH).status === 0);
    const fresh = migrate(FRESH, MIGRATOR, rehearsalPassword(MIGRATOR));
    check("EVERY migration applies as vexa_migrator (no migration needs a superuser)", fresh.status === 0, tail(fresh.err || fresh.out));
    const fo = asAdmin(FRESH);
    const freshOwners = await ownersOf(fo);
    check("everything the migrations created is owned by the migrator from the start", freshOwners.every((o) => o.owner === MIGRATOR), JSON.stringify([...new Set(freshOwners.filter((o) => o.owner !== MIGRATOR).map((o) => o.owner))]));
    check("apply-grants on the fresh database", tool("apply-grants", FRESH).status === 0);
    const vf = tool("verify", FRESH);
    check("the target-model verifier passes on the fresh database", vf.status === 0, tail(vf.out));
  } finally {
    await Promise.all(clients.map((c) => c.$disconnect().catch(() => undefined)));
    if (!KEEP) {
      const a = new PrismaClient({ datasources: { db: { url: adminFor("postgres") } }, log: [] });
      for (const db of [PRODLIKE, FRESH, RESTORED]) {
        await a.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`).catch(() => undefined);
      }
      await a.$disconnect().catch(() => undefined);
    }
    fs.rmSync(workdir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? "REHEARSAL PASSED" : "REHEARSAL FAILED"}: ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    for (const f of failed) {
      console.log(`  failed: ${f.name}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(String(error && error.stack ? error.stack : error).split("\n").slice(0, 6).join("\n"));
  process.exit(1);
});
