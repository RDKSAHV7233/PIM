"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { findViolations } = require("./validate-lane-test-database-url-placeholder.cjs");

const BS = String.fromCharCode(92);

test("the case-insensitive placeholder match is rejected, in every spelling", () => {
  const cases = [
    "if (/HOST:5432/i.test(url)) {}",
    "if (/host:5432/i.test(url)) {}",
    "if (/" + BS + "bHOST:5432" + BS + "b/i.test(url)) {}",
    "if (/@HOST:5432/gi.test(url)) {}",
  ];
  for (const text of cases) {
    assert.deepEqual(findViolations({ "a.test.cjs": text }), ["a.test.cjs"], text);
  }
});

test("the case-sensitive placeholder match is accepted", () => {
  const cases = [
    "if (/HOST:5432/.test(url)) {}",
    "if (/" + BS + "bHOST:5432" + BS + "b/.test(url)) {}",
    "if (/HOST:5432/g.test(url)) {}",
  ];
  for (const text of cases) {
    assert.deepEqual(findViolations({ "a.test.cjs": text }), [], text);
  }
});

test("a test without the placeholder, or with an unrelated i-flag regex, is accepted", () => {
  assert.deepEqual(findViolations({ "a.test.cjs": "const re = /already exists/i; const url = 'postgresql://u:p@localhost:5432/d';" }), []);
});

test("only the offending file is named", () => {
  assert.deepEqual(findViolations({ "ok.test.cjs": "/HOST:5432/.test(x)", "bad.test.cjs": "/HOST:5432/i.test(x)" }), ["bad.test.cjs"]);
});

test("the real lane tests pass the guard", () => {
  const { spawnSync } = require("node:child_process");
  const r = spawnSync(process.execPath, [require("node:path").join(__dirname, "validate-lane-test-database-url-placeholder.cjs")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});
