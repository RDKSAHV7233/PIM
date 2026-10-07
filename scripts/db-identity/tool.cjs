#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001 I1: database identity foundation tool.
 *
 *   node scripts/db-identity/tool.cjs snapshot            [--out file]    read-only: owners of every table, enum type and function
 *   node scripts/db-identity/tool.cjs plan-ownership                      read-only: the exact SQL the ownership transfer would run
 *   node scripts/db-identity/tool.cjs verify              [--json]        read-only: evaluates the target model, exits non-zero on any failure
 *   node scripts/db-identity/tool.cjs create-roles                        idempotent: creates the five identities
 *   node scripts/db-identity/tool.cjs apply-ownership                     transfers ownership of public objects to vexa_migrator (one transaction)
 *   node scripts/db-identity/tool.cjs rollback-ownership --snapshot file  restores the owners recorded in a before-snapshot
 *   node scripts/db-identity/tool.cjs apply-grants                        applies the grants manifest (revoke everything, then grant explicitly)
 *
 * DB_IDENTITY_ADMIN_URL is required and explicit. **Every write mode refuses any host that is not local**: I1 is rehearsal and
 * foundation only, and a production ownership transfer, credential rotation or cutover is out of scope until separately authorised
 * (and until GitHub branch protection is in place). The read-only modes never print a URL, user or password.
 */
const fs = require("node:fs");
const path = require("node:path");
const lib = require("./lib.cjs");

const MODEL_DIR = path.resolve(__dirname, "..", "..", "packages", "db", "identity");
const WRITE_MODES = new Set(["create-roles", "apply-ownership", "rollback-ownership", "apply-grants"]);
const READ_MODES = new Set(["snapshot", "plan-ownership", "verify"]);

function loadManifest() {
  // DB_IDENTITY_MANIFEST lets the rehearsal evaluate a candidate manifest (for example one that classifies a table a new migration added).
  const file = String(process.env.DB_IDENTITY_MANIFEST || "").trim() || path.join(MODEL_DIR, "identity-model.v1.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = next;
        i += 1;
      }
    } else {
      out._.push(argv[i]);
    }
  }
  return out;
}

const quoteIdent = (s) => `"${String(s).replace(/"/g, '""')}"`;
const quoteLiteral = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function gatherObjects(db) {
  const tables = await db.$queryRawUnsafe("SELECT c.relname AS name, pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p') ORDER BY 1");
  const types = await db.$queryRawUnsafe("SELECT t.typname AS name, pg_get_userbyid(t.typowner) AS owner FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype = 'e' ORDER BY 1");
  const functions = await db.$queryRawUnsafe("SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args, pg_get_userbyid(p.proowner) AS owner FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prokind = 'f' ORDER BY 1");
  return [
    ...tables.map((t) => ({ kind: "table", name: t.name, owner: t.owner })),
    ...types.map((t) => ({ kind: "type", name: t.name, owner: t.owner })),
    ...functions.map((f) => ({ kind: "function", name: f.name, args: f.args, owner: f.owner })),
  ];
}

async function gatherState(db) {
  const names = Object.values(lib.ROLES).map((r) => r.name);
  const roles = await db.$queryRawUnsafe(`SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication, rolcanlogin FROM pg_roles WHERE rolname IN (${names.map(quoteLiteral).join(",")})`);
  const objects = await gatherObjects(db);
  const tables = objects.filter((o) => o.kind === "table").map((o) => o.name);
  const effective = {};
  const schemaCreate = {};
  for (const r of roles) {
    const rows = await db.$queryRawUnsafe(`SELECT c.relname AS t, p.priv FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN unnest(ARRAY[${lib.PRIVILEGES.map(quoteLiteral).join(",")}]) AS p(priv) WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND has_table_privilege(${quoteLiteral(r.rolname)}, c.oid, p.priv)`);
    effective[r.rolname] = {};
    for (const row of rows) {
      (effective[r.rolname][row.t] = effective[r.rolname][row.t] || []).push(row.priv);
    }
    const [c] = await db.$queryRawUnsafe(`SELECT has_schema_privilege(${quoteLiteral(r.rolname)}, 'public', 'CREATE') AS can_create`);
    schemaCreate[r.rolname] = c.can_create === true;
  }
  const [pub] = await db.$queryRawUnsafe("SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee = 'PUBLIC'");
  const memberships = await db.$queryRawUnsafe("SELECT pg_get_userbyid(roleid) AS role, pg_get_userbyid(member) AS member FROM pg_auth_members");
  return { roles, objects, tables, effective, publicTableGrants: pub.n, memberships, schemaCreate };
}

