"use strict";

/**
 * SEC-DB-RLS-001 read-only probe: the catalog queries, the output guard and the derived findings.
 *
 * Kept apart from the CLI (sec-db-rls-001-probe.cjs) so that a test can prove, without a database, that every statement is a
 * read-only SELECT that cannot read a password hash, a secret setting or a file. Nothing here opens a connection.
 *
 * Every query reads the system catalogs only (pg_roles, pg_auth_members, pg_database, pg_namespace, pg_class, pg_proc, pg_type,
 * pg_policies, pg_default_acl, pg_db_role_setting, pg_event_trigger, pg_stat_activity, pg_extension, information_schema) and the
 * migrations table's own counts. `pg_authid` (password hashes) is never touched.
 */

const OWNER_OF_DB = "(SELECT datdba FROM pg_database WHERE datname = current_database())";
const NOT_SYSTEM_SCHEMA = "n.nspname !~ '^(pg_|information_schema)'";
const GRANTEE = (col) => `CASE WHEN ${col} = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(${col}) END`;

/**
 * shape: "one"   one row, printed as an object
 *        "many"  many rows, one JSON line each
 *        "names" a single column, printed as a list of strings
 */
const QUERIES = [
  // ── Identity ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    section: "connected identity",
    shape: "one",
    sql: "SELECT current_user AS current_user, session_user AS session_user, r.rolsuper, r.rolbypassrls, r.rolinherit, r.rolcreaterole, r.rolcreatedb, r.rolreplication, r.rolcanlogin, r.rolconnlimit FROM pg_roles r WHERE r.rolname = current_user",
  },
  {
    section: "database",
    shape: "one",
    sql: `SELECT current_database() AS database, pg_get_userbyid(datdba) AS database_owner, (current_setting('server_version_num')::int / 10000) AS server_major FROM pg_database WHERE datname = current_database()`,
  },
  {
    section: "roles (non-internal; names and attributes only)",
    shape: "many",
    sql: "SELECT rolname, rolsuper, rolbypassrls, rolinherit, rolcreaterole, rolcreatedb, rolreplication, rolcanlogin, rolconnlimit, (rolvaliduntil IS NOT NULL) AS has_expiry FROM pg_roles WHERE rolname !~ '^pg_' ORDER BY rolname",
  },
  {
    section: "role memberships",
    shape: "many",
    // to_jsonb keeps this valid on servers before PostgreSQL 16, which have no inherit_option / set_option columns
    sql: "SELECT pg_get_userbyid(m.roleid) AS role_name, pg_get_userbyid(m.member) AS member_name, to_jsonb(m)->>'admin_option' AS admin_option, to_jsonb(m)->>'inherit_option' AS inherit_option, to_jsonb(m)->>'set_option' AS set_option FROM pg_auth_members m ORDER BY 1, 2",
  },
  {
    section: "role and database settings (keys only; values only for an allow-list)",
    shape: "many",
    sql: "SELECT coalesce(pg_get_userbyid(nullif(s.setrole, 0)), '(all roles)') AS for_role, coalesce((SELECT d.datname FROM pg_database d WHERE d.oid = s.setdatabase), '(all databases)') AS in_database, (SELECT array_agg(split_part(x, '=', 1) ORDER BY split_part(x, '=', 1)) FROM unnest(s.setconfig) AS x) AS keys, (SELECT json_object_agg(split_part(x, '=', 1), split_part(x, '=', 2)) FROM unnest(s.setconfig) AS x WHERE split_part(x, '=', 1) IN ('row_security', 'search_path', 'statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout')) AS allow_listed_values FROM pg_db_role_setting s ORDER BY 1, 2",
  },

  // ── Database and schema privileges ──────────────────────────────────────────────────────────────────────────────────────
  {
    section: "database privileges (ACL, including the implicit defaults)",
    shape: "many",
    sql: `SELECT ${GRANTEE("a.grantee")} AS grantee, a.privilege_type, a.is_grantable FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a WHERE d.datname = current_database() ORDER BY 1, 2`,
  },
  {
    section: "schemas (non-system)",
    shape: "many",
    sql: "SELECT nspname AS schema, pg_get_userbyid(nspowner) AS owner, has_schema_privilege('public', nspname, 'CREATE') AS public_can_create FROM pg_namespace n WHERE nspname !~ '^(pg_|information_schema)' ORDER BY 1",
  },
  {
    section: "schema privileges (ACL, including the implicit defaults)",
    shape: "many",
    sql: `SELECT n.nspname AS schema, ${GRANTEE("a.grantee")} AS grantee, a.privilege_type, a.is_grantable FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a WHERE ${NOT_SYSTEM_SCHEMA} ORDER BY 1, 2, 3`,
  },

  // ── Ownership ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    section: "object ownership in non-system schemas (counts)",
    shape: "many",
    sql: `SELECT n.nspname AS schema, CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'table' WHEN 'S' THEN 'sequence' WHEN 'v' THEN 'view' WHEN 'm' THEN 'view' ELSE c.relkind::text END AS kind, pg_get_userbyid(c.relowner) AS owner, count(*)::int AS objects FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE ${NOT_SYSTEM_SCHEMA} AND c.relkind IN ('r','p','S','v','m') GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
  },
  {
    section: "function and type ownership (counts)",
    shape: "many",
    sql: `SELECT 'function' AS kind, pg_get_userbyid(p.proowner) AS owner, count(*)::int AS objects FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE ${NOT_SYSTEM_SCHEMA} GROUP BY 2 UNION ALL SELECT 'enum type', pg_get_userbyid(t.typowner), count(*)::int FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE ${NOT_SYSTEM_SCHEMA} AND t.typtype = 'e' GROUP BY 2`,
  },
  {
    section: "objects NOT owned by the database owner (names only: tables, functions, enum types)",
    shape: "many",
    sql: `SELECT 'table' AS kind, c.relname AS name, pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p','S','v','m') AND c.relowner <> ${OWNER_OF_DB} UNION ALL SELECT 'function', p.proname, pg_get_userbyid(p.proowner) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proowner <> ${OWNER_OF_DB} UNION ALL SELECT 'enum type', t.typname, pg_get_userbyid(t.typowner) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype = 'e' AND t.typowner <> ${OWNER_OF_DB} ORDER BY 1, 2`,
  },
  {
    section: "views and materialized views (names)",
    shape: "names",
    column: "name",
    sql: `SELECT n.nspname || '.' || c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE ${NOT_SYSTEM_SCHEMA} AND c.relkind IN ('v','m') ORDER BY 1`,
  },

  // ── Row level security ──────────────────────────────────────────────────────────────────────────────────────────────────
  {
    section: "row level security coverage (public tables)",
    shape: "one",
    sql: "SELECT count(*)::int AS tables, count(*) FILTER (WHERE c.relrowsecurity)::int AS rls_enabled, count(*) FILTER (WHERE c.relforcerowsecurity)::int AS rls_forced FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'",
  },
  {
    section: "row level security per table (owner, enabled, forced, policies, tenant key)",
    shape: "many",
    sql: "SELECT c.relname AS table_name, pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced, (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = n.nspname AND p.tablename = c.relname) AS policies, EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname IN ('tenant_key', 'tenantKey') AND NOT a.attisdropped) AS has_tenant_key FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1",
  },
  {
    section: "RLS enabled but NOT forced (table names)",
    shape: "names",
    column: "relname",
    sql: "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND NOT c.relforcerowsecurity ORDER BY 1",
  },
  {
    section: "tenant-keyed tables with NO RLS (table names)",
    shape: "names",
    column: "table_name",
    sql: "SELECT DISTINCT col.table_name FROM information_schema.columns col JOIN pg_class c ON c.relname = col.table_name AND c.relkind = 'r' JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE col.table_schema = 'public' AND col.column_name IN ('tenant_key', 'tenantKey') AND NOT c.relrowsecurity ORDER BY 1",
  },
  {
    section: "RLS policy count by command",
    shape: "many",
    sql: "SELECT cmd, count(*)::int AS policies FROM pg_policies WHERE schemaname = 'public' GROUP BY 1 ORDER BY 1",
  },
  {
    section: "RLS policies (every policy: table, permissive, roles, command, USING, WITH CHECK)",
    shape: "many",
    sql: "SELECT tablename AS table_name, policyname AS policy, permissive, roles::text AS roles, cmd, qual AS using_expression, with_check AS with_check_expression FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2",
  },
  {
    section: "distinct policy expressions (grouped)",
    shape: "many",
    sql: "SELECT cmd, permissive, roles::text AS roles, qual AS using_expression, with_check AS with_check_expression, count(*)::int AS policies FROM pg_policies WHERE schemaname = 'public' GROUP BY 1, 2, 3, 4, 5 ORDER BY 6 DESC, 1",
  },

  // ── Object privileges ───────────────────────────────────────────────────────────────────────────────────────────────────
  {
    section: "explicit table grants by grantee (distinct tables per privilege)",
    shape: "many",
    sql: "SELECT grantee, privilege_type, count(DISTINCT table_name)::int AS tables FROM information_schema.role_table_grants WHERE table_schema = 'public' GROUP BY 1, 2 ORDER BY 1, 2",
  },
  {
    section: "relation privileges held by roles other than the owner (counts by kind, grantee and privilege)",
    shape: "many",
    sql: `SELECT x.kind, x.grantee, x.privilege_type, count(*)::int AS relations FROM (SELECT CASE c.relkind WHEN 'S' THEN 'sequence' WHEN 'v' THEN 'view' WHEN 'm' THEN 'view' ELSE 'table' END AS kind, pg_get_userbyid(c.relowner) AS owner, ${GRANTEE("a.grantee")} AS grantee, a.privilege_type FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault((CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END)::"char", c.relowner))) a WHERE ${NOT_SYSTEM_SCHEMA} AND c.relkind IN ('r','p','S','v','m')) x WHERE x.grantee <> x.owner GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
  },
  {
    section: "relations that carry a non-owner privilege (names, first 150)",
    shape: "many",
    sql: `SELECT DISTINCT n.nspname || '.' || c.relname AS relation, c.relkind::text AS relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault((CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END)::"char", c.relowner))) a WHERE ${NOT_SYSTEM_SCHEMA} AND c.relkind IN ('r','p','S','v','m') AND a.grantee <> c.relowner ORDER BY 1 LIMIT 150`,
  },
  {
    section: "functions and procedures (owner, security definer, who may EXECUTE)",
    shape: "many",
    sql: `SELECT n.nspname AS schema, p.proname AS name, p.prokind::text AS kind, pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS security_definer, l.lanname AS language, (SELECT array_agg(DISTINCT g ORDER BY g) FROM (SELECT ${GRANTEE("a.grantee")} AS g FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.privilege_type = 'EXECUTE') s) AS executable_by FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang WHERE ${NOT_SYSTEM_SCHEMA} ORDER BY 1, 2 LIMIT 200`,
  },
  {
    section: "enum types: privileges held by roles other than the owner (counts)",
    shape: "many",
    sql: `SELECT x.grantee, x.privilege_type, count(*)::int AS types FROM (SELECT pg_get_userbyid(t.typowner) AS owner, ${GRANTEE("a.grantee")} AS grantee, a.privilege_type FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace CROSS JOIN LATERAL aclexplode(coalesce(t.typacl, acldefault('T', t.typowner))) a WHERE ${NOT_SYSTEM_SCHEMA} AND t.typtype = 'e') x WHERE x.grantee <> x.owner GROUP BY 1, 2 ORDER BY 1, 2`,
  },
  {
    section: "default privileges",
    shape: "many",
    sql: "SELECT pg_get_userbyid(defaclrole) AS for_role, defaclnamespace::regnamespace::text AS schema, defaclobjtype::text AS object_type, defaclacl::text AS acl FROM pg_default_acl ORDER BY 1, 3",
  },
  {
    section: "event triggers (names)",
    shape: "names",
    column: "evtname",
    sql: "SELECT evtname FROM pg_event_trigger ORDER BY 1",
  },

  // ── What the CONNECTED role can do (run it as a candidate role to certify that role) ────────────────────────────────────
  {
    section: "effective privileges of the connected role",
    shape: "one",
    sql: `SELECT r.rolsuper OR r.rolbypassrls AS bypasses_row_level_security, has_database_privilege(current_user, current_database(), 'CONNECT') AS database_connect, has_database_privilege(current_user, current_database(), 'TEMPORARY') AS database_temp, has_database_privilege(current_user, current_database(), 'CREATE') AS database_create, has_schema_privilege(current_user, 'public', 'USAGE') AS public_schema_usage, has_schema_privilege(current_user, 'public', 'CREATE') AS public_schema_create, (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r') AS tables, (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND has_table_privilege(current_user, c.oid, 'SELECT')) AS tables_select, (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND has_table_privilege(current_user, c.oid, 'INSERT')) AS tables_insert, (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND has_table_privilege(current_user, c.oid, 'UPDATE')) AS tables_update, (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND has_table_privilege(current_user, c.oid, 'DELETE')) AS tables_delete, (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND has_table_privilege(current_user, c.oid, 'TRUNCATE')) AS tables_truncate, (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND has_table_privilege(current_user, c.oid, 'REFERENCES')) AS tables_references, (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND has_table_privilege(current_user, c.oid, 'TRIGGER')) AS tables_trigger, (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND pg_has_role(current_user, c.relowner, 'USAGE')) AS tables_owned_or_inherited, (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND pg_has_role(current_user, c.relowner, 'USAGE') AND c.relrowsecurity AND NOT c.relforcerowsecurity) AS owned_tables_exempt_from_rls, (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'S') AS sequences, (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'S' AND (has_sequence_privilege(current_user, c.oid, 'USAGE') OR has_sequence_privilege(current_user, c.oid, 'UPDATE'))) AS sequences_usable, (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public') AS functions, (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND has_function_privilege(current_user, p.oid, 'EXECUTE')) AS functions_executable FROM pg_roles r WHERE r.rolname = current_user`,
  },

  // ── Server and migrations ───────────────────────────────────────────────────────────────────────────────────────────────
  {
    section: "connections to this database (counts; visibility depends on this role's privileges)",
    shape: "many",
    sql: "SELECT coalesce(usename, '(hidden from this role)') AS database_user, coalesce(nullif(application_name, ''), '(none)') AS application_name, coalesce(state, '(hidden)') AS state, count(*)::int AS sessions FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend' GROUP BY 1, 2, 3 ORDER BY 4 DESC, 1, 2",
  },
  {
    section: "server settings",
    shape: "one",
    sql: "SELECT current_setting('ssl') AS ssl, current_setting('row_security') AS row_security, current_setting('max_connections')::int AS max_connections, (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS total_sessions",
  },
  {
    section: "extensions",
    shape: "names",
    column: "extname",
    sql: "SELECT extname FROM pg_extension ORDER BY 1",
  },
];

/** The migrations table is read only when it exists, so a fresh or foreign database never makes the probe fail. */
const MIGRATIONS_PRESENCE_SQL = "SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS table_present";
const MIGRATIONS_STATE_SQL =
  "SELECT count(*)::int AS applied, count(*) FILTER (WHERE finished_at IS NULL)::int AS unfinished, max(migration_name) AS latest FROM _prisma_migrations";

/** Everything the probe may send to the database. The test pins every entry. */
function allStatements() {
  return [...QUERIES.map((q) => q.sql), MIGRATIONS_PRESENCE_SQL, MIGRATIONS_STATE_SQL];
}

/**
 * Statements the probe sends outside QUERIES, both session-level and harmless: the read-only transaction and a statement timeout
 * so a slow catalog scan cannot hold a lock on a production database.
 */
const SESSION_STATEMENTS = ["SET TRANSACTION READ ONLY", "SET LOCAL statement_timeout = '30000'", "SET LOCAL lock_timeout = '5000'"];

/** A savepoint around each query, so one unreadable catalog cannot abort the probe. Savepoints are allowed in a READ ONLY transaction. */
const SAVEPOINT_SET = "SAVEPOINT probe_query";
const SAVEPOINT_RELEASE = "RELEASE SAVEPOINT probe_query";
const SAVEPOINT_ROLLBACK = "ROLLBACK TO SAVEPOINT probe_query";

/**
 * Runs every query under its own savepoint. A catalog the connected role cannot read marks that one section unavailable (with the
 * database's own one-line reason) instead of aborting the probe, so the probe also works when run as a restricted candidate role.
 * exec(sql) and query(sql) are supplied by the caller; section(name, rows) receives the result.
 */
async function runSections({ queries, exec, query, section }) {
  for (const entry of queries) {
    await exec(SAVEPOINT_SET);
    try {
      const rows = await query(entry.sql);
      await exec(SAVEPOINT_RELEASE);
      if (entry.shape === "one") {
        section(entry.section, rows[0] ?? {});
      } else if (entry.shape === "names") {
        section(entry.section, rows.map((r) => r[entry.column]));
      } else {
        section(entry.section, rows);
      }
    } catch (error) {
      await exec(SAVEPOINT_ROLLBACK);
      // the database's own "ERROR: ..." text (Prisma wraps it in its own text), else the last line
      const text = String(error && error.message ? error.message : error);
      const lines = text.split(/\r?\n/).filter(Boolean);
      const dbError = /ERROR:[^\n`]*/.exec(text);
      const reason = (dbError ? dbError[0].trim() : lines[lines.length - 1]) || "unavailable";
      section(entry.section, { unavailable: true, reason: reason.slice(0, 160) });
    }
  }
}

