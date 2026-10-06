#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * SEC-DB-RLS-001 read-only production probe.
 *
 *   node scripts/sec-db-rls-001-probe.cjs database            roles, ownership, RLS coverage, grants, default privileges,
 *                                                             who is connected (counts), migration state
 *   node scripts/sec-db-rls-001-probe.cjs service-identity    what database user and host kind the named env vars resolve to
 *
 * Output is role names, ownership names, counts and booleans ONLY. No DSN, password, token, row payload or customer data is
 * ever printed: every line passes a guard that refuses to print a URL or any secret taken from the connection string.
 * The `database` mode runs entirely inside a READ ONLY transaction (the database itself rejects any write) and never reads
 * `pg_authid`, so password hashes are never touched.
 *
 * Connection source is explicit, never guessed:
 *   PROBE_DATABASE_URL        a full URL, or
 *   PROBE_DATABASE_URL_FROM   the NAME of one env var to read it from:
 *                             DATABASE_URL_DIRECT | DATABASE_URL | DATABASE_URL_POOLED | OBSERVABILITY_DATABASE_URL
 *   PROBE_ENV_VARS            (service-identity) comma-separated env var NAMES from the same list
 *   PROBE_OUT                 optional path for the JSON evidence
 *
 * `@prisma/client` is used for raw read-only queries only. Run it from the repo root after `npm ci`/`prisma generate`, or point
 * NODE_PATH at a node_modules that has `@prisma/client`.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");

const ALLOWED = ["DATABASE_URL_DIRECT", "DATABASE_URL", "DATABASE_URL_POOLED", "OBSERVABILITY_DATABASE_URL"];
const mode = process.argv[2];
if (!["database", "service-identity"].includes(mode)) {
  console.error("usage: node scripts/sec-db-rls-001-probe.cjs database | service-identity");
  process.exit(2);
}

const secrets = new Set();
const evidence = { probe: "SEC-DB-RLS-001", mode, startedAt: new Date().toISOString(), sections: {} };

function remember(urlText) {
  try {
    const u = new URL(urlText);
    for (const part of [u.password, decodeURIComponent(u.password)]) {
      if (part && part.length >= 4) {
        secrets.add(part);
      }
    }
  } catch {
    /* not a URL */
  }
}

/** Every printed line passes through here. A URL or a remembered secret aborts the run rather than being printed. */
function emit(text) {
  const line = String(text);
  if (/[a-z][a-z0-9+.-]*:\/\/[^\s]*@/i.test(line) || /postgres(ql)?:\/\//i.test(line)) {
    throw new Error("refusing to print a connection string");
  }
  for (const s of secrets) {
    if (line.includes(s)) {
      throw new Error("refusing to print a value that matches a connection secret");
    }
  }
  console.log(line);
}

const json = (v) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
const hostKind = (host) => (/\.railway\.internal$/i.test(host) ? "private-network" : /\.proxy\.rlwy\.net$/i.test(host) ? "public-proxy" : /^(localhost|127\.0\.0\.1|::1)$/.test(host) ? "local" : "other");
const fingerprint = (host, port) => crypto.createHash("sha256").update(`${host}:${port}`).digest("hex").slice(0, 12);

function resolveUrl() {
  let url = String(process.env.PROBE_DATABASE_URL || "").trim();
  if (!url && process.env.PROBE_DATABASE_URL_FROM) {
    const name = String(process.env.PROBE_DATABASE_URL_FROM).trim();
    if (!ALLOWED.includes(name)) {
      console.error(`PROBE_DATABASE_URL_FROM must be one of ${ALLOWED.join(", ")}.`);
      process.exit(2);
    }
    url = String(process.env[name] || "").trim();
  }
  if (!url) {
    console.error("a database URL is required (PROBE_DATABASE_URL or PROBE_DATABASE_URL_FROM): the target is never guessed.");
    process.exit(2);
  }
  remember(url);
  return url;
}

