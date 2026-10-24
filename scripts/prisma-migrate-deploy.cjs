#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Applies the Prisma migrations at deploy time.
 *
 * Default (nothing new configured): exactly what it has always done. The target is DATABASE_URL_DIRECT, then DATABASE_URL, and
 * `prisma migrate deploy` runs with it.
 *
 * SEC-DB-RLS-001 7.9a, opt-in: when MIGRATION_DATABASE_URL is set, the migrations run as THAT identity (the owner and migrator,
 * `vexa_migrator`) and not as the runtime credential, and the explicit table grants are applied immediately afterwards by the same
 * identity (`scripts/db-identity/tool.cjs apply-grants`). The order is a rule, not a convenience: a table added by a migration is
 * unreachable by the runtime role and unreadable by the backup role until the grants are applied, so a deploy that migrated but
 * did not grant would leave new tables failing closed for the application and loudly for backups. If either step fails the deploy
 * fails. Nothing changes until a person creates that credential and sets the variable.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const net = require("node:net");

const SCHEMA_PATH = "packages/db/prisma/schema.prisma";
const GRANTS_TOOL = path.join(__dirname, "db-identity", "tool.cjs");

function clean(value) {
  return String(value ?? "").trim();
}

/** Which credential the migrations run as. MIGRATION_DATABASE_URL wins; otherwise the historical order is kept exactly. */
function resolveDatabaseUrl(env = process.env) {
  const migration = clean(env.MIGRATION_DATABASE_URL);
  if (migration) {
    return { url: migration, source: "MIGRATION_DATABASE_URL", applyGrants: true };
  }
  const direct = clean(env.DATABASE_URL_DIRECT);
  if (direct) {
    return { url: direct, source: "DATABASE_URL_DIRECT", applyGrants: false };
  }
  const pooled = clean(env.DATABASE_URL);
  if (pooled) {
    return { url: pooled, source: "DATABASE_URL", applyGrants: false };
  }
  throw new Error("Neither DATABASE_URL_DIRECT nor DATABASE_URL is set.");
}

function parseHostPort(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const host = parsed.hostname;
  const port = Number(parsed.port || "5432");
  if (!host || !Number.isFinite(port) || port <= 0) {
    throw new Error("Invalid database URL host/port.");
  }
  return { host, port };
}

function checkTcp(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (ok, reason) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ ok, reason });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true, "connected"));
    socket.once("timeout", () => finish(false, `timeout after ${timeoutMs}ms`));
    socket.once("error", (err) => finish(false, err.message || "connection error"));
    socket.connect(port, host);
  });
}

/** The child process for `prisma migrate deploy`: the same command and environment as before, per platform. */
function migrateCommand(url, platform = process.platform, env = process.env) {
  const childEnv = { ...env, DATABASE_URL: url, DATABASE_URL_DIRECT: url };
  return platform === "win32"
    ? { command: "cmd.exe", args: ["/d", "/s", "/c", `npx prisma migrate deploy --schema ${SCHEMA_PATH}`], options: { stdio: "inherit", env: childEnv } }
    : { command: "npx", args: ["prisma", "migrate", "deploy", "--schema", SCHEMA_PATH], options: { stdio: "inherit", env: childEnv } };
}

/**
 * The grants step, only in the opt-in mode. The URL goes to the tool through its environment, never on the command line, and the tool
 * refuses any remote write unless it is told to by this runner AND it is connected as the migrator.
 */
function grantsCommand(url, env = process.env, toolPath = GRANTS_TOOL) {
  return {
    command: process.execPath,
    args: [toolPath, "apply-grants"],
    options: { stdio: "inherit", env: { ...env, DB_IDENTITY_ADMIN_URL: url, DB_IDENTITY_ALLOW_REMOTE_APPLY_GRANTS: "1" } },
  };
}

/**
 * Railway shares a service's variables between its pre-deploy command and the running application. So a migration credential stored as a
 * variable of the API service would be inside the API process: the owner of every table, with BYPASSRLS, reachable by the code the whole
 * model exists to confine. Inside a Railway service the runner refuses the opt-in unless it is told that this service is a dedicated
 * migration service (nothing else runs in it). Returns the reason to refuse, or null.
 */
function railwayServiceRefusal(target, env = process.env) {
  if (!target.applyGrants) {
    return null;
  }
  if (!clean(env.RAILWAY_SERVICE_ID) || clean(env.MIGRATION_ALLOW_ON_RAILWAY_SERVICE) === "1") {
    return null;
  }
  return (
    "MIGRATION_DATABASE_URL is set inside a Railway service. Railway shares a service's variables between this pre-deploy command and the " +
    "running application, so the migration credential would be visible to the application process. Store it only as the GitHub secret " +
    "(STAGING_MIGRATION_DATABASE_URL) that the deploy workflow reads, or run the runner in a dedicated migration service and set " +
    "MIGRATION_ALLOW_ON_RAILWAY_SERVICE=1 there."
  );
}

async function main() {
  const target = resolveDatabaseUrl();
  const { url, source } = target;
  const refusal = railwayServiceRefusal(target);
  if (refusal) {
    console.error(`[prisma:migrate:deploy] ${refusal}`);
    process.exit(1);
  }
  const { host, port } = parseHostPort(url);

  console.log(`[prisma:migrate:deploy] using ${source} (${host}:${port})`);
  const connectivity = await checkTcp(host, port);
  if (!connectivity.ok) {
    console.error(
      `[prisma:migrate:deploy] database unreachable at ${host}:${port}: ${connectivity.reason}`,
    );
    console.error(
      "[prisma:migrate:deploy] start Postgres first (e.g. `npm run infra:up`) or fix DB env vars.",
    );
    process.exit(1);
  }

  const migrate = migrateCommand(url);
  const result = spawnSync(migrate.command, migrate.args, migrate.options);

  if (result.error) {
    console.error("[prisma:migrate:deploy] child process failed:", result.error.message);
    process.exit(1);
  }

  if (typeof result.status !== "number") {
    process.exit(1);
  }
  if (result.status !== 0 || !target.applyGrants) {
    process.exit(result.status);
  }

  // Opt-in: migrations succeeded as the migrator, so apply the explicit grants as the same identity before the app starts.
  console.log("[prisma:migrate:deploy] migrations applied as the migration identity; applying the explicit table grants");
  const grants = grantsCommand(url);
  if (!fs.existsSync(grants.args[0])) {
    console.error("[prisma:migrate:deploy] the grants tool is not part of this deployed layout, so the opt-in cannot be honoured: the deploy fails instead of skipping the grants");
    process.exit(1);
  }
  const grantsResult = spawnSync(grants.command, grants.args, grants.options);
  if (grantsResult.error) {
    console.error("[prisma:migrate:deploy] the grants step could not run:", grantsResult.error.message);
    process.exit(1);
  }
  if (grantsResult.status !== 0) {
    console.error("[prisma:migrate:deploy] the grants step failed: the deploy fails rather than leave new tables ungranted");
  }
  process.exit(typeof grantsResult.status === "number" ? grantsResult.status : 1);
}

module.exports = { resolveDatabaseUrl, parseHostPort, migrateCommand, grantsCommand, railwayServiceRefusal, SCHEMA_PATH, GRANTS_TOOL };

if (require.main === module) {
  main().catch((error) => {
    console.error("[prisma:migrate:deploy] failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
