"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const lib = require("./operator-db-identity.cjs");

test("a blank or missing dedicated variable is not the opt-in", () => {
  for (const env of [{ DATABASE_URL: "postgresql://a" }, { DATABASE_URL: "postgresql://a", OPS_DATABASE_URL: "" }, { DATABASE_URL: "postgresql://a", OPS_DATABASE_URL: "   " }]) {
    const r = lib.resolveOperatorDatabaseUrl(env, "OPS_DATABASE_URL");
    assert.equal(r.optIn, false);
    assert.equal(r.url, "postgresql://a");
    assert.equal(r.source, "DATABASE_URL");
  }
});

test("a set dedicated variable wins over DATABASE_URL and the source names the variable, never the value", () => {
  const r = lib.resolveOperatorDatabaseUrl({ DATABASE_URL: "postgresql://old", REPORTER_DATABASE_URL: " postgresql://new " }, "REPORTER_DATABASE_URL");
  assert.equal(r.optIn, true);
  assert.equal(r.url, "postgresql://new");
  assert.equal(r.source, "REPORTER_DATABASE_URL");
  assert.ok(!r.source.includes("postgresql"));
});

test("nothing set resolves to an empty URL and no opt-in", () => {
  const r = lib.resolveOperatorDatabaseUrl({}, "OPS_DATABASE_URL");
  assert.deepEqual([r.url, r.optIn], ["", false]);
});

test("reporter verdict: exact name, not a superuser, BYPASSRLS required", () => {
  const ok = { name: "vexa_reporter", super: false, bypassrls: true };
  assert.equal(lib.evaluateOperatorIdentity(ok, "vexa_reporter", { requireBypassRls: true }).ok, true);
  assert.equal(lib.evaluateOperatorIdentity(null, "vexa_reporter", { requireBypassRls: true }).ok, false);
  assert.equal(lib.evaluateOperatorIdentity({ ...ok, name: "vexa_runtime" }, "vexa_reporter", { requireBypassRls: true }).ok, false);
  assert.equal(lib.evaluateOperatorIdentity({ ...ok, super: true }, "vexa_reporter", { requireBypassRls: true }).ok, false);
  assert.equal(lib.evaluateOperatorIdentity({ ...ok, bypassrls: false }, "vexa_reporter", { requireBypassRls: true }).ok, false);
});

test("ops verdict: exact name, not a superuser, BYPASSRLS forbidden", () => {
  const ok = { name: "vexa_ops", super: false, bypassrls: false };
  assert.equal(lib.evaluateOperatorIdentity(ok, "vexa_ops", { requireBypassRls: false }).ok, true);
  assert.equal(lib.evaluateOperatorIdentity({ ...ok, bypassrls: true }, "vexa_ops", { requireBypassRls: false }).ok, false);
  assert.equal(lib.evaluateOperatorIdentity({ ...ok, super: true }, "vexa_ops", { requireBypassRls: false }).ok, false);
  assert.equal(lib.evaluateOperatorIdentity({ ...ok, name: "vexa_reporter" }, "vexa_ops", { requireBypassRls: false }).ok, false);
});

test("assertOperatorIdentity reads through the client and throws a reason without any connection detail", async () => {
  const good = { $queryRawUnsafe: async (sql) => (assert.equal(sql, lib.IDENTITY_SQL), [{ name: "vexa_ops", super: false, bypassrls: false }]) };
  const row = await lib.assertOperatorIdentity(good, "vexa_ops", { requireBypassRls: false });
  assert.equal(row.name, "vexa_ops");
  const bad = { $queryRawUnsafe: async () => [{ name: "postgres", super: true, bypassrls: true }] };
  await assert.rejects(() => lib.assertOperatorIdentity(bad, "vexa_ops", { requireBypassRls: false }), /operator identity check failed: connected as postgres, expected vexa_ops/);
  const empty = { $queryRawUnsafe: async () => [] };
  await assert.rejects(() => lib.assertOperatorIdentity(empty, "vexa_ops", { requireBypassRls: false }), /could not read the connected role/);
});

test("createOperatorPrisma passes the URL only when opted in", () => {
  const seen = [];
  class Fake { constructor(options) { seen.push(options); } }
  lib.createOperatorPrisma(Fake, { optIn: false, url: "postgresql://x" });
  lib.createOperatorPrisma(Fake, { optIn: true, url: "postgresql://y" });
  assert.equal(seen[0], undefined);
  assert.deepEqual(seen[1], { datasources: { db: { url: "postgresql://y" } } });
});

test("the identity statement is read-only", () => {
  assert.match(lib.IDENTITY_SQL, /^SELECT /);
  assert.ok(!/;|insert|update|delete|drop|alter/i.test(lib.IDENTITY_SQL));
  assert.ok(fs.existsSync(path.join(__dirname, "operator-db-identity.cjs")));
});
