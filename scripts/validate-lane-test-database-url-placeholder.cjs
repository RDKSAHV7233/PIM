#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001 7.10R: lane tests must not mistake a real database URL for the `HOST:5432` placeholder.
 *
 * Many integration tests carry a helper that replaces DATABASE_URL with the local default (`localhost:5432/pim1`) when it still holds the
 * template placeholder `HOST:5432`. Written as /HOST:5432/i it also matches "local" + "host:5432", that is, every real URL whose server
 * is `localhost` on the default port. The production-shaped rehearsal (rehearse-v2) runs PostgreSQL on exactly `localhost:5432`, so
 * the tests were silently redirected to `pim1`, an empty database, and failed with "table does not exist" while the restricted role and
 * the rehearsal were fine. A developer machine that uses another port never saw it.
 *
 * The placeholder is an upper-case template token. The match must be case-sensitive.
 *
 * This guard reads the tests listed in scripts/restricted-role-lane.v1.json and fails if any of them contains a regular expression
 * literal for HOST:5432 with the `i` flag.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const LANE = path.join(__dirname, "restricted-role-lane.v1.json");
const TEST_DIR = path.join(ROOT, "apps", "api", "test", "integration");

/** A regex literal that mentions HOST:5432 and carries the i flag, for example /HOST:5432/i or /\bhost:5432\b/gi. */
const CASE_INSENSITIVE_PLACEHOLDER = /\/[^/\n]*host:5432[^/\n]*\/[dgmsuvy]*i[dgmsuvy]*/i;

function findViolations(sources) {
  return Object.entries(sources)
    .filter(([, text]) => CASE_INSENSITIVE_PLACEHOLDER.test(text))
    .map(([name]) => name);
}

function readLaneSources() {
  const lane = JSON.parse(fs.readFileSync(LANE, "utf8"));
  const sources = {};
  for (const test of lane.tests) {
    sources[test] = fs.readFileSync(path.join(TEST_DIR, test), "utf8");
  }
  return sources;
}

function main() {
  const violations = findViolations(readLaneSources());
  if (violations.length > 0) {
    console.error(
      `lane tests with a case-insensitive HOST:5432 placeholder match (it also matches "localhost:5432"): ${violations.join(", ")}`,
    );
    process.exit(1);
  }
  console.log("lane test database-url placeholder guard passed");
}

if (require.main === module) {
  main();
}

module.exports = { findViolations, CASE_INSENSITIVE_PLACEHOLDER };
