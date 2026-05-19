#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_DIST = path.join(REPO_ROOT, "apps", "api", "dist");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  if (!fs.existsSync(path.join(API_DIST, "main.js"))) {
    throw new Error(`API build output not found at ${API_DIST}. Run: npm run build --workspace @pim1/api`);
  }

  const { MeeshoConnector } = require(path.join(API_DIST, "connectors", "meesho", "meesho.connector.js"));
  const connector = new MeeshoConnector();

  const ctx = {
    tenantId: "meesho-test-tenant",
    installationId: "meesho-test-install",
    connectorId: "cdef_meesho",
    getAccessToken: async () => "",
  };

  // ── validateCredentials ──────────────────────────────────────────────────
  const credOk = await connector.validateCredentials(ctx);
  assert(credOk === true, "Expected validateCredentials to return true (credential ping pending Meesho onboarding).");

  // ── validateProduct: invalid product (missing required fields) ───────────
  const invalidProduct = {
    sku: "M-INVALID-001",
    title: "A".repeat(75), // > 70 chars → error
    description: "Short",  // < 20 chars → warning
    brand: "TestBrand",
    hsnCode: "12",         // too short → invalid format
    gstRate: 18,
    mrp: 0,                // ≤ 0 → invalid
    sellingPrice: 500,
    mainImageUrl: "",      // missing → error
    attributes: {},
    productType: "apparel",
  };

  const invalidResult = await connector.validateProduct(ctx, invalidProduct);
  assert(invalidResult.isValid === false, "Expected incomplete product to fail validation.");
  assert(invalidResult.source === "LOCAL_RULES", `Expected LOCAL_RULES source, got ${invalidResult.source}`);
  assert(
    invalidResult.errors.some((e) => e.code === "TITLE_TOO_LONG"),
    "Expected TITLE_TOO_LONG error for 75-char title.",
  );
  assert(
    invalidResult.errors.some((e) => e.code === "IMAGE_MISSING"),
    "Expected IMAGE_MISSING error for empty mainImageUrl.",
  );
  assert(
    invalidResult.errors.some((e) => e.code === "HSN_INVALID"),
    "Expected HSN_INVALID error for 2-digit HSN.",
  );
  assert(
    invalidResult.errors.some((e) => e.code === "MRP_INVALID"),
    "Expected MRP_INVALID error for mrp=0.",
  );
  assert(
    invalidResult.warnings.some((w) => w.code === "DESCRIPTION_TOO_SHORT"),
    "Expected DESCRIPTION_TOO_SHORT warning for description < 20 chars.",
  );

  // ── validateProduct: valid product ───────────────────────────────────────
  const validProduct = {
    sku: "M-VALID-001",
    title: "Premium Cotton Kurta for Women",
    description: "Comfortable everyday kurta made from 100% organic cotton.",
    brand: "EthnicWear",
    hsnCode: "620462",
    gstRate: 5,
    mrp: 1499,
    sellingPrice: 999,
    mainImageUrl: "https://cdn.example.com/meesho/m-valid-001.jpg",
    attributes: { colour: "White", size: "M", material: "Cotton" },
    productType: "apparel",
  };

  const validResult = await connector.validateProduct(ctx, validProduct);
  assert(validResult.isValid === true, "Expected valid product to pass validation.");
  assert(validResult.errors.length === 0, `Expected no errors, got: ${validResult.errors.map((e) => e.code).join(", ")}`);
  assert(validResult.source === "LOCAL_RULES", "Expected LOCAL_RULES source.");

  // ── generateExportFile ───────────────────────────────────────────────────
  const exportResult = await connector.generateExportFile(ctx, [validProduct]);
  assert(Buffer.isBuffer(exportResult.buffer), "Expected buffer from generateExportFile.");
  assert(exportResult.buffer.length > 0, "Expected non-empty Excel buffer.");
  assert(
    exportResult.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    `Unexpected mimeType: ${exportResult.mimeType}`,
  );
  assert(
    exportResult.filename.startsWith("meesho_upload_") && exportResult.filename.endsWith(".xlsx"),
    `Unexpected filename: ${exportResult.filename}`,
  );
  // Excel files start with PK (zip header 0x50 0x4B)
  assert(
    exportResult.buffer[0] === 0x50 && exportResult.buffer[1] === 0x4b,
    "Expected xlsx buffer to start with PK (zip magic bytes).",
  );

  // ── generateExportFile: multiple products ────────────────────────────────
  const bulkResult = await connector.generateExportFile(ctx, [validProduct, { ...validProduct, sku: "M-VALID-002" }]);
  assert(Buffer.isBuffer(bulkResult.buffer) && bulkResult.buffer.length > 0, "Expected non-empty bulk export buffer.");

  // ── normaliseError: known code ────────────────────────────────────────────
  const knownIssue = connector.normaliseError("TITLE_TOO_LONG", "raw");
  assert(
    knownIssue.sellerMessage.includes("70 characters"),
    `Unexpected known error message: ${knownIssue.sellerMessage}`,
  );
  assert(knownIssue.fieldPath === "title", `Expected fieldPath 'title', got '${knownIssue.fieldPath}'`);
  assert(knownIssue.severity === "error", `Expected severity 'error', got '${knownIssue.severity}'`);

  // ── normaliseError: unknown code ──────────────────────────────────────────
  const unknownIssue = connector.normaliseError("UNKNOWN_NEW_CODE", "Provider detail");
  assert(unknownIssue.sellerMessage === "Provider detail", "Expected unknown error to preserve provider detail.");
  assert(unknownIssue.severity === "error", "Expected unknown error to default severity to 'error'.");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "meesho_credentials_always_true",
          "meesho_local_validation_errors_on_invalid_product",
          "meesho_local_validation_passes_valid_product",
          "meesho_excel_export_produces_xlsx_buffer",
          "meesho_excel_export_bulk_products",
          "meesho_error_normalization_known_code",
          "meesho_error_normalization_unknown_code",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error("Meesho runtime foundation integration test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
