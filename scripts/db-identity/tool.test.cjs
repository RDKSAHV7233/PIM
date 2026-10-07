#!/usr/bin/env node
"use strict";

/**
 * SEC-DB-RLS-001 7.9a: the host guard of tool.cjs. The rehearsal's database is always local, so it cannot show how the tool treats a
 * REMOTE host. This runs the tool against an address that is not in its local list (127.0.0.2, port 1, so nothing listens) and reads only
 * the exit code and the message: a refusal is exit 3 before any connection, and anything that gets past the guard fails on the
 * connection instead (exit 1). No database is involved and no URL, user or password is ever printed.
 */
const assert = require("node:assert/strict");
const cp = require("node:child_process");
const path = require("node:path");

const TOOL = path.join(__dirname, "tool.cjs");
const REMOTE = "postgresql://vexa_migrator:secret-remote@127.0.0.2:1/app";

function run(mode, env) {
  const r = cp.spawnSync(process.execPath, [TOOL, mode], {
    env: { ...process.env, DB_IDENTITY_ADMIN_URL: REMOTE, DB_IDENTITY_ALLOW_REMOTE_APPLY_GRANTS: "", ...env },
    encoding: "utf8",
    timeout: 60000,
  });
  return { status: r.status, text: `${r.stdout || ""}${r.stderr || ""}` };
}

// Without the runner's flag every write mode refuses a remote host, exactly as before.
for (const mode of ["create-roles", "apply-ownership", "rollback-ownership", "apply-grants"]) {
  const r = run(mode, {});
  assert.equal(r.status, 3, `${mode} on a remote host without the flag is refused`);
  assert.match(r.text, /only ever writes to a local rehearsal database/);
  assert.ok(!r.text.includes("secret-remote"), "the refusal never prints the password");
}

// The flag opens exactly one door: apply-grants. Every other write mode still refuses.
for (const mode of ["create-roles", "apply-ownership", "rollback-ownership"]) {
  const r = run(mode, { DB_IDENTITY_ALLOW_REMOTE_APPLY_GRANTS: "1" });
  assert.equal(r.status, 3, `${mode} stays refused on a remote host even with the apply-grants flag`);
}

// Only the exact value opens it.
for (const value of ["true", "yes", "0", "2", " "]) {
  assert.equal(run("apply-grants", { DB_IDENTITY_ALLOW_REMOTE_APPLY_GRANTS: value }).status, 3, `the value "${value}" does not open the door`);
}

// With the flag, apply-grants gets past the host guard (and then fails on the connection, which is exit 1, not the guard's 3).
const through = run("apply-grants", { DB_IDENTITY_ALLOW_REMOTE_APPLY_GRANTS: "1" });
assert.notEqual(through.status, 3, "the flag lets apply-grants past the host guard");
assert.notEqual(through.status, 0, "and with nothing listening it fails rather than pretending to succeed");
assert.ok(!through.text.includes("secret-remote"), "no password is printed on a connection failure either");

// Read-only modes are unaffected: they never needed the flag.
assert.notEqual(run("verify", {}).status, 3, "read-only modes are not refused by the host guard");

console.log("db-identity tool host guard tests passed.");
