#!/usr/bin/env node
/* eslint-disable no-console */
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
require("reflect-metadata");

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
  const { CatalogService } = require(path.join(DIST_ROOT, "catalog", "catalog.service.js"));
  const { CatalogController } = require(path.join(DIST_ROOT, "catalog", "catalog.controller.js"));
  const { ROLES_KEY } = require(path.join(DIST_ROOT, "common", "rbac", "roles.js"));
  const { runWithTenantContext } = require(path.join(DIST_ROOT, "common", "tenant", "tenant-context.js"));

  const prisma = new PrismaService();
  const auditEvents = [];
  const catalogService = new CatalogService(
    prisma,
    {
      validateAndPersistProduct: async () => ({ productId: null, errorCount: 0, warningCount: 0, issues: [] }),
    },
    {
      touchUsageForCurrentTenant: async () => undefined,
    },
    {
      record: async (event) => {
        auditEvents.push(event);
      },
    },
    {
      emitApprovalDecision: async () => undefined,
      retargetProductNotifications: async () => undefined,
    },
    {
      assertProductAccess: async () => undefined,
      assertRequestedProductScopeAllowed: async () => undefined,
      assertProductAttributeWriteAllowed: async () => undefined,
    },
    createCacheStub(),
  );

  const runId = Date.now().toString();
  const tenantKey = `workflow-sla-${runId}`;
  const categoryId = randomUUID();
  const productId = randomUUID();
  const adminActor = { id: `admin-${runId}`, role: "admin", tenantId: tenantKey };
  const editorActor = { id: `editor-${runId}`, role: "editor", tenantId: tenantKey };
  const reviewerActor = { id: `reviewer-${runId}`, role: "reviewer", tenantId: tenantKey };

  try {
    await runWithTenantContext(tenantKey, async () => {
      const tenantPrisma = prisma.tenant(tenantKey);
      await tenantPrisma.category.create({
        data: {
          id: categoryId,
          tenantKey,
          name: `Workflow Category ${runId}`,
          slug: `workflow-category-${runId}`.slice(0, 60),
          path: `Workflow Category ${runId}`,
        },
      });

      await tenantPrisma.product.create({
        data: {
          id: productId,
          tenantKey,
          title: `Workflow Product ${runId}`,
          description: "workflow collab test",
          brand: "Vexa PIM",
          categoryId,
          status: "draft",
          version: 1,
          attributes: {},
          hsnCode: "62046200",
          gstRate: 18,
        },
      });

      const routeRoles = Reflect.getMetadata(ROLES_KEY, CatalogController.prototype.upsertWorkflowSla) ?? [];
      assert.deepEqual(routeRoles, ["admin"], "workflow SLA upsert route must remain admin-only");

      const slaUpsert = await catalogService.upsertWorkflowSla(5, adminActor);
      assert.equal(slaUpsert.reviewTargetDays, 5, "workflow SLA upsert should persist reviewTargetDays");

      const slaGet = await catalogService.getWorkflowSla(adminActor);
      assert.equal(slaGet.reviewTargetDays, 5, "workflow SLA read should return the persisted configuration");

      const overdueBefore = await catalogService.getOverdueProductCount(adminActor);
      assert.equal(typeof overdueBefore.count, "number", "overdue count should return a numeric count");
      assert.equal(typeof overdueBefore.asOf, "string", "overdue count should return an asOf timestamp");
      assert.equal(overdueBefore.count, 0, "overdue count should be zero before the review transition");

      const assigned = await catalogService.assignProduct(productId, editorActor.id, adminActor);
      assert.equal(assigned.assigneeId, editorActor.id, "assignProduct should set the assignee");

      const unassigned = await catalogService.assignProduct(productId, null, adminActor);
      assert.equal(unassigned.assigneeId, null, "assignProduct should clear the assignee");

      const toReview = await catalogService.updateProduct(
        productId,
        {
          expectedVersion: 1,
          status: "in_review",
        },
        editorActor,
      );
      assert.equal(toReview.status, "in_review", "updateProduct should transition the product to in_review");

      const reviewedProduct = await tenantPrisma.product.findUniqueOrThrow({
        where: { id: productId },
        select: {
          version: true,
          slaDeadlineAt: true,
          status: true,
        },
      });
      assert.equal(reviewedProduct.version, 2, "updateProduct should increment the version on transition");
      assert(reviewedProduct.slaDeadlineAt instanceof Date, "in_review transition should set slaDeadlineAt");
      const deadlineMs = reviewedProduct.slaDeadlineAt.getTime();
      const expectedDeadlineMs = Date.now() + 5 * 24 * 60 * 60 * 1000;
      assert(
        Math.abs(deadlineMs - expectedDeadlineMs) < 60_000,
        `slaDeadlineAt should be approximately five days out; got ${reviewedProduct.slaDeadlineAt.toISOString()}`,
      );

      const changeRequest = await catalogService.requestChanges(
        productId,
        "Please fix the product description — missing key details.",
        reviewerActor,
      );
      assert.equal(changeRequest.status, "open", "requestChanges should create an open change request");
      assert.equal(
        changeRequest.reason,
        "Please fix the product description — missing key details.",
        "requestChanges should persist the supplied reason",
      );

      const changeRequestsForAdmin = await catalogService.listChangeRequests(productId, adminActor);
      const changeRequestsForEditor = await catalogService.listChangeRequests(productId, editorActor);
      const changeRequestsForReviewer = await catalogService.listChangeRequests(productId, reviewerActor);
      assert(changeRequestsForAdmin.some((request) => request.id === changeRequest.id), "admin should see the change request");
      assert(changeRequestsForEditor.some((request) => request.id === changeRequest.id), "editor should see the change request");
      assert(changeRequestsForReviewer.some((request) => request.id === changeRequest.id), "reviewer should see the change request");

      const resolved = await catalogService.resolveChangeRequest(changeRequest.id, adminActor);
      assert.equal(resolved.status, "resolved", "resolveChangeRequest should mark the request resolved");

      const changeRequestsAfterResolve = await catalogService.listChangeRequests(productId, adminActor);
      const resolvedRequest = changeRequestsAfterResolve.find((request) => request.id === changeRequest.id);
      assert(resolvedRequest, "resolved change request should remain visible in history");
      assert.equal(resolvedRequest.status, "resolved", "resolved change request should report resolved status");

      const overdueAfter = await catalogService.getOverdueProductCount(adminActor);
      assert.equal(overdueAfter.count, 0, "future in-review deadline must not count as overdue");

      const recordedActions = auditEvents.map((event) => event.action);
      assert(recordedActions.includes("PRODUCT_ASSIGNED"), "assignProduct should record PRODUCT_ASSIGNED");
      assert(recordedActions.includes("PRODUCT_UNASSIGNED"), "unassignProduct should record PRODUCT_UNASSIGNED");
      assert(recordedActions.includes("PRODUCT_UPDATED"), "updateProduct should record PRODUCT_UPDATED");
      assert(recordedActions.includes("STATUS_TRANSITION"), "updateProduct should record STATUS_TRANSITION");
      assert(recordedActions.includes("CHANGE_REQUEST_CREATED"), "requestChanges should record CHANGE_REQUEST_CREATED");
      assert(recordedActions.includes("CHANGE_REQUEST_RESOLVED"), "resolveChangeRequest should record CHANGE_REQUEST_RESOLVED");
    });

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantKey,
          validated: [
            "rg_c5_sla_route_remains_admin_only",
            "rg_c5_sla_upsert_returns_correct_days",
            "rg_c5_sla_get_returns_config",
            "rg_c5_overdue_count_zero_before_review",
            "rg_c5_assignee_set_and_cleared",
            "rg_c5_transition_to_in_review_sets_sla_deadline",
            "rg_c5_sla_deadline_is_5_days_from_now",
            "rg_c5_change_request_create_open",
            "rg_c5_change_request_list_readable_by_all_roles",
            "rg_c5_change_request_resolve",
            "rg_c5_overdue_count_zero_for_future_deadline",
            "rg_c5_workflow_actions_preserve_audit_events",
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
  console.error("[workflow-collab-sla.test] FAILED");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
