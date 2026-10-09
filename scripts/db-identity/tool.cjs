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
 *   node scripts/db-identity/tool.cjs narrow-public                       revokes PUBLIC's database and schema privileges (administrator: only the owner can)
 *   node scripts/db-identity/tool.cjs restore-public                      puts PUBLIC's database, schema, function and enum privileges back (rollback of the two above)
 *
 * DB_IDENTITY_ADMIN_URL is required and explicit. **Every write mode refuses any host that is not local**: I1 is rehearsal and
 * foundation only, and a production ownership transfer, credential rotation or cutover is out of scope until separately authorised
 * (and until GitHub branch protection is in place). The read-only modes never print a URL, user or password.
 *
 * One narrow exception (SEC-DB-RLS-001 7.9a): `apply-grants` may run on a non-local host, and only when the deploy runner asks for it by
 * setting DB_IDENTITY_ALLOW_REMOTE_APPLY_GRANTS=1 (the runner does that only when MIGRATION_DATABASE_URL is configured). That flag also
 * switches on STRICT checks, on every host, so the same code is what the local rehearsal exercises. Strict mode refuses, before changing
 * a single grant, unless: the connection is `vexa_migrator` and not a superuser; every table, enum type and function in `public` is
 * already owned by the migrator (the ownership transfer is done); the other four identities exist; and every table is classified in
 * the manifest (an unclassified table would otherwise be skipped by the revoke-then-grant, leaving the still-running application
 * without access). After the grants it re-verifies the parts of the model the grants are responsible for and fails if any is wrong.
 * It still never creates a role, changes an owner, or prints a URL, user or password.
 */
const fs = require("node:fs");
const path = require("node:path");
const lib = require("./lib.cjs");

