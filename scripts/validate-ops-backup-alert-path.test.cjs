#!/usr/bin/env node

const assert = require("node:assert/strict");
const { validateBackupAlertPath } = require("./validate-ops-backup-alert-path.cjs");

const clean = validateBackupAlertPath();
assert.equal(clean.ok, true, clean.errors.join("\n"));

const replace = (from, to) => (text) => {
  assert.ok(text.includes(from), `mutation target missing: ${from}`);
  return text.split(from).join(to);
};
const expectFail = (name, transforms, label) => {
  const result = validateBackupAlertPath(transforms);
  assert.equal(result.ok, false, `not detected: ${name}`);
  assert.ok(result.errors.some((e) => e.startsWith(label)), `"${name}" reported, but not for ${label}:\n${result.errors.join("\n")}`);
};

for (const target of ["database", "observability"]) {
  expectFail(`${target}: errors swallowed again`, { [target]: (t) => `${t}\n          true || true\n` }, target);
  expectFail(`${target}: missing-secret check removed`, { [target]: replace("nobody was alerted", "ok") }, target);
  expectFail(`${target}: HTTP status no longer checked`, { [target]: replace("-w '%{http_code}'", "-w ''") }, target);
  expectFail(`${target}: job no longer runs on failure`, { [target]: replace("if: failure()", "if: always()") }, target);
  expectFail(
    `${target}: alert job loses the staging environment`,
    {
      [target]: (x) => {
        const i = x.indexOf("  notify-failure:");
        return x.slice(0, i) + x.slice(i).replace("    environment: staging", "");
      },
    },
    target,
  );
  expectFail(`${target}: alert URL loses the /api/v1 prefix`, { [target]: replace("/api/v1/internal/ops/alerts/backup-job-failure", "/internal/ops/alerts/backup-job-failure") }, target);
  expectFail(`${target}: alert posts to the raw secret again`, { [target]: replace('"${alert_url}"', '"https://${API_INTERNAL_BASE_URL}/internal/ops/alerts/backup-job-failure"') }, target);
  expectFail(`${target}: job removed`, { [target]: replace("  notify-failure:", "  notify-failure-renamed:") }, target);
}
// SEC-DB-RLS-001 7.9b: the dedicated backup identity is opt-in, main-database only, and verified before the dump.
expectFail("database: the fallback to the existing secret is lost (the opt-in would no longer be opt-in)", { database: replace(" || secrets.STAGING_DATABASE_URL_DIRECT", "") }, "database");
expectFail("database: the backup credential is no longer preferred", { database: replace("secrets.STAGING_BACKUP_DATABASE_URL || secrets.STAGING_DATABASE_URL_DIRECT }}\n          BACKUP_EXPECT_ROLE", "secrets.STAGING_DATABASE_URL_DIRECT }}\n          BACKUP_EXPECT_ROLE") }, "database");
expectFail("database: the role expectation is removed", { database: replace("BACKUP_EXPECT_ROLE: ${{ secrets.STAGING_BACKUP_DATABASE_URL != '' && 'vexa_backup' || '' }}", "BACKUP_EXPECT_ROLE: ''") }, "database");
expectFail("database: the role expectation names the wrong role", { database: replace("&& 'vexa_backup' ||", "&& 'postgres' ||") }, "database");
expectFail("database: the expectation applies even when the secret is unset", { database: replace("secrets.STAGING_BACKUP_DATABASE_URL != '' && 'vexa_backup' || ''", "'vexa_backup'") }, "database");
expectFail("observability: the main database's backup credential leaks into the observability backup", { observability: (t) => `${t}\n# STAGING_BACKUP_DATABASE_URL\n` }, "observability");
expectFail("observability: a role expectation for the main database is applied to the observability database", { observability: (t) => `${t}\n# BACKUP_EXPECT_ROLE: vexa_backup\n` }, "observability");
console.log("validate-ops-backup-alert-path tests passed.");
