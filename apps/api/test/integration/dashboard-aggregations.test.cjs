#!/usr/bin/env node
/* eslint-disable no-console */
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const DIST_ROOT = path.join(REPO_ROOT, "apps", "api", "dist");

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || /^\s*#/.test(line)) {
      continue;
    }
    const idx = line.indexOf("=");
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function setDefaultEnv(name, value) {
  if (!process.env[name] || String(process.env[name]).trim().length === 0) {
    process.env[name] = value;
  }
}

function prepareEnv() {
  readEnvFile(path.join(REPO_ROOT, ".env"));
  const localDatabaseUrl = "postgresql://postgres:postgres@localhost:5432/pim1?schema=public";
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl || /HOST:5432/i.test(databaseUrl)) {
    process.env.DATABASE_URL = localDatabaseUrl;
  }
  if (!process.env.DATABASE_URL_POOLED || /HOST:5432/i.test(String(process.env.DATABASE_URL_POOLED))) {
    process.env.DATABASE_URL_POOLED = process.env.DATABASE_URL;
  }
  if (!process.env.DATABASE_URL_DIRECT || /HOST:5432/i.test(String(process.env.DATABASE_URL_DIRECT))) {
    process.env.DATABASE_URL_DIRECT = process.env.DATABASE_URL;
  }
  setDefaultEnv("AUTH_MODE", "local");
  setDefaultEnv("JWT_SECRET", "vexa-pim-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "vexa-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("PIM_DEFAULT_ROLE", "admin");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
  setDefaultEnv("DASHBOARD_CACHE_REDIS_DISABLED", "true");
}

function createCacheStub() {
  return {
    get: async () => null,
    set: async () => undefined,
    delete: async () => undefined,
  };
}