const MODEL_DIR = path.resolve(__dirname, "..", "..", "packages", "db", "identity");
const WRITE_MODES = new Set(["create-roles", "apply-ownership", "rollback-ownership", "apply-grants", "narrow-public", "restore-public"]);
const READ_MODES = new Set(["snapshot", "plan-ownership", "verify"]);
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];
/** The verifier checks the strict grants step is accountable for: privileges, classification, ownership, PUBLIC. Role attributes are the cutover's concern. */
const GRANTS_RESPONSIBILITY = /no function in public is executable by PUBLIC|no enum type in public is usable by PUBLIC|can use exactly the enum types|classified in the runtime grants manifest|lists no table that does not exist|ops and reporter grants|holds exactly the manifest privileges|no table privilege is granted to PUBLIC|owned by the migrator|owns nothing|only the migrator can create/;

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

  // SEC-DB-RLS-001 8.3. A NULL ACL means "the built-in default", which grants PUBLIC CONNECT and TEMPORARY on a database, USAGE on a
  // schema, EXECUTE on a function and USAGE on a type: COALESCE with acldefault() so a never-touched object is not read as "no grant".
  const [dbAcl] = await db.$queryRawUnsafe(`SELECT coalesce(bool_or(a.privilege_type = 'CONNECT'), false) AS connect, coalesce(bool_or(a.privilege_type = 'TEMPORARY'), false) AS temporary, coalesce(bool_or(a.privilege_type = 'CREATE'), false) AS "create" FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a WHERE d.datname = current_database() AND a.grantee = 0`);
  const [schemaAcl] = await db.$queryRawUnsafe(`SELECT coalesce(bool_or(a.privilege_type = 'USAGE'), false) AS usage, coalesce(bool_or(a.privilege_type = 'CREATE'), false) AS "create" FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a WHERE n.nspname = 'public' AND a.grantee = 0`);
  const [fnAcl] = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prokind = 'f' AND EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')`);
  const [typeAcl] = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype = 'e' AND EXISTS (SELECT 1 FROM aclexplode(coalesce(t.typacl, acldefault('T', t.typowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'USAGE')`);
  const identityAccess = {};
  for (const r of roles) {
    const [acc] = await db.$queryRawUnsafe(`SELECT has_database_privilege(${quoteLiteral(r.rolname)}, current_database(), 'CONNECT') AS connect, has_database_privilege(${quoteLiteral(r.rolname)}, current_database(), 'TEMPORARY') AS temporary, has_schema_privilege(${quoteLiteral(r.rolname)}, 'public', 'USAGE') AS schema_usage, (SELECT count(*)::int FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype = 'e' AND has_type_privilege(${quoteLiteral(r.rolname)}, t.oid, 'USAGE')) AS enum_usage`);
    identityAccess[r.rolname] = { connect: acc.connect === true, temporary: acc.temporary === true, schemaUsage: acc.schema_usage === true, enumUsage: acc.enum_usage };
  }
  const enumTotal = objects.filter((o) => o.kind === "type").length;
  const publicAcl = {
    database: { connect: dbAcl.connect === true, temporary: dbAcl.temporary === true, create: dbAcl.create === true },
    schema: { usage: schemaAcl.usage === true, create: schemaAcl.create === true },
    functionsExecutable: fnAcl.n,
    enumTypesUsable: typeAcl.n,
  };
  return { roles, objects, tables, effective, publicTableGrants: pub.n, memberships, schemaCreate, publicAcl, identityAccess, enumTotal };
}

/**
 * Everything strict apply-grants requires before it may change a grant. Returns the reasons it must refuse (empty when it may proceed).
 * Names and counts only: nothing here prints a URL, a user other than the two role names, or a password.
 */
async function strictGrantsRefusals(db, manifest) {
  const migrator = lib.ROLES.migrator.name;
  const reasons = [];
  const [me] = await db.$queryRawUnsafe("SELECT current_user AS name, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS super");
  if (me.name !== migrator || me.super === true) {
    reasons.push(`apply-grants on this path runs only as ${migrator}, not as ${me.name}${me.super === true ? " (a superuser)" : ""}`);
  }
  const objects = await gatherObjects(db);
  const notMigrator = objects.filter((o) => o.owner !== migrator);
  if (notMigrator.length > 0) {
    reasons.push(`the ownership transfer is not complete: ${notMigrator.length} object(s) are not owned by ${migrator} (for example ${notMigrator.slice(0, 3).map((o) => `${o.kind}:${o.name}`).join(", ")})`);
  }
  const others = Object.values(lib.ROLES).map((r) => r.name).filter((n) => n !== migrator);
  const found = new Set((await db.$queryRawUnsafe(`SELECT rolname FROM pg_roles WHERE rolname IN (${others.map(quoteLiteral).join(",")})`)).map((r) => r.rolname));
  const missing = others.filter((n) => !found.has(n));
  if (missing.length > 0) {
    reasons.push(`these identities do not exist yet: ${missing.join(", ")} (they are created at the cutover, not by a deploy)`);
  }
  const classified = new Set([...Object.keys(manifest.runtime.tables), ...(manifest.runtime.excluded || [])]);
  const unclassified = objects.filter((o) => o.kind === "table" && !classified.has(o.name)).map((o) => o.name);
  if (unclassified.length > 0) {
    reasons.push(`${unclassified.length} table(s) are not classified in the grants manifest: ${unclassified.slice(0, 5).join(", ")}. Classify them in packages/db/identity/identity-model.v1.json in the same change as the migration`);
  }
  return reasons;
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
  // Strict apply-grants: asked for by the deploy runner (never by default), and then checked the same way on every host.
  const strictGrants = mode === "apply-grants" && String(process.env.DB_IDENTITY_ALLOW_REMOTE_APPLY_GRANTS || "").trim() === "1";
  if (WRITE_MODES.has(mode) && !LOCAL_HOSTS.includes(host) && !strictGrants) {
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
    } else if (mode === "narrow-public") {
      // Administrator step (the database and the schema belong to the database owner; the migrator cannot revoke them). The identities
      // are granted explicitly first, so there is no moment at which an identity loses access it needs.
      const [dbRow] = await db.$queryRawUnsafe("SELECT current_database() AS name");
      const names = Object.values(lib.ROLES).map((r) => r.name);
      const missing = (await db.$queryRawUnsafe(`SELECT r AS name FROM unnest(ARRAY[${names.map(quoteLiteral).join(",")}]) AS r WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)`)).map((r) => r.name);
      if (missing.length > 0) {
        console.error(`narrow-public refused: these identities do not exist yet (run create-roles first): ${missing.join(", ")}`);
        process.exit(3);
      }
      await db.$transaction(async (tx) => {
        for (const name of names) {
          await tx.$executeRawUnsafe(`GRANT CONNECT ON DATABASE ${quoteIdent(dbRow.name)} TO ${quoteIdent(name)}`);
          await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${quoteIdent(name)}`);
        }
        await tx.$executeRawUnsafe(`REVOKE ALL ON DATABASE ${quoteIdent(dbRow.name)} FROM PUBLIC`);
        await tx.$executeRawUnsafe("REVOKE ALL ON SCHEMA public FROM PUBLIC");
      });
      console.log("PUBLIC's privileges on the database and the public schema are revoked; the five identities hold explicit CONNECT and USAGE");
    } else if (mode === "restore-public") {
      const [dbRow] = await db.$queryRawUnsafe("SELECT current_database() AS name");
      const objects = await gatherObjects(db);
      await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`GRANT CONNECT, TEMPORARY ON DATABASE ${quoteIdent(dbRow.name)} TO PUBLIC`);
        await tx.$executeRawUnsafe("GRANT USAGE ON SCHEMA public TO PUBLIC");
        await tx.$executeRawUnsafe("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC");
        for (const o of objects.filter((x) => x.kind === "type")) {
          await tx.$executeRawUnsafe(`GRANT USAGE ON TYPE public.${quoteIdent(o.name)} TO PUBLIC`);
        }
      });
      console.log("PUBLIC's database, schema, function and enum privileges are restored to the original defaults");
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
      if (strictGrants) {
        const refusals = await strictGrantsRefusals(db, manifest);
        if (refusals.length > 0) {
          console.error("apply-grants refused (strict mode); no grant was changed:");
          for (const reason of refusals) {
            console.error(`  - ${reason}`);
          }
          await db.$disconnect().catch(() => undefined);
          process.exit(3);
        }
      }
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
      // SEC-DB-RLS-001 8.3, the part the migrator can do (it owns the functions and the enum types after the transfer): nothing is
      // executable or usable by PUBLIC, and objects the migrator creates LATER are born that way (the default ACL for this role), so a
      // new migration cannot quietly re-open what this closes. A trigger function needs no EXECUTE to fire (only creating the trigger
      // checks it) and USAGE on a type does not control using its values, so no identity is granted either; manifest.public.enumTypeUsage
      // is empty and lists any role that would have to be.
      const enumTypes = objects.filter((o) => o.kind === "type").map((o) => o.name);
      const enumRoles = ((manifest.public && manifest.public.enumTypeUsage) || []).map((k) => quoteIdent(lib.ROLES[k].name));
      await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC");
        for (const type of enumTypes) {
          await tx.$executeRawUnsafe(`REVOKE USAGE ON TYPE public.${quoteIdent(type)} FROM PUBLIC`);
          for (const role of enumRoles) {
            await tx.$executeRawUnsafe(`GRANT USAGE ON TYPE public.${quoteIdent(type)} TO ${role}`);
          }
        }
        await tx.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdent(migrator)} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`);
        await tx.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdent(migrator)} REVOKE USAGE ON TYPES FROM PUBLIC`);
        if (enumRoles.length > 0) {
          await tx.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdent(migrator)} GRANT USAGE ON TYPES TO ${enumRoles.join(", ")}`);
        }
      });
      console.log(`grants applied for runtime, ops, backup and reporter over ${tables.length} tables; functions and ${enumTypes.length} enum types closed to PUBLIC`);
      if (strictGrants) {
        const findings = lib.evaluateModel(await gatherState(db), manifest);
        const responsible = findings.filter((f) => GRANTS_RESPONSIBILITY.test(f.check));
        const failed = responsible.filter((f) => !f.ok);
        for (const f of findings.filter((x) => !x.ok && !GRANTS_RESPONSIBILITY.test(x.check))) {
          console.warn(`WARN ${f.check}`);
        }
        if (failed.length > 0) {
          for (const f of failed) {
            console.error(`FAIL ${f.check}${f.detail === undefined ? "" : `  ${JSON.stringify(f.detail)}`}`);
          }
          process.exitCode = 1;
        } else {
          console.log(`strict verify: ${responsible.length} grant checks passed`);
        }
      }
    }
  } finally {
    await db.$disconnect().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(String(error && error.message ? error.message : error).split("\n")[0].slice(0, 300));
  process.exit(1);
});
