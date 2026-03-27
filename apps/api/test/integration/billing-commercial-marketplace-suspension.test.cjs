#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const DIST_APP_MODULE = path.join(REPO_ROOT, "apps", "api", "dist", "app.module.js");

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
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (databaseUrl) {
    setDefaultEnv("DATABASE_URL_POOLED", databaseUrl);
    setDefaultEnv("DATABASE_URL_DIRECT", databaseUrl);
  }
  setDefaultEnv("AUTH_MODE", "db");
  process.env.PIM_AUTH_IDENTITIES_JSON = "";
  process.env.PIM_AUTH_WORKSPACES_JSON = "";
  setDefaultEnv("JWT_SECRET", "tej-pim-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "tej-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  if (!fs.existsSync(DIST_APP_MODULE)) {
    throw new Error(`API build output not found at ${DIST_APP_MODULE}. Run: npm run build --workspace @pim1/api`);
  }

  prepareEnv();
  const runId = Date.now().toString();
  const tenantKey = `billing-mkt-suspend-${runId}`;
  const workspaceSlug = `bms-${runId}`.slice(0, 24);
  const adminUserId = `admin-${runId}@example.com`;

  const { NestFactory } = require("@nestjs/core");
  const { AppModule } = require(DIST_APP_MODULE);
  const { PrismaService } = require(path.join(REPO_ROOT, "apps", "api", "dist", "prisma", "prisma.service.js"));
  const { TenantDirectoryService } = require(
    path.join(REPO_ROOT, "apps", "api", "dist", "common", "tenant", "tenant-directory.service.js"),
  );
  const { PlanUsageService } = require(
    path.join(REPO_ROOT, "apps", "api", "dist", "billing", "plan-usage.service.js"),
  );
  const { MarketplaceService } = require(
    path.join(REPO_ROOT, "apps", "api", "dist", "marketplace", "marketplace.service.js"),
  );
  const { ExportJobStatus } = require("@prisma/client");
  const { runWithTenantContext } = require(
    path.join(REPO_ROOT, "apps", "api", "dist", "common", "tenant", "tenant-context.js"),
  );

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    const prisma = app.get(PrismaService);
    const tenantDirectoryService = app.get(TenantDirectoryService);
    const planUsageService = app.get(PlanUsageService);
    const marketplaceService = app.get(MarketplaceService);

    await tenantDirectoryService.provisionWorkspace({
      tenantKey,
      workspaceSlug,
      displayName: `Billing Marketplace Suspension ${runId}`,
      initialAdminUserId: adminUserId,
    });

    const category = await prisma.tenant(tenantKey).category.create({
      data: {
        tenantKey,
        name: `Marketplace Suspension Category ${runId}`,
        slug: `marketplace-suspension-${runId}`.slice(0, 60),
        path: `Marketplace Suspension Category ${runId}`,
      },
    });

    const product = await prisma.tenant(tenantKey).product.create({
      data: {
        tenantKey,
        title: `Marketplace Suspension Product ${runId}`,
        description: "Deterministic product for suspension worker validation",
        brand: "TEJ PIM",
        categoryId: category.id,
        status: "draft",
        hsnCode: "62046200",
        gstRate: 18,
        attributes: {
          color: "black",
          size: "M",
        },
      },
    });

    const job = await prisma.tenant(tenantKey).marketplaceExportJob.create({
      data: {
        tenantKey,
        createdBy: adminUserId,
        productId: product.id,
        categoryId: category.id,
        channel: "flipkart",
        status: ExportJobStatus.queued,
        retryCount: 0,
        maxRetries: 3,
        payload: {
          mappingSource: "system_pack",
        },
      },
      include: { template: true },
    });

    const suspendedProfile = await planUsageService.updateCommercialStateForTenant(
      tenantKey,
      {
        accessStatus: "suspended",
        suspensionReason: "non_payment",
      },
      "ops-commercial",
    );
    assert(suspendedProfile.accessStatus === "suspended", "tenant should be suspended before marketplace processing");

    const skippedResult = await runWithTenantContext(tenantKey, () => marketplaceService.processExportJob(job.id));
    assert(skippedResult.status === "skipped", `expected skipped export job while suspended, got ${String(skippedResult.status)}`);
    assert(
      String(skippedResult.failureReason ?? "") === "tenant_suspended",
      `expected tenant_suspended failure reason, got ${String(skippedResult.failureReason ?? "")}`,
    );

    const skippedRow = await prisma.tenant(tenantKey).marketplaceExportJob.findUnique({
      where: { id: job.id },
      select: {
        status: true,
        failureReason: true,
        dlqReason: true,
        exportPayload: true,
      },
    });
    assert(skippedRow?.status === "skipped", "skipped export job row should persist skipped status");
    assert(skippedRow?.failureReason === "tenant_suspended", "skipped export job row should persist tenant_suspended");
    assert(skippedRow?.dlqReason === null, "skipped export job should not move to DLQ");
    assert(skippedRow?.exportPayload === null, "skipped export job should not write export payload");

    const resumedProfile = await planUsageService.updateCommercialStateForTenant(
      tenantKey,
      {
        accessStatus: "active",
      },
      "ops-commercial",
    );
    assert(resumedProfile.accessStatus === "active", "tenant should resume before second marketplace processing pass");

    await prisma.tenant(tenantKey).product.update({
      where: { id: product.id },
      data: {
        deletedAt: new Date(),
      },
    });

    const failedResult = await runWithTenantContext(tenantKey, () => marketplaceService.processExportJob(job.id));
    assert(failedResult.status === "failed", `expected failed export job after resume, got ${String(failedResult.status)}`);
    assert(
      String(failedResult.failureReason ?? "").toLowerCase().includes("product not found"),
      `expected post-resume failure reason to include product not found, got ${String(failedResult.failureReason ?? "")}`,
    );

    const failedRow = await prisma.tenant(tenantKey).marketplaceExportJob.findUnique({
      where: { id: job.id },
      select: {
        status: true,
        failureReason: true,
        exportPayload: true,
      },
    });
    assert(failedRow?.status === "failed", "resumed export job should leave skipped state and become failed");
    assert(
      String(failedRow?.failureReason ?? "").toLowerCase().includes("product not found"),
      "resumed export job should follow the normal failure path",
    );
    assert(failedRow?.exportPayload === null, "failed export job should not keep export payload");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantKey,
          jobId: job.id,
          validated: [
            "suspended_marketplace_export_job_is_marked_skipped",
            "skipped_marketplace_export_job_persists_tenant_suspended_reason",
            "resumed_marketplace_export_job_reenters_normal_processing_path",
            "post_resume_marketplace_export_job_no_longer_stays_skipped",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close().catch(() => undefined);
  }
}

run().catch((error) => {
  console.error("Billing commercial marketplace suspension integration test failed:");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