async function run() {
  prepareEnv();

  const { PrismaService } = require(path.join(DIST_ROOT, "prisma", "prisma.service.js"));
  const { DashboardService } = require(path.join(DIST_ROOT, "dashboard", "dashboard.service.js"));
  const { TaxonomyService } = require(path.join(DIST_ROOT, "taxonomy", "taxonomy.service.js"));
  const { MarketplaceService } = require(path.join(DIST_ROOT, "marketplace", "marketplace.service.js"));
  const { runWithTenantContext } = require(path.join(DIST_ROOT, "common", "tenant", "tenant-context.js"));

  const runId = Date.now().toString();
  const tenantKey = `dashboard-agg-${runId}`;
  const categoryId = randomUUID();
  const lowProductId = randomUUID();
  const highProductId = randomUUID();
  const connectorId = randomUUID();
  const installationId = randomUUID();
  const exportJobId = randomUUID();

  const prisma = new PrismaService();
  const metricsService = {
    emit: async () => undefined,
  };
  const dashboardService = new DashboardService(prisma, metricsService);
  const taxonomyService = new TaxonomyService(
    prisma,
    {
      buildCategoryScopeWhere: async () => undefined,
    },
    createCacheStub(),
  );
  const marketplaceService = new MarketplaceService(
    prisma,
    { getCurrentTenantKey: () => tenantKey },
    {},
    {},
    {},
    metricsService,
    {},
    {},
    { info() {}, warn() {}, error() {}, debug() {} },
    {},
    {},
  );

  try {
    await runWithTenantContext(tenantKey, async () => {
      const tenantPrisma = prisma.tenant(tenantKey);
      const connectorSlug = `diag-${runId}`.slice(0, 40);

      await tenantPrisma.connectorDefinition.create({
        data: {
          id: connectorId,
          slug: connectorSlug,
          displayName: "Dashboard Diagnostics",
          authType: "api_key",
          capabilities: ["listing_create"],
          connectorVersion: "1.0.0",
          isActive: true,
        },
      });

      await tenantPrisma.category.create({
        data: {
          id: categoryId,
          tenantKey,
          name: `Dashboard Category ${runId}`,
          slug: `dashboard-category-${runId}`.slice(0, 60),
          path: `Dashboard Category ${runId}`,
        },
      });

      await tenantPrisma.attributeDefinition.create({
        data: {
          categoryId,
          key: "material",
          name: "Material",
          dataType: "text",
          required: true,
          appliesTo: "product",
        },
      });

      await tenantPrisma.product.create({
        data: {
          id: lowProductId,
          tenantKey,
          title: `Dashboard Low ${runId}`,
          description: "",
          brand: "Vexa PIM",
          categoryId,
          status: "in_review",
          version: 1,
          attributes: {},
          hsnCode: null,
          gstRate: null,
        },
      });

      await tenantPrisma.product.create({
        data: {
          id: highProductId,
          tenantKey,
          title: `Dashboard High ${runId}`,
          description: "Complete product",
          brand: "Vexa PIM",
          categoryId,
          status: "approved",
          version: 1,
          attributes: {
            material: "cotton",
            color: "black",
            mainImageUrl: "https://example.com/high-product.png",
          },
          hsnCode: "62046200",
          gstRate: 18,
        },
      });

      await tenantPrisma.mediaAsset.create({
        data: {
          id: randomUUID(),
          tenantKey,
          productId: highProductId,
          variantId: null,
          entityType: "product",
          fileName: "high-product.png",
          mimeType: "image/png",
          storagePath: `tests/${runId}/high-product.png`,
          width: 1200,
          height: 1200,
          sizeBytes: 1024,
          checksum: `checksum-${runId}`,
          metadata: {},
        },
      });

      await tenantPrisma.validationIssue.create({
        data: {
          productId: lowProductId,
          ruleId: null,
          severity: "error",
          ruleCode: "MATERIAL_REQUIRED",
          message: "Material is required",
          fieldPath: "attributes.material",
          status: "open",
        },
      });

      await tenantPrisma.connectorInstallation.create({
        data: {
          id: installationId,
          tenantKey,
          connectorId,
          accountAlias: "primary",
          status: "ACTIVE",
          metadata: {},
          installedBy: "dashboard-test",
        },
      });

      await tenantPrisma.connectorSubmission.createMany({
        data: [
          {
            id: randomUUID(),
            tenantKey,
            installationId,
            productId: highProductId,
            variantId: null,
            idempotencyKey: `success-${runId}`,
            submissionType: "publish",
            source: "dashboard-test",
            attemptNumber: 1,
            status: "SUCCESS",
            payloadSnapshot: {},
          },
          {
            id: randomUUID(),
            tenantKey,
            installationId,
            productId: lowProductId,
            variantId: null,
            idempotencyKey: `pending-${runId}`,
            submissionType: "publish",
            source: "dashboard-test",
            attemptNumber: 1,
            status: "PENDING",
            payloadSnapshot: {},
          },
          {
            id: randomUUID(),
            tenantKey,
            installationId,
            productId: lowProductId,
            variantId: null,
            idempotencyKey: `error-${runId}`,
            submissionType: "publish",
            source: "dashboard-test",
            attemptNumber: 2,
            status: "ERROR",
            payloadSnapshot: {},
          },
        ],
      });

      await tenantPrisma.marketplaceExportJob.create({
        data: {
          id: exportJobId,
          tenantKey,
          createdBy: "dashboard-test",
          productId: highProductId,
          categoryId,
          channel: connectorSlug,
          status: "dead_letter",
          retryCount: 2,
          maxRetries: 3,
          payload: {},
        },
      });

      const readiness1 = await dashboardService.getReadiness();
      const readiness2 = await dashboardService.getReadiness();
      assert.equal(readiness2.asOf, readiness1.asOf, "readiness cache should preserve asOf within TTL");
      assert(Array.isArray(readiness1.connectors), "readiness.connectors must be an array");
      const readinessRow = readiness1.connectors.find((connector) => connector.slug === connectorSlug);
      assert(readinessRow, "readiness must include the seeded connector row");
      assert.equal(readinessRow.ready, 1, "readiness.ready should count successful submissions");
      assert.equal(readinessRow.blocked, 1, "readiness.blocked should count error submissions");
      assert.equal(readinessRow.pending, 1, "readiness.pending should count pending submissions");

      const connectorInstallationsHealth = await dashboardService.getConnectorInstallationsHealth();
      assert(Array.isArray(connectorInstallationsHealth.connectors), "connector health connectors must be an array");
      assert(Array.isArray(connectorInstallationsHealth.installations), "connector health installations must be an array");
      const installationRow = connectorInstallationsHealth.installations.find(
        (row) => row.installationId === installationId,
      );
      assert(installationRow, "connector health must include the seeded installation");
      assert.equal(installationRow.ready, 1, "installation ready count should be installation-scoped");
      assert.equal(installationRow.blocked, 1, "installation blocked count should be installation-scoped");
      assert.equal(installationRow.pending, 1, "installation pending count should be installation-scoped");

      const connectorSummary = await dashboardService.getConnectorSummary();
      assert(Array.isArray(connectorSummary.connectors), "connector summary connectors must be an array");
      assert.equal(connectorSummary.totals.ready, 1, "connector summary totals.ready must match seeded truth");
      assert.equal(connectorSummary.totals.blocked, 1, "connector summary totals.blocked must match seeded truth");
      assert.equal(connectorSummary.totals.pending, 1, "connector summary totals.pending must match seeded truth");
      assert.equal(connectorSummary.totals.installations, 1, "connector summary totals.installations must match seeded truth");

      const categoryCounts = await taxonomyService.listCategoryCounts({
        id: "dashboard-admin",
        role: "admin",
        tenantId: tenantKey,
      });
      const categoryCountRow = categoryCounts.find((row) => row.categoryId === categoryId);
      assert(categoryCountRow, "category counts must include the seeded category");
      assert.equal(categoryCountRow.productCount, 2, "category productCount must match seeded products");

      const submissionCount = await marketplaceService.countSubmissions({ installationId });
      assert.equal(submissionCount.count, 3, "submission count must match installation-scoped DB truth");

      const catalogHealth1 = await dashboardService.getCatalogHealth();
      const catalogHealth2 = await dashboardService.getCatalogHealth();
      assert.equal(catalogHealth2.asOf, catalogHealth1.asOf, "catalog-health cache should preserve asOf within TTL");
      assert.equal(catalogHealth1.belowThreshold, 1, "catalog-health belowThreshold must include the incomplete product");
      assert.equal(catalogHealth1.missingMainImage, 1, "catalog-health missingMainImage must reflect seeded media truth");
      assert.equal(catalogHealth1.missingRequiredAttrs, 1, "catalog-health missingRequiredAttrs must reflect seeded attribute truth");

      const dashboardHealth = await dashboardService.getHealth();
      assert.equal(typeof dashboardHealth.asOf, "string", "dashboard health asOf must be a string");
      assert.equal(dashboardHealth.pendingApprovals, 1, "dashboard health pendingApprovals must count in-review products");
      assert.equal(dashboardHealth.snapshot.totalSkus, 2, "dashboard health snapshot.totalSkus must match seeded products");
      assert.equal(dashboardHealth.snapshot.openIssuesBlocking, 1, "dashboard health snapshot.openIssuesBlocking must match seeded issues");
      assert.equal(dashboardHealth.snapshot.publishReadyByConnector[connectorSlug], 1, "dashboard health snapshot ready totals must use connector truth");
      assert(Array.isArray(dashboardHealth.trend) && dashboardHealth.trend.length >= 1, "dashboard health trend must be populated");

      const operations1 = await dashboardService.getOperationsSummary();
      const operations2 = await dashboardService.getOperationsSummary();
      assert.equal(operations2.asOf, operations1.asOf, "operations summary cache should preserve asOf within TTL");
      assert.equal(operations1.activeConnectors, 1, "operations summary activeConnectors must match seeded installation truth");
      assert.equal(operations1.installedConnectors, 1, "operations summary installedConnectors must match seeded installation truth");
      assert.equal(operations1.failedSubmissionJobs, 1, "operations summary failedSubmissionJobs must count error/rejected submissions");
      assert.equal(operations1.deadLetterJobs, 1, "operations summary deadLetterJobs must count dead-letter export jobs");
      assert.equal(
        operations1.jobsNeedingRetry,
        operations1.failedSubmissionJobs + operations1.deadLetterJobs,
        "operations summary jobsNeedingRetry must equal failed submissions plus dead-letter jobs",
      );
    });

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantKey,
          validated: [
            "dashboard_readiness_uses_installation_scoped_truth",
            "connector_installations_health_returns_installation_rows",
            "connector_summary_returns_canonical_totals",
            "taxonomy_category_counts_match_seeded_truth",
            "submission_count_matches_seeded_truth",
            "dashboard_catalog_health_uses_backend_truth",
            "dashboard_health_snapshot_and_trend_are_consistent",
            "dashboard_operations_summary_uses_canonical_counts",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.onModuleDestroy().catch(() => undefined);
  }
}

run().catch((error) => {
  console.error("Dashboard aggregations integration test failed:");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
