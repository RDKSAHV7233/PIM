#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

const REPO_ROOT = path.resolve(__dirname, "..");
const PRODUCT_FALLBACK_URL = "/catalog/products";
const PRODUCT_FALLBACK_LABEL = "View products";

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || /^\s*#/.test(line)) {
      continue;
    }
    const index = line.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function prepareEnv() {
  readEnvFile(path.join(REPO_ROOT, ".env"));
  if (process.env.DATABASE_URL && !process.env.DATABASE_URL_POOLED) {
    process.env.DATABASE_URL_POOLED = process.env.DATABASE_URL;
  }
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    tenantKey: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] ?? "").trim();
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--tenant-key") {
      options.tenantKey = String(argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
  }

  return options;
}

function buildWhereClause(tenantKey, startIndex = 1) {
  const clauses = [
    `n.action_url LIKE '/products/%'`,
    `n.metadata ? 'productId'`,
    `NOT EXISTS (
      SELECT 1
      FROM "Product" AS p
      WHERE p.id = n.metadata->>'productId'
        AND p."tenantKey" = n.tenant_key
        AND p."deletedAt" IS NULL
    )`,
  ];
  const params = [];

  if (tenantKey) {
    clauses.push(`n.tenant_key = $${startIndex}`);
    params.push(tenantKey);
  }

  return {
    sql: `WHERE ${clauses.join(" AND ")}`,
    params,
  };
}

async function main() {
  prepareEnv();
  const { dryRun, tenantKey } = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL or DATABASE_URL_POOLED must be set.");
  }

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });

  try {
    const countWhere = buildWhereClause(tenantKey);
    const countRows = await prisma.$queryRawUnsafe(
      `
        SELECT COUNT(*)::int AS count
        FROM user_notifications AS n
        ${countWhere.sql}
      `,
      ...countWhere.params,
    );
    const affectedCount = Number(countRows?.[0]?.count ?? 0);

    if (dryRun) {
      console.log(JSON.stringify({
        status: "ok",
        mode: "dry-run",
        tenantKey: tenantKey || null,
        affectedCount,
        fallback: {
          actionUrl: PRODUCT_FALLBACK_URL,
          actionLabel: PRODUCT_FALLBACK_LABEL,
        },
      }, null, 2));
      return;
    }

    const updateWhere = buildWhereClause(tenantKey, 3);
    const updatedRows = await prisma.$queryRawUnsafe(
      `
        UPDATE user_notifications AS n
        SET action_url = $1,
            action_label = $2
        ${updateWhere.sql}
        RETURNING n.id
      `,
      PRODUCT_FALLBACK_URL,
      PRODUCT_FALLBACK_LABEL,
      ...updateWhere.params,
    );

    console.log(JSON.stringify({
      status: "ok",
      mode: "write",
      tenantKey: tenantKey || null,
      affectedCount,
      updatedCount: Array.isArray(updatedRows) ? updatedRows.length : 0,
      fallback: {
        actionUrl: PRODUCT_FALLBACK_URL,
        actionLabel: PRODUCT_FALLBACK_LABEL,
      },
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
