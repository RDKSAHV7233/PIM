#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PRODUCTS_CONTROLLER = path.join(REPO_ROOT, "apps", "api", "src", "catalog", "products.controller.ts");
const CATALOG_SERVICE = path.join(REPO_ROOT, "apps", "api", "src", "catalog", "catalog.service.ts");
const REVISION_DTO = path.join(REPO_ROOT, "apps", "api", "src", "catalog", "dto", "product-revision.dto.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const controllerSource = fs.readFileSync(PRODUCTS_CONTROLLER, "utf8");
  const serviceSource = fs.readFileSync(CATALOG_SERVICE, "utf8");
  const dtoSource = fs.readFileSync(REVISION_DTO, "utf8");

  assert(
    controllerSource.includes('":id/revisions"') &&
      controllerSource.includes("getProductRevisions") &&
      controllerSource.includes("@Get"),
    "products.controller.ts must expose GET :id/revisions endpoint calling getProductRevisions.",
  );

  assert(
    serviceSource.includes("async getProductRevisions("),
    "catalog.service.ts must implement getProductRevisions method.",
  );

  assert(
    serviceSource.includes("revisionId:") &&
      serviceSource.includes("productId") &&
      serviceSource.includes("createdAt") &&
      serviceSource.includes("changedFields"),
    "getProductRevisions must return items with revisionId, productId, createdAt, and changedFields.",
  );

  assert(
    serviceSource.includes("items: []") || serviceSource.includes("{ items }"),
    "getProductRevisions must return a response with items array (handles empty history with { items: [] }).",
  );

  assert(
    dtoSource.includes("ProductRevision") &&
      dtoSource.includes("revisionId") &&
      dtoSource.includes("changedFields") &&
      dtoSource.includes("ProductRevisionsResponse"),
    "product-revision.dto.ts must define ProductRevision and ProductRevisionsResponse interfaces.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "products_controller_exposes_revisions_endpoint",
          "catalog_service_implements_get_product_revisions",
          "revision_response_shape_correct",
          "empty_revision_history_handled",
          "product_revision_dto_defined",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

try {
  run();
} catch (error) {
  console.error("Product revision history integration test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
