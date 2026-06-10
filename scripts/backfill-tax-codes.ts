#!/usr/bin/env ts-node
/* eslint-disable no-console */
/**
 * One-time backfill: copies Product.hsnCode / Product.gstRate → ProductTaxCode
 * for the India GST tax regime.
 *
 * Safe to run multiple times — uses upsert per row.
 * Products without hsnCode are skipped.
 *
 * Usage:
 *   npx ts-node scripts/backfill-tax-codes.ts [--dry-run]
 *   DATABASE_URL=<url> npx ts-node scripts/backfill-tax-codes.ts
 */

import path from "node:path";
import { PrismaClient, TaxCodeKey } from "@prisma/client";

// Best-effort .env load
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("dotenv").config({ path: path.resolve(__dirname, "../.env"), override: false });
} catch {
  // not installed or missing — rely on process.env
}

const DRY_RUN = process.argv.includes("--dry-run");
const PAGE_SIZE = 500;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[backfill-tax-codes] ERROR: DATABASE_URL or DATABASE_URL_DIRECT must be set.");
    process.exit(1);
  }

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  if (DRY_RUN) {
    console.log("[backfill-tax-codes] DRY RUN — no writes will be made.\n");
  }

  // 1. Resolve India TaxRegime
  const indiaRegime = await prisma.taxRegime.findUnique({
    where: { marketCode: "IN" },
    select: { id: true, marketCode: true },
  });
  if (!indiaRegime) {
    console.error(
      "[backfill-tax-codes] ERROR: TaxRegime for IN not found. Run seed-tax-regimes.cjs first.",
    );
    process.exit(1);
  }
  console.log(`[backfill-tax-codes] India TaxRegime id: ${indiaRegime.id}`);

  // 2. Count scope
  const total = await prisma.product.count({ where: { hsnCode: { not: null } } });
  console.log(`[backfill-tax-codes] Products with hsnCode: ${total}\n`);

  if (total === 0) {
    console.log("[backfill-tax-codes] Nothing to backfill.");
    await prisma.$disconnect();
    return;
  }

  // 3. Cursor-paginate and upsert
  let cursor: string | undefined;
  let scanned = 0;
  let created = 0;
  let skipped = 0;

  do {
    const page = await prisma.product.findMany({
      where: { hsnCode: { not: null } },
      select: { id: true, tenantKey: true, hsnCode: true, gstRate: true },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    if (page.length === 0) break;
    cursor = page[page.length - 1]!.id;
    scanned += page.length;

    for (const product of page) {
      if (!product.hsnCode) continue;

      if (DRY_RUN) {
        console.log(
          `  [dry-run] would upsert ProductTaxCode { productId: ${product.id}, key: HSN_CODE, value: ${product.hsnCode}, rate: ${product.gstRate ?? "null"} }`,
        );
        created++;
        continue;
      }

      const result = await prisma.productTaxCode.upsert({
        where: {
          tenantKey_productId_marketCode_key: {
            tenantKey: product.tenantKey,
            productId: product.id,
            marketCode: "IN",
            key: TaxCodeKey.HSN_CODE,
          },
        },
        update: {
          value: product.hsnCode.trim(),
          rate: product.gstRate ?? null,
        },
        create: {
          tenantKey: product.tenantKey,
          productId: product.id,
          regimeId: indiaRegime.id,
          marketCode: "IN",
          key: TaxCodeKey.HSN_CODE,
          value: product.hsnCode.trim(),
          rate: product.gstRate ?? null,
        },
        select: { id: true, createdAt: true, updatedAt: true },
      });

      // Infer created vs updated by timestamp proximity
      const isNew = Math.abs(result.createdAt.getTime() - result.updatedAt.getTime()) < 100;
      if (isNew) {
        created++;
      } else {
        skipped++;
      }
    }

    const pct = Math.round((scanned / total) * 100);
    console.log(`  Progress: ${scanned}/${total} (${pct}%) — created: ${created}, updated/skipped: ${skipped}`);
  } while (scanned < total);

  console.log(
    `\n[backfill-tax-codes] Complete — scanned: ${scanned}, created: ${created}, updated/skipped: ${skipped}`,
  );
  if (DRY_RUN) {
    console.log("[backfill-tax-codes] DRY RUN complete — no rows were written.");
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(
    "[backfill-tax-codes] FAILED:",
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
