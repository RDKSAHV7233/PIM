#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001: creates the restricted runtime role used by the restricted-role CI lane, from the repo, with explicit grants.
 *
 *   DATABASE_URL (admin, the migrator stand-in) must point at a freshly migrated, disposable database.
 *   RESTRICTED_ROLE_PASSWORD  optional; the role exists only in that disposable database.
 *
 * The role is the production-equivalent target: NOSUPERUSER, NOBYPASSRLS, not an owner of anything, table-level CRUD only, no
 * sequences (the schema has none), no DDL. The control tables are tighter than ordinary tables: the runtime reads the platform
 * control row and may only update (never insert or delete) the platform budget counters, so "operators write the kill switch" is a
 * database rule here, not only a code convention.
 *
 * It then asserts what it created. It prints booleans and names, never a password.
 */
const { PrismaClient } = require("@prisma/client");

const ROLE = "vexa_runtime_ci";
const adminUrl = String(process.env.DATABASE_URL || "").trim();
if (!adminUrl) {
  console.error("DATABASE_URL (admin) is required.");
  process.exit(2);
}
const password = String(process.env.RESTRICTED_ROLE_PASSWORD || "vexa_runtime_ci_password").replace(/[^A-Za-z0-9_]/g, "");

const SELECT_ONLY = ["ai_platform_controls"];
const NO_INSERT_DELETE = ["ai_platform_budget_periods"];

(async () => {
  const db = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const failures = [];
  const check = (name, ok) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
    if (!ok) {
      failures.push(name);
    }
  };
  try {
    const [current] = await db.$queryRaw`SELECT current_database() AS name, current_user AS admin_user`;
    const exists = await db.$queryRaw`SELECT 1 FROM pg_roles WHERE rolname = ${ROLE}`;
    if (exists.length === 0) {
      await db.$executeRawUnsafe(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`);
    } else {
      await db.$executeRawUnsafe(`ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`);
    }
    await db.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${current.name}" TO ${ROLE}`);
    await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
    const tables = (await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY 1`).map((r) => r.tablename);
    for (const table of tables) {
      await db.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${table}" TO ${ROLE}`);
    }
    for (const table of SELECT_ONLY) {
      await db.$executeRawUnsafe(`REVOKE INSERT, UPDATE, DELETE ON "${table}" FROM ${ROLE}`);
    }
    for (const table of NO_INSERT_DELETE) {
      await db.$executeRawUnsafe(`REVOKE INSERT, DELETE ON "${table}" FROM ${ROLE}`);
    }

    const [attrs] = await db.$queryRaw`SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication FROM pg_roles WHERE rolname = ${ROLE}`;
    check("role is NOSUPERUSER", attrs.rolsuper === false);
    check("role is NOBYPASSRLS", attrs.rolbypassrls === false);
    check("role cannot create databases, roles or replicate", !attrs.rolcreatedb && !attrs.rolcreaterole && !attrs.rolreplication);
    const [owned] = await db.$queryRaw`SELECT count(*)::int AS n FROM pg_class c WHERE pg_get_userbyid(c.relowner) = ${ROLE}`;
    check("role owns no relation", owned.n === 0);
    const [schemaOwner] = await db.$queryRaw`SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = 'public'`;
    check("role does not own the schema", schemaOwner.owner !== ROLE);
    const [seq] = await db.$queryRaw`SELECT count(*)::int AS n FROM pg_class WHERE relkind = 'S'`;
    check("the schema has no sequences, so no sequence grants are needed", seq.n === 0);
    const [priv] = await db.$queryRaw`SELECT has_table_privilege(${ROLE}, 'ai_platform_controls', 'SELECT') AS sel, has_table_privilege(${ROLE}, 'ai_platform_controls', 'UPDATE') AS upd, has_table_privilege(${ROLE}, 'ai_platform_budget_periods', 'INSERT') AS ins, has_table_privilege(${ROLE}, 'ai_platform_budget_periods', 'UPDATE') AS pupd, (to_regclass('public._prisma_migrations') IS NOT NULL) AS mig_table`;
    const [mig] = await db.$queryRaw`SELECT CASE WHEN to_regclass('public._prisma_migrations') IS NULL THEN false ELSE has_table_privilege(${ROLE}, 'public._prisma_migrations', 'SELECT') END AS can_read`;
    check("the platform control row is read-only for the runtime", priv.sel === true && priv.upd === false);
    check("platform budget counters may be updated but not inserted by the runtime", priv.pupd === true && priv.ins === false);
    check("the runtime cannot read the migrations table", mig.can_read === false);
    const [rls] = await db.$queryRaw`SELECT count(*) FILTER (WHERE relrowsecurity)::int AS enabled, count(*) FILTER (WHERE relforcerowsecurity)::int AS forced FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'`;
    console.log(`INFO tables granted: ${tables.length}; RLS enabled on ${rls.enabled}, forced on ${rls.forced}`);
  } catch (error) {
    failures.push(`error: ${String(error && error.message).split("\n")[0].slice(0, 160)}`);
    console.error(failures[failures.length - 1]);
  } finally {
    await db.$disconnect().catch(() => undefined);
  }
  if (failures.length > 0) {
    console.error(`restricted runtime role setup failed: ${failures.join("; ")}`);
    process.exit(1);
  }
  console.log(`restricted runtime role ${ROLE} is ready`);
})();
