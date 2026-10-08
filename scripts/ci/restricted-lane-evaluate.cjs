"use strict";

/**
 * Pure decision logic of the restricted-role lane, separated so it can be unit tested without a database.
 *
 * rows: [{ test, passed }]; expectedFailing: Map(test -> entry); apiUsers: the database users observed on sessions that carry the
 * restricted API application name; role: the expected restricted role name. The dedicated identity subject has its own
 * database-side assertion, which is stronger than a best-effort external pg_stat_activity sample.
 *
 * isolatedRoles: pg_stat_activity is cluster-wide, so the monitor also sees the API sessions of tests that build their OWN disposable
 * database and run the API there as the throwaway restricted role of scripts/ci/create-restricted-runtime-role.cjs. When the lane role
 * is that same name (the regular CI lane) they are indistinguishable and fine. When the lane runs as the production-model role
 * (vexa_runtime, rehearse-v2) those sessions are a second, equally restricted identity: they are tolerated, but they never prove the
 * LANE role. The lane role itself has to be observed, or the dedicated identity test has to pass. Any other user (a superuser, the
 * admin) is still unexpected and fails the lane.
 */
const { DEFAULT_RESTRICTED_ROLE } = require("./restricted-lane-config.cjs");
const IDENTITY_PROOF_TESTS = new Set(["credential-rotation-tenant-iteration.test.cjs"]);
const FAILURE_CATEGORIES = new Set([
  "API_STARTUP_FAILURE",
  "DATABASE_CONNECTION_FAILURE",
  "PRIVILEGE_DENIED",
  "RLS_DENIED",
  "TEST_ASSERTION_FAILED",
  "TIMEOUT",
  "UNCLASSIFIED_FAILURE",
]);

function evaluate(rows, expectedFailing, apiUsers, role, isolatedRoles = [DEFAULT_RESTRICTED_ROLE]) {
  const classified = rows.map((r) => {
    const expected = expectedFailing.get(r.test);
    const status = r.passed ? (expected ? "UNEXPECTED_PASS" : "PASS") : expected ? "EXPECTED_FAIL" : "UNEXPECTED_FAIL";
    return { ...r, status, expected };
  });
  const count = (s) => classified.filter((r) => r.status === s).length;
  const users = [...apiUsers];
  const monitorSawUnexpectedUser = users.some((u) => u !== role && !isolatedRoles.includes(u));
  const monitorProvesIdentity = users.includes(role) && !monitorSawUnexpectedUser;
  const dedicatedTestProvesIdentity = classified.some((item) => IDENTITY_PROOF_TESTS.has(item.test) && item.status === "PASS");
  const sessionsOk = !monitorSawUnexpectedUser && (monitorProvesIdentity || dedicatedTestProvesIdentity);
  const unexpectedFail = count("UNEXPECTED_FAIL");
  const unexpectedPass = count("UNEXPECTED_PASS");
  return {
    classified,
    count,
    sessionsOk,
    identityProof: monitorProvesIdentity ? "MONITOR" : dedicatedTestProvesIdentity ? "DEDICATED_TEST" : "MISSING",
    unexpectedFail,
    unexpectedPass,
    ok: unexpectedFail === 0 && unexpectedPass === 0 && sessionsOk,
  };
}

const FAILURE_SIGNAL = /(AssertionError|integration test failed|\bfailed:|Error:|Expected |did not become healthy|Unhandled|ECONNREFUSED|P20\d\d\b|timed out)/;
const API_LOG_LINE = /^(\{"timestamp"|\[Nest\]|\s*at )/;

/**
 * A line that looks like a failure message printed by the TEST itself rather than one of the API's own log lines.
 * A test prints its assertion message, then the API's stderr tail, then exits, so the message is usually pushed out of a
 * last-N-lines window; the runner keeps the first few of these lines so a failure is diagnosable from CI output alone.
 */
function isFailureSignal(line) {
  return FAILURE_SIGNAL.test(line) && !API_LOG_LINE.test(line);
}

/**
 * Maps a child-test failure to a fixed, non-sensitive category. The runner keeps
 * raw output only in memory while the child is alive; this result is the only
 * diagnostic that can cross the evidence boundary.
 */
function classifyFailure({ timedOut, signals = [], tail = [] }) {
  if (timedOut) return "TIMEOUT";
  const text = [...signals, ...tail].join("\n");
  if (/row-level security|violates row-level security/i.test(text)) return "RLS_DENIED";
  if (/permission denied|insufficient privilege/i.test(text)) return "PRIVILEGE_DENIED";
  if (/P10\d\d|PrismaClientInitializationError|ECONNREFUSED|database .* (unreachable|unavailable)/i.test(text)) {
    return "DATABASE_CONNECTION_FAILURE";
  }
  if (/did not become healthy|API .* (did not|failed to) (become healthy|start)/i.test(text)) {
    return "API_STARTUP_FAILURE";
  }
  if (/AssertionError|integration test failed|expected=.*actual=|Expected .* got /i.test(text)) {
    return "TEST_ASSERTION_FAILED";
  }
  return "UNCLASSIFIED_FAILURE";
}

module.exports = { FAILURE_CATEGORIES, IDENTITY_PROOF_TESTS, classifyFailure, evaluate, isFailureSignal };
