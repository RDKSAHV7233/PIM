#!/usr/bin/env node

const assert = require("node:assert/strict");
const { validateLane } = require("./validate-sec-restricted-lane.cjs");
const { evaluate } = require("./ci/restricted-lane-evaluate.cjs");

const clean = validateLane();
assert.equal(clean.ok, true, clean.errors.join("\n"));

// ---- every static rule must fire -------------------------------------------------------------------------------------------
const expectFail = (name, transforms, label) => {
  const result = validateLane(transforms);
  assert.equal(result.ok, false, `not detected: ${name}`);
  assert.ok(result.errors.some((e) => e.startsWith(label)), `"${name}" reported, but not under ${label}:\n${result.errors.join("\n")}`);
};
const replace = (from, to) => (text) => {
  assert.ok(text.includes(from), `mutation target missing: ${from}`);
  return text.split(from).join(to);
};
const lane = (mutate) => (text) => {
  const j = JSON.parse(text);
  mutate(j);
  return JSON.stringify(j);
};

expectFail("lane lists a missing test", { lane: lane((j) => j.tests.push("does-not-exist.test.cjs")) }, "lane.tests");
expectFail("lane too small", { lane: lane((j) => { j.tests = j.tests.slice(0, 3); j.expectedFailing = []; }) }, "lane.tests");
expectFail("expected failure not in the lane", { lane: lane((j) => j.expectedFailing.push({ test: "other.test.cjs", tracks: "M1", reason: "this is a sufficiently long reason" })) }, "lane.expectedFailing");
expectFail("expected failure without a tracking PR", { lane: lane((j) => { j.expectedFailing[0].tracks = "later"; }) }, "lane.expectedFailing");
expectFail("expected failure without a reason", { lane: lane((j) => { j.expectedFailing[0].reason = "x"; }) }, "lane.expectedFailing");
expectFail("role loses NOBYPASSRLS", { role: replace("NOSUPERUSER NOBYPASSRLS NOCREATEDB", "NOSUPERUSER BYPASSRLS NOCREATEDB") }, "role");
expectFail("role granted ALL", { role: replace("GRANT SELECT, INSERT, UPDATE, DELETE ON", "GRANT ALL ON") }, "role");
expectFail("role may create roles", { role: replace("NOCREATEROLE NOREPLICATION`);\n    } else", "CREATEROLE NOREPLICATION`);\n    } else") }, "role");
expectFail("control row writable by the runtime", { role: replace("REVOKE INSERT, UPDATE, DELETE ON", "REVOKE INSERT ON") }, "role");
expectFail("preload no longer scoped to the API entry", { preload: replace(String.raw`dist\/main\.js`, "") }, "preload");
expectFail("preload assigns something else", { preload: (t) => `${t}\nprocess.env.DATABASE_URL_X = "postgresql://elsewhere";\n` }, "preload");
expectFail("restricted API loses its application name", { preload: replace("vexa-pim-api-restricted", "vexa-pim-api") }, "preload");
expectFail("lane stops requiring proof of restricted sessions", { evaluate: replace("users.length > 0 && ", "") }, "evaluate");
expectFail("lane stops being a ratchet", { evaluate: replace("UNEXPECTED_PASS", "UNEXPECTED_OK") }, "evaluate");
expectFail("runner no longer uses the shared logic", { runner: replace("verdict.ok", "true") }, "runner");
expectFail("CI lets the lane fail silently", { ci: replace("  restricted-role-lane:\n    needs: detect-changes", "  restricted-role-lane:\n    continue-on-error: true\n    needs: detect-changes") }, "ci");
expectFail("CI skips the migration", { ci: replace("      - name: Prisma migrate deploy (admin identity)\n        run: npx prisma migrate deploy --schema packages/db/prisma/schema.prisma\n\n      - name: Create the restricted runtime role", "      - name: Create the restricted runtime role") }, "ci");
expectFail("CI lane job removed", { ci: replace("  restricted-role-lane:\n", "  restricted-role-lane-renamed:\n") }, "ci");

// ---- the lane's decision logic -------------------------------------------------------------------------------------------
const ROLE = "vexa_runtime_ci";
const expectedFailing = new Map([["known.test.cjs", { tracks: "M1", reason: "r" }]]);
const rows = (...pairs) => pairs.map(([test, passed]) => ({ test, passed }));
const run = (r, users) => evaluate(r, expectedFailing, new Set(users), ROLE);

assert.equal(run(rows(["a.test.cjs", true], ["known.test.cjs", false]), [ROLE]).ok, true, "passes and tracked expected failures are fine");
assert.equal(run(rows(["a.test.cjs", false], ["known.test.cjs", false]), [ROLE]).ok, false, "a new failure fails the lane");
assert.equal(run(rows(["a.test.cjs", true], ["known.test.cjs", true]), [ROLE]).ok, false, "a tracked test that now passes fails until the baseline is ratcheted down");
assert.equal(run(rows(["a.test.cjs", true], ["known.test.cjs", false]), []).ok, false, "no observed API sessions can never pass");
assert.equal(run(rows(["a.test.cjs", true], ["known.test.cjs", false]), [ROLE, "postgres"]).ok, false, "an API session as the admin user fails the lane");
assert.equal(run(rows(["a.test.cjs", true], ["known.test.cjs", false]), ["postgres"]).ok, false, "an API running only as the admin user fails the lane");
const detail = run(rows(["a.test.cjs", false], ["known.test.cjs", true]), [ROLE]);
assert.deepEqual([detail.unexpectedFail, detail.unexpectedPass], [1, 1]);
assert.equal(run([], [ROLE]).ok, true, "an empty run has nothing to fail but the runner always has tests");

console.log("validate-sec-restricted-lane tests passed.");
