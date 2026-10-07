"use strict";

const DEFAULT_RESTRICTED_ROLE = "vexa_runtime_ci";

function resolveRestrictedRoleName(env = process.env) {
  const raw = env.RESTRICTED_ROLE_NAME;
  const role = (raw === undefined ? DEFAULT_RESTRICTED_ROLE : String(raw)).trim();
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) {
    throw new Error("RESTRICTED_ROLE_NAME must be a lowercase PostgreSQL identifier.");
  }
  return role;
}

function restrictedUrlFor(adminUrl, role, password) {
  const url = new URL(adminUrl);
  url.username = role;
  url.password = password;
  return url.toString();
}

module.exports = { DEFAULT_RESTRICTED_ROLE, resolveRestrictedRoleName, restrictedUrlFor };
