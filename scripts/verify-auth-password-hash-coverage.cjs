#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

const REPO_ROOT = path.resolve(__dirname, "..");

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
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
    if (key && !(key in process.env)) {
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

function parseArg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) {
    return null;
  }
  return String(process.argv[idx + 1] ?? "").trim() || null;
}

function resolveDatabaseUrl() {
  const databaseUrl = String(
    process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL ?? "",
  ).trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL_DIRECT or DATABASE_URL_POOLED or DATABASE_URL is required.");
  }
  return databaseUrl;
}

async function run() {
  prepareEnv();
  const tenantKey = parseArg("tenant");
  const where = tenantKey ? { tenantKey } : {};
  const prisma = new PrismaClient({ datasources: { db: { url: resolveDatabaseUrl() } } });

  try {
    const [totalIdentities, missingPasswordHash, activeMissingPasswordHash] = await Promise.all([
      prisma.authIdentity.count({ where }),
      prisma.authIdentity.count({ where: { ...where, passwordHash: null } }),
      prisma.authIdentity.count({ where: { ...where, passwordHash: null, isActive: true } }),
    ]);

    const result = {
      status: missingPasswordHash === 0 ? "ok" : "blocked",
      tenantScope: tenantKey ? "single-tenant" : "all-tenants",
      totalIdentities,
      missingPasswordHash,
      activeMissingPasswordHash,
      checkedAt: new Date().toISOString(),
    };

    console.log(JSON.stringify(result, null, 2));

    if (missingPasswordHash > 0) {
      throw new Error(
        `AUTH_PASSWORD_HASH_COVERAGE_INCOMPLETE: ${missingPasswordHash} AuthIdentity row(s) have no passwordHash.`,
      );
    }
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
