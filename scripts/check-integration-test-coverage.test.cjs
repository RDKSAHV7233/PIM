#!/usr/bin/env node
/* eslint-disable no-console */

"use strict";

const assert = require("node:assert/strict");

const {
  CI_QUARANTINED_TESTS,
  DB_DEPENDENT_TESTS,
  GLOB_COVERED_TESTS,
  evaluateCoverage,
  findDuplicates,
  listActualTestFiles,
} = require("./check-integration-test-coverage.cjs");

function main() {
  // A fully-declared set passes clean.
  assert.deepEqual(evaluateCoverage(["a.test.cjs", "b.test.cjs"], ["b.test.cjs"], ["a.test.cjs"], []), {
    ok: true,
    uncovered: [],
    stale: [],
    crossBucketDuplicates: [],
    duplicatesWithinBucket: [],
    declaredCount: 2,
  });

  // A file on disk that isn't declared anywhere fails and is named.
  const uncoveredResult = evaluateCoverage(
    ["a.test.cjs", "b.test.cjs", "c.test.cjs"],
    [],
    ["a.test.cjs", "b.test.cjs"],
    [],
  );
  assert.equal(uncoveredResult.ok, false);
  assert.deepEqual(uncoveredResult.uncovered, ["c.test.cjs"]);
  assert.deepEqual(uncoveredResult.stale, []);

  // A declared file that no longer exists on disk is flagged stale.
  const staleResult = evaluateCoverage(["a.test.cjs"], [], ["a.test.cjs", "b.test.cjs"]);
  assert.equal(staleResult.ok, false);
  assert.deepEqual(staleResult.stale, ["b.test.cjs"]);
  assert.deepEqual(staleResult.uncovered, []);

  // A file declared in both buckets is flagged as a cross-bucket duplicate.
  const crossBucketResult = evaluateCoverage(["a.test.cjs"], ["a.test.cjs"], ["a.test.cjs"], []);
  assert.equal(crossBucketResult.ok, false);
  assert.deepEqual(crossBucketResult.crossBucketDuplicates, ["a.test.cjs"]);
  assert.deepEqual(
    evaluateCoverage(["a.test.cjs"], [], ["a.test.cjs"], ["a.test.cjs"]).crossBucketDuplicates,
    ["a.test.cjs"],
    "quarantined files cannot also be CI-runnable",
  );

  // A file listed twice within the same bucket is flagged too.
  const withinBucketResult = evaluateCoverage(
    ["a.test.cjs"],
    [],
    ["a.test.cjs", "a.test.cjs"],
  );
  assert.equal(withinBucketResult.ok, false);
  assert.deepEqual(withinBucketResult.duplicatesWithinBucket, ["a.test.cjs"]);

  assert.deepEqual(findDuplicates(["x", "y", "x", "z", "y", "y"]), ["x", "y"]);
  assert.deepEqual(findDuplicates(["x", "y", "z"]), []);

  // Real repo state: the two declared buckets must not overlap and must be
  // internally duplicate-free (this is the same shape the CI step checks,
  // asserted here directly against the actual arrays as a static sanity
  // check independent of the filesystem).
  assert.deepEqual(findDuplicates(DB_DEPENDENT_TESTS), [], "DB_DEPENDENT_TESTS has no internal duplicates");
  assert.deepEqual(findDuplicates(GLOB_COVERED_TESTS), [], "GLOB_COVERED_TESTS has no internal duplicates");
  assert.deepEqual(findDuplicates(CI_QUARANTINED_TESTS), [], "CI_QUARANTINED_TESTS has no internal duplicates");
  const overlap = [...DB_DEPENDENT_TESTS, ...GLOB_COVERED_TESTS, ...CI_QUARANTINED_TESTS]
    .filter((entry, index, all) => all.indexOf(entry) !== index)
    .sort();
  assert.deepEqual(overlap, [], "coverage buckets must not overlap");

  // Real repo state: every file that currently exists on disk must be
  // accounted for, and every declared entry must still exist. This is the
  // live drift check the CI step performs — kept here too so `npm test`-style
  // invocation of this file alone still catches drift, not just the CLI run.
  const actualFiles = listActualTestFiles();
  const liveResult = evaluateCoverage(actualFiles, DB_DEPENDENT_TESTS, GLOB_COVERED_TESTS, CI_QUARANTINED_TESTS);
  assert.equal(
    liveResult.ok,
    true,
    `apps/web/test/integration/ has drifted from the declared allowlist: ${JSON.stringify(liveResult, null, 2)}`,
  );

  console.log("[check-integration-test-coverage.test] all assertions passed");
}

main();
