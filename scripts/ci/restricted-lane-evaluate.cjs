"use strict";

/**
 * Pure decision logic of the restricted-role lane, separated so it can be unit tested without a database.
 *
 * rows: [{ test, passed }]; expectedFailing: Map(test -> entry); apiUsers: the database users observed on sessions that carry the
 * restricted API application name; role: the expected restricted role name.
 */
function evaluate(rows, expectedFailing, apiUsers, role) {
  const classified = rows.map((r) => {
    const expected = expectedFailing.get(r.test);
    const status = r.passed ? (expected ? "UNEXPECTED_PASS" : "PASS") : expected ? "EXPECTED_FAIL" : "UNEXPECTED_FAIL";
    return { ...r, status, expected };
  });
  const count = (s) => classified.filter((r) => r.status === s).length;
  const users = [...apiUsers];
  const sessionsOk = users.length > 0 && users.every((u) => u === role);
  const unexpectedFail = count("UNEXPECTED_FAIL");
  const unexpectedPass = count("UNEXPECTED_PASS");
  return { classified, count, sessionsOk, unexpectedFail, unexpectedPass, ok: unexpectedFail === 0 && unexpectedPass === 0 && sessionsOk };
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

module.exports = { evaluate, isFailureSignal };
