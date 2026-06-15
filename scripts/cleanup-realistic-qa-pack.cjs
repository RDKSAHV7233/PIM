#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const helper = require("../apps/web/test/e2e/helpers/vexa-pim.cjs");
const { PrismaClient } = require("@prisma/client");
const { GENERATED_DIR } = require("./lib/realistic-qa-pack.cjs");
const {
  getCategoryOwnership,
  hasExplicitCategoryOwnership,
  sortCategoriesForDeletion,
} = require("./lib/realistic-qa-pack-runtime.cjs");
const { cleanupExistingDataset } = require("./seed-realistic-qa-pack-db.cjs");

const RUNTIME_MANIFEST_PATH = path.join(GENERATED_DIR, "runtime-manifest.json");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const [flag, inlineValue] = token.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      args[flag] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[flag] = next;
      index += 1;
    } else {
      args[flag] = true;
    }
  }
  return args;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function safeDeleteProduct(adminToken, productId, apiUrl) {
  try {
    await helper.deleteProduct(adminToken, productId, apiUrl);
  } catch (error) {
    if (!String(error instanceof Error ? error.message : error).includes("404")) {
      throw error;
    }
  }

  try {
    await helper.purgeProduct(adminToken, productId, apiUrl);
  } catch (error) {
    if (!String(error instanceof Error ? error.message : error).includes("404")) {
      throw error;
    }
  }
}

