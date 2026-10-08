#!/usr/bin/env node

const assert = require("node:assert/strict");
const { validateLane } = require("./validate-sec-restricted-lane.cjs");
const { classifyFailure, evaluate, isFailureSignal } = require("./ci/restricted-lane-evaluate.cjs");
const { safeFailureStage } = require("./ci/restricted-lane-safe-diagnostics.cjs");

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
const withEntry = (j) => {
  if (!j.expectedFailing[0]) {
    j.expectedFailing.push({ test: j.tests[0], tracks: "M1", reason: "a sufficiently long reason for the test entry" });
  }
  return j.expectedFailing[0];
};
const lane = (mutate) => (text) => {
  const j = JSON.parse(text);
  mutate(j);
  return JSON.stringify(j);
};

expectFail("lane lists a missing test", { lane: lane((j) => j.tests.push("does-not-exist.test.cjs")) }, "lane.tests");
expectFail("lane too small", { lane: lane((j) => { j.tests = j.tests.slice(0, 3); j.expectedFailing = []; }) }, "lane.tests");
expectFail("expected failure not in the lane", { lane: lane((j) => j.expectedFailing.push({ test: "other.test.cjs", tracks: "M1", reason: "this is a sufficiently long reason" })) }, "lane.expectedFailing");
expectFail("expected failure without a tracking PR", { lane: lane((j) => { withEntry(j).tracks = "later"; }) }, "lane.expectedFailing");
expectFail("expected failure without a reason", { lane: lane((j) => { withEntry(j).reason = "x"; }) }, "lane.expectedFailing");
expectFail("role loses NOBYPASSRLS", { role: replace("NOSUPERUSER NOBYPASSRLS NOCREATEDB", "NOSUPERUSER BYPASSRLS NOCREATEDB") }, "role");
expectFail("role granted ALL", { role: replace("GRANT SELECT, INSERT, UPDATE, DELETE ON", "GRANT ALL ON") }, "role");
expectFail("role may create roles", { role: replace("NOCREATEROLE NOREPLICATION`);\n      } else", "CREATEROLE NOREPLICATION`);\n      } else") }, "role");
expectFail("control row writable by the runtime", { role: replace("REVOKE INSERT, UPDATE, DELETE ON", "REVOKE INSERT ON") }, "role");
expectFail("preload no longer scoped to the API entry", { preload: replace(String.raw`dist\/main\.js`, "") }, "preload");
expectFail("preload assigns something else", { preload: (t) => `${t}\nprocess.env.DATABASE_URL_X = "postgresql://elsewhere";\n` }, "preload");
expectFail("restricted API loses its application name", { preload: replace("vexa-pim-api-restricted", "vexa-pim-api") }, "preload");
expectFail("lane stops requiring dedicated restricted-identity proof", { evaluate: replace("IDENTITY_PROOF_TESTS", "REMOVED_PROOF") }, "evaluate");
expectFail("lane stops being a ratchet", { evaluate: replace("UNEXPECTED_PASS", "UNEXPECTED_OK") }, "evaluate");
expectFail("runner no longer uses the shared logic", { runner: replace("verdict.ok", "true") }, "runner");
expectFail("runner no longer uses validated role configuration", { config: replace("RESTRICTED_ROLE_NAME", "V2_ROLE_NAME") }, "runner");
expectFail("session monitor ignores isolated subject databases", { runner: replace("application_name = 'vexa-pim-api-restricted'", "datname = current_database() AND application_name = 'vexa-pim-api-restricted'") }, "runner");
expectFail("session monitor is too coarse for short-lived API pools", { runner: replace("SESSION_MONITOR_INTERVAL_MS = 100", "SESSION_MONITOR_INTERVAL_MS = 1500") }, "runner");
expectFail("runner exposes a child-output tail", { runner: replace("r.failureCategory", "r.tail") }, "runner");
expectFail("runner loses its bounded failure checkpoint parser", { diagnostics: replace("SAFE_RESTRICTED_LANE_STAGE", "UNSAFE_STAGE") }, "runner");
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
assert.equal(run(rows(["credential-rotation-tenant-iteration.test.cjs", true], ["known.test.cjs", false]), []).ok, true, "the dedicated database-side identity proof covers short-lived API pools");
assert.equal(run(rows(["credential-rotation-tenant-iteration.test.cjs", true], ["known.test.cjs", false]), ["postgres"]).ok, false, "an observed privileged API identity always fails even when the dedicated proof passes");
// A backend still inside the connection handshake is reported with a NULL (or empty) user: not an identity, not an unexpected user.
assert.equal(run(rows(["a.test.cjs", true], ["known.test.cjs", false]), [ROLE, null, ""]).ok, true, "a not-yet-authenticated session next to the restricted role does not fail the lane");
assert.equal(run(rows(["a.test.cjs", true], ["known.test.cjs", false]), [null]).ok, false, "a not-yet-authenticated session proves nothing: no identity evidence still fails");
assert.equal(run(rows(["credential-rotation-tenant-iteration.test.cjs", true], ["known.test.cjs", false]), [null, ""]).ok, true, "the dedicated proof still covers a lane that only ever sampled handshakes");
assert.equal(run(rows(["a.test.cjs", true], ["known.test.cjs", false]), [ROLE, null, "postgres"]).ok, false, "a real privileged user still fails the lane even when a handshake was also sampled");
assert.deepEqual(run(rows(["a.test.cjs", true], ["known.test.cjs", false]), [null, ROLE]).identityProof, "MONITOR", "the restricted role is proven by the monitor, not by the unnamed session");
const detail = run(rows(["a.test.cjs", false], ["known.test.cjs", true]), [ROLE]);
assert.deepEqual([detail.unexpectedFail, detail.unexpectedPass], [1, 1]);
assert.equal(run([], [ROLE]).ok, true, "an empty run has nothing to fail but the runner always has tests");

