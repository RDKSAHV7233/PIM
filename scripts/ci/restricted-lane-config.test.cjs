"use strict";

const assert = require("node:assert/strict");
const { DEFAULT_RESTRICTED_ROLE, resolveRestrictedRoleName, restrictedUrlFor } = require("./restricted-lane-config.cjs");

assert.equal(resolveRestrictedRoleName({}), DEFAULT_RESTRICTED_ROLE);
assert.equal(resolveRestrictedRoleName({ RESTRICTED_ROLE_NAME: "vexa_runtime" }), "vexa_runtime");
assert.equal(resolveRestrictedRoleName({ RESTRICTED_ROLE_NAME: " vexa_runtime " }), "vexa_runtime");
for (const invalid of ["", "VEXA_RUNTIME", "vexa-runtime", "vexa runtime", "vexa_runtime;drop"]) {
  assert.throws(() => resolveRestrictedRoleName({ RESTRICTED_ROLE_NAME: invalid }), /lowercase PostgreSQL identifier/);
}
const target = new URL(restrictedUrlFor("postgresql://admin:admin-password@localhost:5432/pim1?schema=public", "vexa_runtime", "runtime-password"));
assert.equal(target.username, "vexa_runtime");
assert.equal(target.password, "runtime-password");
assert.equal(target.hostname, "localhost");
assert.equal(target.pathname, "/pim1");

console.log("restricted-lane config tests passed.");
