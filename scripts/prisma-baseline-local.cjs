#!/usr/bin/env node
/* eslint-disable no-console */
const { readdirSync, statSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const MIGRATIONS_DIR = path.join(__dirname, "..", "packages", "db", "prisma", "migrations");
const SCHEMA_PATH = path.join("packages", "db", "prisma", "schema.prisma");
const PRISMA_BIN = path.join(__dirname, "..", "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");

function resolveDatabaseUrl() {
  const direct = String(process.env.DATABASE_URL_DIRECT ?? "").trim();
  if (direct) {
    return { url: direct, source: "DATABASE_URL_DIRECT" };
  }
  const pooled = String(process.env.DATABASE_URL ?? "").trim();
  if (pooled) {
    return { url: pooled, source: "DATABASE_URL" };
  }
  throw new Error("Neither DATABASE_URL_DIRECT nor DATABASE_URL is set.");
}

function assertLocalDatabase(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const host = String(parsed.hostname ?? "").trim().toLowerCase();
  if (!host) {
    throw new Error("Database URL host is missing.");
  }
  const isLocalhost =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]";
  if (!isLocalhost) {
    throw new Error(
      `Refusing to baseline non-local database host "${host}". This tool is for local development only.`,
    );
  }
  return host;
}

function listMigrationDirectories() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((entry) => {
      const fullPath = path.join(MIGRATIONS_DIR, entry);
      return statSync(fullPath).isDirectory();
    })
    .sort();
}

function runResolve(migrationName, databaseUrl) {
  const result = spawnSync(
    PRISMA_BIN,
    ["migrate", "resolve", "--applied", migrationName, "--schema", SCHEMA_PATH],
    {
      cwd: path.join(__dirname, ".."),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
      encoding: "utf8",
    },
  );

  const combinedOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();

  if (result.status === 0) {
    return { status: "applied", output: combinedOutput };
  }
  if (combinedOutput.includes("P3008")) {
    return { status: "already_applied", output: combinedOutput };
  }
  return { status: "failed", output: combinedOutput, code: result.status ?? 1 };
}

function main() {
  const { url, source } = resolveDatabaseUrl();
  const host = assertLocalDatabase(url);
  const migrations = listMigrationDirectories();

  console.log(
    `[prisma:baseline:local] baselining ${migrations.length} migrations using ${source} (${host})`,
  );

  let applied = 0;
  let skipped = 0;

  for (const migrationName of migrations) {
    const result = runResolve(migrationName, url);
    if (result.status === "applied") {
      applied += 1;
      console.log(`[applied] ${migrationName}`);
      continue;
    }
    if (result.status === "already_applied") {
      skipped += 1;
      console.log(`[skip] ${migrationName}`);
      continue;
    }
    console.error(`[failed] ${migrationName}`);
    if (result.output) {
      console.error(result.output);
    }
    process.exit(result.code || 1);
  }

  console.log(
    `[prisma:baseline:local] complete — applied ${applied}, skipped ${skipped}, total ${migrations.length}`,
  );
}

try {
  main();
} catch (error) {
  console.error(
    "[prisma:baseline:local] failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
}
