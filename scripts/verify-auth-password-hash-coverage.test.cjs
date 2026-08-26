#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT_PATH = path.join(REPO_ROOT, "scripts", "verify-auth-password-hash-coverage.cjs");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const script = fs.readFileSync(SCRIPT_PATH, "utf8");

assert(script.includes("PrismaClient"), "coverage checker must use the Prisma client");
assert(script.includes("prisma.authIdentity.count"), "coverage checker must count AuthIdentity rows");
assert(script.includes("passwordHash: null"), "coverage checker must test passwordHash null coverage");
assert(script.includes("AUTH_PASSWORD_HASH_COVERAGE_INCOMPLETE"), "coverage checker must fail with a stable blocker code");
assert(script.includes("DATABASE_URL_DIRECT"), "coverage checker must support direct database URL");
assert(script.includes("DATABASE_URL_POOLED"), "coverage checker must support pooled database URL");
assert(script.includes("DATABASE_URL"), "coverage checker must support fallback database URL");
assert(!script.includes("PIM_AUTH_PASSWORD"), "coverage checker must not depend on the shared password fallback");
assert(!script.includes(".update("), "coverage checker must be read-only");
assert(!script.includes(".updateMany("), "coverage checker must be read-only");
assert(!script.includes(".delete("), "coverage checker must be read-only");
assert(!script.includes(".deleteMany("), "coverage checker must be read-only");
assert(!script.includes(".create("), "coverage checker must be read-only");
assert(!script.includes("passwordHash,"), "coverage checker must never print password hashes");

console.log("verify-auth-password-hash-coverage.test.cjs: PASS");
