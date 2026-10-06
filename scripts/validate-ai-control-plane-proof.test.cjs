#!/usr/bin/env node

/** Unit tests for the proof's classification rules. They need no database. */
const assert = require("node:assert/strict");
const lib = require("./ai-control-plane-proof-lib.cjs");

const { PROVEN, UNVERIFIED, FAILED } = lib;

// ---- a hidden zero is never proof of emptiness ----------------------------------------------------------------------
const restricted = { isSuperuser: false, bypassRls: false };
assert.equal(lib.visibilityOf({ ...restricted, rlsEnabled: true, hasMaintenancePolicy: false, readThroughMaintenance: false }), "hidden");
assert.equal(lib.visibilityOf({ ...restricted, rlsEnabled: true, hasMaintenancePolicy: true, readThroughMaintenance: false }), "hidden", "a maintenance policy only helps when read through the maintenance transaction");
assert.equal(lib.visibilityOf({ ...restricted, rlsEnabled: true, hasMaintenancePolicy: false, readThroughMaintenance: true }), "hidden", "reading through the marker is useless without a maintenance policy");
assert.equal(lib.visibilityOf({ ...restricted, rlsEnabled: true, hasMaintenancePolicy: true, readThroughMaintenance: true }), "global");
assert.equal(lib.visibilityOf({ ...restricted, rlsEnabled: false, hasMaintenancePolicy: false, readThroughMaintenance: false }), "global", "a table without RLS shows every row");
assert.equal(lib.visibilityOf({ isSuperuser: true, bypassRls: false, rlsEnabled: true, hasMaintenancePolicy: false, readThroughMaintenance: false }), "global");
assert.equal(lib.visibilityOf({ isSuperuser: false, bypassRls: true, rlsEnabled: true, hasMaintenancePolicy: false, readThroughMaintenance: false }), "global");

assert.equal(lib.classifyCount(0, "hidden").status, UNVERIFIED, "a hidden zero must be UNVERIFIED");
assert.equal(lib.classifyCount(7, "hidden").status, UNVERIFIED);
assert.equal(lib.classifyCount(0, "global").status, PROVEN);
assert.equal(lib.classifyCount(3, "global").status, PROVEN);
assert.equal(lib.classifyCount(0, "hidden").detail.visibleCount, 0);

// ---- the platform control row ---------------------------------------------------------------------------------------
assert.deepEqual(lib.evaluateControlRow({ enabled: false, killSwitch: true }), { enabled: PROVEN, killSwitch: PROVEN });
assert.equal(lib.evaluateControlRow({ enabled: true, killSwitch: true }).enabled, FAILED, "permissive: enabled");
assert.equal(lib.evaluateControlRow({ enabled: false, killSwitch: false }).killSwitch, FAILED, "permissive: kill switch off");
assert.equal(lib.evaluateControlRow(null).enabled, FAILED, "missing or unreadable row fails");
assert.equal(lib.evaluateControlRow(undefined).killSwitch, FAILED);
assert.equal(lib.evaluateControlRow({ enabled: "no", killSwitch: 1 }).enabled, FAILED, "malformed row fails");

// ---- grants ---------------------------------------------------------------------------------------------------------
const allGranted = Object.fromEntries(lib.REQUIRED_GRANTS.map(({ table }) => [table, { sel: true, ins: true, upd: true, del: true }]));
assert.ok(lib.evaluateGrants(allGranted).every((g) => g.ok));
const noInsert = { ...allGranted, ai_provider_budget_reservations: { sel: true, ins: false, upd: true, del: true } };
const missing = lib.evaluateGrants(noInsert).find((g) => g.table === "ai_provider_budget_reservations");
assert.equal(missing.ok, false);
assert.deepEqual(missing.missing, ["INSERT"]);
const noTable = { ...allGranted };
delete noTable.ai_platform_controls;
assert.equal(lib.evaluateGrants(noTable).find((g) => g.table === "ai_platform_controls").ok, false, "a table the role cannot even see fails");

// ---- the verdict ----------------------------------------------------------------------------------------------------
const f = (name, status, required = false) => ({ name, status, required });
assert.equal(lib.verdictOf([f("a", PROVEN, true), f("b", PROVEN)]).verdict, "DORMANT_PROVEN");
assert.equal(lib.verdictOf([f("a", PROVEN, true), f("b", UNVERIFIED)]).verdict, "DORMANT_PROVEN_WITH_UNVERIFIED", "unverified secondary facts do not fail the proof");
assert.equal(lib.verdictOf([f("a", FAILED, true), f("b", PROVEN)]).verdict, "FAILED", "a failed required deny control fails the proof");
assert.deepEqual(lib.verdictOf([f("kill", FAILED, true)]).requiredFailed, ["kill"]);
assert.equal(lib.verdictOf([f("a", PROVEN, true), f("b", FAILED, false)]).verdict, "DORMANT_PROVEN_WITH_FINDINGS", "a non-required failure is reported but does not claim the controls failed");
assert.equal(lib.verdictOf([f("a", UNVERIFIED, true)]).verdict, "INCONCLUSIVE", "a required fact that cannot be established is never a pass");
assert.equal(lib.verdictOf([]).verdict, "INCONCLUSIVE", "no findings must never read as a pass");
assert.equal(lib.verdictOf([f("a", PROVEN, false)]).verdict, "INCONCLUSIVE", "without a required finding nothing was proven");

// the script itself must record the required deny controls and never print a connection string
const fs = require("node:fs");
const script = fs.readFileSync(require("node:path").join(__dirname, "ai-control-plane-proof.cjs"), "utf8");
for (const required of ["platform enabled = false", "kill switch = true", "platform control row is readable by the app role", "effective admission is DENY"]) {
  assert.ok(script.includes(required), `the script must record a required finding: ${required}`);
}
assert.ok(!/console\.(log|error)\([^)]*\burl\b/.test(script), "the script must never print the URL");
assert.ok(!/BYPASSRLS\s+ROLE|CREATE ROLE|ALTER ROLE|GRANT /i.test(script), "the script must not create roles or grants: no admin bypass");

console.log("validate-ai-control-plane-proof tests passed.");
