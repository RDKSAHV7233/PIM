#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(
      `API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`,
    );
  }

  const { NykaaConnector } = require(
    path.join(REPO_ROOT, "apps", "api", "dist", "connectors", "nykaa", "nykaa.connector.js"),
  );

  // Resolve ExcelJS — try workspace root, fallback to api-level
  let ExcelJS;
  try {
    ExcelJS = require("exceljs");
  } catch {
    ExcelJS = require(path.join(REPO_ROOT, "node_modules", "exceljs"));
  }

  const connector = new NykaaConnector();
  const fakeCtx = { tenantId: "local", installationId: "local", connectorId: "cdef_nykaa", getAccessToken: async () => "" };

  // ── 1. validateCredentials always returns false in v1 ──────────────────────

  const credResult = await connector.validateCredentials(fakeCtx);
  assert(credResult === false, "Expected Nykaa v1 validateCredentials to return false (portal-only, no API).");

  // ── 2. validateProduct — full lipstick product (all required fields) ────────

  const validLipstick = await connector.validateProduct(fakeCtx, {
    sku: "LIP-RED-001",
    title: "Velvet Matte Red Lipstick",
    brand: "GlowUp",
    mrp: 449,
    sellingPrice: 329,
    hsnCode: "330410",
    gstRate: 18,
    countryOfOrigin: "India",
    description: "A rich, long-lasting matte red lip colour.",
    mainImageUrl: "https://cdn.example.com/lipstick-red.jpg",
    productType: "lipstick",
    attributes: {
      shadeName: "Cherry Red",
      finish: "Matte",
      netWeight: "3.5g",
      shelfLife: "24",
    },
  });
  assert(
    validLipstick.isValid === true,
    `Expected valid lipstick to pass; errors: ${JSON.stringify(validLipstick.errors)}`,
  );
  assert(validLipstick.errors.length === 0, "Expected zero errors for fully specified lipstick.");
  assert(validLipstick.source === "LOCAL_RULES", `Expected LOCAL_RULES source, got ${validLipstick.source}`);

  // ── 3. validateProduct — missing brand ─────────────────────────────────────

  const noBrand = await connector.validateProduct(fakeCtx, {
    sku: "FOUND-001",
    title: "Dewy Foundation",
    brand: "",
    mrp: 699,
    sellingPrice: 499,
    hsnCode: "330410",
    gstRate: 18,
    countryOfOrigin: "India",
    description: "Buildable dewy finish foundation.",
    mainImageUrl: "https://cdn.example.com/foundation.jpg",
    productType: "foundation",
    attributes: {
      shadeName: "Porcelain",
      coverage: "Medium",
      finish: "Dewy",
      skinType: "Dry",
      netWeight: "30ml",
      shelfLife: "24",
    },
  });
  assert(noBrand.isValid === false, "Expected missing brand to fail.");
  assert(
    noBrand.errors.some((e) => e.code === "BRAND_REQUIRED"),
    `Expected BRAND_REQUIRED error; got: ${JSON.stringify(noBrand.errors)}`,
  );

  // ── 4. validateProduct — missing MRP ───────────────────────────────────────

  const noMrp = await connector.validateProduct(fakeCtx, {
    sku: "SKIN-001",
    title: "Hydrating Face Serum",
    brand: "GlowSkin",
    mrp: null,
    sellingPrice: 499,
    hsnCode: "330499",
    gstRate: 18,
    countryOfOrigin: "India",
    description: "Hydrating hyaluronic acid serum.",
    mainImageUrl: "https://cdn.example.com/serum.jpg",
    productType: "skincare",
    attributes: {
      productSubtype: "Serum",
      skinType: "Dry",
      netWeight: "30ml",
      shelfLife: "24",
    },
  });
  assert(noMrp.isValid === false, "Expected missing MRP to fail.");
  assert(
    noMrp.errors.some((e) => e.code === "MRP_REQUIRED"),
    `Expected MRP_REQUIRED error; got: ${JSON.stringify(noMrp.errors)}`,
  );

  // ── 5. validateProduct — missing HSN ───────────────────────────────────────

  const noHsn = await connector.validateProduct(fakeCtx, {
    sku: "HAIR-001",
    title: "Argan Oil Shampoo",
    brand: "HairLux",
    mrp: 299,
    sellingPrice: 249,
    hsnCode: "",
    gstRate: 18,
    countryOfOrigin: "India",
    description: "Nourishing argan oil shampoo.",
    mainImageUrl: "https://cdn.example.com/shampoo.jpg",
    productType: "haircare",
    attributes: {
      productSubtype: "Shampoo",
      hairType: "Dry",
      netWeight: "200ml",
      shelfLife: "30",
    },
  });
  assert(noHsn.isValid === false, "Expected missing HSN to fail.");
  assert(
    noHsn.errors.some((e) => e.code === "HSN_REQUIRED"),
    `Expected HSN_REQUIRED error; got: ${JSON.stringify(noHsn.errors)}`,
  );

  // ── 6. validateProduct — missing shelfLife (beauty-specific required) ───────

  const noShelfLife = await connector.validateProduct(fakeCtx, {
    sku: "PC-001",
    title: "Rose Body Wash",
    brand: "BloomCare",
    mrp: 199,
    sellingPrice: 149,
    hsnCode: "340111",
    gstRate: 18,
    countryOfOrigin: "India",
    description: "Gentle rose-scented body wash.",
    mainImageUrl: "https://cdn.example.com/bodywash.jpg",
    productType: "personal-care",
    attributes: {
      productSubtype: "Body Wash",
      netWeight: "250ml",
      // shelfLife intentionally omitted
    },
  });
  assert(noShelfLife.isValid === false, "Expected missing shelfLife to fail.");
  assert(
    noShelfLife.errors.some((e) => e.code === "SHELF_LIFE_REQUIRED"),
    `Expected SHELF_LIFE_REQUIRED error; got: ${JSON.stringify(noShelfLife.errors)}`,
  );

  // ── 7. validateProduct — missing netWeight (beauty-specific required) ────────

  const noNetWeight = await connector.validateProduct(fakeCtx, {
    sku: "LIP-002",
    title: "Glossy Pink Lip Gloss",
    brand: "GlowUp",
    mrp: 249,
    sellingPrice: 199,
    hsnCode: "330410",
    gstRate: 18,
    countryOfOrigin: "India",
    description: "High-shine glossy pink lip colour.",
    mainImageUrl: "https://cdn.example.com/gloss.jpg",
    productType: "lipstick",
    attributes: {
      shadeName: "Bubblegum Pink",
      finish: "Glossy",
      shelfLife: "18",
      // netWeight intentionally omitted
    },
  });
  assert(noNetWeight.isValid === false, "Expected missing netWeight to fail.");
  assert(
    noNetWeight.errors.some((e) => e.code === "NET_WEIGHT_REQUIRED"),
    `Expected NET_WEIGHT_REQUIRED error; got: ${JSON.stringify(noNetWeight.errors)}`,
  );

  // ── 8. validateProduct — selling price > MRP ────────────────────────────────

  const priceViolation = await connector.validateProduct(fakeCtx, {
    sku: "SKIN-002",
    title: "Vitamin C Serum",
    brand: "GlowSkin",
    mrp: 499,
    sellingPrice: 600,
    hsnCode: "330499",
    gstRate: 18,
    countryOfOrigin: "India",
    description: "Brightening Vitamin C serum.",
    mainImageUrl: "https://cdn.example.com/vitc.jpg",
    productType: "skincare",
    attributes: { productSubtype: "Serum", skinType: "All Skin Types", netWeight: "30ml", shelfLife: "24" },
  });
  assert(priceViolation.isValid === false, "Expected sellingPrice > MRP to fail.");
  assert(
    priceViolation.errors.some((e) => e.code === "SELLING_PRICE_EXCEEDS_MRP"),
    `Expected SELLING_PRICE_EXCEEDS_MRP; got: ${JSON.stringify(priceViolation.errors)}`,
  );

  // ── 9. validateProduct — invalid GST rate ───────────────────────────────────

  const badGst = await connector.validateProduct(fakeCtx, {
    sku: "HAIR-002",
    title: "Coconut Hair Oil",
    brand: "HairLux",
    mrp: 199,
    sellingPrice: 149,
    hsnCode: "150620",
    gstRate: 7,
    countryOfOrigin: "India",
    description: "Pure coconut hair oil.",
    mainImageUrl: "https://cdn.example.com/hairoil.jpg",
    productType: "haircare",
    attributes: { productSubtype: "Hair Oil", hairType: "All Hair Types", netWeight: "150ml", shelfLife: "36" },
  });
  assert(badGst.isValid === false, "Expected invalid GST rate (7) to fail.");
  assert(
    badGst.errors.some((e) => e.code === "GST_RATE_INVALID"),
    `Expected GST_RATE_INVALID; got: ${JSON.stringify(badGst.errors)}`,
  );

  // ── 10. normaliseError contract ─────────────────────────────────────────────

  const hsnRequired = connector.normaliseError("HSN_REQUIRED", "");
  assert(hsnRequired.fieldPath === "hsnCode", `Expected fieldPath 'hsnCode'; got '${hsnRequired.fieldPath}'`);
  assert(hsnRequired.severity === "error", "Expected error severity for HSN_REQUIRED.");

  const shelfLifeRequired = connector.normaliseError("SHELF_LIFE_REQUIRED", "");
  assert(
    shelfLifeRequired.fieldPath === "attributes.shelfLife",
    `Expected fieldPath 'attributes.shelfLife'; got '${shelfLifeRequired.fieldPath}'`,
  );
  assert(shelfLifeRequired.severity === "error", "Expected error severity for SHELF_LIFE_REQUIRED.");

  const brandRequired = connector.normaliseError("BRAND_REQUIRED", "");
  assert(brandRequired.fieldPath === "brand", `Expected fieldPath 'brand'; got '${brandRequired.fieldPath}'`);

  const categoryMismatch = connector.normaliseError("CATEGORY_MISMATCH", "");
  assert(categoryMismatch.severity === "warning", "Expected CATEGORY_MISMATCH to be a warning, not an error.");

  const unknownCode = connector.normaliseError("SOME_UNKNOWN_ERROR", "Raw Nykaa detail");
  assert(
    unknownCode.sellerMessage === "Raw Nykaa detail",
    `Expected unknown error to preserve raw message; got: ${unknownCode.sellerMessage}`,
  );

  // ── 11. generateExportFile — lipstick XLSX structure ────────────────────────

  const exportResult = await connector.generateExportFile(fakeCtx, [
    {
      sku: "LIP-EXPORT-001",
      title: "Velvet Matte Red Lipstick",
      brand: "GlowUp",
      mrp: 449,
      sellingPrice: 329,
      hsnCode: "330410",
      gstRate: 18,
      countryOfOrigin: "India",
      description: "A rich matte red.",
      mainImageUrl: "https://cdn.example.com/lip-red.jpg",
      productType: "lipstick",
      attributes: { shadeName: "Cherry Red", finish: "Matte", netWeight: "3.5g", shelfLife: "24" },
    },
    {
      sku: "LIP-EXPORT-002",
      title: "Velvet Matte Pink Lipstick",
      brand: "GlowUp",
      mrp: 449,
      sellingPrice: 329,
      hsnCode: "330410",
      gstRate: 18,
      countryOfOrigin: "India",
      description: "A rich matte pink.",
      mainImageUrl: "https://cdn.example.com/lip-pink.jpg",
      productType: "lipstick",
      attributes: { shadeName: "Rose Pink", finish: "Matte", netWeight: "3.5g", shelfLife: "24" },
    },
  ]);

  assert(Buffer.isBuffer(exportResult.buffer), "Expected generateExportFile to return a Buffer.");
  assert(exportResult.buffer.length > 1000, "Expected XLSX buffer to be non-trivial in size.");
  assert(
    exportResult.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    `Expected correct XLSX MIME type; got: ${exportResult.mimeType}`,
  );
  assert(
    exportResult.filename.startsWith("nykaa_lipstick_"),
    `Expected filename to start with 'nykaa_lipstick_'; got: ${exportResult.filename}`,
  );
  assert(
    exportResult.filename.endsWith(".xlsx"),
    `Expected filename to end with .xlsx; got: ${exportResult.filename}`,
  );

  // Parse XLSX and verify sheet structure
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(exportResult.buffer);

  const sheetNames = workbook.worksheets.map((ws) => ws.name);
  assert(
    sheetNames.includes("Products"),
    `Expected 'Products' worksheet; found: ${sheetNames.join(", ")}`,
  );
  assert(
    sheetNames.includes("Upload Guide"),
    `Expected 'Upload Guide' worksheet; found: ${sheetNames.join(", ")}`,
  );

  const productsSheet = workbook.getWorksheet("Products");
  const headerRow = productsSheet.getRow(1);
  const headers = [];
  headerRow.eachCell((cell) => headers.push(String(cell.value || "")));
  assert(
    headers.includes("Seller SKU"),
    `Expected 'Seller SKU' column header; found: ${headers.join(", ")}`,
  );
  assert(
    headers.includes("Product Name"),
    `Expected 'Product Name' column header; found: ${headers.join(", ")}`,
  );
  assert(
    headers.includes("Shade Name"),
    `Expected 'Shade Name' column header for lipstick template; found: ${headers.join(", ")}`,
  );
  assert(
    headers.includes("Shelf Life (months)"),
    `Expected 'Shelf Life (months)' column header; found: ${headers.join(", ")}`,
  );

  // Row 2 is hint row — should say 'Required' or 'Optional'
  const hintRow = productsSheet.getRow(2);
  const hintValues = [];
  hintRow.eachCell((cell) => hintValues.push(String(cell.value || "")));
  assert(
    hintValues.some((v) => v === "Required"),
    "Expected hint row to contain 'Required' labels for mandatory columns.",
  );

  // Data rows start at row 3 — 2 products → 2 data rows
  const dataRow3 = productsSheet.getRow(3);
  assert(
    dataRow3.hasValues,
    "Expected data row at row 3 (first product).",
  );
  const dataRow4 = productsSheet.getRow(4);
  assert(
    dataRow4.hasValues,
    "Expected data row at row 4 (second product).",
  );

  // Upload Guide sheet: 7 step rows + 1 header row = 8 total
  const guideSheet = workbook.getWorksheet("Upload Guide");
  assert(
    guideSheet !== undefined && guideSheet !== null,
    "Expected Upload Guide sheet to exist.",
  );
  let guideRowCount = 0;
  guideSheet.eachRow(() => { guideRowCount++; });
  assert(
    guideRowCount === 8,
    `Expected 8 rows in Upload Guide (1 header + 7 steps); got ${guideRowCount}`,
  );

  const guideRow2 = guideSheet.getRow(2);
  const guideStep1 = String(guideRow2.getCell(2).value || "");
  assert(
    guideStep1.toLowerCase().includes("seller.nykaa.com") || guideStep1.toLowerCase().includes("log in"),
    `Expected step 1 to reference seller.nykaa.com; got: ${guideStep1}`,
  );

  // ── 12. generateExportFile — empty products array throws ────────────────────

  let emptyThrew = false;
  try {
    await connector.generateExportFile(fakeCtx, []);
  } catch {
    emptyThrew = true;
  }
  assert(emptyThrew, "Expected generateExportFile to throw when passed empty products array.");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "nykaa_validate_credentials_returns_false_v1",
          "nykaa_valid_lipstick_passes_local_rules",
          "nykaa_missing_brand_caught",
          "nykaa_missing_mrp_caught",
          "nykaa_missing_hsn_caught",
          "nykaa_missing_shelf_life_caught",
          "nykaa_missing_net_weight_caught",
          "nykaa_selling_price_exceeds_mrp_caught",
          "nykaa_invalid_gst_rate_caught",
          "nykaa_error_map_hsn_required",
          "nykaa_error_map_shelf_life_required",
          "nykaa_category_mismatch_is_warning",
          "nykaa_unknown_error_code_preserves_raw_message",
          "nykaa_generate_export_file_produces_xlsx_buffer",
          "nykaa_xlsx_has_products_and_upload_guide_sheets",
          "nykaa_xlsx_products_sheet_has_correct_headers",
          "nykaa_xlsx_products_sheet_has_hint_row",
          "nykaa_xlsx_products_sheet_has_data_rows",
          "nykaa_xlsx_upload_guide_has_7_steps",
          "nykaa_generate_export_file_throws_on_empty",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error("Nykaa runtime foundation integration test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
