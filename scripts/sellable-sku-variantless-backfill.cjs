#!/usr/bin/env node
/* eslint-disable no-console */
//
// PIM#663 historical backfill script.
//
// Background: the forward-fix (PR #670, CatalogService.ensureCanonicalVariant)
// auto-creates a canonical Variant the moment a product first becomes sellable,
// so this can never recur for products approved/activated from here on. It does
// NOT touch products that were already approved/active with zero variants
// before it shipped. The read-only audit (scripts/sellable-sku-variantless-
// audit-report.cjs) quantified that population: 63 products in production as of
// 2026-08-26, all in the shared tenant.
//
// This script closes that gap by running the EXACT SAME logic
// ensureCanonicalVariant already uses in production — not new bespoke rules —
// against exactly that population: products with status IN (approved, active),
// deletedAt IS NULL, and zero Variant rows. For each, it creates exactly one
// Variant with:
//   - skuCode:       attributes.sku (trimmed) if present, else the product's own id
//   - mrp:           attributes.mrp, else attributes.price, else null
//   - sellingPrice:  attributes.sellingPrice, else attributes.selling_price,
//                    else mrp
//   - status:        the product's own status (approved or active)
// This mirrors CatalogService.ensureCanonicalVariant field-for-field so a
// backfilled variant is indistinguishable from one the forward-fix would have
// created at approval time.
//
// SAFETY:
//   - DRY RUN BY DEFAULT. No row is created unless --confirm is passed AND the
//     CONFIRM_SELLABLE_SKU_BACKFILL environment variable is exactly "true" —
//     two independent opt-ins, neither sufficient alone, so a single mistaken
//     flag or env var can never trigger a real write.
//   - Idempotent per row: immediately before creating a variant for a given
//     product, re-checks that product still has zero variants inside the same
//     operation. A product that gained a variant since the population was read
//     (e.g. a concurrent normal approval elsewhere) is skipped, not duplicated.
//   - Bounded: refuses to process more than ROW_FETCH_CAP products in one run
//     (today's population is 63) — fails closed rather than silently processing
//     an unbounded population.
//   - Every outcome (created / skipped-already-has-variant / would-create in dry
//     run) is recorded per product ID in the output report. Nothing is inferred
//     or summarized away.

const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_OUTPUT = ".run-logs/sellable-sku-variantless-backfill-report.json";
const ROW_FETCH_CAP = 5000;

// Mirrors SELLABLE_VARIANT_STATUSES in apps/api/src/billing/plan-usage.service.ts
// and the trigger condition in CatalogService.ensureCanonicalVariant — duplicated
// here because this script runs standalone, outside the NestJS app.
const SELLABLE_STATUSES = ["approved", "active"];

function loadPrismaClient() {
  return require("@prisma/client").PrismaClient;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function parseArgs(argv) {
  const args = { output: DEFAULT_OUTPUT, confirm: false };
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--output") {
      args.output = argv[index + 1] || "";
      index += 1;
    } else if (item === "--target-environment") {
      args.targetEnvironment = argv[index + 1] || "";
      index += 1;
    } else if (item === "--confirm") {
      args.confirm = true;
    }
  }
  return args;
}

// Pure function — mirrors CatalogService.ensureCanonicalVariant's own field
// derivation exactly (apps/api/src/catalog/catalog.service.ts), so a backfilled
// row is indistinguishable from one the forward-fix would have created.
function deriveCanonicalVariantFields(product) {
  const attributes = (product.attributes && typeof product.attributes === "object") ? product.attributes : {};
  const attrSku = typeof attributes.sku === "string" ? attributes.sku.trim() : "";
  const skuCode = attrSku || product.id;
  const attrMrp =
    typeof attributes.mrp === "number" ? attributes.mrp :
    typeof attributes.price === "number" ? attributes.price : null;
  const attrSellingPrice =
    typeof attributes.sellingPrice === "number" ? attributes.sellingPrice :
    typeof attributes.selling_price === "number" ? attributes.selling_price : attrMrp;
  return {
    skuCode,
    mrp: attrMrp,
    sellingPrice: attrSellingPrice,
    status: product.status,
  };
}

// Determines whether a real write is authorized. Two independent opt-ins are
// required so a single mistaken flag or env var can never trigger a write:
// the CLI flag (an explicit, deliberate invocation choice) and the env var (a
// workflow-level gate the dispatcher must also set). Neither alone is enough.
function isWriteAuthorized({ confirmFlag, confirmEnv }) {
  return confirmFlag === true && normalizeText(confirmEnv).toLowerCase() === "true";
}

async function backfillProduct(prisma, product, { dryRun }) {
  const fields = deriveCanonicalVariantFields(product);
  if (dryRun) {
    return { productId: product.id, tenantKey: product.tenantKey, outcome: "would_create", ...fields };
  }
  // Re-verified inside the write itself, not just at population-read time —
  // a product that gained a variant since the population was read (e.g. a
  // concurrent normal approval) must be skipped, not duplicated.
  return prisma.$transaction(async (tx) => {
    const existingVariant = await tx.variant.findFirst({
      where: { productId: product.id, tenantKey: product.tenantKey },
      select: { id: true },
    });
    if (existingVariant) {
      return { productId: product.id, tenantKey: product.tenantKey, outcome: "skipped_already_has_variant" };
    }
    // tenantKey is set explicitly because this script runs a standalone
    // PrismaClient with no request-bound tenant context — unlike
    // CatalogService.ensureCanonicalVariant, which runs through the app's
    // tenant-scoped client extension (this.prisma.tenant()) that injects
    // tenantKey automatically. Omitting it here would silently default every
    // backfilled variant to tenantKey "default" regardless of the product's
    // real tenant, violating Variant's own @@unique([tenantKey, skuCode])
    // constraint's isolation intent.
    const created = await tx.variant.create({
      data: {
        tenantKey: product.tenantKey,
        productId: product.id,
        skuCode: fields.skuCode,
        mrp: fields.mrp,
        sellingPrice: fields.sellingPrice,
        status: fields.status,
      },
      select: { id: true },
    });
    return { productId: product.id, tenantKey: product.tenantKey, outcome: "created", variantId: created.id, ...fields };
  });
}

