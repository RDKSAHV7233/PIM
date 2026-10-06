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
  expectFail(`${target}: job removed`, { [target]: replace("  notify-failure:", "  notify-failure-renamed:") }, target);
}
console.log("validate-ops-backup-alert-path tests passed.");
