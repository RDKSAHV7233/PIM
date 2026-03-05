#!/usr/bin/env node
/* eslint-disable no-console */
const { PrismaClient, Prisma } = require("@prisma/client");

function getDatabaseUrl() {
  const direct = String(process.env.DATABASE_URL_DIRECT ?? "").trim();
  if (direct) return direct;
  const pooled = String(process.env.DATABASE_URL_POOLED ?? "").trim();
  if (pooled) return pooled;
  const fallback = String(process.env.DATABASE_URL ?? "").trim();
  if (fallback) return fallback;
  throw new Error("DATABASE_URL_DIRECT or DATABASE_URL_POOLED or DATABASE_URL is required.");
}

async function main() {
  const client = new PrismaClient({
    datasources: { db: { url: getDatabaseUrl() } },
  });
  try {
    await client.$executeRaw(Prisma.sql`ALTER TABLE ondc_mappings ENABLE ROW LEVEL SECURITY;`);
    await client.$executeRaw(Prisma.sql`DROP POLICY IF EXISTS tenant_isolation_ondc_mappings ON ondc_mappings;`);
    await client.$executeRaw(Prisma.sql`
      CREATE POLICY tenant_isolation_ondc_mappings
      ON ondc_mappings
      USING (tenant_key = COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'))
      WITH CHECK (tenant_key = COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'));
    `);

    await client.$executeRaw(Prisma.sql`ALTER TABLE "PlanUsage" ENABLE ROW LEVEL SECURITY;`);
    await client.$executeRaw(Prisma.sql`DROP POLICY IF EXISTS "PlanUsage_tenant_isolation" ON "PlanUsage";`);
    await client.$executeRaw(Prisma.sql`
      CREATE POLICY "PlanUsage_tenant_isolation"
      ON "PlanUsage"
      USING ("tenantKey" = COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'))
      WITH CHECK ("tenantKey" = COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'));
    `);

    console.log("Applied RLS policy for ondc_mappings and PlanUsage.");
  } finally {
    await client.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
