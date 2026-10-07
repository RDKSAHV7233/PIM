#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001 7.9b: the restore test's own rules. Pure verdicts, the streaming procedure with a stand-in `psql`, and static guards on
 * the script and its workflow (it must never be able to reach a production database).
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { Readable } = require("node:stream");
const { gzipSync } = require("node:zlib");

const rt = require("./r2-restore-test.cjs");

const ROOT = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "packages", "db", "identity", "identity-model.v1.json"), "utf8"));
const ALL_TABLES = [...Object.keys(manifest.runtime.tables), ...manifest.runtime.excluded];

const goodFacts = () => ({
  tables: [...ALL_TABLES],
  migrations: { count: 118, unfinished: 0 },
  counts: { Product: 12, WorkspaceDirectory: 3, ai_platform_controls: 1, connector_definitions: 13 },
  rlsTables: 64,
  policies: 67,
});
const goodCtx = () => ({ restoreExit: 0, trailerSeen: true, ageHours: 5, maxAgeHours: 36 });
const failing = (facts, ctx) => rt.evaluateRestore(facts, ctx, manifest).filter((f) => !f.ok).map((f) => f.check);

// ---- picking the backup -------------------------------------------------------------------------------------------------------------
test("pickNewest takes the newest object and ignores empty or malformed entries", () => {
  const objs = [
    { key: "backups/a.sql.gz", lastModified: "2026-10-05T02:00:00Z", size: 100 },
    { key: "backups/c.sql.gz", lastModified: "2026-10-07T02:00:00Z", size: 300 },
    { key: "backups/b.sql.gz", lastModified: "2026-10-06T02:00:00Z", size: 200 },
    { key: "backups/empty.sql.gz", lastModified: "2026-10-08T02:00:00Z", size: 0 },
    { key: "backups/bad.sql.gz", lastModified: "not a date", size: 5 },
    null,
  ];
  assert.equal(rt.pickNewest(objs).key, "backups/c.sql.gz");
  assert.equal(rt.pickNewest([]), null);
  assert.equal(rt.pickNewest(undefined), null);
  assert.equal(rt.pickNewest([{ key: "x", lastModified: "2026-10-07T02:00:00Z", size: 0 }]), null, "a zero-byte backup is not a backup");
});

test("ageHours", () => {
  assert.equal(rt.ageHours("2026-10-07T00:00:00Z", new Date("2026-10-07T06:00:00Z")), 6);
});

// ---- the target must be local -------------------------------------------------------------------------------------------------------
test("only a local database can be a restore target, and the refusal never echoes the URL", () => {
  for (const ok of ["postgresql://u:p@localhost:5432/d", "postgresql://u:p@127.0.0.1:5432/d", "postgresql://u:p@[::1]:5432/d"]) {
    assert.doesNotThrow(() => rt.assertLocalTarget(ok), ok);
  }
  for (const bad of ["postgresql://u:secret-pw@127.0.0.2:5432/d", "postgresql://u:secret-pw@db.example.com/d", "postgresql://u:secret-pw@monorail.proxy.rlwy.net:5432/railway", "postgresql://u:secret-pw@postgres.railway.internal:5432/railway", "not a url", ""]) {
    assert.throws(() => rt.assertLocalTarget(bad), (error) => !String(error.message).includes("secret-pw") && !String(error.message).includes("example.com"), bad);
  }
});

// ---- the verdicts --------------------------------------------------------------------------------------------------------------------
test("a faithful restore passes every check", () => {
  assert.deepEqual(failing(goodFacts(), goodCtx()), []);
  assert.ok(rt.evaluateRestore(goodFacts(), goodCtx(), manifest).length >= 9, "the evaluation is not trivially small");
});

test("a table added by a migration after the backup is tolerated, a truncated schema is not", () => {
  const f = goodFacts();
  f.tables = f.tables.slice(0, f.tables.length - 3);
  assert.deepEqual(failing(f, goodCtx()), [], "three missing tables of 78 are within the allowance");
  const g = goodFacts();
  g.tables = g.tables.slice(0, Math.floor(g.tables.length * 0.7));
  assert.ok(failing(g, goodCtx()).some((c) => c.includes("missing from the backup")));
});

