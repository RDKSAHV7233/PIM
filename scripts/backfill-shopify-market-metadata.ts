#!/usr/bin/env ts-node
/* eslint-disable no-console */
/**
 * One-time backfill: sets currencyCode and marketCode on Shopify connector
 * installations whose metadata pre-dates PR-3 (Marketplace Context).
 *
 * Strategy (no Shopify API calls required):
 *   1. Find Shopify installations where metadata->>'currencyCode' IS NULL.
 *   2. For each tenant, look up its default price list's currency and market codes.
 *   3. Fall back to INR / IN for tenants with no price lists (India-first platform).
 *   4. JSONB-merge the resolved values into the installation metadata.
 *
 * Safe to run multiple times — skips installations that already have currencyCode set.
 *
 * Usage:
 *   npx ts-node scripts/backfill-shopify-market-metadata.ts [--dry-run]
 *   DATABASE_URL=<url> npx ts-node scripts/backfill-shopify-market-metadata.ts
 */

import path from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";

// Best-effort .env load
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("dotenv").config({ path: path.resolve(__dirname, "../.env"), override: false });
} catch {
  // not installed or missing — rely on process.env
}

const DRY_RUN = process.argv.includes("--dry-run");
const SHOPIFY_CONNECTOR_ID = "shopify";
const DEFAULT_CURRENCY = "INR";
const DEFAULT_MARKET = "IN";

// ── types ──────────────────────────────────────────────────────────────────

type StaleInstallationRow = {
  id: string;
  tenant_key: string;
  metadata: Record<string, unknown>;
};

type PriceListRow = {
  currency_code: string;
  market_code: string;
};

// ── helpers ────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

// ── main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "[backfill-shopify-market-metadata] ERROR: DATABASE_URL or DATABASE_URL_DIRECT must be set.",
    );
    process.exit(1);
  }

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  if (DRY_RUN) {
    console.log("[backfill-shopify-market-metadata] DRY RUN — no writes will be made.\n");
  }

  // 1. Find all Shopify installations missing currencyCode in metadata
  const staleRows = await prisma.$queryRaw<StaleInstallationRow[]>(Prisma.sql`
    SELECT id, tenant_key, metadata
    FROM connector_installations
    WHERE connector_id = ${SHOPIFY_CONNECTOR_ID}
      AND status = 'ACTIVE'
      AND (
        metadata->>'currencyCode' IS NULL
        OR metadata->>'marketCode'  IS NULL
      )
    ORDER BY tenant_key, installed_at
  `);

  if (staleRows.length === 0) {
    console.log("[backfill-shopify-market-metadata] Nothing to backfill — all installations are up to date.");
    await prisma.$disconnect();
    return;
  }

  console.log(
    `[backfill-shopify-market-metadata] Found ${staleRows.length} installation(s) to backfill.`,
  );

  // 2. For each unique tenantKey, resolve the best currency+market pair
  const tenantKeys = [...new Set(staleRows.map((r) => r.tenant_key))];
  const tenantCurrencyMap = new Map<string, { currencyCode: string; marketCode: string }>();

  for (const tenantKey of tenantKeys) {
    // Prefer the tenant's default price list; any active list is acceptable as fallback.
    const [rows] = await prisma.$queryRaw<PriceListRow[]>(Prisma.sql`
      SELECT
        c.code  AS currency_code,
        m.code  AS market_code
      FROM price_lists pl
      JOIN currencies c ON c.id = pl.currency_id
      JOIN markets    m ON m.id = pl.market_id
      WHERE pl.tenant_key = ${tenantKey}
        AND pl.status      = 'active'
      ORDER BY pl.is_default DESC, pl.created_at ASC
      LIMIT 1
    `).then((r) => [r[0] ?? null]);

    if (rows) {
      tenantCurrencyMap.set(tenantKey, {
        currencyCode: rows.currency_code,
        marketCode: rows.market_code,
      });
    } else {
      // No price lists configured — use India-first defaults
      tenantCurrencyMap.set(tenantKey, {
        currencyCode: DEFAULT_CURRENCY,
        marketCode: DEFAULT_MARKET,
      });
      console.log(
        `  [${tenantKey}] No price lists found — defaulting to ${DEFAULT_CURRENCY} / ${DEFAULT_MARKET}`,
      );
    }
  }

  // 3. Update each installation
  let updated = 0;
  let skipped = 0;

  for (const row of staleRows) {
    const resolved = tenantCurrencyMap.get(row.tenant_key)!;
    const currentMeta = asRecord(row.metadata);

    // Determine which fields actually need writing
    const currencyCode =
      typeof currentMeta.currencyCode === "string" ? currentMeta.currencyCode : resolved.currencyCode;
    const marketCode =
      typeof currentMeta.marketCode === "string" ? currentMeta.marketCode : resolved.marketCode;

    if (
      currentMeta.currencyCode === currencyCode &&
      currentMeta.marketCode === marketCode
    ) {
      skipped++;
      continue;
    }

    const shopName = typeof currentMeta.shopName === "string" ? currentMeta.shopName : null;
    console.log(
      `  [${row.tenant_key}] ${row.id.slice(-8)} (${shopName ?? "unknown shop"}): ` +
        `currencyCode=${currencyCode}, marketCode=${marketCode}`,
    );

    if (!DRY_RUN) {
      await prisma.$executeRaw(Prisma.sql`
        UPDATE connector_installations
        SET
          metadata   = COALESCE(metadata, '{}'::jsonb)
                       || jsonb_build_object(
                            'currencyCode', ${currencyCode},
                            'marketCode',   ${marketCode}
                          ),
          updated_at = NOW()
        WHERE id = ${row.id}
      `);
    }

    updated++;
  }

  console.log(
    `\n[backfill-shopify-market-metadata] Done.` +
      ` updated=${DRY_RUN ? `${updated} (dry-run, no writes)` : updated}` +
      ` skipped=${skipped}`,
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[backfill-shopify-market-metadata] FATAL:", err);
  process.exit(1);
});
