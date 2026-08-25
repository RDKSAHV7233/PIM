#!/usr/bin/env node
/* eslint-disable no-console */
//
// PIM#663 read-only production confirmation script.
//
// Background: PIM#663 found that a sellable (approved/active) product with zero
// Variant rows contributes nothing to the "sellable SKU" billing meter
// (SELLABLE_VARIANT_WHERE in plan-usage.service.ts counts Variant rows only — a
// deliberate, ratified definition, see PIM#579/#593, never to be changed) and is
// invisible to connector publish (buildConnectorProductPayload derives sku/mrp/
// sellingPrice from the "primary" variant). The engineering fix (PR #670) makes
// this structurally impossible GOING FORWARD by auto-creating a canonical variant
// the moment a product first becomes sellable.
//
// What that fix does NOT do: retroactively touch any product that was ALREADY
// approved/active with zero variants before it shipped. Deciding whether (and how)
// to backfill those existing rows is a separate, deliberately deferred decision —
// it would mean synthesizing placeholder SKU/price data for already-live products
// on the shared tenant, which this script does not presume the answer to.
//
// This script answers the one question that decision actually needs: how many
// such rows exist, right now, in production? It is intentionally narrow — one
// counts-only script, read-only, no remediation — mirroring the same shape this
// repo already used for the #496/#483 media-integrity production confirmation
// (see scripts/media-integrity-readonly-report.cjs and its dedicated
// workflow_dispatch-only GitHub Actions workflow).
//
// SAFETY: this script performs ONLY read queries (Product.count, Product.findMany
// with a `select`). It contains no `.create(`, `.update(`, `.upsert(`, `.delete(`,
// or `$executeRaw*` call anywhere. It is safe to run against production.

const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_OUTPUT = ".run-logs/sellable-sku-variantless-audit-report.json";
const SAMPLE_SIZE = 25;

// Mirrors SELLABLE_VARIANT_STATUSES in apps/api/src/billing/plan-usage.service.ts —
// duplicated here (not imported) because this script runs standalone, outside the
// NestJS app, against @prisma/client directly.
const SELLABLE_STATUSES = ["approved", "active"];

function loadPrismaClient() {
  return require("@prisma/client").PrismaClient;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function parseArgs(argv) {
  const args = { output: DEFAULT_OUTPUT };
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--output") {
      args.output = argv[index + 1] || "";
      index += 1;
    } else if (item === "--target-environment") {
      args.targetEnvironment = argv[index + 1] || "";
      index += 1;
    }
  }
  return args;
}

// Pure function — exported for testing without a real Prisma connection.
function buildReport(counts, sampleRows, options = {}) {
  const { targetEnvironment, appEnv } = options;
  const byTenant = {};
  for (const row of sampleRows) {
    const key = row.tenantKey || "(unknown)";
    byTenant[key] = (byTenant[key] ?? 0) + 1;
  }

  return {
    status: "ok",
    suite: "sellable-sku-variantless-audit",
    mode: "read_only",
    safety: {
      databaseMutations: false,
      storageMutations: false,
    },
    targetEnvironment: targetEnvironment || "(unspecified)",
    appEnv: appEnv || "(unspecified)",
    sellableStatuses: SELLABLE_STATUSES,
    totals: {
      totalProducts: counts.totalProducts,
      sellableProducts: counts.sellableProducts,
      sellableProductsWithVariants: counts.sellableProducts - counts.sellableVariantlessProducts,
      sellableVariantlessProducts: counts.sellableVariantlessProducts,
      billableSkusFromVariants: counts.billableSkusFromVariants,
    },
    // If this backfill decision goes with "Option A: auto-create a canonical
    // variant retroactively," this is exactly how many rows that would touch.
    impactIfBackfilled: {
      newBillableSkusAdded: counts.sellableVariantlessProducts,
      percentOfCurrentBillableSkus:
        counts.billableSkusFromVariants > 0
          ? Number(((counts.sellableVariantlessProducts / counts.billableSkusFromVariants) * 100).toFixed(2))
          : null,
    },
    sampleVariantlessProductsByTenant: byTenant,
    sampleVariantlessProductIds: sampleRows.map((row) => row.id).slice(0, SAMPLE_SIZE),
    checkedAt: new Date().toISOString(),
  };
}

async function loadCounts(prisma) {
  const where = {
    deletedAt: null,
    status: { in: SELLABLE_STATUSES },
  };
  const [totalProducts, sellableProducts, sellableVariantlessProducts, billableSkusFromVariants] = await Promise.all([
    prisma.product.count(),
    prisma.product.count({ where }),
    prisma.product.count({ where: { ...where, variants: { none: {} } } }),
    prisma.variant.count({
      where: {
        status: { in: SELLABLE_STATUSES },
        product: { deletedAt: null, status: { in: SELLABLE_STATUSES } },
      },
    }),
  ]);
  return { totalProducts, sellableProducts, sellableVariantlessProducts, billableSkusFromVariants };
}

async function loadSampleRows(prisma) {
  return prisma.product.findMany({
    where: {
      deletedAt: null,
      status: { in: SELLABLE_STATUSES },
      variants: { none: {} },
    },
    select: { id: true, tenantKey: true, title: true, status: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: SAMPLE_SIZE,
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const output = normalizeText(args.output) || DEFAULT_OUTPUT;
  const targetEnvironment = normalizeText(args.targetEnvironment) || normalizeText(process.env.SELLABLE_SKU_AUDIT_TARGET_ENV);
  const databaseUrl = normalizeText(process.env.DATABASE_URL);
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the read-only sellable-SKU audit report.");
  }

  const PrismaClient = loadPrismaClient();
  const prisma = new PrismaClient();
  try {
    const counts = await loadCounts(prisma);
    const sampleRows = await loadSampleRows(prisma);
    const report = buildReport(counts, sampleRows, {
      targetEnvironment,
      appEnv: process.env.APP_ENV,
    });
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(
      JSON.stringify(
        {
          status: report.status,
          suite: report.suite,
          targetEnvironment: report.targetEnvironment,
          totals: report.totals,
          impactIfBackfilled: report.impactIfBackfilled,
          output,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  buildReport,
  SELLABLE_STATUSES,
};
