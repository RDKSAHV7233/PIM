#!/usr/bin/env node
/* eslint-disable no-console */
const { randomUUID } = require("node:crypto");
const { PrismaClient, ExportJobStatus, MarketplaceChannel } = require("@prisma/client");

const CHECKER_ROLE = "pim1_rls_checker";
const DEFAULT_TENANT = "default";
const SMOKE_TENANT = "smoke-tenant";

function withTenant(databaseUrl, tenantKey) {
  const encoded = encodeURIComponent(`-c app.tenant_key=${tenantKey}`);
  if (databaseUrl.includes("options=")) {
    return databaseUrl.replace(/([?&])options=[^&]*/, `$1options=${encoded}`);
  }
  if (databaseUrl.includes("?")) {
    return `${databaseUrl}&options=${encoded}`;
  }
  return `${databaseUrl}?options=${encoded}`;
}

async function ensureCheckerRole(client) {
  await client.$executeRawUnsafe(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${CHECKER_ROLE}') THEN
    EXECUTE 'CREATE ROLE ${CHECKER_ROLE} NOLOGIN NOBYPASSRLS';
  END IF;
END $$;
  `);
  await client.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${CHECKER_ROLE}`);
  await client.$executeRawUnsafe(`
    GRANT SELECT ON TABLE
      "Category",
      "Product",
      "Variant",
      "AttributeDefinition",
      "ComplianceRule",
      "ValidationIssue",
      "ChannelMappingTemplate",
      "MarketplaceExportJob",
      "BulkImportJob",
      "BulkImportRow",
      "BulkImportTemplate",
      "BulkEditOperation",
      "BulkEditOperationItem",
      audit_logs
    TO ${CHECKER_ROLE}
  `);
}

async function countVisibleById(client, tableName, id) {
  const rows = await client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${CHECKER_ROLE}`);
    return tx.$queryRawUnsafe(
      `SELECT COUNT(*)::INT AS count FROM "${tableName}" WHERE id = $1`,
      id,
    );
  });
  return rows[0]?.count ?? 0;
}

async function countVisibleAuditById(client, id) {
  const rows = await client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${CHECKER_ROLE}`);
    return tx.$queryRawUnsafe(
      `SELECT COUNT(*)::INT AS count FROM audit_logs WHERE id = $1`,
      id,
    );
  });
  return rows[0]?.count ?? 0;
}