function section(name, rows) {
  evidence.sections[name] = rows;
  emit(`\n## ${name}`);
  if (Array.isArray(rows)) {
    if (rows.length === 0) {
      emit("(none)");
    }
    for (const r of rows) {
      emit(typeof r === "string" ? r : json(r));
    }
  } else {
    emit(json(rows));
  }
}

async function serviceIdentity() {
  const names = String(process.env.PROBE_ENV_VARS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (names.length === 0 || names.some((n) => !ALLOWED.includes(n))) {
    console.error(`PROBE_ENV_VARS must list one or more of ${ALLOWED.join(", ")}.`);
    process.exit(2);
  }
  const rows = [];
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (!value) {
      rows.push({ variable: name, present: false });
      continue;
    }
    remember(value);
    try {
      const u = new URL(value);
      rows.push({
        variable: name,
        present: true,
        databaseUser: decodeURIComponent(u.username),
        database: u.pathname.replace(/^\//, ""),
        hostKind: hostKind(u.hostname),
        hostFingerprint: fingerprint(u.hostname, u.port),
        sslModeParameterPresent: u.searchParams.has("sslmode"),
      });
    } catch {
      rows.push({ variable: name, present: true, parseable: false });
    }
  }
  section("service database identity (names, host kind, fingerprint only)", rows);
}

async function databaseProbe() {
  const { PrismaClient } = require("@prisma/client");
  const db = new PrismaClient({ datasources: { db: { url: resolveUrl() } } });
  try {
    await db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        const q = (sql) => tx.$queryRawUnsafe(sql);

        const [me] = await q("SELECT current_user AS current_user, session_user AS session_user, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolreplication, r.rolcanlogin FROM pg_roles r WHERE r.rolname = current_user");
        section("connected identity", me);
        const [d] = await q("SELECT current_database() AS database, pg_get_userbyid(datdba) AS database_owner, (current_setting('server_version_num')::int / 10000) AS server_major FROM pg_database WHERE datname = current_database()");
        section("database", d);
        section("roles (non-internal; names and attributes only)", await q("SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication, rolcanlogin, rolconnlimit FROM pg_roles WHERE rolname !~ '^pg_' ORDER BY rolname"));
        section("role memberships", await q("SELECT pg_get_userbyid(roleid) AS role_name, pg_get_userbyid(member) AS member_name FROM pg_auth_members ORDER BY 1, 2"));
        section("schemas (non-system)", await q("SELECT nspname AS schema, pg_get_userbyid(nspowner) AS owner, has_schema_privilege('public', nspname, 'CREATE') AS public_can_create FROM pg_namespace WHERE nspname !~ '^(pg_|information_schema)' ORDER BY 1"));
        section("object ownership in non-system schemas (counts)", await q("SELECT n.nspname AS schema, CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'table' WHEN 'S' THEN 'sequence' WHEN 'v' THEN 'view' WHEN 'm' THEN 'view' ELSE c.relkind::text END AS kind, pg_get_userbyid(c.relowner) AS owner, count(*)::int AS objects FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname !~ '^(pg_|information_schema)' AND c.relkind IN ('r','p','S','v','m') GROUP BY 1, 2, 3 ORDER BY 1, 2, 3"));
        section("function and type ownership (counts)", await q("SELECT 'function' AS kind, pg_get_userbyid(p.proowner) AS owner, count(*)::int AS objects FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname !~ '^(pg_|information_schema)' GROUP BY 2 UNION ALL SELECT 'enum type', pg_get_userbyid(t.typowner), count(*)::int FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname !~ '^(pg_|information_schema)' AND t.typtype = 'e' GROUP BY 2"));
        section("objects NOT owned by the database owner (names only: tables, functions, enum types)", await q("SELECT 'table' AS kind, c.relname AS name, pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p','S','v','m') AND pg_get_userbyid(c.relowner) <> (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) UNION ALL SELECT 'function', p.proname, pg_get_userbyid(p.proowner) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) <> (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) UNION ALL SELECT 'enum type', t.typname, pg_get_userbyid(t.typowner) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype = 'e' AND pg_get_userbyid(t.typowner) <> (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) ORDER BY 1, 2"));
        const [rls] = await q("SELECT count(*)::int AS tables, count(*) FILTER (WHERE c.relrowsecurity)::int AS rls_enabled, count(*) FILTER (WHERE c.relforcerowsecurity)::int AS rls_forced FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'");
        section("row level security coverage (public tables)", rls);
        section("RLS enabled but NOT forced (table names)", (await q("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND NOT c.relforcerowsecurity ORDER BY 1")).map((r) => r.relname));
        section("tenant-keyed tables with NO RLS (table names)", (await q("SELECT DISTINCT col.table_name FROM information_schema.columns col JOIN pg_class c ON c.relname = col.table_name AND c.relkind = 'r' JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE col.table_schema = 'public' AND col.column_name IN ('tenant_key', 'tenantKey') AND NOT c.relrowsecurity ORDER BY 1")).map((r) => r.table_name));
        section("RLS policy count by command", await q("SELECT cmd, count(*)::int AS policies FROM pg_policies WHERE schemaname = 'public' GROUP BY 1 ORDER BY 1"));
        section("explicit table grants by grantee (distinct tables per privilege)", await q("SELECT grantee, privilege_type, count(DISTINCT table_name)::int AS tables FROM information_schema.role_table_grants WHERE table_schema = 'public' GROUP BY 1, 2 ORDER BY 1, 2"));
        section("default privileges", await q("SELECT pg_get_userbyid(defaclrole) AS for_role, defaclnamespace::regnamespace::text AS schema, defaclobjtype::text AS object_type, defaclacl::text AS acl FROM pg_default_acl ORDER BY 1, 3"));
        section("connections to this database (counts; visibility depends on this role's privileges)", await q("SELECT coalesce(usename, '(hidden from this role)') AS database_user, coalesce(nullif(application_name, ''), '(none)') AS application_name, coalesce(state, '(hidden)') AS state, count(*)::int AS sessions FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend' GROUP BY 1, 2, 3 ORDER BY 4 DESC, 1, 2"));
        const [net] = await q("SELECT current_setting('ssl') AS ssl, current_setting('row_security') AS row_security, current_setting('max_connections')::int AS max_connections, (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS total_sessions");
        section("server settings", net);
        const [mig] = await q("SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS table_present");
        if (mig.table_present) {
          const [m] = await q("SELECT count(*)::int AS applied, count(*) FILTER (WHERE finished_at IS NULL)::int AS unfinished, max(migration_name) AS latest FROM _prisma_migrations");
          section("migration state", m);
        } else {
          section("migration state", { table_present: false });
        }
        section("extensions", (await q("SELECT extname FROM pg_extension ORDER BY 1")).map((r) => r.extname));
      },
      { timeout: 60000, maxWait: 10000 },
    );
    evidence.result = "COMPLETE";
  } finally {
    await db.$disconnect().catch(() => undefined);
  }
}

(async () => {
  let code = 0;
  try {
    if (mode === "service-identity") {
      await serviceIdentity();
      evidence.result = "COMPLETE";
    } else {
      await databaseProbe();
    }
  } catch (error) {
    code = 1;
    evidence.result = "FAILED";
    evidence.error = error instanceof Error ? `${error.name}: ${String(error.message).split("\n")[0]}`.slice(0, 200) : "unknown error";
    emit(`\nPROBE FAILED: ${evidence.error}`);
  }
  evidence.finishedAt = new Date().toISOString();
  emit(`\nRESULT: ${evidence.result}`);
  if (process.env.PROBE_OUT) {
    try {
      fs.writeFileSync(process.env.PROBE_OUT, `${json(evidence)}\n`);
    } catch {
      emit("evidence file could not be written");
    }
  }
  process.exit(code);
})();
