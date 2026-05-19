#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

const REPO_ROOT = path.resolve(__dirname, "..");

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || /^\s*#/.test(line)) {
      continue;
    }
    const idx = line.indexOf("=");
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const raw = line.slice(idx + 1).trim();
    const value = raw.replace(/^"|"$/g, "");
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function prepareEnv() {
  readEnvFile(path.join(REPO_ROOT, ".env"));
  const directDatabaseUrl = String(process.env.DATABASE_URL_DIRECT ?? "").trim();
  const pooledDatabaseUrl = String(process.env.DATABASE_URL_POOLED ?? "").trim();
  const fallbackDatabaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (directDatabaseUrl) {
    process.env.DATABASE_URL_POOLED = pooledDatabaseUrl || directDatabaseUrl;
    process.env.DATABASE_URL = fallbackDatabaseUrl || directDatabaseUrl;
    return;
  }
  if (fallbackDatabaseUrl) {
    process.env.DATABASE_URL_POOLED = pooledDatabaseUrl || fallbackDatabaseUrl;
  }
}

function resolveSharedPassword() {
  const configured = String(process.env.PIM_AUTH_PASSWORD ?? "").trim();
  if (configured) {
    return configured;
  }
  const appEnv = String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "development").trim().toLowerCase();
  if (appEnv === "development" || appEnv === "local" || appEnv === "test") {
    return "vexa-pim-demo-password";
  }
  throw new Error("PIM_AUTH_PASSWORD is required to migrate legacy auth hashes.");
}

function parseTenantArg() {
  const idx = process.argv.indexOf("--tenant");
  if (idx === -1) {
    return null;
  }
  return String(process.argv[idx + 1] ?? "").trim() || null;
}

function resolveRuntimeEnvironment() {
  return String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "development").trim().toLowerCase();
}

function assertTenantScope(runtimeEnv, tenantKey) {
  if (tenantKey) {
    return;
  }
  if (runtimeEnv === "development" || runtimeEnv === "local" || runtimeEnv === "test") {
    return;
  }
  throw new Error(
    "Refusing to backfill legacy auth hashes without --tenant outside local/test environments. Run the script with --tenant <tenantKey> so staging/production maintenance stays tenant-scoped.",
  );
}

async function run() {
  prepareEnv();
  const databaseUrl = String(
    process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL ?? "",
  ).trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL_DIRECT or DATABASE_URL_POOLED or DATABASE_URL is required.");
  }
  const runtimeEnv = resolveRuntimeEnvironment();
  const tenantKey = parseTenantArg();
  assertTenantScope(runtimeEnv, tenantKey);
  const sharedPassword = resolveSharedPassword();
  const passwordHash = await bcrypt.hash(sharedPassword, 12);
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  try {
    const where = {
      passwordHash: null,
      ...(tenantKey ? { tenantKey } : {}),
    };
    const beforeCount = await prisma.authIdentity.count({ where });
    const updated = await prisma.authIdentity.updateMany({
      where,
      data: {
        passwordHash,
      },
    });
    const afterCount = await prisma.authIdentity.count({ where });

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantKey: tenantKey ?? "all-local",
          environment: runtimeEnv,
          beforeCount,
          updatedCount: updated.count,
          remainingCount: afterCount,
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
