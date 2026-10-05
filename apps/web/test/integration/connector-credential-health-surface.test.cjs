#!/usr/bin/env node
/* eslint-disable no-console */
//
// PR 2c: the heartbeat records VALID / INVALID / INDETERMINATE / CONFIGURATION_ERROR on each
// installation. This exercises the real helper (apps/web/src/lib/connector-utils.ts) so the UI
// never presents an unreachable provider as bad credentials, and an expired installation does
// not look healthy because of an outage.
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const UTILS_MODULE = path.join(REPO_ROOT, "apps", "web", "src", "lib", "connector-utils.ts");
const read = (...p) => fs.readFileSync(path.join(REPO_ROOT, ...p), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run() {
  const { describeCredentialHealth } = require(UTILS_MODULE);
  const v = (outcome, reason = null, lastValidatedAt = null) => ({
    outcome,
    reason,
    lastValidatedAt,
    lastAttemptAt: "2026-10-05T00:00:00.000Z",
  });
  const verifiedAt = "2026-10-04T10:00:00.000Z";

  // Not checked by the heartbeat: no credential health, the page shows only the status.
  assert(describeCredentialHealth({ status: "PAUSED" }) === null, "paused has no credential health");
  assert(describeCredentialHealth({ status: "DISABLED", validation: v("INVALID") }) === null, "disabled has no credential health");

  // Never checked (including an older API that omits validation).
  for (const installation of [{ status: "ACTIVE" }, { status: "ACTIVE", validation: v(null) }]) {
    const health = describeCredentialHealth(installation);
    assert(health.label === "Not yet verified" && health.tone === "neutral", "unchecked ACTIVE is 'Not yet verified', not healthy");
  }

  // VALID
  const valid = describeCredentialHealth({ status: "ACTIVE", validation: v("VALID", null, verifiedAt) });
  assert(valid.label === "Verified" && valid.tone === "success" && valid.lastVerifiedAt === verifiedAt, "VALID is verified");
  const tokenOnly = describeCredentialHealth({ status: "ACTIVE", validation: v("VALID", "TOKEN_ONLY", verifiedAt) });
  assert(tokenOnly.label === "Verified" && /provider was not contacted/.test(tokenOnly.detail), "TOKEN_ONLY says no provider call was made");

  // INDETERMINATE on an active installation: warning, never 'rejected'
  const outage = describeCredentialHealth({ status: "ACTIVE", validation: v("INDETERMINATE", "HTTP_503", verifiedAt) });
  assert(outage.label === "Check inconclusive (provider unreachable)", "INDETERMINATE label");
  assert(outage.tone === "warning", "INDETERMINATE is a warning, not danger");
  assert(/HTTP 503/.test(outage.detail) && /not rejected/.test(outage.detail), "INDETERMINATE says the credentials were not rejected");
  assert(outage.lastVerifiedAt === verifiedAt, "last verified is preserved through an outage");

  // INDETERMINATE on an expired installation: still expired
  const stillExpired = describeCredentialHealth({ status: "CREDENTIAL_EXPIRED", validation: v("INDETERMINATE", "HTTP_503") });
  assert(stillExpired.label === "Credentials expired" && stillExpired.tone === "danger", "an outage does not clear an expired installation");

  // INVALID
  const rejected = describeCredentialHealth({ status: "CREDENTIAL_EXPIRED", validation: v("INVALID", "HTTP_401", verifiedAt) });
  assert(rejected.label === "Credentials rejected" && rejected.tone === "danger", "INVALID is 'Credentials rejected'");
  const legacyExpired = describeCredentialHealth({ status: "CREDENTIAL_EXPIRED" });
  assert(legacyExpired.label === "Credentials expired" && legacyExpired.tone === "danger", "expired with no facts stays expired");

  // CONFIGURATION_ERROR: not a credential verdict
  const config = describeCredentialHealth({ status: "ACTIVE", validation: v("CONFIGURATION_ERROR", "WOOCOMMERCE_SITE_URL_UNSAFE") });
  assert(config.label === "Configuration problem" && config.tone === "warning", "CONFIGURATION_ERROR label and tone");

  // Legacy boolean: explained, still not a rejection
  const legacy = describeCredentialHealth({ status: "ACTIVE", validation: v("INDETERMINATE", "LEGACY_BOOLEAN_FALSE") });
  assert(legacy.tone === "warning" && /cannot tell a rejected credential from an outage/.test(legacy.detail), "legacy boolean false is explained");

  // Raw reason codes are shown only as codes, never as a URL or message
  const odd = describeCredentialHealth({ status: "ACTIVE", validation: v("INDETERMINATE", "SOME_CODE") });
  assert(/Reason code: SOME_CODE\./.test(odd.detail), "unknown codes are shown as codes");

  // The pages render it
  const list = read("apps", "web", "src", "app", "connectors", "page.tsx");
  const detail = read("apps", "web", "src", "app", "channels", "connectors", "[installationId]", "page.tsx");
  assert(list.includes("describeCredentialHealth(installation)") && list.includes("credential-health-detail"), "connectors list renders credential health");
  assert(detail.includes("describeCredentialHealth(installation)") && detail.includes("credential-health-detail"), "connector detail renders credential health");
  assert(detail.includes("credentialHealthAlerts ? credentialHealthAlerts.label"), "Account health KPI must follow a warning or danger credential state instead of reading Healthy");
  const ops = read("apps", "web", "src", "app", "internal", "ops", "page.tsx");
  assert(ops.includes("inconclusiveInstallations") && ops.includes("configurationProblemInstallations"), "ops page shows the two new counts");
}

try {
  run();
  console.log("connector-credential-health-surface: ok");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
