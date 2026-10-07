#!/usr/bin/env node
/* eslint-disable no-console */

"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  backupKey,
  selectKeysToPrune,
  resolveBackupPrefix,
  evaluateBackupIdentity,
  parseBackupIdentity,
  BACKUP_IDENTITY_SQL,
  RETENTION_DAYS,
  MIN_BACKUPS_TO_KEEP,
  BACKUP_PREFIX,
} = require("./r2-backup-run.cjs");

// ---- SEC-DB-RLS-001 7.9b: the backup identity pre-flight ----------------------------------------------------------------------------
const GOOD = { name: "vexa_backup", super: false, bypassrls: true };

test("with no expected role the identity check is skipped, exactly the old behaviour", () => {
  assert.deepEqual(evaluateBackupIdentity(GOOD, ""), { ok: true, skipped: true });
  assert.deepEqual(evaluateBackupIdentity(null, undefined), { ok: true, skipped: true });
  assert.deepEqual(evaluateBackupIdentity({ name: "postgres", super: true, bypassrls: true }, "   "), { ok: true, skipped: true });
});

test("the real backup identity passes: right name, not a superuser, bypasses RLS", () => {
  assert.deepEqual(evaluateBackupIdentity(GOOD, "vexa_backup"), { ok: true });
});

test("every wrong identity is refused with a reason that names no credential", () => {
  const cases = [
    [{ name: "vexa_runtime", super: false, bypassrls: false }, /connected as vexa_runtime, expected vexa_backup/],
    [{ name: "vexa_app_v2", super: true, bypassrls: false }, /connected as vexa_app_v2, expected vexa_backup/],
    [{ name: "vexa_backup", super: true, bypassrls: true }, /is a superuser/],
    [{ name: "vexa_backup", super: false, bypassrls: false }, /does not bypass row level security/],
    [{ name: "vexa_migrator", super: false, bypassrls: true }, /connected as vexa_migrator/],
    [null, /could not read the connected role/],
  ];
  for (const [row, pattern] of cases) {
    const verdict = evaluateBackupIdentity(row, "vexa_backup");
    assert.equal(verdict.ok, false, JSON.stringify(row));
    assert.match(verdict.reason, pattern);
  }
});

test("psql output is parsed strictly", () => {
  assert.deepEqual(parseBackupIdentity("vexa_backup|f|t\n"), GOOD);
  assert.deepEqual(parseBackupIdentity("postgres|t|t"), { name: "postgres", super: true, bypassrls: true });
  for (const bad of ["", "vexa_backup|f", "|f|t", "a|b|c|d", null, undefined]) {
    assert.equal(parseBackupIdentity(bad), null, `not parsed: ${String(bad)}`);
  }
});

