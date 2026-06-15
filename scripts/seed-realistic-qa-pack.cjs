#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const helper = require("../apps/web/test/e2e/helpers/vexa-pim.cjs");
const { buildPack, GENERATED_DIR } = require("./lib/realistic-qa-pack.cjs");
const { seedDirectQaPack } = require("./seed-realistic-qa-pack-db.cjs");
const { buildCategoryOwnership, normalizeSeedOptions } = require("./lib/realistic-qa-pack-runtime.cjs");

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

function ensureDir(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCollection(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.items)) {
    return payload.items;
  }
  return [];
}

function buildUpdatePayload(product, nextStatus) {
  return {
    expectedVersion: product.version,
    title: product.title,
    description: product.description,
    brand: product.brand,
    categoryId: product.categoryId,
    hsnCode: product.hsnCode ?? undefined,
    gstRate: product.gstRate ?? undefined,
    taxCodes: Array.isArray(product.taxCodes) ? product.taxCodes : undefined,
    attributes: product.attributes ?? {},
    status: nextStatus,
  };
}

async function listCategories(adminToken, apiUrl) {
  const payload = await helper.apiRequest("GET", "/taxonomy/categories?all=true&limit=500", adminToken, undefined, apiUrl);
  return normalizeCollection(payload);
}

async function ensureCategoryTree(pack, adminToken, apiUrl) {
  const existing = await listCategories(adminToken, apiUrl);
  const byPath = new Map(existing.map((category) => [String(category.path ?? ""), category]));
  const created = [];
  const reused = [];
  const keyToCategory = new Map();

  for (const category of pack.taxonomy) {
    const existingCategory = byPath.get(category.path);
    if (existingCategory) {
      keyToCategory.set(category.key, existingCategory);
      reused.push(existingCategory);
      continue;
    }

    const parentId = category.parentKey ? keyToCategory.get(category.parentKey)?.id : undefined;
    const createdCategory = await helper.createCategory(adminToken, category.name, parentId, apiUrl);
    keyToCategory.set(category.key, createdCategory);
    byPath.set(createdCategory.path, createdCategory);
    created.push(createdCategory);
  }

  return {
    created,
    reused,
    categories: pack.taxonomy.map((category) => {
      const resolved = keyToCategory.get(category.key) ?? byPath.get(category.path);
      if (!resolved) {
        throw new Error(`Unable to resolve category ${category.path}`);
      }
      return { key: category.key, id: resolved.id, path: resolved.path, name: resolved.name, parentId: resolved.parentId ?? null };
    }),
  };
}

async function ensureAttributeDefinitions(pack, categoryRows, adminToken, apiUrl) {
  const created = [];
  const existingByCategory = new Map();

  for (const category of categoryRows) {
    const definitions = await helper.apiRequest("GET", `/taxonomy/categories/${category.id}/attributes`, adminToken, undefined, apiUrl);
    existingByCategory.set(
      category.id,
      new Map(normalizeCollection(definitions).map((definition) => [`${definition.key}:${definition.appliesTo}`, definition])),
    );
  }

  for (const definition of pack.attributeDefinitions) {
    const category = categoryRows.find((row) => row.key === definition.categoryKey);
    if (!category) {
      throw new Error(`Missing category for attribute definition ${definition.key}`);
    }
    const existing = existingByCategory.get(category.id)?.get(`${definition.key}:${definition.appliesTo}`);
    if (existing) {
      continue;
    }
    const createdDefinition = await helper.apiRequest(
      "POST",
      `/taxonomy/categories/${category.id}/attributes`,
      adminToken,
      {
        key: definition.key,
        name: definition.name,
        dataType: definition.dataType,
        required: definition.required,
        appliesTo: definition.appliesTo,
        allowedValues: definition.allowedValues ?? {},
      },
      apiUrl,
    );
    created.push({
      categoryKey: category.key,
      categoryId: category.id,
      id: createdDefinition.id,
      key: createdDefinition.key,
      appliesTo: createdDefinition.appliesTo,
    });
  }

  return created;
}

async function fetchProduct(productId, token, apiUrl) {
  return helper.apiRequest("GET", `/catalog/products/${productId}`, token, undefined, apiUrl);
}