test("every way a restore can be wrong is reported by a named check", () => {
  const cases = [
    ["the backup is too old", goodFacts(), { ...goodCtx(), ageHours: 80 }, "is recent"],
    ["the age is unknown", goodFacts(), { ...goodCtx(), ageHours: NaN }, "is recent"],
    ["the dump was truncated", goodFacts(), { ...goodCtx(), trailerSeen: false }, "completion trailer"],
    ["psql failed", goodFacts(), { ...goodCtx(), restoreExit: 3 }, "without an error"],
    ["psql was killed", goodFacts(), { ...goodCtx(), restoreExit: null }, "without an error"],
    ["an unknown table came back", { ...goodFacts(), tables: [...goodFacts().tables, "stray_table"] }, goodCtx(), "classified in the grants manifest"],
    ["the migrations table is missing", { ...goodFacts(), migrations: null }, goodCtx(), "migrations table"],
    ["the migrations table is empty", { ...goodFacts(), migrations: { count: 0, unfinished: 0 } }, goodCtx(), "migrations table"],
    ["a migration is unfinished", { ...goodFacts(), migrations: { count: 118, unfinished: 1 } }, goodCtx(), "migrations table"],
    ["the control row is missing", { ...goodFacts(), counts: { ...goodFacts().counts, ai_platform_controls: 0 } }, goodCtx(), "platform control row"],
    ["the control row is duplicated", { ...goodFacts(), counts: { ...goodFacts().counts, ai_platform_controls: 2 } }, goodCtx(), "platform control row"],
    ["the control table is absent", { ...goodFacts(), counts: { ...goodFacts().counts, ai_platform_controls: null } }, goodCtx(), "platform control row"],
    ["connector definitions are missing", { ...goodFacts(), counts: { ...goodFacts().counts, connector_definitions: 2 } }, goodCtx(), "connector definitions"],
    ["row level security did not come back", { ...goodFacts(), rlsTables: 3 }, goodCtx(), "row level security"],
    ["policies did not come back", { ...goodFacts(), policies: 0 }, goodCtx(), "row level security"],
  ];
  for (const [name, facts, ctx, label] of cases) {
    const failed = failing(facts, ctx);
    assert.ok(failed.some((c) => c.includes(label)), `"${name}" was not reported under "${label}": ${JSON.stringify(failed)}`);
  }
});

test("no facts at all (the restore failed before they could be read) fails rather than passing vacuously", () => {
  const failed = failing(null, { restoreExit: 3, trailerSeen: false, ageHours: 2, maxAgeHours: 36 });
  assert.ok(failed.length >= 5, JSON.stringify(failed));
});

// ---- the facts statement is read-only and never reads a row value ------------------------------------------------------------------
test("the facts statement is a single read-only SELECT of counts and names", () => {
  assert.match(rt.FACTS_SQL, /^SELECT json_build_object\(/);
  assert.ok(!/;/.test(rt.FACTS_SQL), "no second statement");
  assert.ok(!/\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|set_config|pg_authid|pg_shadow|password)\b/i.test(rt.FACTS_SQL), "no write, no secret catalog");
  for (const table of ["Product", "WorkspaceDirectory"]) {
    assert.ok(rt.FACTS_SQL.includes(`count(*) AS c FROM public."${table}"`), `${table} is only counted`);
  }
});

// ---- the streaming restore, with a stand-in psql -------------------------------------------------------------------------------------
function fakePsql(work) {
  const script = path.join(work, "fake-psql.cjs");
  fs.writeFileSync(
    script,
    `const fs=require("fs");const chunks=[];process.stdin.on("data",c=>chunks.push(c));process.stdin.on("end",()=>{
fs.writeFileSync(${JSON.stringify(path.join(work, "psql.json"))},JSON.stringify({args:process.argv.slice(2),stdin:Buffer.concat(chunks).toString("utf8")}));
const code=Number(process.env.FAKE_PSQL_EXIT||0);
if(code){process.stderr.write("psql: ERROR:  23505\\nDETAIL:  Key (email)=(jane@example.com) already exists.\\n");}
process.exit(code);});`,
  );
  return script;
}

async function restoreWith(sql, { exit = 0, gzip = true } = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "restore-test-"));
  const script = fakePsql(work);
  const previous = process.env.FAKE_PSQL_EXIT;
  process.env.FAKE_PSQL_EXIT = String(exit);
  try {
    const body = gzip ? gzipSync(Buffer.from(sql)) : Buffer.from(sql);
    const result = await rt.restoreFromStream(Readable.from([body]), "postgresql://u:secret-restore-pw@localhost:5432/restore_test", { psqlBin: process.execPath, psqlPrefixArgs: [script] });
    const recorded = fs.existsSync(path.join(work, "psql.json")) ? JSON.parse(fs.readFileSync(path.join(work, "psql.json"), "utf8")) : null;
    return { result, recorded };
  } finally {
    if (previous === undefined) delete process.env.FAKE_PSQL_EXIT;
    else process.env.FAKE_PSQL_EXIT = previous;
    fs.rmSync(work, { recursive: true, force: true });
  }
}

