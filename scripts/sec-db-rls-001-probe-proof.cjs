#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * Live proof for the SEC-DB-RLS-001 read-only probe, against a LOCAL, THROWAWAY PostgreSQL that reproduces the production shape.
 *
 *   PROBE_PROOF_ADMIN_URL=postgresql://postgres:postgres@localhost:5432/postgres node scripts/sec-db-rls-001-probe-proof.cjs
 *
 * It builds the production-like database (all migrations as the owner, then a superuser `vexa_app_v2` that owns exactly the 15
 * tables, 2 functions and 9 enum types observed in production), runs the probe as that superuser, then applies the I1 target
 * model locally and runs the same probe as each target identity. Every claim the probe makes is cross-checked against a
 * separate catalog query made by the admin connection. It refuses any host that is not local and never touches a real database.
 */
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

const ROOT = path.resolve(__dirname, "..");
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "packages", "db", "identity", "production-ownership-split.v1.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "packages", "db", "identity", "identity-model.v1.json"), "utf8"));

const adminRaw = String(process.env.PROBE_PROOF_ADMIN_URL || "").trim();
if (!adminRaw) {
  console.error("PROBE_PROOF_ADMIN_URL is required (a local PostgreSQL superuser URL). The target is never guessed.");
  process.exit(2);
}
const admin = new URL(adminRaw);
if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(admin.hostname)) {
  console.error("The proof only runs against a local database. Refusing.");
  process.exit(3);
}
const HOST = admin.hostname;
const PORT = admin.port || "5432";
const ADMIN_USER = decodeURIComponent(admin.username);
const ADMIN_PASS = decodeURIComponent(admin.password);
const DB = "probe_proof_prodlike";
const OLD_OWNER = fixture.currentOwner;
const pw = (role) => `${role}_rehearsal_password`;
// Roles are cluster-level: a failed earlier run can leave them behind, and they must not outlive this proof on a shared server.
const ROLES_MADE = [OLD_OWNER, "vexa_runtime", "vexa_backup", "vexa_reporter", "vexa_ops", "vexa_migrator", "probe_nobody"];
const urlFor = (db, user, pass) => `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${HOST}:${PORT}/${db}?schema=public`;

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: Boolean(ok) });
  console.error(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  -> ${detail}` : ""}`);
};

