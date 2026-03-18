#!/usr/bin/env node
/* eslint-disable no-console */
const { PrismaClient, Prisma } = require("@prisma/client");

const BOOTSTRAP_TABLES_WITH_MANUAL_TENANT_FILTER = new Set([
  "AuthIdentity",
  "WorkspaceDirectory",
  "api_access_keys",
]);

function parseTablesArg(argv) {
  const flag = argv.find((entry) => entry.startsWith("--tables="));
  if (flag) {
    const value = flag.slice("--tables=".length).trim();
    if (!value) {
      return [];
    }
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  const positionalIndex = argv.findIndex((entry) => entry === "--tables");
  if (positionalIndex === -1) {
    return null;
  }
  const positionalValue = String(argv[positionalIndex + 1] ?? "").trim();
  if (!positionalValue) {
    return [];
  }
  return positionalValue
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function getDatabaseUrl() {
  const direct = String(process.env.DATABASE_URL_DIRECT ?? "").trim();
  if (direct) {
    return direct;
  }
  const pooled = String(process.env.DATABASE_URL_POOLED ?? "").trim();
  if (pooled) {
    return pooled;
  }
  const fallback = String(process.env.DATABASE_URL ?? "").trim();
  if (fallback) {
    return fallback;
  }
  throw new Error("DATABASE_URL_DIRECT or DATABASE_URL_POOLED or DATABASE_URL is required.");
}

async function discoverTenantTables(client) {
  const rows = await client.$queryRaw(Prisma.sql`
    SELECT DISTINCT c.table_name AS "tableName"
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND LOWER(c.column_name) IN ('tenantid', 'tenant_id', 'tenantkey', 'tenant_key')
    ORDER BY c.table_name
  `);
  return rows.map((row) => row.tableName);
}

async function loadPolicyTables(client) {
  const rows = await client.$queryRaw(Prisma.sql`
    SELECT DISTINCT tablename AS "tableName"
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);
  return new Set(rows.map((row) => String(row.tableName).toLowerCase()));
}

async function main() {
  const targetFilter = parseTablesArg(process.argv.slice(2));
  const client = new PrismaClient({
    datasources: { db: { url: getDatabaseUrl() } },
  });

  try {
    const discovered = await discoverTenantTables(client);
    const rlsEligibleTables = discovered.filter(
      (table) => !BOOTSTRAP_TABLES_WITH_MANUAL_TENANT_FILTER.has(String(table)),
    );
    const targetTables =
      targetFilter === null
        ? rlsEligibleTables
        : rlsEligibleTables.filter((table) => targetFilter.includes(table));
    const policyTables = await loadPolicyTables(client);
    const missing = targetTables.filter((table) => !policyTables.has(String(table).toLowerCase()));

    console.log(
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          discoveredTables: discovered,
          excludedBootstrapTables: discovered.filter((table) =>
            BOOTSTRAP_TABLES_WITH_MANUAL_TENANT_FILTER.has(String(table)),
          ),
          checkedTables: targetTables,
          missingPolicies: missing,
        },
        null,
        2,
      ),
    );

    if (missing.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await client.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