async function transitionProductToTarget(productDefinition, currentProduct, tokens, apiUrl) {
  const { editorToken, adminToken, reviewerToken } = tokens;

  if (productDefinition.status === "draft") {
    return currentProduct;
  }

  let product = currentProduct;
  if (product.status === "draft") {
    product = await helper.updateProduct(editorToken, product.id, buildUpdatePayload(product, "in_review"), apiUrl);
  }

  if (productDefinition.status === "in_review") {
    return product;
  }

  if (productDefinition.status === "rejected") {
    return helper.reviewProduct(reviewerToken, product.id, "rejected", "QA realistic data rejection scenario", apiUrl);
  }

  if (product.status === "in_review") {
    product = await helper.reviewProduct(reviewerToken, product.id, "approved", "QA realistic data approval scenario", apiUrl);
  }

  if (productDefinition.status === "approved") {
    return product;
  }

  if (productDefinition.status === "active") {
    const refreshed = await fetchProduct(product.id, adminToken, apiUrl);
    return helper.updateProduct(adminToken, refreshed.id, buildUpdatePayload(refreshed, "active"), apiUrl);
  }

  if (productDefinition.status === "archived") {
    const refreshed = await fetchProduct(product.id, adminToken, apiUrl);
    return helper.updateProduct(adminToken, refreshed.id, buildUpdatePayload(refreshed, "archived"), apiUrl);
  }

  return product;
}

async function applyPostSeedActions(productDefinition, product, tokens, apiUrl) {
  const actions = [];
  const requestedActions = Array.isArray(productDefinition.postSeedActions) ? productDefinition.postSeedActions : [];
  if (requestedActions.length === 0) {
    return actions;
  }

  for (const action of requestedActions) {
    if (action === "approval_comment") {
      const response = await helper.apiRequest(
        "POST",
        `/catalog/products/${product.id}/review-comments`,
        tokens.reviewerToken,
        { body: "QA pack note: ready for manual approvals and activity checks." },
        apiUrl,
      );
      actions.push({ type: action, id: response.id ?? null });
      continue;
    }

    if (action === "reviewer_change_request_open") {
      const response = await helper.apiRequest(
        "POST",
        `/catalog/products/${product.id}/change-requests`,
        tokens.reviewerToken,
        { reason: "QA pack request: confirm attribute and compliance completeness before approval." },
        apiUrl,
      );
      actions.push({ type: action, id: response.id ?? null });
      continue;
    }

    if (action === "reviewer_change_request_resolve") {
      const requests = await helper.apiRequest(
        "GET",
        `/catalog/products/${product.id}/change-requests`,
        tokens.adminToken,
        undefined,
        apiUrl,
      );
      const openRequest = normalizeCollection(requests).find((item) => !item.resolvedAt);
      if (openRequest?.id) {
        await helper.apiRequest(
          "POST",
          `/catalog/products/${product.id}/change-requests/${openRequest.id}/resolve`,
          tokens.adminToken,
          {},
          apiUrl,
        );
        actions.push({ type: action, id: openRequest.id });
      }
    }
  }

  return actions;
}

async function createProducts(pack, categoryRows, tokens, apiUrl) {
  const productResults = [];

  for (const productDefinition of pack.products) {
    const category = categoryRows.find((row) => row.key === productDefinition.categoryKey);
    if (!category) {
      throw new Error(`Missing category ${productDefinition.categoryKey} for product ${productDefinition.title}`);
    }

    console.log(`Seeding product: ${productDefinition.title}`);
    const created = await helper.createProduct(
      tokens.editorToken,
      {
        title: productDefinition.title,
        description: productDefinition.description,
        brand: productDefinition.brand,
        categoryId: category.id,
        status: "draft",
        hsnCode: productDefinition.hsnCode ?? undefined,
        gstRate: productDefinition.gstRate ?? undefined,
        taxCodes: Array.isArray(productDefinition.taxCodes) ? productDefinition.taxCodes : undefined,
        attributes: productDefinition.attributes,
      },
      apiUrl,
    );

    const variantResults = [];
    for (const variant of productDefinition.variants) {
      const createdVariant = await helper.apiRequest(
        "POST",
        `/catalog/products/${created.id}/variants`,
        tokens.editorToken,
        {
          skuCode: variant.skuCode,
          attributes: variant.attributes,
          mrp: variant.mrp,
          sellingPrice: variant.sellingPrice,
          inventoryQty: variant.inventoryQty,
          status: variant.status,
        },
        apiUrl,
      );
      variantResults.push({
        key: `${productDefinition.key}:${variant.key}`,
        id: createdVariant.id,
        skuCode: createdVariant.skuCode,
      });
    }

    const transitioned = await transitionProductToTarget(productDefinition, created, tokens, apiUrl);
    const actions = await applyPostSeedActions(productDefinition, transitioned, tokens, apiUrl);
    const activity = await helper.apiRequest("GET", `/catalog/products/${transitioned.id}/activity?limit=20`, tokens.adminToken, undefined, apiUrl);

    productResults.push({
      key: productDefinition.key,
      id: transitioned.id,
      title: transitioned.title,
      categoryId: transitioned.categoryId,
      status: transitioned.status,
      version: transitioned.version,
      variants: variantResults,
      postSeedActions: actions,
      activityTotal: Number(activity.total ?? 0),
    });
  }

  return productResults;
}

