#!/usr/bin/env node
/* eslint-disable no-console */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DATASET_ID, buildPack } = require("./lib/realistic-qa-pack.cjs");
const { buildCategoryOwnership, getDatasetProductWhere } = require("./lib/realistic-qa-pack-runtime.cjs");
const {
  cleanupExistingDataset,
  createOptionalOpsArtifacts,
  maybeSeedControlPlane,
} = require("./seed-realistic-qa-pack-db.cjs");
const { applyEnvFile } = require("../apps/web/scripts/load-env.cjs");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "realistic-qa-pack-"));
}

function writeManifestFile(manifest) {
  const dir = tempDir();
  const manifestPath = path.join(dir, "runtime-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return manifestPath;
}

function createCleanupPrisma(options = {}) {
  const calls = [];
  const productRows = options.productRows ?? [{ id: "dataset-product-1", title: "Same Visible Title" }];
  const installationRows = options.installationRows ?? [{ id: "dataset-installation-1" }];

  function record(model, method, args) {
    calls.push({ model, method, args });
  }

  function model(name, handlers = {}) {
    return new Proxy(handlers, {
      get(target, prop) {
        if (prop in target) {
          return target[prop];
        }
        return async (args) => {
          record(name, String(prop), args);
          return {};
        };
      },
    });
  }

  return {
    calls,
    prisma: {
      connectorInstallation: model("connectorInstallation", {
        async findMany(args) {
          record("connectorInstallation", "findMany", args);
          return installationRows;
        },
      }),
      connectorCredential: model("connectorCredential"),
      connectorSubmission: model("connectorSubmission"),
      connectorProductSyncState: model("connectorProductSyncState"),
      connectorSyncSchedule: model("connectorSyncSchedule"),
      connectorProductLink: model("connectorProductLink"),
      connectorMappingVersion: model("connectorMappingVersion"),
      bulkEditOperation: model("bulkEditOperation"),
      bulkImportJob: model("bulkImportJob"),
      product: model("product", {
        async findMany(args) {
          record("product", "findMany", args);
          return productRows;
        },
      }),
      userNotification: model("userNotification"),
      approvalComment: model("approvalComment"),
      auditLog: model("auditLog"),
      mediaAsset: model("mediaAsset"),
      bulkEditOperationItem: model("bulkEditOperationItem"),
      marketplaceExportJob: model("marketplaceExportJob"),
      attributeDefinition: model("attributeDefinition"),
      category: model("category"),
    },
  };
}

function createControlPlanePrisma() {
  const calls = [];

  function record(model, method, args) {
    calls.push({ model, method, args });
  }

  return {
    calls,
    prisma: {
      workspaceDirectory: {
        async upsert(args) {
          record("workspaceDirectory", "upsert", args);
          return {};
        },
      },
      tenantPlanProfile: {
        async upsert(args) {
          record("tenantPlanProfile", "upsert", args);
          return {};
        },
      },
      workflowSla: {
        async upsert(args) {
          record("workflowSla", "upsert", args);
          return {};
        },
      },
      authIdentity: {
        async upsert(args) {
          record("authIdentity", "upsert", args);
          return {};
        },
      },
    },
  };
}

function createOpsPrisma() {
  const calls = [];

  function record(model, method, args) {
    calls.push({ model, method, args });
  }

  function model(name, handlers = {}) {
    return new Proxy(handlers, {
      get(target, prop) {
        if (prop in target) {
          return target[prop];
        }
        return async (args) => {
          record(name, String(prop), args);
          return {};
        };
      },
    });
  }

  return {
    calls,
    prisma: {
      connectorDefinition: model("connectorDefinition", {
        async upsert(args) {
          record("connectorDefinition", "upsert", args);
          return { id: "shopify-def", connectorVersion: "1.0.0" };
        },
      }),
      connectorInstallation: model("connectorInstallation", {
        async create(args) {
          record("connectorInstallation", "create", args);
          return { id: args.data.id };
        },
      }),
      connectorMappingVersion: model("connectorMappingVersion", {
        async create(args) {
          record("connectorMappingVersion", "create", args);
          return { id: args.data.id };
        },
      }),
      connectorSubmission: model("connectorSubmission", {
        async create(args) {
          record("connectorSubmission", "create", args);
          return { id: args.data.id };
        },
      }),
      bulkEditOperation: model("bulkEditOperation", {
        async create(args) {
          record("bulkEditOperation", "create", args);
          return { id: "bulk-edit-1" };
        },
      }),
      bulkEditOperationItem: model("bulkEditOperationItem", {
        async create(args) {
          record("bulkEditOperationItem", "create", args);
          return { id: `${args.data.productId}-item` };
        },
      }),
      bulkImportJob: model("bulkImportJob", {
        async create(args) {
          record("bulkImportJob", "create", args);
          return { id: "import-job-1" };
        },
      }),
      bulkImportRow: model("bulkImportRow", {
        async create(args) {
          record("bulkImportRow", "create", args);
          return { id: `${args.data.rowNumber}` };
        },
      }),
      userNotification: model("userNotification", {
        async create(args) {
          record("userNotification", "create", args);
          return { id: args.data.id };
        },
      }),
    },
  };
}

async function testCleanupUsesDatasetMarkerAndOwnedCategories() {
  const ownership = buildCategoryOwnership(
    [
      { id: "cat-owned", path: "Apparel/Women/Kurtas", name: "Kurtas" },
      { id: "cat-reused", path: "Apparel/Men/Shirts", name: "Shirts" },
    ],
    ["cat-owned"],
  );
  const manifestPath = writeManifestFile({
    datasetId: DATASET_ID,
    createdCategories: ownership.createdCategories,
    reusedCategories: ownership.reusedCategories,
    createdCategoryIds: ownership.createdCategoryIds,
    reusedCategoryIds: ownership.reusedCategoryIds,
    createdAttributeDefinitionIds: ["attr-owned-1", "attr-owned-2"],
    ops: {
      bulkEdit: { operationIds: ["bulk-edit-1"] },
      importJob: { jobIds: ["import-job-1"] },
    },
    connectors: {
      installationIds: ["manifest-installation-1"],
      mappingVersionIds: ["mapping-1"],
    },
  });
  const { prisma, calls } = createCleanupPrisma();
  const result = await cleanupExistingDataset(prisma, "default", manifestPath);

  const productLookup = calls.find((call) => call.model === "product" && call.method === "findMany");
  assert.deepEqual(productLookup.args.where, getDatasetProductWhere("default", DATASET_ID));
  assert.equal("title" in productLookup.args.where, false, "cleanup must not search by title");

  const categoryDeletes = calls
    .filter((call) => call.model === "category" && call.method === "deleteMany")
    .map((call) => call.args.where.id);
  assert.deepEqual(categoryDeletes, ["cat-owned"]);

  const attributeDelete = calls.find((call) => call.model === "attributeDefinition" && call.method === "deleteMany");
  assert.deepEqual(attributeDelete.args.where.id.in, ["attr-owned-1", "attr-owned-2"]);

  const importDelete = calls.find((call) => call.model === "bulkImportJob" && call.method === "deleteMany");
  assert.deepEqual(importDelete.args.where.id.in, ["import-job-1"]);
  assert.equal(result.skippedCategoryCleanup, false);
}

async function testCleanupSkipsAmbiguousCategoryOwnership() {
  const manifestPath = writeManifestFile({
    datasetId: DATASET_ID,
    categories: [{ id: "legacy-cat", path: "Apparel/Legacy", name: "Legacy" }],
  });
  const { prisma, calls } = createCleanupPrisma({ productRows: [] });
  const result = await cleanupExistingDataset(prisma, "default", manifestPath);

  const categoryDeletes = calls.filter((call) => call.model === "category" && call.method === "deleteMany");
  assert.equal(categoryDeletes.length, 0);
  assert.equal(result.skippedCategoryCleanup, true);
}

async function testControlPlaneMutationsAreOptIn() {
  const disabled = await maybeSeedControlPlane({}, "default", { allowControlPlaneMutations: false });
  assert.deepEqual(disabled, { applied: false });

  const { prisma, calls } = createControlPlanePrisma();
  const enabled = await maybeSeedControlPlane(prisma, "default", { allowControlPlaneMutations: true });
  assert.deepEqual(enabled, { applied: true });
  assert.ok(calls.some((call) => call.model === "tenantPlanProfile"));
  assert.ok(calls.some((call) => call.model === "workflowSla"));
  assert.ok(calls.some((call) => call.model === "authIdentity"));
}

async function testOpsArtifactsAreExplicitOnly() {
  const pack = buildPack();
  const categoryByKey = new Map([["women-kurtas", { id: "cat-kurtas", path: "Apparel/Women/Kurtas" }]]);
  const approvedProducts = [{ id: "product-1" }, { id: "product-2" }];
  const bulkEditTargets = [
    { id: "product-3", brand: "Northline Apparel" },
    { id: "product-4", brand: "LittleOrbit" },
  ];

  const disabled = await createOptionalOpsArtifacts({
    prisma: new Proxy(
      {},
      {
        get() {
          throw new Error("ops models must not be touched when withOps=false");
        },
      },
    ),
    pack,
    tenantKey: "default",
    seedOptions: { withOps: false },
    categoryByKey,
    approvedProducts,
    bulkEditTargets,
  });
  assert.deepEqual(disabled, {
    connectorInstallationId: null,
    mappingVersionIds: [],
    submissionIds: [],
    bulkEditOperationIds: [],
    importJobIds: [],
  });

  const { prisma, calls } = createOpsPrisma();
  const enabled = await createOptionalOpsArtifacts({
    prisma,
    pack,
    tenantKey: "default",
    seedOptions: { withOps: true },
    categoryByKey,
    approvedProducts,
    bulkEditTargets,
  });
  assert.ok(enabled.connectorInstallationId);
  assert.equal(enabled.mappingVersionIds.length, 1);
  assert.equal(enabled.importJobIds.length, 1);
  assert.equal(enabled.bulkEditOperationIds.length, 1);
  assert.equal(enabled.submissionIds.length, 2);
  assert.ok(calls.some((call) => call.model === "connectorDefinition"));
  assert.ok(calls.some((call) => call.model === "bulkImportJob"));
}

function testSharedEnvLoaderUsesDotenvSemantics() {
  const dir = tempDir();
  const envPath = path.join(dir, ".env");
  const env = {};

  fs.writeFileSync(
    envPath,
    [
      'QUOTED_VALUE="value with spaces"',
      'INLINE_COMMENT="kept value" # comment should be ignored',
      "PLAIN_VALUE=plain",
      "",
    ].join("\n"),
    "utf8",
  );

  applyEnvFile(env, envPath);
  assert.equal(env.QUOTED_VALUE, "value with spaces");
  assert.equal(env.INLINE_COMMENT, "kept value");
  assert.equal(env.PLAIN_VALUE, "plain");
}

async function main() {
  await testCleanupUsesDatasetMarkerAndOwnedCategories();
  await testCleanupSkipsAmbiguousCategoryOwnership();
  await testControlPlaneMutationsAreOptIn();
  await testOpsArtifactsAreExplicitOnly();
  testSharedEnvLoaderUsesDotenvSemantics();

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "dataset_cleanup_uses_marker_not_title",
          "category_cleanup_deletes_owned_rows_only",
          "legacy_manifests_skip_unsafe_category_cleanup",
          "control_plane_mutations_are_opt_in",
          "ops_artifacts_require_explicit_flag",
          "shared_web_env_loader_uses_dotenv_parsing",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
