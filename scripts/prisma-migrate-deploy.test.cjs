#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001 7.9a: the migration runner.
 *
 * Pure rules first, then the real runner end to end with a fake `npx` (it records which identity it was given and exits as told), a
 * stub grants tool, and a local TCP listener so the connectivity check passes. Nothing here touches a database.
 */
const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const runner = require("./prisma-migrate-deploy.cjs");

// ---- which credential the migrations run as ----------------------------------------------------------------------------------------
const URLS = { m: "postgresql://vexa_migrator:pw@db.example.test:5432/app", d: "postgresql://runtime_user:pw@db.example.test:5432/app", p: "postgresql://pooled_user:pw@pool.example.test:6432/app" };
assert.deepEqual(runner.resolveDatabaseUrl({ DATABASE_URL_DIRECT: URLS.d, DATABASE_URL: URLS.p }), { url: URLS.d, source: "DATABASE_URL_DIRECT", applyGrants: false }, "the historical order is kept: direct first");
assert.deepEqual(runner.resolveDatabaseUrl({ DATABASE_URL: URLS.p }), { url: URLS.p, source: "DATABASE_URL", applyGrants: false }, "then the pooled URL");
assert.deepEqual(runner.resolveDatabaseUrl({ MIGRATION_DATABASE_URL: URLS.m, DATABASE_URL_DIRECT: URLS.d, DATABASE_URL: URLS.p }), { url: URLS.m, source: "MIGRATION_DATABASE_URL", applyGrants: true }, "the migration identity wins over both runtime URLs");
assert.deepEqual(runner.resolveDatabaseUrl({ MIGRATION_DATABASE_URL: "   ", DATABASE_URL_DIRECT: URLS.d }), { url: URLS.d, source: "DATABASE_URL_DIRECT", applyGrants: false }, "a blank migration variable (an unset secret) is not the opt-in");
assert.deepEqual(runner.resolveDatabaseUrl({ MIGRATION_DATABASE_URL: "", DATABASE_URL: URLS.p }), { url: URLS.p, source: "DATABASE_URL", applyGrants: false });
assert.throws(() => runner.resolveDatabaseUrl({}), /Neither DATABASE_URL_DIRECT nor DATABASE_URL is set/);
assert.throws(() => runner.resolveDatabaseUrl({ MIGRATION_DATABASE_URL: " ", DATABASE_URL_DIRECT: " " }), /Neither DATABASE_URL_DIRECT nor DATABASE_URL is set/, "blank values are never a target");
assert.deepEqual(runner.parseHostPort(URLS.p), { host: "pool.example.test", port: 6432 });
assert.deepEqual(runner.parseHostPort("postgresql://u:p@h/db"), { host: "h", port: 5432 });

// ---- the commands ---------------------------------------------------------------------------------------------------------------------
const posix = runner.migrateCommand(URLS.m, "linux", { KEEP: "1", DATABASE_URL: "old" });
assert.equal(posix.command, "npx");
assert.deepEqual(posix.args, ["prisma", "migrate", "deploy", "--schema", "packages/db/prisma/schema.prisma"], "the migrate command is unchanged");
assert.equal(posix.options.env.DATABASE_URL, URLS.m, "DATABASE_URL is the chosen identity");
assert.equal(posix.options.env.KEEP, "1", "the rest of the environment is kept");
assert.equal(posix.options.stdio, "inherit");
const win = runner.migrateCommand(URLS.m, "win32", {});
assert.equal(win.command, "cmd.exe");
assert.deepEqual(win.args, ["/d", "/s", "/c", "npx prisma migrate deploy --schema packages/db/prisma/schema.prisma"]);
const grants = runner.grantsCommand(URLS.m, { KEEP: "1" }, "/x/tool.cjs");
assert.deepEqual(grants.args, ["/x/tool.cjs", "apply-grants"]);
assert.ok(!grants.args.join(" ").includes("vexa_migrator") && !grants.args.join(" ").includes("pw"), "the credential never appears on a command line");
assert.equal(grants.options.env.DB_IDENTITY_ADMIN_URL, URLS.m);
assert.equal(grants.options.env.DB_IDENTITY_ALLOW_REMOTE_APPLY_GRANTS, "1");
assert.equal(path.basename(path.dirname(runner.GRANTS_TOOL)), "db-identity");
assert.equal(path.basename(runner.GRANTS_TOOL), "tool.cjs");