async function safeDeleteAttributeDefinition(adminToken, attributeDefinitionId, apiUrl) {
  try {
    await helper.apiRequest(
      "DELETE",
      `/taxonomy/categories/attributes/${encodeURIComponent(attributeDefinitionId)}`,
      adminToken,
      undefined,
      apiUrl,
    );
  } catch (error) {
    if (!String(error instanceof Error ? error.message : error).includes("404")) {
      throw error;
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runtimeManifestPath = args["runtime-manifest"]
    ? path.resolve(process.cwd(), String(args["runtime-manifest"]))
    : RUNTIME_MANIFEST_PATH;

  if (!fs.existsSync(runtimeManifestPath)) {
    console.error(`Runtime manifest not found: ${runtimeManifestPath}`);
    process.exit(1);
  }

  const runtimeManifest = readJsonFile(runtimeManifestPath);
  if (runtimeManifest.mode === "db") {
    const prisma = new PrismaClient();
    try {
      await prisma.$connect();
      const tenantKey = runtimeManifest.tenantKey || "default";
      const cleanupSummary = await cleanupExistingDataset(prisma, tenantKey, runtimeManifestPath);

      const cleanupReportPath = runtimeManifestPath.replace(/\.json$/i, ".cleanup.json");
      fs.writeFileSync(
        cleanupReportPath,
        JSON.stringify(
          {
            status: "ok",
            mode: "db",
            datasetId: runtimeManifest.datasetId,
            tenantKey,
            cleanedAt: new Date().toISOString(),
            deletedProductCount: cleanupSummary.deletedProductIds.length,
            deletedCategoryCount: cleanupSummary.deletedCategoryIds.length,
            deletedAttributeDefinitionCount: cleanupSummary.deletedAttributeDefinitionIds.length,
            skippedCategoryCleanup: cleanupSummary.skippedCategoryCleanup,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      fs.unlinkSync(runtimeManifestPath);
      console.log(
        JSON.stringify(
          {
            status: "ok",
            mode: "db",
            cleanupReportPath,
            deletedProductCount: cleanupSummary.deletedProductIds.length,
            deletedCategoryCount: cleanupSummary.deletedCategoryIds.length,
            deletedAttributeDefinitionCount: cleanupSummary.deletedAttributeDefinitionIds.length,
            skippedCategoryCleanup: cleanupSummary.skippedCategoryCleanup,
          },
          null,
          2,
        ),
      );
      return;
    } finally {
      await prisma.$disconnect();
    }
  }

  const apiUrl = String(args["api-url"] || runtimeManifest.apiUrl || process.env.QA_DATASET_API_URL || helper.DEFAULT_API_URL);
  const adminToken = await helper.apiLogin("admin", apiUrl, runtimeManifest.tenantKey || "default");

  const deletedProducts = [];
  const productFailures = [];
  for (const product of runtimeManifest.products ?? []) {
    try {
      await safeDeleteProduct(adminToken, product.id, apiUrl);
      deletedProducts.push({ id: product.id, title: product.title });
    } catch (error) {
      productFailures.push({
        id: product.id,
        title: product.title,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const attributeDefinitionIds = Array.isArray(runtimeManifest.createdAttributeDefinitionIds)
    ? runtimeManifest.createdAttributeDefinitionIds
    : Array.isArray(runtimeManifest.createdAttributeDefinitions)
      ? runtimeManifest.createdAttributeDefinitions.map((definition) => definition.id).filter(Boolean)
      : [];
  const deletedAttributeDefinitions = [];
  const attributeDefinitionFailures = [];
  for (const attributeDefinitionId of attributeDefinitionIds) {
    try {
      await safeDeleteAttributeDefinition(adminToken, attributeDefinitionId, apiUrl);
      deletedAttributeDefinitions.push(attributeDefinitionId);
    } catch (error) {
      attributeDefinitionFailures.push({
        id: attributeDefinitionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const ownership = getCategoryOwnership(runtimeManifest);
  const categories = hasExplicitCategoryOwnership(runtimeManifest)
    ? sortCategoriesForDeletion(ownership.createdCategories)
    : [];
  const categoryOwnershipGuard = hasExplicitCategoryOwnership(runtimeManifest)
    ? null
    : "Category ownership metadata is missing; cleanup refused to delete any categories.";

  const deletedCategories = [];
  const categoryFailures = [];
  if (categoryOwnershipGuard) {
    categoryFailures.push({
      id: null,
      path: null,
      error: categoryOwnershipGuard,
    });
  } else {
    for (const category of categories) {
      try {
        await helper.deleteCategory(adminToken, category.id, apiUrl);
        deletedCategories.push({ id: category.id, path: category.path });
      } catch (error) {
        categoryFailures.push({
          id: category.id,
          path: category.path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const cleanupReport = {
    datasetId: runtimeManifest.datasetId,
    tenantKey: runtimeManifest.tenantKey,
    apiUrl,
    cleanedAt: new Date().toISOString(),
    deletedProducts,
    deletedAttributeDefinitions,
    deletedCategories,
    productFailures,
    attributeDefinitionFailures,
    categoryFailures,
    categoryOwnershipGuard,
    retainedOpsWarning:
      runtimeManifest.options?.withOps === true
        ? "Bulk edit and import-job records do not have full delete support in the current API and may remain."
        : null,
  };

  const cleanupReportPath = runtimeManifestPath.replace(/\.json$/i, ".cleanup.json");
  fs.writeFileSync(cleanupReportPath, JSON.stringify(cleanupReport, null, 2) + "\n", "utf8");

  if (productFailures.length === 0 && attributeDefinitionFailures.length === 0 && categoryFailures.length === 0) {
    fs.unlinkSync(runtimeManifestPath);
  }

  console.log(
    JSON.stringify(
      {
        status:
          productFailures.length === 0 &&
          attributeDefinitionFailures.length === 0 &&
          categoryFailures.length === 0
            ? "ok"
            : "partial",
        cleanupReportPath,
        deletedProductCount: deletedProducts.length,
        deletedAttributeDefinitionCount: deletedAttributeDefinitions.length,
        deletedCategoryCount: deletedCategories.length,
        productFailureCount: productFailures.length,
        attributeDefinitionFailureCount: attributeDefinitionFailures.length,
        categoryFailureCount: categoryFailures.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("Realistic QA pack cleanup failed:");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
