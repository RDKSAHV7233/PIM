#!/usr/bin/env node
/* eslint-disable no-console */

"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const { backupKey, selectKeysToPrune, RETENTION_DAYS, MIN_BACKUPS_TO_KEEP, BACKUP_PREFIX } = require("./r2-backup-run.cjs");

test("backupKey produces a sortable, prefixed, filesystem-safe key", () => {
  const key = backupKey(new Date("2026-08-27T02:00:00.000Z"));
  assert.equal(key, "backups/2026-08-27T02-00-00-000Z.sql.gz");
  assert.ok(key.startsWith(BACKUP_PREFIX));
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
