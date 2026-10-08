#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Seed system-level TaxRegime rows.
 * Safe to run multiple times — uses upsert (update: {} = no-op if row exists).
 *
 * Usage:
 *   node scripts/seed-tax-regimes.cjs
 *   DATABASE_URL=<url> node scripts/seed-tax-regimes.cjs
 *
 * Requires DATABASE_URL or DATABASE_URL_DIRECT in env (loads .env via dotenv if present).
 *
 * SEC-DB-RLS-001 8.1b. tax_regimes is a system registry that the restricted runtime role (vexa_runtime) may only READ. This script
 * is the one deploy-time writer, so once the runtime credential is restricted it has to write as the migrator, the same identity
 * that applies the migrations. MIGRATION_DATABASE_URL is the opt-in (a blank value is not): when set the script connects with it and
 * first verifies the connection really is vexa_migrator (not a superuser, bypasses RLS). When it is not set the script behaves
 * exactly as before (DATABASE_URL_DIRECT, then DATABASE_URL).
 */

const path = require("node:path");

// Try to load .env from repo root (best-effort; not an error if missing)
try {
  require("dotenv").config({ path: path.resolve(__dirname, "../.env"), override: false });
} catch {
  // dotenv not installed or .env not present — rely on env vars already set
}

const { assertOperatorIdentity } = require("./operator-db-identity.cjs");

/** Which connection the seed uses. A blank MIGRATION_DATABASE_URL (an unset secret mapped into a workflow) is not the opt-in. */
function resolveSeedConnection(env) {
  const migration = String(env.MIGRATION_DATABASE_URL ?? "").trim();
  if (migration) {
    return { url: migration, optIn: true, source: "MIGRATION_DATABASE_URL" };
  }
  const direct = String(env.DATABASE_URL_DIRECT ?? "").trim();
  if (direct) {
    return { url: direct, optIn: false, source: "DATABASE_URL_DIRECT" };
  }
  return { url: String(env.DATABASE_URL ?? "").trim(), optIn: false, source: "DATABASE_URL" };
}

async function main() {
  const { PrismaClient } = require("@prisma/client");

  const connection = resolveSeedConnection(process.env);
  const databaseUrl = connection.url;

  if (!databaseUrl) {
    console.error("[seed-tax-regimes] ERROR: DATABASE_URL or DATABASE_URL_DIRECT must be set.");
    process.exit(1);
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  if (connection.optIn) {
    // The migrator owns the schema and bypasses RLS; anything else in MIGRATION_DATABASE_URL is a misconfiguration, so stop before writing.
    await assertOperatorIdentity(prisma, "vexa_migrator", { requireBypassRls: true });
    console.log("[seed-tax-regimes] connected as vexa_migrator (verified)");
  }

  const regimes = [
    {
      marketCode: "IN",
      name: "India GST",
      description: "Goods and Services Tax — HSN code required (4/6/8 digits)",
    },
    {
      marketCode: "GB",
      name: "UK VAT",
      description: "Value Added Tax — UK Trade Tariff commodity code (10 digits)",
    },
    {
      marketCode: "US",
      name: "US Sales Tax",
      description: "Sales tax — Avalara/AvaTax tax category string",
    },
    {
      marketCode: "AE",
      name: "UAE VAT",
      description: "Value Added Tax — HS code required (6 digits)",
    },
    {
      marketCode: "AU",
      name: "Australia GST",
      description: "Goods and Services Tax — commodity code",
    },
  ];

  console.log(`[seed-tax-regimes] Upserting ${regimes.length} TaxRegime rows…`);

  let created = 0;
  let skipped = 0;

  for (const regime of regimes) {
    const result = await prisma.taxRegime.upsert({
      where: { marketCode: regime.marketCode },
      update: { name: regime.name, description: regime.description },
      create: regime,
    });

    // Prisma upsert doesn't tell us which path it took; check createdAt ≈ updatedAt to infer
    const isNew = result.createdAt.getTime() === result.updatedAt.getTime() ||
                  (Date.now() - result.createdAt.getTime()) < 3000;
    if (isNew) {
      console.log(`  ✓ Created  ${regime.marketCode}  ${regime.name}`);
      created++;
    } else {
      console.log(`  · Updated  ${regime.marketCode}  ${regime.name}`);
      skipped++;
    }
  }

  console.log(`\n[seed-tax-regimes] Done — ${created} created / ${skipped} updated.`);
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[seed-tax-regimes] FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

module.exports = { resolveSeedConnection };
