"use strict";

// SEC-DB-RLS-001 8.1b: the tax-regime seed is the deploy-time writer of a table the restricted runtime may only read.
// The real roles are exercised by the database-identity rehearsal (stage R8d); these tests pin the rules without a database.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { resolveSeedConnection } = require("./seed-tax-regimes.cjs");

test("a blank MIGRATION_DATABASE_URL is not the opt-in; the original order (DIRECT, then DATABASE_URL) is unchanged", () => {
  for (const env of [{ DATABASE_URL_DIRECT: "d", DATABASE_URL: "u" }, { MIGRATION_DATABASE_URL: "", DATABASE_URL_DIRECT: "d", DATABASE_URL: "u" }, { MIGRATION_DATABASE_URL: "  ", DATABASE_URL_DIRECT: "d" }]) {
    const r = resolveSeedConnection(env);
    assert.equal(r.optIn, false);
    assert.equal(r.url, "d");
    assert.equal(r.source, "DATABASE_URL_DIRECT");
  }
  const onlyPooled = resolveSeedConnection({ DATABASE_URL: "u" });
  assert.deepEqual([onlyPooled.url, onlyPooled.optIn, onlyPooled.source], ["u", false, "DATABASE_URL"]);
  assert.equal(resolveSeedConnection({}).url, "");
});

test("a set MIGRATION_DATABASE_URL wins over both runtime URLs and the source names the variable, never the value", () => {
  const r = resolveSeedConnection({ MIGRATION_DATABASE_URL: " postgresql://migrator ", DATABASE_URL_DIRECT: "d", DATABASE_URL: "u" });
  assert.equal(r.optIn, true);
  assert.equal(r.url, "postgresql://migrator");
  assert.equal(r.source, "MIGRATION_DATABASE_URL");
  assert.ok(!r.source.includes("postgresql"));
});

test("importing the script does not run it", () => {
  // resolveSeedConnection was imported above without a database; reaching this line proves main() is guarded by require.main.
  assert.equal(typeof resolveSeedConnection, "function");
});

test("the opt-in verifies the migrator identity before the first write", () => {
  const src = fs.readFileSync(path.join(__dirname, "seed-tax-regimes.cjs"), "utf8");
  const main = src.slice(src.indexOf("async function main()"));
  const identity = main.indexOf('assertOperatorIdentity(prisma, "vexa_migrator", { requireBypassRls: true })');
  const firstWrite = main.indexOf("prisma.taxRegime.upsert");
  assert.ok(identity > 0, "the identity check exists");
  assert.ok(firstWrite > identity, "the identity check comes before the first upsert");
  assert.match(main.slice(Math.max(0, identity - 400), identity), /if \(connection\.optIn\)/, "and only when opted in");
  assert.match(src, /require\.main === module/, "the script is importable");
});

test("the deploy workflow maps only the migrator secret into the seed step", () => {
  const wf = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "deploy-staging.yml"), "utf8");
  const seed = wf.slice(wf.indexOf("- name: Seed tax regimes"), wf.indexOf("- name: Sync smoke-test identity password"));
  assert.match(seed, /MIGRATION_DATABASE_URL: \$\{\{ secrets\.STAGING_MIGRATION_DATABASE_URL \}\}/);
  assert.ok(seed.includes("node scripts/seed-tax-regimes.cjs"));
});
