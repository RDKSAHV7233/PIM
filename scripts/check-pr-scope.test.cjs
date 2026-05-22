#!/usr/bin/env node
/* eslint-disable no-console */

"use strict";

const assert = require("node:assert/strict");

const {
  LARGE_PR_APPROVAL_LABEL,
  classifyDomains,
  evaluateScope,
  hasLargePrApproval,
  parseNumstat,
  summarizeScope,
} = require("./check-pr-scope.cjs");

function buildEntries(count, prefix) {
  return Array.from({ length: count }, (_, index) => ({
    additions: 20,
    deletions: 5,
    file: `${prefix}/file-${index}.ts`,
  }));
}

function main() {
  assert.deepEqual(parseNumstat("10\t2\tapps/api/src/auth/auth.service.ts\n-\t-\tassets/logo.png\n"), [
    { additions: 10, deletions: 2, file: "apps/api/src/auth/auth.service.ts" },
    { additions: 0, deletions: 0, file: "assets/logo.png" },
  ]);

  assert.deepEqual(
    classifyDomains([
      ".github/workflows/ci.yml",
      "apps/api/src/auth/auth.service.ts",
      "apps/api/test/integration/auth-login-lockout.test.cjs",
      "apps/web/src/middleware.ts",
      "docs/release.md",
    ]),
    ["api-auth", "api-tests", "ci", "docs", "web"],
  );

  const focusedSummary = summarizeScope(buildEntries(10, "apps/api/src/catalog"));
  assert.deepEqual(evaluateScope(focusedSummary, false), {
    approved: false,
    ok: true,
    reasons: [],
  });

  const oversizedEntries = [
    ...buildEntries(12, "apps/api/src/auth"),
    ...buildEntries(12, "apps/api/test/integration"),
    ...buildEntries(12, "apps/web/src"),
  ];
  const oversizedSummary = summarizeScope(oversizedEntries);
  const rejected = evaluateScope(oversizedSummary, false);
  assert.equal(rejected.ok, false);
  assert.match(rejected.reasons.join("\n"), /risk domains/);
  assert.equal(evaluateScope(oversizedSummary, true).ok, true);

  const lineHeavySummary = summarizeScope([{ additions: 2600, deletions: 1, file: "apps/api/src/catalog/catalog.service.ts" }]);
  assert.match(evaluateScope(lineHeavySummary, false).reasons.join("\n"), /2500-line review bound/);

  assert.equal(hasLargePrApproval([LARGE_PR_APPROVAL_LABEL], {}), true);
  assert.equal(hasLargePrApproval([], { PR_SCOPE_ALLOW_LARGE: "true" }), true);
  assert.equal(hasLargePrApproval([], {}), false);

  console.log("check-pr-scope.test.cjs: PASS");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