function hostOf(url) {
  return new URL(url).hostname;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args._[0];
  if (!WRITE_MODES.has(mode) && !READ_MODES.has(mode)) {
    console.error(`usage: tool.cjs ${[...READ_MODES, ...WRITE_MODES].join(" | ")}   (needs DB_IDENTITY_ADMIN_URL)`);
    process.exit(2);
  }
  const adminUrl = String(process.env.DB_IDENTITY_ADMIN_URL || "").trim();
  if (!adminUrl) {
    console.error("DB_IDENTITY_ADMIN_URL is required: the target is never guessed.");
    process.exit(2);
  }
  const host = hostOf(adminUrl);
  if (WRITE_MODES.has(mode) && !["localhost", "127.0.0.1", "::1"].includes(host)) {
    console.error(`${mode} refused: it writes, and I1 only ever writes to a local rehearsal database. Production ownership transfer, credential rotation and cutover are out of scope and need separate authorisation.`);
    process.exit(3);
  }

  const { PrismaClient } = require("@prisma/client");
  const db = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const manifest = loadManifest();
  const migrator = lib.ROLES.migrator.name;
  try {
    if (mode === "snapshot") {
      const objects = await gatherObjects(db);
      const out = { takenAt: new Date().toISOString(), owners: lib.ownerSummary(objects), objects };
      if (args.out) {
        fs.writeFileSync(args.out, `${JSON.stringify(out, null, 2)}\n`);
      }
      console.log(JSON.stringify({ owners: out.owners, objects: objects.length }));
    } else if (mode === "plan-ownership") {
      const objects = await gatherObjects(db);
      const plan = lib.buildOwnershipPlan(objects, migrator);
      console.log(`-- ${plan.length} statement(s); metadata only, no data is rewritten\nBEGIN;\n${plan.map((s) => `${s};`).join("\n")}\nCOMMIT;`);
    } else if (mode === "verify") {
      const state = await gatherState(db);
      const findings = lib.evaluateModel(state, manifest);
      const failed = findings.filter((f) => !f.ok);
      for (const f of findings) {
        console.log(`${f.ok ? "PASS" : "FAIL"} ${f.check}${f.detail === undefined ? "" : `  ${JSON.stringify(f.detail)}`}`);
      }
      console.log(`\n${failed.length === 0 ? "VERIFIED" : "NOT VERIFIED"}: ${findings.length - failed.length}/${findings.length} checks passed`);
      if (failed.length > 0) {
        process.exitCode = 1;
      }
    } else if (mode === "create-roles") {
      const pw = (key) => {
        const v = process.env[`DB_IDENTITY_${key.toUpperCase()}_PASSWORD`];
        return v && v.trim() ? v.trim() : `${lib.ROLES[key].name}_rehearsal_password`;
      };
      for (const [key, r] of Object.entries(lib.ROLES)) {
        const attrs = `LOGIN NOSUPERUSER ${r.bypassrls ? "BYPASSRLS" : "NOBYPASSRLS"} NOCREATEDB NOCREATEROLE NOREPLICATION`;
        const exists = await db.$queryRawUnsafe(`SELECT 1 FROM pg_roles WHERE rolname = ${quoteLiteral(r.name)}`);
        await db.$executeRawUnsafe(`${exists.length ? "ALTER" : "CREATE"} ROLE ${quoteIdent(r.name)} WITH ${attrs} PASSWORD ${quoteLiteral(pw(key))}`);
      }
      const [dbRow] = await db.$queryRawUnsafe("SELECT current_database() AS name");
      for (const r of Object.values(lib.ROLES)) {
        await db.$executeRawUnsafe(`GRANT CONNECT ON DATABASE ${quoteIdent(dbRow.name)} TO ${quoteIdent(r.name)}`);
        await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${quoteIdent(r.name)}`);
      }
      await db.$executeRawUnsafe(`GRANT CREATE ON SCHEMA public TO ${quoteIdent(migrator)}`);
      console.log("roles created or updated: " + Object.values(lib.ROLES).map((r) => r.name).join(", "));
    } else if (mode === "apply-ownership") {
      const objects = await gatherObjects(db);
      const plan = lib.buildOwnershipPlan(objects, migrator);
      await db.$transaction(async (tx) => {
        for (const statement of plan) {
          await tx.$executeRawUnsafe(statement);
        }
      });
      const after = await gatherObjects(db);
      console.log(JSON.stringify({ statements: plan.length, ownersAfter: lib.ownerSummary(after) }));
    } else if (mode === "rollback-ownership") {
      if (!args.snapshot || args.snapshot === true) {
        console.error("rollback-ownership needs --snapshot <file> taken before the transfer.");
        process.exit(2);
      }
      const before = JSON.parse(fs.readFileSync(args.snapshot, "utf8")).objects;
      const current = await gatherObjects(db);
      const plan = lib.buildRollbackPlan(before, current);
      await db.$transaction(async (tx) => {
        for (const statement of plan) {
          await tx.$executeRawUnsafe(statement);
        }
      });
      console.log(JSON.stringify({ statements: plan.length, restored: lib.sameOwnership(before, await gatherObjects(db)) }));
    } else if (mode === "apply-grants") {
      const objects = await gatherObjects(db);
      const tables = objects.filter((o) => o.kind === "table").map((o) => o.name);
      const excluded = new Set(manifest.runtime.excluded || []);
      await db.$transaction(async (tx) => {
        for (const key of ["runtime", "ops", "backup", "reporter"]) {
          const role = quoteIdent(lib.ROLES[key].name);
          await tx.$executeRawUnsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`);
          for (const table of tables) {
            const want = key === "runtime" && excluded.has(table) ? [] : lib.expectedPrivileges(manifest, key, table);
            if (want === null) {
              continue;
            }
            if (want.length > 0) {
              await tx.$executeRawUnsafe(`GRANT ${want.join(", ")} ON public.${quoteIdent(table)} TO ${role}`);
            }
          }
        }
      });
      console.log(`grants applied for runtime, ops, backup and reporter over ${tables.length} tables`);
    }
  } finally {
    await db.$disconnect().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(String(error && error.message ? error.message : error).split("\n")[0].slice(0, 300));
  process.exit(1);
});
