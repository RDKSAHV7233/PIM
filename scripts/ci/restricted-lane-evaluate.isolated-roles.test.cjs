"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluate } = require("./restricted-lane-evaluate.cjs");

const LANE_ROLE = "vexa_runtime";
const ISOLATED = "vexa_runtime_ci";
const pass = (name) => ({ test: name, passed: true });
const run = (users, tests = [pass("a.test.cjs")], role = LANE_ROLE) => evaluate(tests, new Map(), new Set(users), role);
const rotation = pass("credential-rotation-tenant-iteration.test.cjs");

test("the production-model lane tolerates the isolated tests' own throwaway restricted role", () => {
  const v = run([LANE_ROLE, ISOLATED]);
  assert.equal(v.ok, true);
  assert.equal(v.identityProof, "MONITOR");
});

test("isolated-role sessions never prove the LANE role", () => {
  assert.equal(run([ISOLATED]).ok, false, "only the throwaway role observed, no dedicated proof");
  const v = run([ISOLATED], [rotation, pass("a.test.cjs")]);
  assert.equal(v.ok, true, "the dedicated database-side identity test can still prove it");
  assert.equal(v.identityProof, "DEDICATED_TEST");
});

test("any other user is still unexpected, with or without an isolated role beside it", () => {
  for (const users of [[LANE_ROLE, "postgres"], [LANE_ROLE, ISOLATED, "postgres"], ["postgres"], [LANE_ROLE, "vexa_app_v2"], [LANE_ROLE, "vexa_migrator"]]) {
    assert.equal(run(users).ok, false, users.join(","));
    assert.equal(run(users, [rotation, pass("a.test.cjs")]).ok, false, `${users.join(",")} even with the dedicated proof`);
  }
});

test("in the regular lane the lane role and the isolated role are the same name and behave as before", () => {
  assert.equal(run([ISOLATED], [pass("a.test.cjs")], ISOLATED).ok, true);
  assert.equal(run([], [pass("a.test.cjs")], ISOLATED).ok, false);
  assert.equal(run(["postgres"], [pass("a.test.cjs")], ISOLATED).ok, false);
});

test("an explicit isolatedRoles list replaces the default", () => {
  const v = evaluate([pass("a.test.cjs")], new Map(), new Set([LANE_ROLE, ISOLATED]), LANE_ROLE, []);
  assert.equal(v.ok, false, "with no isolated roles allowed, the throwaway role is unexpected");
});
