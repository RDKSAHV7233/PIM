#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * Tests for the SEC-DB-RLS-001 read-only probe. No database is needed: these prove that every statement the probe can send is a
 * read-only catalog SELECT, that it covers every item the evidence record needs, that the output guard cannot print a secret, and
 * that a catalog the connected role cannot read degrades one section instead of aborting the probe.
 * The live behavior against a production-shaped database is proved by sec-db-rls-001-probe-proof.cjs (local PostgreSQL only).
 */
const assert = require("node:assert/strict");
const cp = require("node:child_process");
const path = require("node:path");
const lib = require("./sec-db-rls-001-probe-lib.cjs");

const PROBE = path.join(__dirname, "sec-db-rls-001-probe.cjs");
let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}\n     ${String(error && error.stack ? error.stack : error).split("\n").slice(0, 6).join("\n     ")}`);
    process.exitCode = 1;
  }
}

const sqlOf = (sectionPattern) => {
  const found = lib.QUERIES.filter((q) => sectionPattern.test(q.section));
  assert.ok(found.length > 0, `no section matches ${sectionPattern}`);
  return found.map((q) => q.sql).join("\n");
};

(async () => {
  // ── Every statement is a read-only catalog SELECT ────────────────────────────────────────────────────────────────────
  await test("every statement the probe sends is a read-only SELECT with no write, DDL or secret-bearing catalog", () => {
    const statements = lib.allStatements();
    assert.ok(statements.length >= 30, `expected at least 30 statements, got ${statements.length}`);
    for (const sql of statements) {
      assert.deepEqual(lib.validateStatement(sql), [], `${sql.slice(0, 120)}...`);
    }
  });

  await test("the only non-SELECT statements are the read-only transaction, two timeouts and the savepoints", () => {
    assert.deepEqual(lib.SESSION_STATEMENTS, ["SET TRANSACTION READ ONLY", "SET LOCAL statement_timeout = '30000'", "SET LOCAL lock_timeout = '5000'"]);
    assert.deepEqual([lib.SAVEPOINT_SET, lib.SAVEPOINT_RELEASE, lib.SAVEPOINT_ROLLBACK], ["SAVEPOINT probe_query", "RELEASE SAVEPOINT probe_query", "ROLLBACK TO SAVEPOINT probe_query"]);
  });

  await test("section names are unique", () => {
    const names = lib.QUERIES.map((q) => q.section);
    assert.equal(new Set(names).size, names.length);
  });

  // ── The validator rejects what it must (negative mutations) ──────────────────────────────────────────────────────────
  const MUST_REJECT = [
    ["an INSERT", "INSERT INTO t VALUES (1)"],
    ["an UPDATE", "UPDATE t SET a = 1"],
    ["a DELETE", "DELETE FROM t"],
    ["a data-modifying CTE", "WITH x AS (DELETE FROM t RETURNING 1) SELECT 1 FROM x"],
    ["two statements", "SELECT 1; DROP TABLE t"],
    ["two harmless statements (only the semicolon rule can catch this)", "SELECT 1; SELECT 2"],
    ["a DROP", "SELECT 1 WHERE (SELECT 1) = 1 AND false /* */ ; DROP TABLE t"],
    ["a row lock", "SELECT * FROM t FOR UPDATE"],
    ["TRUNCATE", "SELECT 1 FROM t TRUNCATE"],
    ["GRANT", "GRANT SELECT ON t TO x"],
    ["COPY", "COPY t TO STDOUT"],
    ["DO", "DO $$ BEGIN END $$"],
    ["pg_authid", "SELECT rolname FROM pg_authid"],
    ["pg_shadow", "SELECT usename FROM pg_shadow"],
    ["a password column", "SELECT rolpassword FROM pg_roles"],
    ["set_config", "SELECT set_config('row_security', 'off', true)"],
    ["a file read", "SELECT pg_read_file('/etc/passwd')"],
    ["a large-object export", "SELECT lo_export(1, '/tmp/x')"],
    ["a sequence advance", "SELECT nextval('s')"],
    ["pg_terminate_backend", "SELECT pg_terminate_backend(1)"],
    ["pg_advisory lock", "SELECT pg_advisory_lock(1)"],
    ["pg_settings (can carry secrets)", "SELECT * FROM pg_settings"],
    ["an app setting read", "SELECT current_setting('app.tenant_key')"],
    ["not starting with SELECT", "EXPLAIN SELECT 1"],
  ];
  for (const [label, sql] of MUST_REJECT) {
    await test(`validator rejects ${label}`, () => {
      assert.ok(lib.validateStatement(sql).length > 0, `${sql} was accepted`);
    });
  }

  await test("validator accepts privilege names inside string literals (CREATE, UPDATE, EXECUTE, TRIGGER)", () => {
    assert.deepEqual(lib.validateStatement("SELECT has_schema_privilege('public', 'CREATE'), has_sequence_privilege(current_user, 1, 'UPDATE'), 'EXECUTE', 'it''s DELETE'"), []);
  });

  await test("mutating any real statement into a write is detected", () => {
    for (const q of lib.QUERIES.slice(0, 6)) {
      assert.ok(lib.validateStatement(`${q.sql} FOR UPDATE`).length > 0);
      assert.ok(lib.validateStatement(q.sql.replace(/^SELECT/i, "DELETE FROM x USING (SELECT")).length > 0);
    }
  });

  // ── Coverage: every item the evidence record needs ───────────────────────────────────────────────────────────────────
  const COVERAGE = [
    ["role flags incl. inherit, login and connection limit", /connected identity|roles \(/, ["rolsuper", "rolbypassrls", "rolinherit", "rolcanlogin", "rolconnlimit"]],
    ["role memberships incl. options", /role memberships/, ["pg_auth_members", "admin_option", "inherit_option", "set_option"]],
    ["database CONNECT/TEMP/CREATE privileges", /database privileges/, ["datacl", "acldefault('d'", "aclexplode"]],
    ["schema USAGE/CREATE privileges", /schema privileges/, ["nspacl", "acldefault('n'", "aclexplode"]],
    ["table, view and sequence ownership", /object ownership/, ["relowner", "'S'", "'v'"]],
    ["table, view and sequence ACLs", /relation privileges held/, ["relacl", "acldefault(", "aclexplode"]],
    ["function and procedure ownership and EXECUTE", /functions and procedures/, ["proowner", "proacl", "'EXECUTE'", "prosecdef"]],
    ["enum type usage", /enum types: privileges/, ["typacl", "acldefault('T'", "'e'"]],
    ["default privileges", /default privileges/, ["pg_default_acl"]],
    ["row level security enabled and forced", /row level security per table/, ["relrowsecurity", "relforcerowsecurity", "pg_policies"]],
    ["every policy with roles, command, USING and WITH CHECK", /RLS policies \(every policy/, ["roles", "cmd", "qual", "with_check"]],
    ["role and database settings", /role and database settings/, ["pg_db_role_setting", "'row_security'"]],
    ["what the connected role can do", /effective privileges of the connected role/, ["has_table_privilege", "has_database_privilege", "has_schema_privilege", "has_function_privilege", "has_sequence_privilege", "TRUNCATE", "pg_has_role"]],
  ];
  for (const [label, pattern, tokens] of COVERAGE) {
    await test(`covers ${label}`, () => {
      const sql = sqlOf(pattern);
      for (const token of tokens) assert.ok(sql.includes(token), `missing ${token}`);
    });
  }

  await test("the policy listings select the real USING and WITH CHECK expressions, not a placeholder", () => {
    for (const pattern of [/RLS policies \(every policy/, /distinct policy expressions/]) {
      const sql = sqlOf(pattern);
      assert.match(sql, /\bqual AS using_expression\b/);
      assert.match(sql, /\bwith_check AS with_check_expression\b/);
      assert.doesNotMatch(sql, /NULL AS (using|with_check)_expression/i);
    }
  });

  await test("the policy listing includes every policy of the public schema, ungrouped and grouped", () => {
    assert.ok(sqlOf(/RLS policies \(every policy/).includes("schemaname = 'public'"));
    assert.ok(sqlOf(/distinct policy expressions/).includes("GROUP BY"));
  });

  // ── Output guard ─────────────────────────────────────────────────────────────────────────────────────────────────────
  await test("the guard refuses a connection string and a remembered secret, and prints ordinary lines", () => {
    const secrets = new Set(["S3cretPassw0rd"]);
    const guard = lib.makeLineGuard(secrets);
    assert.throws(() => guard("postgresql://u:p@host/db"), /connection string/);
    assert.throws(() => guard("postgres://u@host/db"), /connection string/);
    assert.throws(() => guard("https://user:pw@example.com/x"), /connection string/);
    assert.throws(() => guard('{"leak":"x S3cretPassw0rd y"}'), /connection secret/);
    assert.equal(guard('{"using_expression":"(tenant_key = COALESCE(NULLIF(current_setting(\'app.tenant_key\'::text, true), \'\'::text), \'default\'::text))"}').length > 10, true);
    assert.equal(guard("## database privileges"), "## database privileges");
  });

  // ── Savepoints: one unreadable catalog degrades one section ──────────────────────────────────────────────────────────
  await test("a query that fails marks only its section unavailable and the probe continues", async () => {
    const calls = [];
    const sections = {};
    const queries = [
      { section: "one", shape: "one", sql: "SELECT 1" },
      { section: "two", shape: "many", sql: "SELECT 2" },
      { section: "three", shape: "names", column: "n", sql: "SELECT 3" },
    ];
    await lib.runSections({
      queries,
      exec: async (sql) => void calls.push(sql),
      query: async (sql) => {
        calls.push(sql);
        if (sql === "SELECT 2") throw new Error("Invalid `prisma.$queryRawUnsafe()` invocation:\n\nERROR: permission denied for table pg_thing");
        return sql === "SELECT 3" ? [{ n: "a" }, { n: "b" }] : [{ v: 1 }];
      },
      section: (name, rows) => void (sections[name] = rows),
    });
    assert.deepEqual(sections.one, { v: 1 });
    assert.deepEqual(sections.two, { unavailable: true, reason: "ERROR: permission denied for table pg_thing" });
    assert.deepEqual(sections.three, ["a", "b"]);
    assert.deepEqual(calls, [
      lib.SAVEPOINT_SET, "SELECT 1", lib.SAVEPOINT_RELEASE,
      lib.SAVEPOINT_SET, "SELECT 2", lib.SAVEPOINT_ROLLBACK,
      lib.SAVEPOINT_SET, "SELECT 3", lib.SAVEPOINT_RELEASE,
    ]);
  });

  // ── Derived findings ─────────────────────────────────────────────────────────────────────────────────────────────────
  const T = "row level security per table (owner, enabled, forced, policies, tenant key)";
  const sectionsFixture = () => ({
    "connected identity": { rolsuper: true, rolbypassrls: false, rolcanlogin: true },
    "effective privileges of the connected role": { tables_owned_or_inherited: 78, owned_tables_exempt_from_rls: 10 },
    [T]: [
      { table_name: "Product", owner: "postgres", rls_enabled: true, rls_forced: true, policies: 1, has_tenant_key: true },
      { table_name: "connector_credentials", owner: "postgres", rls_enabled: true, rls_forced: false, policies: 1, has_tenant_key: true },
      { table_name: "AuthIdentity", owner: "postgres", rls_enabled: false, rls_forced: false, policies: 0, has_tenant_key: true },
      { table_name: "tax_regimes", owner: "vexa_app_v2", rls_enabled: false, rls_forced: false, policies: 0, has_tenant_key: false },
      { table_name: "orphan_policy", owner: "postgres", rls_enabled: false, rls_forced: false, policies: 1, has_tenant_key: false },
      { table_name: "enabled_no_policy", owner: "postgres", rls_enabled: true, rls_forced: true, policies: 0, has_tenant_key: true },
      { table_name: "_prisma_migrations", owner: "postgres", rls_enabled: false, rls_forced: false, policies: 0, has_tenant_key: false },
    ],
    "database privileges (ACL, including the implicit defaults)": [
      { grantee: "PUBLIC", privilege_type: "CONNECT" },
      { grantee: "PUBLIC", privilege_type: "TEMPORARY" },
      { grantee: "postgres", privilege_type: "CREATE" },
    ],
    "schema privileges (ACL, including the implicit defaults)": [
      { schema: "public", grantee: "PUBLIC", privilege_type: "USAGE" },
      { schema: "public", grantee: "pg_database_owner", privilege_type: "CREATE" },
    ],
    "functions and procedures (owner, security definer, who may EXECUTE)": [
      { name: "f1", security_definer: false, executable_by: ["PUBLIC", "vexa_app_v2"] },
      { name: "f2", security_definer: true, executable_by: ["vexa_app_v2"] },
    ],
    "enum types: privileges held by roles other than the owner (counts)": [{ grantee: "PUBLIC", privilege_type: "USAGE", types: 31 }],
    "relation privileges held by roles other than the owner (counts by kind, grantee and privilege)": [
      { kind: "table", grantee: "vexa_runtime", privilege_type: "SELECT", relations: 77 },
      { kind: "table", grantee: "vexa_backup", privilege_type: "SELECT", relations: 78 },
    ],
    "RLS policies (every policy: table, permissive, roles, command, USING, WITH CHECK)": [
      { table_name: "Product", cmd: "ALL", roles: "{public}", with_check_expression: "x" },
      { table_name: "connector_credentials", cmd: "ALL", roles: "{public}", with_check_expression: null },
      { table_name: "connector_tenant_entitlements", cmd: "SELECT", roles: "{public}", with_check_expression: null },
    ],
    "object ownership in non-system schemas (counts)": [{ kind: "sequence", objects: 0 }, { kind: "table", objects: 78 }],
    "views and materialized views (names)": [],
    "event triggers (names)": [],
  });

  await test("derived findings are plain facts computed from the sections", () => {
    const f = lib.deriveFindings(sectionsFixture());
    assert.equal(f.connectedRoleIsSuperuser, true);
    assert.equal(f.connectedRoleBypassesRls, true);
    assert.equal(f.ownedTablesWhereRlsIsEnabledButNotForced, 10);
    assert.equal(f.tenantKeyedTables, 4);
    assert.equal(f.tenantKeyedTablesWithRlsEnabled, 3);
    assert.equal(f.tenantKeyedTablesWithRlsForced, 2);
    assert.equal(f.tenantKeyedTablesWithAtLeastOnePolicy, 2);
    assert.deepEqual(f.tenantKeyedTablesWithRlsEnabledButNoPolicy, ["enabled_no_policy"]);
    assert.deepEqual(f.tablesWithPoliciesButRlsDisabled, ["orphan_policy"]);
    assert.equal(f.policiesTotal, 3);
    assert.equal(f.policiesWithoutWithCheckExpression, 1);
    assert.equal(f.policiesApplyingToPublicRole, 3);
    assert.equal(f.publicCanConnectToDatabase, true);
    assert.equal(f.publicCanCreateTemporaryTables, true);
    assert.equal(f.publicCanCreateInPublicSchema, false);
    assert.equal(f.publicCanUsePublicSchema, true);
    assert.equal(f.functionsExecutableByPublic, 1);
    assert.equal(f.securityDefinerFunctions, 1);
    assert.equal(f.enumTypesUsableByPublic, 31);
    assert.equal(f.relationsWithANonOwnerPrivilege, 155);
    assert.deepEqual(f.relationPrivilegeHoldersOtherThanOwner, ["vexa_backup", "vexa_runtime"]);
    assert.equal(f.sequencesPresent, 0);
    assert.deepEqual(f.distinctTableOwners, ["postgres", "vexa_app_v2"]);
  });

  await test("derived findings do not crash on missing or unavailable sections and never turn a gap into a clean bill", () => {
    const f = lib.deriveFindings({ "connected identity": { unavailable: true, reason: "x" } });
    assert.equal(f.connectedRoleIsSuperuser, false);
    assert.equal(f.connectedRoleBypassesRls, false);
    assert.equal(f.policiesTotal, 0);
    assert.equal(f.ownedTablesWhereRlsIsEnabledButNotForced, null);
    assert.equal(f.tablesOwnedByConnectedRoleOrItsRoles, null);
    assert.equal(f.tenantKeyedTables, 0);
  });

  await test("an unavailable section is listed and never read as 'nothing found' (regression: the first live run crashed on it)", () => {
    const s = sectionsFixture();
    s["relation privileges held by roles other than the owner (counts by kind, grantee and privilege)"] = { unavailable: true, reason: "ERROR: boom" };
    s["RLS policies (every policy: table, permissive, roles, command, USING, WITH CHECK)"] = { unavailable: true, reason: "ERROR: boom" };
    const f = lib.deriveFindings(s);
    assert.deepEqual(f.sectionsUnavailable, [
      "RLS policies (every policy: table, permissive, roles, command, USING, WITH CHECK)",
      "relation privileges held by roles other than the owner (counts by kind, grantee and privilege)",
    ]);
    assert.equal(f.relationsWithANonOwnerPrivilege, 0);
    assert.deepEqual(lib.deriveFindings(sectionsFixture()).sectionsUnavailable, []);
  });

  await test("acldefault is always given a \"char\" (regression: an uncast CASE made two sections fail on a real server)", () => {
    for (const q of lib.QUERIES) {
      for (const call of q.sql.match(/acldefault\((?:[^()]|\([^()]*\))*\)/g) ?? []) {
        const first = call.slice("acldefault(".length).split(",")[0];
        assert.ok(/^'[a-zA-Z]'$/.test(first.trim()) || /::"char"\s*$/.test(first.trim()), `${call}`);
      }
    }
  });

  await test("the database's own ERROR line is the reason, not Prisma's wrapper text", async () => {
    const sections = {};
    await lib.runSections({
      queries: [{ section: "s", shape: "many", sql: "SELECT 1" }],
      exec: async () => undefined,
      query: async () => {
        throw new Error("Invalid `prisma.$queryRawUnsafe()` invocation:\n\nRaw query failed. Code: `42883`. Message: `ERROR: function acldefault(text, oid) does not exist\nHINT: No function matches.`");
      },
      section: (name, rows) => void (sections[name] = rows),
    });
    assert.match(sections.s.reason, /^ERROR: function acldefault/);
  });

  await test("a role that is not a superuser but has BYPASSRLS is reported as bypassing RLS (the backup and migrator identities)", () => {
    const s = sectionsFixture();
    s["connected identity"] = { rolsuper: false, rolbypassrls: true, rolcanlogin: true };
    const f = lib.deriveFindings(s);
    assert.equal(f.connectedRoleIsSuperuser, false);
    assert.equal(f.connectedRoleBypassesRls, true);
    s["connected identity"] = { rolsuper: false, rolbypassrls: false, rolcanlogin: true };
    assert.equal(lib.deriveFindings(s).connectedRoleBypassesRls, false);
  });

  await test("a PUBLIC CREATE on the public schema is reported", () => {
    const s = sectionsFixture();
    s["schema privileges (ACL, including the implicit defaults)"].push({ schema: "public", grantee: "PUBLIC", privilege_type: "CREATE" });
    assert.equal(lib.deriveFindings(s).publicCanCreateInPublicSchema, true);
  });

  // ── The CLI ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  // the developer's own DATABASE_URL / PROBE_* variables must never reach these runs
  const cleanEnv = () => {
    const out = { ...process.env };
    for (const key of Object.keys(out)) {
      if (/^PROBE_|^DATABASE_URL|^OBSERVABILITY_DATABASE_URL/.test(key)) delete out[key];
    }
    return out;
  };
  const run = (args, env) =>
    cp.spawnSync(process.execPath, [PROBE, ...args], { env: { ...cleanEnv(), ...env }, encoding: "utf8" });

  await test("the CLI never guesses a target: no URL is an error", () => {
    const r = run(["database"], {});
    assert.equal(r.status, 2);
    assert.match(r.stderr, /database URL is required/);
  });

  await test("the CLI only reads the named env vars from its allow-list", () => {
    const r = run(["database"], { PROBE_DATABASE_URL_FROM: "AWS_SECRET_ACCESS_KEY", AWS_SECRET_ACCESS_KEY: "x" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /must be one of/);
  });

  await test("service-identity prints the user, database and host kind, and never the password or the URL", () => {
    const url = "postgresql://vexa_app_v2:Sup3rS3cretPw@viaduct.proxy.rlwy.net:5432/railway";
    const r = run(["service-identity"], { PROBE_ENV_VARS: "DATABASE_URL", DATABASE_URL: url });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /"databaseUser":"vexa_app_v2"/);
    assert.match(r.stdout, /"hostKind":"public-proxy"/);
    assert.ok(!r.stdout.includes("Sup3rS3cretPw"));
    assert.ok(!/postgres(ql)?:\/\//i.test(r.stdout));
  });

  console.log(`\n${passed} checks passed`);
  if (process.exitCode) {
    console.error("SEC-DB-RLS-001 probe tests FAILED");
  }
})();