// ---- failure-message capture ---------------------------------------------------------------------------------------------------
assert.equal(isFailureSignal("AssertionError [ERR_ASSERTION]: the credential must be v2"), true, "an assertion message is kept");
assert.equal(isFailureSignal("credential-rotation integration test failed:"), true, "a test's own failure banner is kept");
assert.equal(isFailureSignal("API did not become healthy at http://127.0.0.1:1/api/v1/health within 60000ms"), true, "a health timeout is kept");
assert.equal(isFailureSignal("Expected dry-run failures=0, got 1"), true, "an Expected-style message is kept");
assert.equal(isFailureSignal('{"timestamp":"2026-10-06T18:58:11.951Z","level":"error","message":"Marketplace export job failed during processing"}'), false, "the API's JSON log lines are not mistaken for the test's message");
assert.equal(isFailureSignal("[Nest] 4535  - LOG [RouterExplorer] Mapped {/api/v1/x, GET} route Error: none"), false, "Nest log lines are not kept");
assert.equal(isFailureSignal("    at Object.<anonymous> (file.cjs:10:5) Error: stack frame"), false, "stack frames are not kept");
assert.equal(isFailureSignal("ok   worker-backpressure.test.cjs (3s)"), false, "a passing line is not a failure");
assert.equal(classifyFailure({ timedOut: false, signals: ["new row violates row-level security policy"], tail: [] }), "RLS_DENIED");
assert.equal(classifyFailure({ timedOut: false, signals: ["permission denied for table Product"], tail: [] }), "PRIVILEGE_DENIED");
assert.equal(classifyFailure({ timedOut: true, signals: [], tail: [] }), "TIMEOUT");
assert.equal(classifyFailure({ timedOut: false, signals: [], tail: [] }), "UNCLASSIFIED_FAILURE");
assert.equal(safeFailureStage(["noise", "SAFE_RESTRICTED_LANE_STAGE=TENANT_PROVISIONING"]), "TENANT_PROVISIONING");
assert.equal(safeFailureStage(["SAFE_RESTRICTED_LANE_STAGE=contains-dashes"]), null, "only fixed safe stage codes may cross the evidence boundary");

console.log("validate-sec-restricted-lane tests passed.");
