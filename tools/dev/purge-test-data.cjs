#!/usr/bin/env node
/* eslint-disable no-console */
const { PrismaClient } = require("@prisma/client");

const TEST_PREFIXES = [
  "phase2 ",
  "phase3 ",
  "phase4 ",
  "phase5 ",
  "phase6 ",
  "phase7 ",
  "phase8 ",
  "smoke ",
  "rbac ",
  "concurrency ",
  "audit ",
  "benchmark",
  "metrics ",
  "reject score ",
  "media smoke ",
  "ondc smoke ",
  "ai smoke ",
  "pilot ",
  "template ",
  "version ",
  "xlsx ",
  "e2e-",
  "qa flow ",
  "pim1 qa flow ",
  "ui-reality-",
  "manual cat ",
];

function parseArgs(argv) {
  const args = {
    execute: false,
    tenantKey: "default",
  };
  for (const arg of argv.slice(2)) {
    if (arg === "--execute") {
      args.execute = true;
      continue;
    }
    if (arg.startsWith("--tenant=")) {
      args.tenantKey = arg.split("=", 2)[1]?.trim() || "default";
      continue;
    }
  }
  return args;
}

function escapeLike(value) {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function buildOrPrefixMatchSql(columnName) {
  return TEST_PREFIXES.map((prefix) => `LOWER(${columnName}) LIKE '${escapeLike(prefix)}%'`).join(" OR ");
}

async function run() {
  const { execute, tenantKey } = parseArgs(process.argv);
  const prisma = new PrismaClient();
  const [mediaTableCheck] = await prisma.$queryRawUnsafe(
    "SELECT to_regclass('public.media_assets') IS NOT NULL AS present",
  );
  const hasMediaAssets = Boolean(mediaTableCheck?.present);
  const tenantLiteral = tenantKey.replace(/'/g, "''");
  const categoryMatch = `(${buildOrPrefixMatchSql('"name"')} OR ${buildOrPrefixMatchSql('"path"')})`;
  const productMatch = `(${buildOrPrefixMatchSql('"title"')})`;

  const mediaCountSql = hasMediaAssets
    ? `(SELECT COUNT(*)::int FROM media_assets m WHERE m.product_id IN (SELECT id FROM matched_products) OR m.variant_id IN (SELECT id FROM "Variant" v WHERE v."productId" IN (SELECT id FROM matched_products))) AS media_assets`
    : `0::int AS media_assets`;

  const countsSql = `
    WITH matched_categories AS (
      SELECT id
      FROM "Category"
      WHERE "tenantKey" = '${tenantLiteral}' AND ${categoryMatch}
    ),
    matched_products AS (
      SELECT p.id
      FROM "Product" p
      WHERE (p."tenantKey" = '${tenantLiteral}' AND ${productMatch})
         OR p."categoryId" IN (SELECT id FROM matched_categories)
    ),
    matched_jobs AS (
      SELECT j.id
      FROM "BulkImportJob" j
      WHERE j."tenantKey" = '${tenantLiteral}'
        AND j."categoryId" IN (SELECT id FROM matched_categories)
    ),
    matched_export_jobs AS (
      SELECT j.id
      FROM "MarketplaceExportJob" j
      WHERE j."tenantKey" = '${tenantLiteral}'
        AND (j."productId" IN (SELECT id FROM matched_products) OR j."categoryId" IN (SELECT id FROM matched_categories))
    ),
    matched_operations AS (
      SELECT o.id
      FROM "BulkEditOperation" o
      WHERE o."tenantKey" = '${tenantLiteral}'
        AND EXISTS (
          SELECT 1
          FROM "BulkEditOperationItem" i
          WHERE i."operationId" = o.id
            AND i."tenantKey" = '${tenantLiteral}'
            AND i."productId" IN (SELECT id FROM matched_products)
        )
    )
    SELECT
      (SELECT COUNT(*)::int FROM matched_categories) AS categories,
      (SELECT COUNT(*)::int FROM matched_products) AS products,
      (SELECT COUNT(*)::int FROM "Variant" v WHERE v."productId" IN (SELECT id FROM matched_products)) AS variants,
      (SELECT COUNT(*)::int FROM "ValidationIssue" vi WHERE vi."productId" IN (SELECT id FROM matched_products)) AS validation_issues,
      (SELECT COUNT(*)::int FROM "AttributeDefinition" a WHERE a."tenantKey" = '${tenantLiteral}' AND a."categoryId" IN (SELECT id FROM matched_categories)) AS attribute_definitions,
      (SELECT COUNT(*)::int FROM "ComplianceRule" r WHERE r."tenantKey" = '${tenantLiteral}' AND r."categoryId" IN (SELECT id FROM matched_categories)) AS compliance_rules,
      (SELECT COUNT(*)::int FROM "ChannelMappingTemplate" t WHERE t."tenantKey" = '${tenantLiteral}' AND t."categoryId" IN (SELECT id FROM matched_categories)) AS mapping_templates,
      (SELECT COUNT(*)::int FROM "MarketplaceExportJob" e WHERE e.id IN (SELECT id FROM matched_export_jobs)) AS export_jobs,
      (SELECT COUNT(*)::int FROM "BulkImportTemplate" bt WHERE bt."tenantKey" = '${tenantLiteral}' AND bt."categoryId" IN (SELECT id FROM matched_categories)) AS bulk_import_templates,
      (SELECT COUNT(*)::int FROM "BulkImportJob" bj WHERE bj.id IN (SELECT id FROM matched_jobs)) AS bulk_import_jobs,
      (SELECT COUNT(*)::int FROM "BulkImportRow" br WHERE br."jobId" IN (SELECT id FROM matched_jobs) OR br."productId" IN (SELECT id FROM matched_products)) AS bulk_import_rows,
      (SELECT COUNT(*)::int FROM "BulkEditOperation" bo WHERE bo.id IN (SELECT id FROM matched_operations)) AS bulk_edit_operations,
      (SELECT COUNT(*)::int FROM "BulkEditOperationItem" bi WHERE bi."tenantKey" = '${tenantLiteral}' AND (bi."operationId" IN (SELECT id FROM matched_operations) OR bi."productId" IN (SELECT id FROM matched_products))) AS bulk_edit_items,
      ${mediaCountSql}
  `;

  const [counts] = await prisma.$queryRawUnsafe(countsSql);
  const summary = {
    tenantKey,
    mode: execute ? "execute" : "dry-run",
    matched: counts,
    checkedAt: new Date().toISOString(),
  };

  if (!execute) {
    console.log(JSON.stringify(summary, null, 2));
    await prisma.$disconnect();
    return;
  }

  const deleteSqlStatements = [];
  if (hasMediaAssets) {
    deleteSqlStatements.push(`
      WITH matched_categories AS (
        SELECT id FROM "Category" WHERE "tenantKey" = '${tenantLiteral}' AND ${categoryMatch}
      ),
      matched_products AS (
        SELECT p.id
        FROM "Product" p
        WHERE (p."tenantKey" = '${tenantLiteral}' AND ${productMatch})
           OR p."categoryId" IN (SELECT id FROM matched_categories)
      ),
      matched_variants AS (
        SELECT v.id
        FROM "Variant" v
        WHERE v."productId" IN (SELECT id FROM matched_products)
      )
      DELETE FROM media_assets
      WHERE product_id IN (SELECT id FROM matched_products) OR variant_id IN (SELECT id FROM matched_variants)
    `);
  }
  deleteSqlStatements.push(
    `
      WITH matched_categories AS (
        SELECT id FROM "Category" WHERE "tenantKey" = '${tenantLiteral}' AND ${categoryMatch}
      ),
      matched_products AS (
        SELECT p.id
        FROM "Product" p
        WHERE (p."tenantKey" = '${tenantLiteral}' AND ${productMatch})
           OR p."categoryId" IN (SELECT id FROM matched_categories)
      )
      DELETE FROM "ValidationIssue"
      WHERE "productId" IN (SELECT id FROM matched_products)
    `,
    `
      WITH matched_categories AS (
        SELECT id FROM "Category" WHERE "tenantKey" = '${tenantLiteral}' AND ${categoryMatch}
      ),
      matched_products AS (
        SELECT p.id
        FROM "Product" p
        WHERE (p."tenantKey" = '${tenantLiteral}' AND ${productMatch})
           OR p."categoryId" IN (SELECT id FROM matched_categories)
      ),
      matched_operations AS (
        SELECT DISTINCT i."operationId"
        FROM "BulkEditOperationItem" i
        WHERE i."productId" IN (SELECT id FROM matched_products)
      )
      DELETE FROM "BulkEditOperationItem"
      WHERE "operationId" IN (SELECT "operationId" FROM matched_operations) OR "productId" IN (SELECT id FROM matched_products)
    `,
    `
      WITH matched_categories AS (
        SELECT id FROM "Category" WHERE "tenantKey" = '${tenantLiteral}' AND ${categoryMatch}
      ),
      matched_products AS (
        SELECT p.id
        FROM "Product" p
        WHERE (p."tenantKey" = '${tenantLiteral}' AND ${productMatch})
           OR p."categoryId" IN (SELECT id FROM matched_categories)
      )
      DELETE FROM "Variant"
      WHERE "productId" IN (SELECT id FROM matched_products)
    `,
    `
      WITH matched_categories AS (
        SELECT id FROM "Category" WHERE "tenantKey" = '${tenantLiteral}' AND ${categoryMatch}
      ),
      matched_products AS (
        SELECT p.id
        FROM "Product" p
        WHERE (p."tenantKey" = '${tenantLiteral}' AND ${productMatch})
           OR p."categoryId" IN (SELECT id FROM matched_categories)
      )
      DELETE FROM "MarketplaceExportJob"
      WHERE "productId" IN (SELECT id FROM matched_products) OR "categoryId" IN (SELECT id FROM matched_categories)
    `,
    `
      WITH matched_categories AS (
        SELECT id FROM "Category" WHERE "tenantKey" = '${tenantLiteral}' AND ${categoryMatch}
      ),
      matched_jobs AS (
        SELECT id FROM "BulkImportJob" WHERE "tenantKey" = '${tenantLiteral}' AND "categoryId" IN (SELECT id FROM matched_categories)
      ),
      matched_products AS (
        SELECT p.id
        FROM "Product" p
        WHERE (p."tenantKey" = '${tenantLiteral}' AND ${productMatch})
           OR p."categoryId" IN (SELECT id FROM matched_categories)
      )
      DELETE FROM "BulkImportRow"
      WHERE "jobId" IN (SELECT id FROM matched_jobs) OR "productId" IN (SELECT id FROM matched_products)
    `,
    `
      WITH matched_categories AS (
        SELECT id FROM "Category" WHERE "tenantKey" = '${tenantLiteral}' AND ${categoryMatch}
      )
      DELETE FROM "BulkImportJob"
      WHERE "tenantKey" = '${tenantLiteral}'
        AND "categoryId" IN (SELECT id FROM matched_categories)
    `,
    `
      WITH matched_categories AS (
        SELECT id FROM "Category" WHERE "tenantKey" = '${tenantLiteral}' AND ${categoryMatch}
      ),
      matched_products AS (
        SELECT p.id
        FROM "Product" p
        WHERE (p."tenantKey" = '${tenantLiteral}' AND ${productMatch})
           OR p."categoryId" IN (SELECT id FROM matched_categories)
      )
      DELETE FROM "Product"
      WHERE id IN (SELECT id FROM matched_products)
    `,
    `
      WITH matched_categories AS (
        SELECT id FROM "Category" WHERE "tenantKey" = '${tenantLiteral}' AND ${categoryMatch}
      )
      DELETE FROM "ChannelMappingTemplate"
      WHERE "tenantKey" = '${tenantLiteral}'
        AND "categoryId" IN (SELECT id FROM matched_categories)
    `,
    `
      WITH matched_categories AS (
        SELECT id FROM "Category" WHERE "tenantKey" = '${tenantLiteral}' AND ${categoryMatch}
      )
      DELETE FROM "ComplianceRule"
      WHERE "tenantKey" = '${tenantLiteral}'
        AND "categoryId" IN (SELECT id FROM matched_categories)
    `,
    `
      WITH matched_categories AS (
        SELECT id FROM "Category" WHERE "tenantKey" = '${tenantLiteral}' AND ${categoryMatch}
      )
      DELETE FROM "AttributeDefinition"
      WHERE "tenantKey" = '${tenantLiteral}'
        AND "categoryId" IN (SELECT id FROM matched_categories)
    `,
    `
      WITH matched_categories AS (
        SELECT id FROM "Category" WHERE "tenantKey" = '${tenantLiteral}' AND ${categoryMatch}
      )
      DELETE FROM "BulkImportTemplate"
      WHERE "tenantKey" = '${tenantLiteral}'
        AND "categoryId" IN (SELECT id FROM matched_categories)
    `,
    `
      WITH matched_categories AS (
        SELECT id FROM "Category" WHERE "tenantKey" = '${tenantLiteral}' AND ${categoryMatch}
      )
      DELETE FROM "Category"
      WHERE id IN (SELECT id FROM matched_categories)
    `,
  );

  for (const sql of deleteSqlStatements) {
    await prisma.$executeRawUnsafe(sql);
  }

  const result = {
    ...summary,
    status: "completed",
    completedAt: new Date().toISOString(),
  };
  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}

run().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
