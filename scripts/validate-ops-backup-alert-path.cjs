#!/usr/bin/env node

/**
 * A failed backup must never be silent. Both daily backup workflows have a notify-failure job that tells the API's internal ops
 * alerting. This guard fails if that path can quietly do nothing again:
 *   - the job must exist, depend on the backup job and run on failure();
 *   - it must refuse (fail the job with an explicit error) when API_INTERNAL_BASE_URL or INTERNAL_OPS_API_KEY is not set;
 *   - it must check the HTTP status of the alert call and fail unless it is 2xx;
 *   - it must not swallow errors with `|| true`.
 * `validateBackupAlertPath(transforms)` accepts per-file text transforms so the negative tests can prove each rule fires.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const WORKFLOWS = {
  database: { file: path.join(ROOT, ".github", "workflows", "backup-r2-daily.yml"), backupJob: "r2-backup" },
  observability: { file: path.join(ROOT, ".github", "workflows", "backup-r2-daily-observability.yml"), backupJob: "r2-backup-observability" },
};

function validateBackupAlertPath(transforms = {}) {
  const errors = [];
  for (const [name, { file, backupJob }] of Object.entries(WORKFLOWS)) {
    let text = fs.readFileSync(file, "utf8");
    if (transforms[name]) {
      text = transforms[name](text);
    }
    const fail = (message) => errors.push(`${name}: ${message}`);
    const at = text.indexOf("  notify-failure:");
    if (at < 0) {
      fail("has no notify-failure job");
      continue;
    }
    const job = text.slice(at);
    if (!new RegExp(`needs:\\s*\\[${backupJob}\\]`).test(job) || !/if:\s*failure\(\)/.test(job)) {
      fail(`notify-failure must need ${backupJob} and run if: failure()`);
    }
    if (!/\[ -z "\$\{API_INTERNAL_BASE_URL\}" \] \|\| \[ -z "\$\{INTERNAL_OPS_API_KEY\}" \]/.test(job) || !/::error[^\n]*nobody was alerted/.test(job)) {
      fail("must fail loudly when API_INTERNAL_BASE_URL or INTERNAL_OPS_API_KEY is not set");
    }
    if (!/alert_url="https:\/\/\$\{base\}\/api\/v1\/internal\/ops\/alerts\/backup-job-failure"/.test(job) || !/"\$\{alert_url\}"/.test(job)) {
      fail("must post to <host>/api/v1/internal/ops/alerts/backup-job-failure (the API's global prefix is api/v1; without it the alert is a 404)");
    }
    if (!/-w '%\{http_code\}'/.test(job) || !/2\*\)/.test(job)) {
      fail("must check that the alert endpoint answered 2xx");
    }
    if (!/environment:\s*staging/.test(job)) {
      fail("notify-failure must run in the staging environment so the alert secrets can be found beside the others");
    }
    if (/\|\|\s*true/.test(job)) {
      fail("must not swallow alert failures with || true");
    }
    if (!/exit 1/.test(job)) {
      fail("must exit non-zero when the alert is not delivered");
    }
  }
  return { ok: errors.length === 0, errors };
}

if (require.main === module) {
  const result = validateBackupAlertPath();
  if (!result.ok) {
    console.error("Backup alert path validation failed:");
    for (const e of result.errors) {
      console.error(`- ${e}`);
    }
    process.exit(1);
  }
  console.log("Backup alert path validation passed: a failed backup cannot be silent.");
}

module.exports = { validateBackupAlertPath };
