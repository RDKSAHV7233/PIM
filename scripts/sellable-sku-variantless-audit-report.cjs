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
// This script answers the questions that decision actually needs: how many such
// rows exist right now in production, broken down by lifecycle status, deletion
// state, tenant, and whether they've already been published to a channel. It is
// intentionally narrow — one counts-only script, read-only, no remediation —
// mirroring the same shape this repo already used for the #496/#483 media-integrity
// production confirmation (see scripts/media-integrity-readonly-report.cjs and its
// dedicated workflow_dispatch-only GitHub Actions workflow).
//
// SAFETY: this script performs ONLY read queries (Product.count, Product.groupBy,
// Product.findMany, ConnectorSubmission.findMany with a `select`/`distinct`). It
// contains no `.create(`, `.update(`, `.upsert(`, `.delete(`, or `$executeRaw*`
// call anywhere. It is safe to run against production.

const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_OUTPUT = ".run-logs/sellable-sku-variantless-audit-report.json";
const SAMPLE_SIZE = 25;
// Defensive ceiling, not an expected-normal limit — today's population is ~63.
// Fetched as CAP + 1 so hitting the cap is distinguishable from landing exactly
// on it (see loadSellableVariantlessRows / main).
const ROW_FETCH_CAP = 5000;

// Mirrors SELLABLE_VARIANT_STATUSES in apps/api/src/billing/plan-usage.service.ts —
// duplicated here (not imported) because this script runs standalone, outside the
// NestJS app, against @prisma/client directly.
const SELLABLE_STATUSES = ["approved", "active"];

// Mirrors the RecordStatus enum in packages/db/prisma/schema.prisma — duplicated
// for the same standalone-script reason as SELLABLE_STATUSES above.
const ALL_LIFECYCLE_STATUSES = ["draft", "in_review", "approved", "rejected", "active", "archived"];

// A submission counts as "published" evidence for this audit's purpose only when
// it reached a real terminal success — matches the same string every connector
// resolves to on success (see marketplace.service.ts / *.connector.ts).
const PUBLISHED_SUBMISSION_STATUS = "SUCCESS";

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

// Normalizes a Prisma groupBy-by-status result into a fixed-shape object covering
// every lifecycle status, defaulting absent statuses to 0 — never a sparse object
// that silently omits a status with zero matching rows.
function normalizeLifecycleDistribution(groupByRows) {
  const distribution = Object.fromEntries(ALL_LIFECYCLE_STATUSES.map((status) => [status, 0]));
  for (const row of groupByRows) {
    if (Object.prototype.hasOwnProperty.call(distribution, row.status)) {
      distribution[row.status] = row._count._all;
    }
  }
  return distribution;
}

function buildFullTenantDistribution(rows) {
  const byTenant = {};
  for (const row of rows) {
    const key = row.tenantKey || "(unknown)";
    byTenant[key] = (byTenant[key] ?? 0) + 1;
  }
  return byTenant;
}

// Pure function — exported for testing without a real Prisma connection.
function buildReport(counts, sellableVariantlessRows, options = {}) {
  const { targetEnvironment, appEnv } = options;

  const channelLinkedCount = counts.channelLinkedSellableVariantlessCount ?? 0;
  // Clamped, never negative: channelLinkedCount is only ever computed from the
  // same sellableVariantlessRows snapshot as the total (see main()), so this
  // shouldn't go negative in practice — the clamp is cheap insurance
  // against ever rendering a nonsensical count in a report a commercial
  // decision depends on, not a substitute for that consistency.
  const notChannelLinkedCount = Math.max(0, counts.sellableVariantlessProducts - channelLinkedCount);

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
    // Broader-than-"sellable" view: every non-deleted variant-less product by its
    // own lifecycle status, not just the approved/active ones already counted
    // above. A draft or in_review variant-less product isn't billable yet, but it
    // is tomorrow's #663 exposure the moment it's approved — this is what a
    // "how much of this keeps growing" read needs, separate from the current
    // billing-impact number. Soft-deleted variant-less products are reported
    // separately since they can never become billable regardless of status.
    lifecycleDistribution: {
      nonDeleted: counts.lifecycleDistributionNonDeleted,
      deletedVariantlessProducts: counts.deletedVariantlessProducts,
    },
    // Of the products actually counted as sellable-variant-less above, how many
    // have already been published to at least one channel (a real SUCCESS
    // connector submission) versus never submitted at all. A published-but-
    // uncounted product is the sharpest version of the #663 defect — it is
    // provably live and selling, and still invisible to billing.
    channelLinked: {
      sellableVariantlessPublished: channelLinkedCount,
      sellableVariantlessNotPublished: notChannelLinkedCount,
    },
    // Full distribution across every affected tenant — not a capped sample. With
    // a population this small (bounded by sellableVariantlessProducts itself),
    // computing this exhaustively costs nothing extra beyond the one row fetch
    // already needed for the ID sample below. If the row fetch hit ROW_FETCH_CAP,
    // this distribution and channelLinked are partial — rowFetchTruncated says so
    // explicitly rather than silently under-reporting.
    variantlessProductsByTenant: buildFullTenantDistribution(sellableVariantlessRows),
    sampleVariantlessProductIds: sellableVariantlessRows.map((row) => row.id).slice(0, SAMPLE_SIZE),
    rowFetchTruncated: Boolean(counts.rowFetchTruncated),
    checkedAt: new Date().toISOString(),
  };
}

