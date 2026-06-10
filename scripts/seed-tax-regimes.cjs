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
 */

const path = require("node:path");

// Try to load .env from repo root (best-effort; not an error if missing)
try {
  require("dotenv").config({ path: path.resolve(__dirname, "../.env"), override: false });
} catch {
  // dotenv not installed or .env not present — rely on env vars already set
}

async function main() {
  const { PrismaClient } = require("@prisma/client");

  const databaseUrl =
    process.env.DATABASE_URL_DIRECT ??
    process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error("[seed-tax-regimes] ERROR: DATABASE_URL or DATABASE_URL_DIRECT must be set.");
    process.exit(1);
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

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

main().catch((err) => {
  console.error("[seed-tax-regimes] FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
