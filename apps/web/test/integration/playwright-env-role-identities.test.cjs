#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Drift guard for the tracked .env.playwright (found by the mapping scratch-stack QA run, 2026-09-30).
 * The file overrides the Playwright API's identity directory, but it declared only 5 of the 8 app roles. The specs
 * (helpers/vexa-pim.cjs, helpers/global-setup.cjs) fall back to "<role>@vexa-pim.local" for publisher, approver and
 * connector_admin, which the override did not contain, so those logins resolved to the default "viewer" role and the
 * rbac-role-enforcement / rbac-admin-boundary-roles specs failed on "Role: Publisher" (etc.) badges.
 * This test keeps the file, the identity directory and the spec helpers in step.
 */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const ROLES = ["admin", "editor", "publisher", "approver", "channel_manager", "connector_admin", "reviewer", "viewer"];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

function run() {
  const env = parseEnv(fs.readFileSync(path.join(REPO_ROOT, ".env.playwright"), "utf8"));
  assert(env.PLAYWRIGHT_PASSWORD, "PLAYWRIGHT_PASSWORD must be declared.");

  let directory;
  try {
    directory = JSON.parse(env.PLAYWRIGHT_AUTH_IDENTITIES_JSON);
  } catch (error) {
    throw new Error(`PLAYWRIGHT_AUTH_IDENTITIES_JSON must be valid JSON on a single line: ${error.message}`);
  }

  const seen = new Set();
  for (const role of ROLES) {
    const varName = `PLAYWRIGHT_${role.toUpperCase()}_USER`;
    const userId = env[varName];
    assert(userId, `${varName} must be declared, otherwise the specs fall back to ${role}@vexa-pim.local, which is not in this identity directory.`);
    assert(!seen.has(userId), `${varName} must be a distinct user id (${userId} is reused).`);
    seen.add(userId);
    const identity = directory[userId];
    assert(identity, `${userId} (${varName}) must exist in PLAYWRIGHT_AUTH_IDENTITIES_JSON.`);
    assert(identity.role === role, `${userId} must have role "${role}" in the identity directory (found "${identity.role}").`);
    assert(identity.tenantId === "default", `${userId} must belong to the default tenant.`);
  }
  const extra = Object.keys(directory).filter((userId) => !seen.has(userId));
  assert(extra.length === 0, `identity directory has entries no PLAYWRIGHT_*_USER refers to: ${extra.join(", ")}`);

  // The spec helpers must know exactly the same eight roles.
  for (const file of ["vexa-pim.cjs", "global-setup.cjs"]) {
    const source = fs.readFileSync(path.join(REPO_ROOT, "apps", "web", "test", "e2e", "helpers", file), "utf8");
    for (const role of ROLES) {
      assert(source.includes(`PLAYWRIGHT_${role.toUpperCase()}_USER`), `helpers/${file} must read PLAYWRIGHT_${role.toUpperCase()}_USER.`);
    }
  }

  console.log(JSON.stringify({ status: "ok", validated: ["eight_roles_declared", "identity_directory_matches_users", "no_orphan_identities", "spec_helpers_read_same_vars"] }, null, 2));
}

try {
  run();
} catch (error) {
  console.error("Playwright env role identities test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