function sellableVariantlessWhere() {
  return {
    deletedAt: null,
    status: { in: SELLABLE_STATUSES },
    variants: { none: {} },
  };
}

async function loadCandidateProducts(prisma) {
  return prisma.product.findMany({
    where: sellableVariantlessWhere(),
    select: { id: true, tenantKey: true, status: true, attributes: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: ROW_FETCH_CAP + 1,
  });
}

// Throws when the actual fetched row count exceeds the cap — the real
// enforcement point, not the upfront count() (a non-atomic, TOCTOU-vulnerable
// proxy for it: the population can grow past the cap between the count() and
// the findMany() that follows it). loadCandidateProducts fetches CAP+1
// specifically so this comparison can tell "landed exactly on the cap" apart
// from "there are more rows than the cap allows" — failing closed here rather
// than silently processing only the first CAP rows.
function assertNotTruncated(fetchedRowCount, cap) {
  if (fetchedRowCount > cap) {
    throw new Error(
      `Candidate population grew past ROW_FETCH_CAP (${cap}) between the initial count and the row fetch — ` +
        `refusing to process a silently-truncated subset. Re-run once the population is confirmed stable, or ` +
        `raise the cap deliberately after re-confirming the eligibility predicate still matches expectations ` +
        `at this scale.`,
    );
  }
}

function summarize(results) {
  // Fixed shape covering every possible outcome, including "error" — never a
  // sparse object that silently omits a category with zero occurrences, and
  // never lets an error outcome go unnoticed by only appearing when non-zero.
  const summary = { created: 0, skipped_already_has_variant: 0, would_create: 0, error: 0 };
  for (const result of results) {
    summary[result.outcome] = (summary[result.outcome] ?? 0) + 1;
  }
  return summary;
}

async function main() {
  const args = parseArgs(process.argv);
  const output = normalizeText(args.output) || DEFAULT_OUTPUT;
  const targetEnvironment = normalizeText(args.targetEnvironment) || normalizeText(process.env.SELLABLE_SKU_BACKFILL_TARGET_ENV);
  const databaseUrl = normalizeText(process.env.DATABASE_URL);
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the sellable-SKU backfill.");
  }

  const writeAuthorized = isWriteAuthorized({
    confirmFlag: args.confirm,
    confirmEnv: process.env.CONFIRM_SELLABLE_SKU_BACKFILL,
  });
  const dryRun = !writeAuthorized;

  const PrismaClient = loadPrismaClient();
  const prisma = new PrismaClient();
  try {
    const candidates = await prisma.product.count({ where: sellableVariantlessWhere() });
    if (candidates > ROW_FETCH_CAP) {
      throw new Error(
        `Candidate population (${candidates}) exceeds ROW_FETCH_CAP (${ROW_FETCH_CAP}) — refusing to run ` +
          `unbounded. Raise the cap deliberately after re-confirming the eligibility predicate still matches ` +
          `expectations at this scale.`,
      );
    }

    // This count() and the findMany() below are two independent, non-atomic
    // reads of a live table — the population can grow past ROW_FETCH_CAP in
    // between, so the upfront count alone is a best-effort proxy, not a
    // guarantee. assertNotTruncated re-checks the actual fetched row count,
    // which is the real enforcement point.
    const products = await loadCandidateProducts(prisma);
    assertNotTruncated(products.length, ROW_FETCH_CAP);
    const results = [];
    // Sequential, not Promise.all — this performs real writes when write-
    // authorized; deliberately trades speed for a report where a mid-run
    // failure's position is unambiguous and every completed row is real. Each
    // product is isolated in its own try/catch: one row's failure (e.g. a
    // skuCode unique-constraint collision) is recorded and the batch
    // continues, rather than aborting the whole run and losing the report for
    // every row that already succeeded.
    for (const product of products) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await backfillProduct(prisma, product, { dryRun });
        results.push(result);
      } catch (error) {
        results.push({
          productId: product.id,
          tenantKey: product.tenantKey,
          outcome: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const report = {
      status: "ok",
      suite: "sellable-sku-variantless-backfill",
      mode: dryRun ? "dry_run" : "write",
      safety: {
        databaseMutations: !dryRun,
        storageMutations: false,
      },
      targetEnvironment: targetEnvironment || "(unspecified)",
      appEnv: process.env.APP_ENV || "(unspecified)",
      sellableStatuses: SELLABLE_STATUSES,
      candidateCount: products.length,
      summary: summarize(results),
      results,
      checkedAt: new Date().toISOString(),
    };

    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(
      JSON.stringify(
        {
          status: report.status,
          suite: report.suite,
          mode: report.mode,
          targetEnvironment: report.targetEnvironment,
          candidateCount: report.candidateCount,
          summary: report.summary,
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
  deriveCanonicalVariantFields,
  isWriteAuthorized,
  assertNotTruncated,
  summarize,
  SELLABLE_STATUSES,
  ROW_FETCH_CAP,
};