// ── Read-only proof for the statements ──────────────────────────────────────────────────────────────────────────────────────

const FORBIDDEN_KEYWORDS = [
  "INSERT", "UPDATE", "DELETE", "MERGE", "TRUNCATE", "ALTER", "CREATE", "DROP", "GRANT", "REVOKE", "COMMENT", "COPY", "CALL", "DO",
  "LOCK", "VACUUM", "ANALYZE", "REINDEX", "CLUSTER", "REFRESH", "NOTIFY", "LISTEN", "PREPARE", "EXECUTE", "DISCARD", "RESET",
];
const FORBIDDEN_SUBSTRINGS = [
  "pg_authid", "pg_shadow", "pg_user_mapping", "pg_read_file", "pg_read_binary_file", "pg_ls_dir", "lo_import", "lo_export",
  "set_config(", "pg_advisory", "nextval(", "setval(", "pg_terminate_backend", "pg_cancel_backend", "pg_reload_conf",
  "pg_switch_wal", "pg_create_", "pg_drop_", "dblink", "pg_stat_statements", "current_setting('app.", "password", "rolpassword",
  "pg_hba_file_rules", "pg_file_settings", "pg_settings", "version()",
];

/**
 * Returns the problems with one statement; an empty array means it is a read-only catalog SELECT.
 * String literals are removed before keywords are looked for, so a literal such as 'CREATE' (an ACL privilege name) is fine.
 */