const DUMP = `-- PostgreSQL database dump\nCREATE TABLE t (id int);\nINSERT INTO t VALUES (1);\n-- ${rt.TRAILER}\n`;

test("the dump is gunzipped and streamed into psql with the runbook procedure and strict flags", async () => {
  const { result, recorded } = await restoreWith(DUMP);
  assert.deepEqual(result, { exit: 0, trailerSeen: true, sqlstate: null });
  assert.equal(recorded.stdin, DUMP, "psql received the gunzipped SQL byte for byte");
  for (const flag of ["ON_ERROR_STOP=1", "VERBOSITY=sqlstate", "--single-transaction", "-X", "-q"]) {
    assert.ok(recorded.args.includes(flag), `psql was given ${flag}`);
  }
});

test("a truncated dump is recognised by its missing trailer", async () => {
  const { result } = await restoreWith(DUMP.replace(`-- ${rt.TRAILER}\n`, ""));
  assert.equal(result.trailerSeen, false);
});

test("a failing restore reports its exit code and SQLSTATE only, never the message or any row value", async () => {
  const { result } = await restoreWith(DUMP, { exit: 3 });
  assert.equal(result.exit, 3);
  assert.equal(result.sqlstate, "23505");
  const text = JSON.stringify(result);
  assert.ok(!text.includes("jane@example.com") && !text.includes("email") && !text.includes("secret-restore-pw"));
});

test("a backup that is not valid gzip is refused with a message that carries no data", async () => {
  await assert.rejects(restoreWith("this is not gzip data at all", { gzip: false }), (error) => /not valid gzip/.test(error.message) && !error.message.includes("this is not gzip"));
});

// ---- static guards: the script and the workflow can never reach production --------------------------------------------------------
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("the script reads no production database variable and never prints a URL", () => {
  const code = stripComments(fs.readFileSync(path.join(__dirname, "r2-restore-test.cjs"), "utf8"));
  assert.ok(!/DATABASE_URL_DIRECT|DATABASE_URL_POOLED|process\.env\.DATABASE_URL|OBSERVABILITY_DATABASE_URL|STAGING_/.test(code), "only RESTORE_TEST_DATABASE_URL and the R2 variables");
  assert.ok(/RESTORE_TEST_DATABASE_URL/.test(code));
  assert.ok(!/console\.(log|error|warn)\([^)]*\b(target|databaseUrl)\b/.test(code), "the URL is never logged");
  for (const flag of ["ON_ERROR_STOP=1", "VERBOSITY=sqlstate", "--single-transaction"]) {
    assert.ok(code.includes(flag), `the restore always passes ${flag}`);
  }
});

test("the workflow is manual, runs in a throwaway container, and receives only the R2 secrets", () => {
  const text = fs.readFileSync(path.join(ROOT, ".github", "workflows", "restore-test-r2.yml"), "utf8");
  const on = text.slice(text.indexOf("\non:"), text.indexOf("\njobs:"));
  assert.ok(/workflow_dispatch:/.test(on) && !/schedule:|push:|pull_request/.test(on), "manual only");
  assert.ok(/image:\s*postgres:18/.test(text), "a PostgreSQL 18 service container, matching the server");
  assert.ok(/RESTORE_TEST_DATABASE_URL:\s*postgresql:\/\/postgres:restore-test-throwaway@localhost:5432\/restore_test/.test(text), "the target is the job's own local container");
  assert.ok(/environment:\s*staging/.test(text));
  const secrets = [...text.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual([...new Set(secrets)], ["R2_ACCESS_KEY_ID", "R2_ACCOUNT_ID", "R2_PRIVATE_BUCKET_NAME", "R2_SECRET_ACCESS_KEY"], "no database credential is ever passed to the restore test");
  assert.ok(!/DATABASE_URL_DIRECT|STAGING_DATABASE|OBSERVABILITY_DATABASE|BACKUP_DATABASE/.test(stripComments(text.replace(/^\s*#.*$/gm, ""))), "no production database variable appears");
});

test("the runbook documents the restore test and names the real restore format", () => {
  const runbook = fs.readFileSync(path.join(ROOT, "docs", "runbooks", "backup-restore.md"), "utf8");
  assert.ok(/Restore test/.test(runbook) && /restore-test-r2/.test(runbook));
  assert.ok(/db-restore\.sh/.test(runbook) && /custom-format|pg_restore/.test(runbook), "the runbook says what db-restore.sh is for");
});
