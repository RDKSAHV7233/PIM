#!/usr/bin/env node
/**
 * fix-test-env.js — Set L: add PIM_AUTH_REDIS_DISABLED to all integration tests
 *
 * 85 integration tests have setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true")
 * but are missing setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true").
 * This causes those tests to hang or fail in environments without Redis
 * because the auth middleware attempts a Redis connection on startup.
 *
 * Root cause: the auth system has two Redis-dependent subsystems:
 *   - JWT blocklist (controlled by JWT_BLOCKLIST_REDIS_DISABLED)
 *   - Auth middleware session gate (controlled by PIM_AUTH_REDIS_DISABLED)
 * Tests that disable only the first leave the second active.
 * The three working tests (connector-idempotency-semantics, rls-isolation,
 * category-tenant-uniqueness, etc.) disable both.
 *
 * Usage (run from PIM1/ repo root):
 *   node fix-test-env.js
 *   node fix-test-env.js --dry-run   # preview only, no writes
 *
 * Already patched in Set A (skip list):
 *   marketplace-capability-gating.test.cjs
 *   media-ssrf-guard.test.cjs
 */
"use strict";
const fs   = require("node:fs");
const path = require("node:path");

const DRY_RUN = process.argv.includes("--dry-run");
const TEST_DIR = path.join(__dirname, "apps", "api", "test", "integration");

// Files already patched in Set A — skip to avoid double-adding
const ALREADY_PATCHED = new Set([
  "marketplace-capability-gating.test.cjs",
  "media-ssrf-guard.test.cjs",
]);

// Files that intentionally set JWT_BLOCKLIST_REDIS_DISABLED in a different context
// (jwt-blocklist-contract controls both values dynamically)
const SKIP_LIST = new Set([
  ...ALREADY_PATCHED,
  "jwt-blocklist-contract.test.cjs",
]);

const BLOCKLIST_NEEDLE = 'setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");';
const AUTH_NEEDLE      = 'setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");';
const AUTH_INSERT      = `  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");  // Set L: auth middleware Redis gate`;

let fixed = 0;
let skipped = 0;
let alreadyOk = 0;

const files = fs.readdirSync(TEST_DIR).filter(f => f.endsWith(".cjs") || f.endsWith(".ts"));

for (const file of files) {
  if (SKIP_LIST.has(file)) { skipped++; continue; }

  const fullPath = path.join(TEST_DIR, file);
  const content  = fs.readFileSync(fullPath, "utf8");

  if (!content.includes(BLOCKLIST_NEEDLE)) { skipped++; continue; }
  if (content.includes(AUTH_NEEDLE))       { alreadyOk++; continue; }

  // Insert PIM_AUTH_REDIS_DISABLED on the line immediately after JWT_BLOCKLIST_REDIS_DISABLED
  const patched = content.replace(
    BLOCKLIST_NEEDLE,
    `${BLOCKLIST_NEEDLE}\n${AUTH_INSERT}`
  );

  if (!DRY_RUN) {
    fs.writeFileSync(fullPath, patched, "utf8");
    console.log(`  patched: ${file}`);
  } else {
    console.log(`  [dry-run] would patch: ${file}`);
  }
  fixed++;
}

console.log(`\nDone. Fixed: ${fixed} | Already ok: ${alreadyOk} | Skipped: ${skipped}`);
if (DRY_RUN) console.log("(dry-run mode — no files written)");