function validateStatement(sql) {
  const problems = [];
  const text = String(sql);
  if (!/^\s*(SELECT|WITH)\b/i.test(text)) problems.push("does not start with SELECT or WITH");
  if (text.includes(";")) problems.push("contains a semicolon (more than one statement)");
  const withoutLiterals = text.replace(/'(?:[^']|'')*'/g, "''");
  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`, "i").test(withoutLiterals)) problems.push(`contains the keyword ${keyword}`);
  }
  const lower = text.toLowerCase();
  for (const bad of FORBIDDEN_SUBSTRINGS) {
    if (lower.includes(bad.toLowerCase())) problems.push(`contains ${bad}`);
  }
  return problems;
}

// ── Output guard ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Returns a function that throws instead of printing a connection string or a remembered secret. */
function makeLineGuard(secrets) {
  return (text) => {
    const line = String(text);
    if (/[a-z][a-z0-9+.-]*:\/\/[^\s]*@/i.test(line) || /postgres(ql)?:\/\//i.test(line)) {
      throw new Error("refusing to print a connection string");
    }
    for (const secret of secrets) {
      if (line.includes(secret)) throw new Error("refusing to print a value that matches a connection secret");
    }
    return line;
  };
}

// ── Derived findings ────────────────────────────────────────────────────────────────────────────────────────────────────────

const SYSTEM_TABLE = "_prisma_migrations";

/**
 * Plain facts computed from the evidence sections: booleans and counts only. These are the lines the QA record quotes, so each
 * one is derivable from the raw sections printed above it.
 */
function deriveFindings(sections) {
  // A section the connected role could not read arrives as { unavailable: true, reason }. It must never read as "nothing found".
  const rowsOf = (name) => (Array.isArray(sections[name]) ? sections[name] : []);
  const objectOf = (name) => (sections[name] && !Array.isArray(sections[name]) && !sections[name].unavailable ? sections[name] : {});
  const unavailableSections = Object.keys(sections).filter((name) => sections[name] && sections[name].unavailable === true).sort();
  const me = objectOf("connected identity");
  const eff = objectOf("effective privileges of the connected role");
  const perTable = rowsOf("row level security per table (owner, enabled, forced, policies, tenant key)").filter((t) => t.table_name !== SYSTEM_TABLE);
  const tenantTables = perTable.filter((t) => t.has_tenant_key);
  const dbPrivs = rowsOf("database privileges (ACL, including the implicit defaults)");
  const schemaPrivs = rowsOf("schema privileges (ACL, including the implicit defaults)");
  const functions = rowsOf("functions and procedures (owner, security definer, who may EXECUTE)");
  const enumPrivs = rowsOf("enum types: privileges held by roles other than the owner (counts)");
  const relPrivs = rowsOf("relation privileges held by roles other than the owner (counts by kind, grantee and privilege)");
  const policies = rowsOf("RLS policies (every policy: table, permissive, roles, command, USING, WITH CHECK)");
  const owners = new Set(perTable.map((t) => t.owner));
  const publicHas = (rows, privilege) => rows.some((r) => r.grantee === "PUBLIC" && r.privilege_type === privilege);
  const publicSchemaPrivs = schemaPrivs.filter((r) => r.schema === "public");
  const tenantPolicyTables = new Set(policies.map((p) => p.table_name));

  return {
    sectionsUnavailable: unavailableSections,
    connectedRoleIsSuperuser: me.rolsuper === true,
    connectedRoleBypassesRls: me.rolsuper === true || me.rolbypassrls === true,
    connectedRoleCanLogin: me.rolcanlogin === true,
    distinctTableOwners: [...owners].sort(),
    tablesOwnedByConnectedRoleOrItsRoles: eff.tables_owned_or_inherited ?? null,
    ownedTablesWhereRlsIsEnabledButNotForced: eff.owned_tables_exempt_from_rls ?? null,
    tenantKeyedTables: tenantTables.length,
    tenantKeyedTablesWithRlsEnabled: tenantTables.filter((t) => t.rls_enabled).length,
    tenantKeyedTablesWithRlsForced: tenantTables.filter((t) => t.rls_forced).length,
    tenantKeyedTablesWithAtLeastOnePolicy: tenantTables.filter((t) => t.policies > 0).length,
    tenantKeyedTablesWithRlsEnabledButNoPolicy: tenantTables.filter((t) => t.rls_enabled && t.policies === 0).map((t) => t.table_name),
    tablesWithPoliciesButRlsDisabled: perTable.filter((t) => t.policies > 0 && !t.rls_enabled).map((t) => t.table_name),
    policiesTotal: policies.length,
    policiesWithoutWithCheckExpression: policies.filter((p) => p.with_check_expression == null && ["INSERT", "UPDATE", "ALL"].includes(p.cmd)).length,
    policiesApplyingToPublicRole: policies.filter((p) => /\{public\}|^\{?PUBLIC\}?$/i.test(String(p.roles))).length,
    distinctPolicyTables: tenantPolicyTables.size,
    publicCanConnectToDatabase: publicHas(dbPrivs, "CONNECT"),
    publicCanCreateTemporaryTables: publicHas(dbPrivs, "TEMPORARY"),
    publicCanCreateInPublicSchema: publicHas(publicSchemaPrivs, "CREATE"),
    publicCanUsePublicSchema: publicHas(publicSchemaPrivs, "USAGE"),
    functionsExecutableByPublic: functions.filter((f) => Array.isArray(f.executable_by) && f.executable_by.includes("PUBLIC")).length,
    functionsTotal: functions.length,
    securityDefinerFunctions: functions.filter((f) => f.security_definer === true).length,
    enumTypesUsableByPublic: enumPrivs.filter((r) => r.grantee === "PUBLIC" && r.privilege_type === "USAGE").reduce((sum, r) => sum + r.types, 0),
    relationsWithANonOwnerPrivilege: relPrivs.reduce((sum, r) => sum + r.relations, 0),
    relationPrivilegeHoldersOtherThanOwner: [...new Set(relPrivs.map((r) => r.grantee))].sort(),
    sequencesPresent: rowsOf("object ownership in non-system schemas (counts)").filter((r) => r.kind === "sequence").reduce((sum, r) => sum + r.objects, 0),
    viewsPresent: rowsOf("views and materialized views (names)").length,
    eventTriggersPresent: rowsOf("event triggers (names)").length,
  };
}

module.exports = {
  QUERIES,
  MIGRATIONS_PRESENCE_SQL,
  MIGRATIONS_STATE_SQL,
  SESSION_STATEMENTS,
  SAVEPOINT_SET,
  SAVEPOINT_RELEASE,
  SAVEPOINT_ROLLBACK,
  allStatements,
  runSections,
  validateStatement,
  makeLineGuard,
  deriveFindings,
};