async function loadChannelLinkedCount(prisma, productIds) {
  if (!productIds || productIds.length === 0) {
    return 0;
  }
  const rows = await prisma.connectorSubmission.findMany({
    where: { productId: { in: productIds }, status: PUBLISHED_SUBMISSION_STATUS },
    select: { productId: true },
    distinct: ["productId"],
  });
  return rows.length;
}

// sellableVariantlessProducts is deliberately NOT counted here — it's derived
// from the same row snapshot loadSellableVariantlessRows already fetched (see
// main()), never from a second, independently-timed count() call. Two separate
// reads of a live, concurrently-mutating table could disagree on which products
// currently qualify, and channelLinkedSellableVariantlessCount is bounded by
// that same row snapshot's IDs — deriving the total from anything else risks a
// nonsensical negative "not published" count in the report.
async function loadCounts(prisma, sellableVariantlessProductIds) {
  const where = {
    deletedAt: null,
    status: { in: SELLABLE_STATUSES },
  };
  const [
    totalProducts,
    sellableProducts,
    billableSkusFromVariants,
    lifecycleGroupByRows,
    deletedVariantlessProducts,
    channelLinkedSellableVariantlessCount,
  ] = await Promise.all([
    prisma.product.count(),
    prisma.product.count({ where }),
    prisma.variant.count({
      where: {
        status: { in: SELLABLE_STATUSES },
        product: { deletedAt: null, status: { in: SELLABLE_STATUSES } },
      },
    }),
    prisma.product.groupBy({
      by: ["status"],
      where: { deletedAt: null, variants: { none: {} } },
      _count: { _all: true },
    }),
    prisma.product.count({ where: { deletedAt: { not: null }, variants: { none: {} } } }),
    loadChannelLinkedCount(prisma, sellableVariantlessProductIds),
  ]);
  return {
    totalProducts,
    sellableProducts,
    billableSkusFromVariants,
    lifecycleDistributionNonDeleted: normalizeLifecycleDistribution(lifecycleGroupByRows),
    deletedVariantlessProducts,
    channelLinkedSellableVariantlessCount,
  };
}

function sellableVariantlessWhere() {
  return {
    deletedAt: null,
    status: { in: SELLABLE_STATUSES },
    variants: { none: {} },
  };
}

// Fetches sellable-variant-less products' id + tenantKey, capped at
// ROW_FETCH_CAP + 1 so hitting the cap is distinguishable from landing exactly
// on it. Today's population (~63) is far below the cap; this exists so a much
// larger future population degrades to a flagged partial result instead of an
// unbounded fetch/IN-list against production.
async function loadSellableVariantlessRows(prisma) {
  return prisma.product.findMany({
    where: sellableVariantlessWhere(),
    select: { id: true, tenantKey: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: ROW_FETCH_CAP + 1,
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
    const fetchedRows = await loadSellableVariantlessRows(prisma);
    const rowFetchTruncated = fetchedRows.length > ROW_FETCH_CAP;
    const sellableVariantlessRows = rowFetchTruncated ? fetchedRows.slice(0, ROW_FETCH_CAP) : fetchedRows;
    // Only falls back to a second, independently-timed count() when the row
    // fetch was actually truncated — the common case (today: 63 rows) derives
    // the total from the same snapshot as everything else, with no extra query
    // and no cross-query race window.
    const sellableVariantlessProducts = rowFetchTruncated
      ? await prisma.product.count({ where: sellableVariantlessWhere() })
      : sellableVariantlessRows.length;
    const counts = await loadCounts(
      prisma,
      sellableVariantlessRows.map((row) => row.id),
    );
    counts.sellableVariantlessProducts = sellableVariantlessProducts;
    counts.rowFetchTruncated = rowFetchTruncated;
    const report = buildReport(counts, sellableVariantlessRows, {
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
          lifecycleDistribution: report.lifecycleDistribution,
          channelLinked: report.channelLinked,
          tenantCount: Object.keys(report.variantlessProductsByTenant).length,
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
  ALL_LIFECYCLE_STATUSES,
};