async function run() {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const defaultClient = new PrismaClient({
    datasources: { db: { url: withTenant(baseUrl, DEFAULT_TENANT) } },
  });
  const smokeClient = new PrismaClient({
    datasources: { db: { url: withTenant(baseUrl, SMOKE_TENANT) } },
  });

  const uid = Date.now().toString(36);
  const created = {};

  try {
    await ensureCheckerRole(defaultClient);

    const category = await smokeClient.category.create({
      data: {
        tenantKey: SMOKE_TENANT,
        name: `RLS Category ${uid}`,
        slug: `rls-category-${uid}`,
        path: `RLS Category ${uid}`,
      },
      select: { id: true },
    });
    created.Category = category.id;

    const product = await smokeClient.product.create({
      data: {
        tenantKey: SMOKE_TENANT,
        title: `RLS Product ${uid}`,
        description: "RLS verification product",
        brand: "PIM1",
        categoryId: category.id,
      },
      select: { id: true },
    });
    created.Product = product.id;

    const variant = await smokeClient.variant.create({
      data: {
        tenantKey: SMOKE_TENANT,
        productId: product.id,
        skuCode: `RLS-SKU-${uid}`,
        attributes: {},
      },
      select: { id: true },
    });
    created.Variant = variant.id;

    const attributeDefinition = await smokeClient.attributeDefinition.create({
      data: {
        tenantKey: SMOKE_TENANT,
        categoryId: category.id,
        key: `rls_key_${uid}`,
        name: "RLS Key",
        dataType: "text",
        appliesTo: "product",
      },
      select: { id: true },
    });
    created.AttributeDefinition = attributeDefinition.id;

    const complianceRule = await smokeClient.complianceRule.create({
      data: {
        tenantKey: SMOKE_TENANT,
        ruleCode: `RLS_RULE_${uid}`,
        name: "RLS Rule",
        categoryId: category.id,
        severity: "error",
        ruleType: "required_field",
        config: {},
        active: true,
      },
      select: { id: true, ruleCode: true },
    });
    created.ComplianceRule = complianceRule.id;

    const validationIssue = await smokeClient.validationIssue.create({
      data: {
        tenantKey: SMOKE_TENANT,
        productId: product.id,
        variantId: variant.id,
        ruleId: complianceRule.id,
        severity: "error",
        ruleCode: complianceRule.ruleCode,
        message: "RLS smoke issue",
        fieldPath: "title",
      },
      select: { id: true },
    });
    created.ValidationIssue = validationIssue.id;

    const mappingTemplate = await smokeClient.channelMappingTemplate.create({
      data: {
        tenantKey: SMOKE_TENANT,
        name: `RLS Template ${uid}`,
        categoryId: category.id,
        channel: MarketplaceChannel.amazon,
        requiredFields: [],
        fieldMap: {},
        isDefault: false,
      },
      select: { id: true },
    });
    created.ChannelMappingTemplate = mappingTemplate.id;

    const exportJob = await smokeClient.marketplaceExportJob.create({
      data: {
        tenantKey: SMOKE_TENANT,
        productId: product.id,
        categoryId: category.id,
        channel: MarketplaceChannel.amazon,
        status: ExportJobStatus.queued,
        retryCount: 0,
        maxRetries: 1,
        templateId: mappingTemplate.id,
      },
      select: { id: true },
    });
    created.MarketplaceExportJob = exportJob.id;

    const importJob = await smokeClient.bulkImportJob.create({
      data: {
        tenantKey: SMOKE_TENANT,
        categoryId: category.id,
        sourceFormat: "json",
        sourceName: `rls-import-${uid}.json`,
        mapping: {},
      },
      select: { id: true },
    });
    created.BulkImportJob = importJob.id;

    const importRow = await smokeClient.bulkImportRow.create({
      data: {
        tenantKey: SMOKE_TENANT,
        jobId: importJob.id,
        rowNumber: 1,
        payload: { title: "RLS" },
        status: "queued",
      },
      select: { id: true },
    });
    created.BulkImportRow = importRow.id;

    const importTemplate = await smokeClient.bulkImportTemplate.create({
      data: {
        tenantKey: SMOKE_TENANT,
        categoryId: category.id,
        name: `RLS Import Template ${uid}`,
        version: 1,
        sourceFormat: "json",
        mapping: {},
      },
      select: { id: true },
    });
    created.BulkImportTemplate = importTemplate.id;

    const bulkEditOp = await smokeClient.bulkEditOperation.create({
      data: {
        tenantKey: SMOKE_TENANT,
        status: "processing",
        scope: { productId: product.id },
        updates: { status: "active" },
        requestedCount: 1,
      },
      select: { id: true },
    });
    created.BulkEditOperation = bulkEditOp.id;

    const bulkEditItem = await smokeClient.bulkEditOperationItem.create({
      data: {
        tenantKey: SMOKE_TENANT,
        operationId: bulkEditOp.id,
        productId: product.id,
        status: "success",
        before: { status: "draft" },
        after: { status: "active" },
      },
      select: { id: true },
    });
    created.BulkEditOperationItem = bulkEditItem.id;

    const auditId = randomUUID();
    await smokeClient.$executeRawUnsafe(
      `
      INSERT INTO audit_logs (
        id, tenant_key, actor_id, actor_role, action, resource, resource_id, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      `,
      auditId,
      SMOKE_TENANT,
      "rls-checker",
      "admin",
      "CREATE",
      "rls",
      product.id,
      JSON.stringify({ scope: "verify-tenant-rls" }),
    );
    created.audit_logs = auditId;

    const tableChecks = [];
    for (const [table, id] of Object.entries(created)) {
      const defaultCount = table === "audit_logs"
        ? await countVisibleAuditById(defaultClient, id)
        : await countVisibleById(defaultClient, table, id);
      const smokeCount = table === "audit_logs"
        ? await countVisibleAuditById(smokeClient, id)
        : await countVisibleById(smokeClient, table, id);
      tableChecks.push({
        table,
        rowCount: smokeCount,
        crossTenantRowCount: defaultCount,
        passed: defaultCount === 0 && smokeCount === 1,
      });
    }

    const output = {
      checkedAt: new Date().toISOString(),
      tenantA: DEFAULT_TENANT,
      tenantB: SMOKE_TENANT,
      results: tableChecks,
    };

    console.log(JSON.stringify(output, null, 2));
    if (tableChecks.some((entry) => entry.passed !== true)) {
      process.exitCode = 1;
    }
  } finally {
    if (created.audit_logs) {
      await smokeClient.$executeRawUnsafe(`DELETE FROM audit_logs WHERE id = $1`, created.audit_logs);
    }
    if (created.BulkEditOperationItem) {
      await smokeClient.bulkEditOperationItem.deleteMany({ where: { id: created.BulkEditOperationItem } });
    }
    if (created.BulkEditOperation) {
      await smokeClient.bulkEditOperation.deleteMany({ where: { id: created.BulkEditOperation } });
    }
    if (created.BulkImportTemplate) {
      await smokeClient.bulkImportTemplate.deleteMany({ where: { id: created.BulkImportTemplate } });
    }
    if (created.BulkImportRow) {
      await smokeClient.bulkImportRow.deleteMany({ where: { id: created.BulkImportRow } });
    }
    if (created.BulkImportJob) {
      await smokeClient.bulkImportJob.deleteMany({ where: { id: created.BulkImportJob } });
    }
    if (created.MarketplaceExportJob) {
      await smokeClient.marketplaceExportJob.deleteMany({ where: { id: created.MarketplaceExportJob } });
    }
    if (created.ChannelMappingTemplate) {
      await smokeClient.channelMappingTemplate.deleteMany({ where: { id: created.ChannelMappingTemplate } });
    }
    if (created.ValidationIssue) {
      await smokeClient.validationIssue.deleteMany({ where: { id: created.ValidationIssue } });
    }
    if (created.ComplianceRule) {
      await smokeClient.complianceRule.deleteMany({ where: { id: created.ComplianceRule } });
    }
    if (created.AttributeDefinition) {
      await smokeClient.attributeDefinition.deleteMany({ where: { id: created.AttributeDefinition } });
    }
    if (created.Variant) {
      await smokeClient.variant.deleteMany({ where: { id: created.Variant } });
    }
    if (created.Product) {
      await smokeClient.product.deleteMany({ where: { id: created.Product } });
    }
    if (created.Category) {
      await smokeClient.category.deleteMany({ where: { id: created.Category } });
    }
    await Promise.all([defaultClient.$disconnect(), smokeClient.$disconnect()]);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
