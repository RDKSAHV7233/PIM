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

const SELECT_ONLY = ["ai_platform_controls", "connector_definitions", "connector_tenant_entitlements", "tax_regimes"];
const NO_INSERT_DELETE = ["ai_platform_budget_periods"];

const SHARED_CATALOG_RETRY_ATTEMPTS = 10;
// 42710 duplicate_object (role created by a concurrent setup), XX000 "tuple concurrently updated" (concurrent ALTER/GRANT on the same
// shared-catalog row), 40P01 deadlock_detected, 40001 serialization_failure.
const TRANSIENT_CATALOG_ERROR = /Code: `(42710|XX000|40P01|40001)`|already exists|tuple concurrently updated|deadlock detected/;

async function withSharedCatalogRetry(step) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await step();
    } catch (error) {
      if (attempt >= SHARED_CATALOG_RETRY_ATTEMPTS || !TRANSIENT_CATALOG_ERROR.test(String(error && error.message))) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 40 * attempt + Math.floor(Math.random() * 120)));
    }
  }
}

/** Prisma errors start with a blank line and an "Invalid ... invocation" banner; keep the part that says what went wrong. */
function describeError(error) {
  const text = String((error && error.message) || error || "unknown error").replace(/\s+/g, " ").trim();
  const detail = /(Raw query failed\..*)$/.exec(text);
  return (detail ? detail[1] : text).slice(0, 300);
}

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
    // The role is CLUSTER-WIDE, but the lane runs several isolated test databases at once and each one runs this script. Two of them
    // can both see "no role" and both CREATE it (42710 already exists), or both ALTER it at the same moment (XX000 tuple concurrently
    // updated). Those are races between identical, idempotent setups, not failures, so retry the shared-catalog step with a short
    // jittered backoff. Anything else fails immediately, and the error text is reported in full.
    await withSharedCatalogRetry(async () => {
      const exists = await db.$queryRaw`SELECT 1 FROM pg_roles WHERE rolname = ${ROLE}`;
      if (exists.length === 0) {
        await db.$executeRawUnsafe(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`);
      } else {
        await db.$executeRawUnsafe(`ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`);
      }
    });
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
    const [ref] = await db.$queryRaw`SELECT bool_and(has_table_privilege(${ROLE}, t, 'SELECT')) AS can_read, bool_or(has_table_privilege(${ROLE}, t, 'INSERT') OR has_table_privilege(${ROLE}, t, 'UPDATE') OR has_table_privilege(${ROLE}, t, 'DELETE')) AS can_write FROM unnest(ARRAY['connector_definitions', 'connector_tenant_entitlements', 'tax_regimes']) AS t`;
    check("the connector catalogue, the entitlement ledger and the tax regimes are read-only for the runtime", ref.can_read === true && ref.can_write === false);
    const [rls] = await db.$queryRaw`SELECT count(*) FILTER (WHERE relrowsecurity)::int AS enabled, count(*) FILTER (WHERE relforcerowsecurity)::int AS forced FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'`;
    console.log(`INFO tables granted: ${tables.length}; RLS enabled on ${rls.enabled}, forced on ${rls.forced}`);
  } catch (error) {
    failures.push(`error: ${describeError(error)}`);
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