function run(file, args, env) {
  const r = cp.spawnSync(process.execPath, [file, ...args], { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, out: r.stdout || "", err: r.stderr || "" };
}

function probeAs(user, pass, label) {
  const out = path.join(os.tmpdir(), `probe-proof-${label}-${process.pid}.json`);
  const r = run(path.join(__dirname, "sec-db-rls-001-probe.cjs"), ["database"], { PROBE_DATABASE_URL: urlFor(DB, user, pass), PROBE_OUT: out });
  const evidence = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : null;
  if (fs.existsSync(out)) fs.unlinkSync(out);
  return { ...r, evidence, text: r.out + r.err, secret: pass };
}

const sec = (p, name) => p.evidence.sections[name];
const S = {
  me: "connected identity",
  eff: "effective privileges of the connected role",
  dbAcl: "database privileges (ACL, including the implicit defaults)",
  schemaAcl: "schema privileges (ACL, including the implicit defaults)",
  rls: "row level security per table (owner, enabled, forced, policies, tenant key)",
  policies: "RLS policies (every policy: table, permissive, roles, command, USING, WITH CHECK)",
  distinct: "distinct policy expressions (grouped)",
  funcs: "functions and procedures (owner, security definer, who may EXECUTE)",
  notDbOwner: "objects NOT owned by the database owner (names only: tables, functions, enum types)",
  relPrivs: "relation privileges held by roles other than the owner (counts by kind, grantee and privilege)",
  findings: "derived findings (computed from the sections above; booleans, counts and names)",
};

async function main() {
  const adminDb = new PrismaClient({ datasources: { db: { url: urlFor("postgres", ADMIN_USER, ADMIN_PASS) } } });
  await adminDb.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  for (const role of ROLES_MADE) await adminDb.$executeRawUnsafe(`DROP ROLE IF EXISTS "${role}"`).catch(() => undefined);
  await adminDb.$executeRawUnsafe(`CREATE DATABASE ${DB}`);
  await adminDb.$disconnect();

  const prismaCli = require.resolve("prisma/build/index.js", { paths: [ROOT] });
  const migrateUrl = urlFor(DB, ADMIN_USER, ADMIN_PASS);
  const m = run(prismaCli, ["migrate", "deploy", "--schema", path.join(ROOT, "packages", "db", "prisma", "schema.prisma")], {
    DATABASE_URL: migrateUrl, DATABASE_URL_POOLED: migrateUrl, DATABASE_URL_DIRECT: migrateUrl, CHECKPOINT_DISABLE: "1",
  });
  check("every migration applies to the proof database", m.status === 0, (m.err || m.out).slice(-300));

  const a = new PrismaClient({ datasources: { db: { url: urlFor(DB, ADMIN_USER, ADMIN_PASS) } } });
  const q = (sql) => a.$queryRawUnsafe(sql);
  await a.$executeRawUnsafe(`CREATE ROLE "${OLD_OWNER}" WITH LOGIN SUPERUSER PASSWORD '${pw(OLD_OWNER)}'`);
  for (const t of fixture.tables) await a.$executeRawUnsafe(`ALTER TABLE public."${t}" OWNER TO "${OLD_OWNER}"`);
  for (const t of fixture.enumTypes) await a.$executeRawUnsafe(`ALTER TYPE public."${t}" OWNER TO "${OLD_OWNER}"`);
  for (const f of fixture.functions) {
    const [{ args }] = await q(`SELECT pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = '${f}'`);
    await a.$executeRawUnsafe(`ALTER FUNCTION public."${f}"(${args}) OWNER TO "${OLD_OWNER}"`);
  }

  // Independent facts, from the admin connection (not from the probe)
  const [{ n: tenantTables }] = await q(`SELECT count(DISTINCT c.relname)::int AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace JOIN pg_attribute at ON at.attrelid = c.oid WHERE ns.nspname = 'public' AND c.relkind = 'r' AND at.attname IN ('tenant_key','tenantKey') AND NOT at.attisdropped`);
  const [{ n: rlsNotForced }] = await q(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND NOT c.relforcerowsecurity`);
  const [{ n: policies }] = await q(`SELECT count(*)::int AS n FROM pg_policy`);
  const [{ n: enumTypes }] = await q(`SELECT count(*)::int AS n FROM pg_type t JOIN pg_namespace ns ON ns.oid = t.typnamespace WHERE ns.nspname = 'public' AND t.typtype = 'e'`);
  const [{ n: tableCount }] = await q(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind = 'r'`);
  const manifestTables = Object.keys(manifest.runtime.tables);
  const crudTables = manifestTables.filter((t) => manifest.runtime.tables[t] === "crud").length;
  const updTables = manifestTables.filter((t) => ["crud", "select-update"].includes(manifest.runtime.tables[t])).length;

  // ── Production-like: the deployed superuser ──────────────────────────────────────────────────────────────────────
  console.error("\n== as the deployed role (superuser, owner of the fixture objects)");
  const prod = probeAs(OLD_OWNER, pw(OLD_OWNER), "prod");
  check("the probe completes", prod.status === 0 && prod.evidence?.result === "COMPLETE", prod.text.slice(-300));
  check("never prints the password or a connection string", !prod.text.includes(prod.secret) && !/postgres(ql)?:\/\//i.test(prod.text));
  check("no section is unavailable for the superuser", Object.values(prod.evidence.sections).every((v) => !(v && v.unavailable)));
  check("connected identity: superuser, login, inherit", sec(prod, S.me).rolsuper === true && sec(prod, S.me).rolcanlogin === true && sec(prod, S.me).rolinherit === true && sec(prod, S.me).current_user === OLD_OWNER);
  check("the objects not owned by the database owner are exactly the 15 tables, 2 functions and 9 enum types of the fixture", (() => {
    const rows = sec(prod, S.notDbOwner);
    const names = (kind) => rows.filter((r) => r.kind === kind).map((r) => r.name).sort();
    return JSON.stringify(names("table")) === JSON.stringify([...fixture.tables].sort()) && JSON.stringify(names("function")) === JSON.stringify([...fixture.functions].sort()) && JSON.stringify(names("enum type")) === JSON.stringify([...fixture.enumTypes].sort()) && rows.every((r) => r.owner === OLD_OWNER);
  })());
  check("database ACL shows the implicit PUBLIC CONNECT and TEMPORARY", sec(prod, S.dbAcl).some((r) => r.grantee === "PUBLIC" && r.privilege_type === "CONNECT") && sec(prod, S.dbAcl).some((r) => r.grantee === "PUBLIC" && r.privilege_type === "TEMPORARY"));
  check("schema ACL: PUBLIC has USAGE and not CREATE on public", sec(prod, S.schemaAcl).some((r) => r.schema === "public" && r.grantee === "PUBLIC" && r.privilege_type === "USAGE") && !sec(prod, S.schemaAcl).some((r) => r.schema === "public" && r.grantee === "PUBLIC" && r.privilege_type === "CREATE"));
  check(`tenant-keyed tables match the independent count (${tenantTables})`, sec(prod, S.findings).tenantKeyedTables === tenantTables, `${sec(prod, S.findings).tenantKeyedTables}`);
  check(`RLS enabled but not forced matches the independent count (${rlsNotForced})`, sec(prod, S.eff).owned_tables_exempt_from_rls === rlsNotForced && sec(prod, S.findings).ownedTablesWhereRlsIsEnabledButNotForced === rlsNotForced, `${sec(prod, S.eff).owned_tables_exempt_from_rls}`);
  const [{ enabled: rlsEnabledTotal, forced: rlsForcedTotal }] = await q(`SELECT count(*) FILTER (WHERE c.relrowsecurity)::int AS enabled, count(*) FILTER (WHERE c.relforcerowsecurity)::int AS forced FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'`);
  check(`per-table RLS flags match the independent counts (enabled ${rlsEnabledTotal}, forced ${rlsForcedTotal})`, sec(prod, S.rls).filter((t) => t.table_name !== "_prisma_migrations" && t.rls_enabled).length === rlsEnabledTotal && sec(prod, S.rls).filter((t) => t.table_name !== "_prisma_migrations" && t.rls_forced).length === rlsForcedTotal);
  check(`policy count matches the independent count (${policies})`, sec(prod, S.policies).length === policies && sec(prod, S.findings).policiesTotal === policies);
  check("every policy expression is printed (USING present on every policy)", sec(prod, S.policies).every((p) => typeof p.using_expression === "string" && p.using_expression.length > 0 || p.cmd === "INSERT"));
  check("WITH CHECK expressions are printed for the write policies", sec(prod, S.policies).some((p) => typeof p.with_check_expression === "string" && /app\.tenant_key/.test(p.with_check_expression)));
  check("the entitlement policy is SELECT-only and keyed on app.tenant_key", sec(prod, S.policies).some((p) => p.table_name === "connector_tenant_entitlements" && p.cmd === "SELECT" && /app\.tenant_key/.test(p.using_expression)));
  check("the grouped policy expressions account for every policy", sec(prod, S.distinct).reduce((s, r) => s + r.policies, 0) === policies);
  check(`enum types usable by PUBLIC match the independent count (${enumTypes})`, sec(prod, S.findings).enumTypesUsableByPublic === enumTypes, `${sec(prod, S.findings).enumTypesUsableByPublic}`);
  check("both functions are listed with their owner and PUBLIC EXECUTE", fixture.functions.every((f) => sec(prod, S.funcs).some((r) => r.name === f && r.owner === OLD_OWNER && r.executable_by.includes("PUBLIC"))));
  check("the superuser bypasses RLS and owns every table through inheritance of ownership", sec(prod, S.findings).connectedRoleBypassesRls === true && sec(prod, S.eff).tables_owned_or_inherited === tableCount);

  // ── Target model, applied locally ────────────────────────────────────────────────────────────────────────────────
  console.error("\n== apply the I1 target model locally");
  const tool = (mode) => run(path.join(__dirname, "db-identity", "tool.cjs"), [mode], { DB_IDENTITY_ADMIN_URL: urlFor(DB, ADMIN_USER, ADMIN_PASS) });
  for (const mode of ["create-roles", "apply-ownership", "apply-grants"]) {
    const r = tool(mode);
    check(`I1 tool ${mode}`, r.status === 0, (r.err || r.out).slice(-200));
  }

  console.error("\n== as vexa_runtime (the target application identity)");
  const rt = probeAs("vexa_runtime", pw("vexa_runtime"), "runtime");
  check("the probe completes as the restricted role", rt.status === 0 && rt.evidence?.result === "COMPLETE", rt.text.slice(-300));
  check("not superuser, no BYPASSRLS, cannot create roles or databases", sec(rt, S.me).rolsuper === false && sec(rt, S.me).rolbypassrls === false && sec(rt, S.me).rolcreaterole === false && sec(rt, S.me).rolcreatedb === false);
  check("it does not bypass RLS and owns nothing", sec(rt, S.findings).connectedRoleBypassesRls === false && sec(rt, S.eff).tables_owned_or_inherited === 0 && sec(rt, S.eff).owned_tables_exempt_from_rls === 0);
  check("it cannot create in the public schema or the database", sec(rt, S.eff).public_schema_create === false && sec(rt, S.eff).database_create === false);
  check(`it can read every listed table (${manifestTables.length})`, sec(rt, S.eff).tables_select === manifestTables.length, `${sec(rt, S.eff).tables_select}`);
  check(`INSERT on ${crudTables} tables, UPDATE on ${updTables}, as the manifest says`, sec(rt, S.eff).tables_insert === crudTables && sec(rt, S.eff).tables_update === updTables, `insert ${sec(rt, S.eff).tables_insert} update ${sec(rt, S.eff).tables_update}`);
  check("no TRUNCATE, REFERENCES or TRIGGER anywhere", sec(rt, S.eff).tables_truncate === 0 && sec(rt, S.eff).tables_references === 0 && sec(rt, S.eff).tables_trigger === 0);
  check("it cannot read the migrations table", sec(rt, S.eff).tables_select === tableCount - 1);
  check("no sequences exist or are usable", sec(rt, S.eff).sequences === 0 && sec(rt, S.eff).sequences_usable === 0);
  check("it holds no role memberships beyond its own", !sec(rt, "role memberships").some((r) => r.member_name === "vexa_runtime"));

  console.error("\n== as vexa_backup");
  const bk = probeAs("vexa_backup", pw("vexa_backup"), "backup");
  check("the backup identity bypasses RLS, reads every table and writes nothing", bk.status === 0 && sec(bk, S.me).rolbypassrls === true && sec(bk, S.me).rolsuper === false && sec(bk, S.eff).tables_select === tableCount && sec(bk, S.eff).tables_insert === 0 && sec(bk, S.eff).tables_update === 0 && sec(bk, S.eff).tables_delete === 0);

  console.error("\n== as vexa_reporter");
  const rp = probeAs("vexa_reporter", pw("vexa_reporter"), "reporter");
  check(
    "the reporter bypasses RLS because a report spans tenants, reads exactly its four report tables, and writes nothing",
    rp.status === 0 && sec(rp, S.me).rolbypassrls === true && sec(rp, S.me).rolsuper === false && sec(rp, S.eff).tables_select === 4 && sec(rp, S.eff).tables_insert === 0 && sec(rp, S.eff).tables_update === 0 && sec(rp, S.eff).tables_delete === 0 && sec(rp, S.eff).tables_truncate === 0,
  );
  check("the reporter owns nothing and cannot create in the schema or the database", sec(rp, S.eff).tables_owned_or_inherited === 0 && sec(rp, S.eff).public_schema_create === false && sec(rp, S.eff).database_create === false);

  console.error("\n== as vexa_ops");
  const ops = probeAs("vexa_ops", pw("vexa_ops"), "ops");
  check(
    "the operator identity writes only the two platform control tables, plus INSERT of variants for the backfill, reads the tenant directory it lists tenants from, and does not bypass RLS",
    ops.status === 0 && sec(ops, S.eff).tables_select === 5 && sec(ops, S.eff).tables_insert === 3 && sec(ops, S.eff).tables_update === 2 && sec(ops, S.eff).tables_delete === 2 && sec(ops, S.me).rolbypassrls === false,
  );

  console.error("\n== as vexa_migrator");
  const mg = probeAs("vexa_migrator", pw("vexa_migrator"), "migrator");
  check("the migrator owns every table and is exempt from RLS exactly where RLS is enabled but not forced", mg.status === 0 && sec(mg, S.eff).tables_owned_or_inherited === tableCount && sec(mg, S.eff).owned_tables_exempt_from_rls === rlsNotForced && sec(mg, S.me).rolbypassrls === true && sec(mg, S.me).rolsuper === false);
  check("after the transfer nothing is owned by the old role", sec(mg, S.notDbOwner).every((r) => r.owner !== OLD_OWNER));

  console.error("\n== degraded visibility");
  await a.$executeRawUnsafe(`CREATE ROLE probe_nobody LOGIN PASSWORD '${pw("probe_nobody")}' NOSUPERUSER NOBYPASSRLS`);
  const nobody = probeAs("probe_nobody", pw("probe_nobody"), "nobody");
  check("a role with no grants still gets a complete probe (catalogs are readable) and reports it can read nothing", nobody.status === 0 && sec(nobody, S.eff).tables_select === 0 && sec(nobody, S.eff).tables_insert === 0);

  // The probe wrote nothing: ownership and ACLs are exactly what the tool left
  const [{ n: stillRoles }] = await q(`SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN ('vexa_runtime','vexa_backup','vexa_reporter','vexa_ops','vexa_migrator')`);
  check("the probe created and changed nothing (the five identities are still the only ones the tool made)", stillRoles === 5);

  await a.$disconnect();
  const cleanup = new PrismaClient({ datasources: { db: { url: urlFor("postgres", ADMIN_USER, ADMIN_PASS) } } });
  await cleanup.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  for (const role of ROLES_MADE) await cleanup.$executeRawUnsafe(`DROP ROLE IF EXISTS "${role}"`).catch(() => undefined);
  await cleanup.$disconnect();
}

main()
  .catch((error) => check("proof run completed without an unexpected error", false, String(error && error.message ? error.message : error).slice(0, 300)))
  .finally(() => {
    const failed = checks.filter((c) => !c.ok);
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), passed: checks.length - failed.length, failed: failed.length, failures: failed.map((f) => f.name) }, null, 2));
    process.exitCode = failed.length === 0 ? 0 : 1;
  });