async function attemptBulkEdit(pack, productResults, adminToken, apiUrl) {
  const targets = ["sprig-uniform-twin-tee-pack", "northline-weekend-checked-shirt"]
    .map((key) => productResults.find((product) => product.key === key))
    .filter(Boolean);

  if (targets.length !== 2) {
    return { status: "skipped", reason: "bulk_edit_targets_missing" };
  }

  try {
    const response = await helper.apiRequest(
      "POST",
      "/bulk-edit/apply",
      adminToken,
      {
        scope: { productIds: targets.map((item) => item.id) },
        updates: { brand: "Vista Uniforms" },
      },
      apiUrl,
    );
    return {
      status: "created",
      operationId: response.id ?? null,
      scopeProductIds: targets.map((item) => item.id),
      response,
      warning: "Bulk edit mutates the seeded dataset and does not have a delete endpoint.",
    };
  } catch (error) {
    return {
      status: "blocked",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function attemptImportJob(pack, categoryRows, editorToken, apiUrl) {
  const category = categoryRows.find((row) => row.key === "women-kurtas");
  if (!category) {
    return { status: "blocked", reason: "women-kurtas category missing" };
  }

  const rows = pack.imports.mixedRows.map((row) => ({
    title: row.title,
    description: row.description,
    brand: row.brand,
    hsnCode: row.hsnCode || undefined,
    gstRate: row.gstRate === "" ? undefined : row.gstRate,
    skuCode: row.skuCode || undefined,
    status: row.status || undefined,
    attributes: (() => {
      try {
        return JSON.parse(String(row.attributes ?? "{}"));
      } catch {
        return {};
      }
    })(),
  }));

  try {
    const job = await helper.apiRequest(
      "POST",
      "/bulk-import/jobs",
      editorToken,
      {
        categoryId: category.id,
        sourceFormat: "json",
        sourceName: "Visible QA Mixed Import",
        rows,
        chunkSize: 5,
        maxRetries: 1,
      },
      apiUrl,
    );

    await helper.apiRequest(
      "POST",
      `/bulk-import/jobs/${job.id}/process`,
      editorToken,
      { chunkSize: 5 },
      apiUrl,
    );

    for (let attempt = 0; attempt < 15; attempt += 1) {
      await sleep(2000);
      const refreshed = await helper.apiRequest("GET", `/bulk-import/jobs/${job.id}`, editorToken, undefined, apiUrl);
      if (["completed", "failed", "dead_letter"].includes(String(refreshed.status))) {
        return {
          status: "processed",
          jobId: refreshed.id,
          jobStatus: refreshed.status,
          totalRows: refreshed.totalRows,
          failedRows: refreshed.failedRows,
          deadLetterRows: refreshed.deadLetterRows,
        };
      }
    }

    return {
      status: "queued_timeout",
      jobId: job.id,
      reason: "Bulk import worker did not complete within polling window.",
    };
  } catch (error) {
    return {
      status: "blocked",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function writeRuntimeManifest(manifestPath, payload) {
  ensureDir(path.dirname(manifestPath));
  fs.writeFileSync(manifestPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiUrl = String(args["api-url"] || process.env.QA_DATASET_API_URL || helper.DEFAULT_API_URL);
  const runtimeManifestPath = args["runtime-manifest"]
    ? path.resolve(process.cwd(), String(args["runtime-manifest"]))
    : RUNTIME_MANIFEST_PATH;
  const seedOptions = normalizeSeedOptions({
    withOps: args["with-ops"] === true,
    allowControlPlaneMutations:
      args["with-control-plane"] === true || String(process.env.QA_SEED_CONTROL_PLANE || "").toLowerCase() === "true",
  });

  if (args.reset) {
    console.error("Use `npm run qa:data:cleanup` before re-seeding. Automatic reset is intentionally blocked.");
    process.exit(1);
  }

  const pack = buildPack();
  const tokens = {
    adminToken: await helper.apiLogin("admin", apiUrl, pack.tenantKey),
    editorToken: await helper.apiLogin("editor", apiUrl, pack.tenantKey),
    reviewerToken: await helper.apiLogin("reviewer", apiUrl, pack.tenantKey),
  };

  let categoryResult;
  let createdAttributeDefinitions;
  let productResults;

  try {
    categoryResult = await ensureCategoryTree(pack, tokens.adminToken, apiUrl);
    createdAttributeDefinitions = await ensureAttributeDefinitions(pack, categoryResult.categories, tokens.adminToken, apiUrl);
    productResults = await createProducts(pack, categoryResult.categories, tokens, apiUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/fetch failed|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i.test(message)) {
      throw error;
    }
    const fallback = await seedDirectQaPack({
      runtimeManifestPath,
      withOps: seedOptions.withOps,
      allowControlPlaneMutations: seedOptions.allowControlPlaneMutations,
    });
    console.log(
      JSON.stringify(
        {
          status: "ok",
          mode: "db_fallback",
          reason: message,
          fallback,
        },
        null,
        2,
      ),
    );
    return;
  }

  const categoryOwnership = buildCategoryOwnership(
    categoryResult.categories,
    categoryResult.created.map((category) => category.id),
  );

  const runtimeManifest = {
    datasetId: pack.datasetId,
    tenantKey: pack.tenantKey,
    apiUrl,
    seededAt: new Date().toISOString(),
    options: {
      withOps: seedOptions.withOps,
      allowControlPlaneMutations: seedOptions.allowControlPlaneMutations,
    },
    resolvedCategories: categoryResult.categories,
    createdCategories: categoryOwnership.createdCategories,
    reusedCategories: categoryOwnership.reusedCategories,
    createdCategoryIds: categoryOwnership.createdCategoryIds,
    reusedCategoryIds: categoryOwnership.reusedCategoryIds,
    createdCategoryCount: categoryResult.created.length,
    createdAttributeDefinitions,
    createdAttributeDefinitionIds: createdAttributeDefinitions.map((definition) => definition.id),
    products: productResults,
    blockers: [],
    ops: {
      bulkEdit: { status: "not_requested" },
      importJob: { status: "not_requested" },
    },
  };

  if (seedOptions.withOps) {
    runtimeManifest.ops.bulkEdit = await attemptBulkEdit(pack, productResults, tokens.adminToken, apiUrl);
    runtimeManifest.ops.importJob = await attemptImportJob(pack, categoryResult.categories, tokens.editorToken, apiUrl);
    if (runtimeManifest.ops.bulkEdit.status !== "created") {
      runtimeManifest.blockers.push({
        type: "bulk_edit",
        detail: runtimeManifest.ops.bulkEdit.reason ?? "Bulk edit not created.",
      });
    }
    if (runtimeManifest.ops.importJob.status !== "processed") {
      runtimeManifest.blockers.push({
        type: "bulk_import",
        detail: runtimeManifest.ops.importJob.reason ?? "Import job did not finish in a completed/dead-letter state.",
      });
    }
  }

  runtimeManifest.blockers.push(
    {
      type: "connector_submission",
      detail: "Submission and recovery scenarios still require live connector credentials and installation state.",
    },
    {
      type: "system_admin_pages",
      detail: "system_admin_gated route data remains blocked until boundary-role test identities exist.",
    },
  );

  writeRuntimeManifest(runtimeManifestPath, runtimeManifest);

  console.log(
    JSON.stringify(
      {
        status: "ok",
        datasetId: runtimeManifest.datasetId,
        tenantKey: runtimeManifest.tenantKey,
        runtimeManifestPath,
        createdCategoryCount: runtimeManifest.createdCategoryCount,
        createdAttributeDefinitionCount: runtimeManifest.createdAttributeDefinitions.length,
        productCount: runtimeManifest.products.length,
        blockerCount: runtimeManifest.blockers.length,
        ops: runtimeManifest.ops,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("Realistic QA pack seed failed:");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