test("run() verifies the identity BEFORE it dumps or contacts R2, and a failed check throws", () => {
  // run() needs R2 and a database, so its order is pinned statically: the check must come before the client and the dump.
  const code = require("node:fs").readFileSync(require("node:path").join(__dirname, "r2-backup-run.cjs"), "utf8");
  const check = code.indexOf("evaluateBackupIdentity(identity, expectedRole)");
  const client = code.indexOf("new S3Client");
  const dump = code.indexOf("await pgDumpGzipToFile(databaseUrl, localFile)");
  assert.ok(check > 0 && client > check && dump > check, "the identity check precedes the R2 client and the dump");
  assert.match(code, /if \(!verdict\.ok\) \{\s*throw new Error\(`backup identity check failed: \$\{verdict\.reason\}`\);/, "a failed check fails the job, which fires the failure alert");
  assert.match(code, /const expectedRole = String\(process\.env\.BACKUP_EXPECT_ROLE \?\? ""\)\.trim\(\);\s*if \(expectedRole\) \{/, "the check runs only when the workflow asks for it");
  assert.ok(!/console\.(log|error)\([^)]*databaseUrl/.test(code), "the connection string is never logged");
});

test("the identity statement is one read-only SELECT of the connected role's own flags", () => {
  assert.match(BACKUP_IDENTITY_SQL, /^SELECT current_user AS name, r\.rolsuper AS super, r\.rolbypassrls AS bypassrls FROM pg_roles r WHERE r\.rolname = current_user$/);
  assert.ok(!/;|insert|update|delete|drop|alter|create|grant|pg_authid|password/i.test(BACKUP_IDENTITY_SQL), "no write, no second statement, no password column");
});

test("backupKey produces a sortable, prefixed, filesystem-safe key", () => {
  const key = backupKey(new Date("2026-08-27T02:00:00.000Z"));
  assert.equal(key, "backups/2026-08-27T02-00-00-000Z.sql.gz");
  assert.ok(key.startsWith(BACKUP_PREFIX));
});

test("BACKUP_PREFIX defaults to backups/ when R2_BACKUP_PREFIX is unset (#919 gate F: primary job behavior unchanged)", () => {
  assert.equal(BACKUP_PREFIX, "backups/");
});

test("resolveBackupPrefix falls back to backups/ when unset or blank", () => {
  const original = process.env.R2_BACKUP_PREFIX;
  try {
    delete process.env.R2_BACKUP_PREFIX;
    assert.equal(resolveBackupPrefix(), "backups/");
    process.env.R2_BACKUP_PREFIX = "   ";
    assert.equal(resolveBackupPrefix(), "backups/");
  } finally {
    if (original === undefined) {
      delete process.env.R2_BACKUP_PREFIX;
    } else {
      process.env.R2_BACKUP_PREFIX = original;
    }
  }
});

test("resolveBackupPrefix honors an explicit override and normalizes a trailing slash", () => {
  const original = process.env.R2_BACKUP_PREFIX;
  try {
    process.env.R2_BACKUP_PREFIX = "backups-observability";
    assert.equal(resolveBackupPrefix(), "backups-observability/");
    process.env.R2_BACKUP_PREFIX = "backups-observability/";
    assert.equal(resolveBackupPrefix(), "backups-observability/");
  } finally {
    if (original === undefined) {
      delete process.env.R2_BACKUP_PREFIX;
    } else {
      process.env.R2_BACKUP_PREFIX = original;
    }
  }
});

test("selectKeysToPrune leaves recent backups alone", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const objects = [
    { key: "backups/day-1.sql.gz", lastModified: new Date("2026-08-26T00:00:00.000Z") },
    { key: "backups/day-2.sql.gz", lastModified: new Date("2026-08-25T00:00:00.000Z") },
  ];
  assert.deepEqual(selectKeysToPrune(objects, now), []);
});

test("selectKeysToPrune drops objects strictly older than the retention window", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const objects = [];
  // 10 recent backups (within retention) + 10 old ones (outside retention).
  for (let i = 0; i < 10; i += 1) {
    objects.push({ key: `backups/recent-${i}.sql.gz`, lastModified: new Date(now.getTime() - i * 24 * 60 * 60 * 1000) });
  }
  for (let i = 0; i < 10; i += 1) {
    const age = RETENTION_DAYS + 1 + i;
    objects.push({ key: `backups/old-${i}.sql.gz`, lastModified: new Date(now.getTime() - age * 24 * 60 * 60 * 1000) });
  }
  const pruned = selectKeysToPrune(objects, now);
  assert.equal(pruned.length, 10);
  assert.ok(pruned.every((k) => k.startsWith("backups/old-")));
});

test("selectKeysToPrune never drops the total below the safety floor, even if everything is old", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const objects = Array.from({ length: 5 }, (_, i) => ({
    key: `backups/ancient-${i}.sql.gz`,
    lastModified: new Date(now.getTime() - (RETENTION_DAYS + 100 + i) * 24 * 60 * 60 * 1000),
  }));
  // Only 5 objects exist, floor is MIN_BACKUPS_TO_KEEP (7) — nothing should be pruned.
  assert.ok(objects.length < MIN_BACKUPS_TO_KEEP);
  const pruned = selectKeysToPrune(objects, now);
  assert.deepEqual(pruned, []);
});

test("selectKeysToPrune keeps the floor count when old backups exceed it", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  // 20 objects, all older than retention. Floor is 7 -> expect 13 pruned, 7 newest kept.
  const objects = Array.from({ length: 20 }, (_, i) => ({
    key: `backups/old-${i}.sql.gz`,
    lastModified: new Date(now.getTime() - (RETENTION_DAYS + 1 + i) * 24 * 60 * 60 * 1000),
  }));
  const pruned = selectKeysToPrune(objects, now);
  assert.equal(pruned.length, 20 - MIN_BACKUPS_TO_KEEP);
  // The 7 newest (smallest index, since index increases with age) must survive.
  const survivors = objects.map((o) => o.key).filter((k) => !pruned.includes(k));
  assert.deepEqual(
    survivors.sort(),
    ["old-0", "old-1", "old-2", "old-3", "old-4", "old-5", "old-6"].map((n) => `backups/${n}.sql.gz`).sort(),
  );
});