// ---- the Railway guard: a migration credential must not live where the application can see it ----------------------------------------
const optIn = { url: URLS.m, source: "MIGRATION_DATABASE_URL", applyGrants: true };
const plain = { url: URLS.d, source: "DATABASE_URL_DIRECT", applyGrants: false };
assert.equal(runner.railwayServiceRefusal(optIn, {}), null, "outside Railway (a GitHub workflow, a laptop) the opt-in is fine");
assert.match(runner.railwayServiceRefusal(optIn, { RAILWAY_SERVICE_ID: "svc" }), /visible to the application process/, "inside a Railway service the opt-in is refused");
assert.equal(runner.railwayServiceRefusal(optIn, { RAILWAY_SERVICE_ID: "svc", MIGRATION_ALLOW_ON_RAILWAY_SERVICE: "1" }), null, "a dedicated migration service can say so explicitly");
assert.match(runner.railwayServiceRefusal(optIn, { RAILWAY_SERVICE_ID: "svc", MIGRATION_ALLOW_ON_RAILWAY_SERVICE: "true" }), /visible/, "only the exact value 1 is an override");
assert.match(runner.railwayServiceRefusal(optIn, { RAILWAY_SERVICE_ID: "svc", MIGRATION_ALLOW_ON_RAILWAY_SERVICE: "" }), /visible/);
assert.equal(runner.railwayServiceRefusal(plain, { RAILWAY_SERVICE_ID: "svc" }), null, "the default mode on Railway is exactly what it always was");
assert.equal(runner.railwayServiceRefusal(optIn, { RAILWAY_SERVICE_ID: "  " }), null, "a blank Railway marker is not Railway");

// ---- the real runner, end to end ---------------------------------------------------------------------------------------------------
function userOf(url) {
  return new URL(url).username;
}

