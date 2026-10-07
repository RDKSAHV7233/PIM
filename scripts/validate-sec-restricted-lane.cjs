#!/usr/bin/env node

/**
 * SEC-DB-RLS-001: static guard for the restricted-role CI lane.
 *
 * The lane is only worth having if it cannot quietly stop being what it claims. This checks, from source, that:
 *   - the lane lists real test files, and every expected-failing entry is a listed test with a reason and a tracking PR (M1..M6);
 *   - the role is NOSUPERUSER and NOBYPASSRLS, grants are explicit table-level CRUD (never ALL), and the control tables are tighter;
 *   - the preload switches only the API entry process, and only when a restricted URL is given;
 *   - the runner refuses to pass unless the API provably connected as the restricted role, and uses the shared decision logic;
 *   - CI runs the lane as its own job with a disposable database, migrates as the admin identity, and that job is not allowed to
 *     fail silently (no continue-on-error).
 * `validateLane(transforms)` accepts per-source text transforms so the negative tests can prove each rule fires.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const FILES = {
  lane: path.join(__dirname, "restricted-role-lane.v1.json"),
  role: path.join(__dirname, "ci", "create-restricted-runtime-role.cjs"),
  preload: path.join(__dirname, "ci", "restricted-db-preload.cjs"),
  evaluate: path.join(__dirname, "ci", "restricted-lane-evaluate.cjs"),
  runner: path.join(__dirname, "run-restricted-role-lane.cjs"),
  config: path.join(__dirname, "ci", "restricted-lane-config.cjs"),
  ci: path.join(ROOT, ".github", "workflows", "ci.yml"),
};
const TESTS_DIR = path.join(ROOT, "apps", "api", "test", "integration");

function validateLane(transforms = {}) {
  const errors = [];
  const fail = (label, message) => errors.push(`${label}: ${message}`);
  const src = {};
  for (const [key, file] of Object.entries(FILES)) {
    src[key] = fs.readFileSync(file, "utf8");
    if (transforms[key]) {
      src[key] = transforms[key](src[key]);
    }
  }
  const lane = JSON.parse(src.lane);

  if (!Array.isArray(lane.tests) || lane.tests.length < 10) {
    fail("lane.tests", "the lane must run a meaningful set of tests (at least 10)");
  }
  for (const t of lane.tests || []) {
    if (!fs.existsSync(path.join(TESTS_DIR, t))) {
      fail("lane.tests", `${t} does not exist under apps/api/test/integration`);
    }
  }
  if (new Set(lane.tests).size !== (lane.tests || []).length) {
    fail("lane.tests", "duplicate test entries");
  }
  for (const e of lane.expectedFailing || []) {
    if (!(lane.tests || []).includes(e.test)) {
      fail("lane.expectedFailing", `${e.test} is not a listed test`);
    }
    if (!/^M[1-6]$/.test(String(e.tracks))) {
      fail("lane.expectedFailing", `${e.test} must name the migration PR that fixes it (M1 to M6)`);
    }
    if (!e.reason || String(e.reason).length < 20) {
      fail("lane.expectedFailing", `${e.test} needs a reason`);
    }
  }

  if (!/NOSUPERUSER NOBYPASSRLS/.test(src.role)) {
    fail("role", "the restricted role must be created NOSUPERUSER NOBYPASSRLS");
  }
  const roleWithoutNegations = src.role.replace(/NOSUPERUSER|NOBYPASSRLS|NOCREATEDB|NOCREATEROLE|NOREPLICATION/g, "");
  const codeOnly = roleWithoutNegations
    .split(String.fromCharCode(10))
    .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
    .join(String.fromCharCode(10));
  if (/GRANT ALL|SUPERUSER|BYPASSRLS|GRANT OPTION|CREATEROLE|CREATEDB|REPLICATION/.test(codeOnly)) {
    fail("role", "the role script must not grant ALL, superuser, BYPASSRLS, grant options, replication, or role or database creation");
  }
  if (!/GRANT SELECT, INSERT, UPDATE, DELETE ON/.test(src.role)) {
    fail("role", "grants must be explicit table-level CRUD");
  }
  if (!/REVOKE INSERT, UPDATE, DELETE ON "\$\{table\}" FROM/.test(src.role) || !/ai_platform_controls/.test(src.role)) {
    fail("role", "the platform control row must be read-only for the runtime");
  }
  if (!/owns no relation/.test(src.role) || !/does not own the schema/.test(src.role)) {
    fail("role", "the role script must assert the runtime owns nothing");
  }

  if (!src.preload.includes("VEXA_RESTRICTED_DATABASE_URL") || !src.preload.includes(String.raw`dist\/main\.js`) || !src.preload.includes("if (restricted &&")) {
    fail("preload", "the preload must act only when a restricted URL is given and only for apps/api/dist/main.js");
  }
  const assignments = src.preload.match(/process[.]env[.]DATABASE_URL[A-Z_]* = [^;]+;/g) || [];
  if (assignments.length !== 3 || assignments.some((x) => !x.endsWith("= restricted;"))) {
    fail("preload", "the preload may only assign the restricted URL, to exactly the three database variables");
  }
  if (!/DB_POOL_APP_NAME = "vexa-pim-api-restricted"/.test(src.preload) || !/vexa-pim-api-restricted/.test(src.runner)) {
    fail("preload", "the restricted API must carry a distinct application name so the lane can prove which sessions it is");
  }

  if (!/sessionsOk/.test(src.evaluate) || !/users\.length > 0/.test(src.evaluate) || !/every\(\(u\) => u === role\)/.test(src.evaluate)) {
    fail("evaluate", "the lane must fail unless it observed API sessions and every one was the restricted role");
  }
  if (!/UNEXPECTED_PASS/.test(src.evaluate) || !/UNEXPECTED_FAIL/.test(src.evaluate)) {
    fail("evaluate", "the lane must be a ratchet: unexpected failures and unexpected passes both fail it");
  }
  if (!/require\("\.\/ci\/restricted-lane-evaluate\.cjs"\)/.test(src.runner) || !/verdict\.ok/.test(src.runner)) {
    fail("runner", "the runner must use the shared decision logic");
  }
  if (!/resolveRestrictedRoleName/.test(src.runner) || !/restrictedUrlFor/.test(src.runner) || !/RESTRICTED_ROLE_NAME/.test(src.config)) {
    fail("runner", "the runner must resolve an explicit, validated restricted role name for production-shaped rehearsal reuse");
  }
  if (!/NODE_OPTIONS/.test(src.runner) || !/--require=/.test(src.runner)) {
    fail("runner", "the runner must inject the preload through NODE_OPTIONS");
  }

  const job = /\n  restricted-role-lane:\n([\s\S]*?)(?=\n  [a-z0-9-]+:\n|$)/.exec(src.ci);
  if (!job) {
    fail("ci", "ci.yml must define a restricted-role-lane job");
  } else {
    const body = job[1];
    if (/continue-on-error:\s*true/.test(body)) {
      fail("ci", "the restricted-role lane must not be allowed to fail silently (no continue-on-error)");
    }
    if (!/image:\s*postgres/.test(body)) {
      fail("ci", "the lane needs its own disposable PostgreSQL service");
    }
    for (const needle of ["prisma migrate deploy", "create-restricted-runtime-role.cjs", "run-restricted-role-lane.cjs"]) {
      if (!body.includes(needle)) {
        fail("ci", `the lane job must run ${needle}`);
      }
    }
    if (body.indexOf("prisma migrate deploy") > body.indexOf("create-restricted-runtime-role.cjs")) {
      fail("ci", "migrations must run (as the admin identity) before the restricted role is created");
    }
  }
  return { ok: errors.length === 0, errors };
}

if (require.main === module) {
  const result = validateLane();
  if (!result.ok) {
    console.error("SEC-DB-RLS-001 restricted-role lane validation failed:");
    for (const e of result.errors) {
      console.error(`- ${e}`);
    }
    process.exit(1);
  }
  const lane = JSON.parse(fs.readFileSync(FILES.lane, "utf8"));
  console.log(`SEC-DB-RLS-001 restricted-role lane validation passed: ${lane.tests.length} tests, ${lane.expectedFailing.length} tracked expected failures.`);
}

module.exports = { validateLane };