async function scenario(name, { env, migrateExit = 0, grantsExit = 0, withTool = true }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-runner-"));
  const log = path.join(work, "log.jsonl");
  fs.mkdirSync(path.join(work, "scripts", "db-identity"), { recursive: true });
  fs.copyFileSync(path.join(__dirname, "prisma-migrate-deploy.cjs"), path.join(work, "scripts", "prisma-migrate-deploy.cjs"));
  if (withTool) {
    fs.writeFileSync(
      path.join(work, "scripts", "db-identity", "tool.cjs"),
      `const fs=require("fs");fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({event:"grants",argv:process.argv.slice(2),user:new URL(process.env.DB_IDENTITY_ADMIN_URL).username,allow:process.env.DB_IDENTITY_ALLOW_REMOTE_APPLY_GRANTS||null})+"\\n");process.exit(Number(process.env.FAKE_GRANTS_EXIT||0));`,
    );
  }
  const bin = path.join(work, "bin");
  fs.mkdirSync(bin);
  const impl = path.join(bin, "npx-impl.cjs");
  fs.writeFileSync(impl, `const fs=require("fs");fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({event:"migrate",user:new URL(process.env.DATABASE_URL).username})+"\\n");process.exit(Number(process.env.FAKE_MIGRATE_EXIT||0));`);
  fs.writeFileSync(path.join(bin, "npx"), `#!/bin/sh\nexec "${process.execPath}" "${impl}" "$@"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "npx.cmd"), `@echo off\r\n"${process.execPath}" "${impl}" %*\r\n`);

  const server = net.createServer((socket) => socket.destroy());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const local = (user) => `postgresql://${user}:secret-${user}@127.0.0.1:${port}/app`;
  const fullEnv = { PATH: `${bin}${path.delimiter}${process.env.PATH}`, SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec, FAKE_MIGRATE_EXIT: String(migrateExit), FAKE_GRANTS_EXIT: String(grantsExit) };
  for (const [k, v] of Object.entries(env)) {
    fullEnv[k] = v.replace(/<(\w+)>/, (_, user) => local(user));
  }
  const child = cp.spawn(process.execPath, [path.join(work, "scripts", "prisma-migrate-deploy.cjs")], { env: fullEnv, cwd: work });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const status = await new Promise((resolve) => child.on("close", resolve));
  server.close();
  const events = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  assert.ok(!out.includes("secret-"), `${name}: the runner never prints a password`);
  fs.rmSync(work, { recursive: true, force: true });
  return { status, events, out };
}

(async () => {
  // Default: today's behaviour, and the grants tool is never involved.
  let r = await scenario("default", { env: { DATABASE_URL_DIRECT: "<runtime_user>" } });
  assert.equal(r.status, 0);
  assert.deepEqual(r.events.map((e) => e.event), ["migrate"], "without MIGRATION_DATABASE_URL only the migration runs");
  assert.equal(r.events[0].user, "runtime_user", "as the credential it always used");
  assert.match(r.out, /using DATABASE_URL_DIRECT/);

  r = await scenario("default pooled", { env: { DATABASE_URL: "<pooled_user>" } });
  assert.deepEqual(r.events.map((e) => `${e.event}:${e.user}`), ["migrate:pooled_user"]);

  // A blank migration variable (an unset secret mapped into the workflow) changes nothing.
  r = await scenario("blank opt-in", { env: { MIGRATION_DATABASE_URL: "", DATABASE_URL_DIRECT: "<runtime_user>" } });
  assert.deepEqual(r.events.map((e) => `${e.event}:${e.user}`), ["migrate:runtime_user"]);

  // Default and a failing migration: the same exit code, as before.
  r = await scenario("default failure", { env: { DATABASE_URL_DIRECT: "<runtime_user>" }, migrateExit: 7 });
  assert.equal(r.status, 7, "a failing migration still fails with its own exit code");

  // Opt-in: the migration identity migrates, then the same identity grants, in that order.
  r = await scenario("opt-in", { env: { MIGRATION_DATABASE_URL: "<vexa_migrator>", DATABASE_URL_DIRECT: "<runtime_user>", DATABASE_URL: "<pooled_user>" } });
  assert.equal(r.status, 0);
  assert.deepEqual(r.events.map((e) => `${e.event}:${e.user}`), ["migrate:vexa_migrator", "grants:vexa_migrator"], "migrate as the migrator, THEN grant as the migrator, never as the runtime credential");
  assert.deepEqual(r.events[1].argv, ["apply-grants"]);
  assert.equal(r.events[1].allow, "1");
  assert.match(r.out, /using MIGRATION_DATABASE_URL/);

  // Opt-in and the migration fails: no grants, and the deploy fails with the migration's code.
  r = await scenario("opt-in migrate failure", { env: { MIGRATION_DATABASE_URL: "<vexa_migrator>" }, migrateExit: 3 });
  assert.equal(r.status, 3);
  assert.deepEqual(r.events.map((e) => e.event), ["migrate"], "grants never run after a failed migration");

  // Inside a Railway service the opt-in is refused before anything runs: the credential would be visible to the application.
  r = await scenario("opt-in inside a Railway service", { env: { MIGRATION_DATABASE_URL: "<vexa_migrator>", RAILWAY_SERVICE_ID: "svc-api" } });
  assert.equal(r.status, 1);
  assert.deepEqual(r.events, [], "neither the migration nor the grants ran");
  assert.match(r.out, /visible to the application process/);
  r = await scenario("opt-in in a dedicated migration service", { env: { MIGRATION_DATABASE_URL: "<vexa_migrator>", RAILWAY_SERVICE_ID: "svc-migrator", MIGRATION_ALLOW_ON_RAILWAY_SERVICE: "1" } });
  assert.deepEqual(r.events.map((e) => `${e.event}:${e.user}`), ["migrate:vexa_migrator", "grants:vexa_migrator"], "an explicit override for a dedicated service works");
  r = await scenario("default mode inside a Railway service", { env: { DATABASE_URL_DIRECT: "<runtime_user>", RAILWAY_SERVICE_ID: "svc-api" } });
  assert.equal(r.status, 0);
  assert.deepEqual(r.events.map((e) => `${e.event}:${e.user}`), ["migrate:runtime_user"], "the default mode on Railway is unchanged");

  // Opt-in and the grants fail: the deploy fails rather than leave new tables ungranted.
  r = await scenario("opt-in grants failure", { env: { MIGRATION_DATABASE_URL: "<vexa_migrator>" }, grantsExit: 5 });
  assert.equal(r.status, 5, "a failing grants step fails the deploy with its own exit code");
  assert.deepEqual(r.events.map((e) => e.event), ["migrate", "grants"]);
  assert.match(r.out, /the deploy fails rather than leave new tables ungranted/);

  // Opt-in and the grants tool is missing from the deployed layout: fail closed, never skip.
  r = await scenario("opt-in tool missing", { env: { MIGRATION_DATABASE_URL: "<vexa_migrator>" }, withTool: false });
  assert.notEqual(r.status, 0, "a layout without the grants tool fails the opt-in deploy instead of silently skipping the grants");
  assert.deepEqual(r.events.map((e) => e.event), ["migrate"]);
  assert.match(r.out, /grants tool is not part of this deployed layout/, "and it says why");

  console.log("prisma-migrate-deploy tests passed.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
