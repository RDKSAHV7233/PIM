#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CONNECTOR_FILE = path.join(
  REPO_ROOT,
  "apps",
  "api",
  "src",
  "connectors",
  "meesho",
  "meesho.connector.ts",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(CONNECTOR_FILE, "utf8");

  // ExcelJS import and workbook usage
  assert(
    source.includes("import * as ExcelJS from 'exceljs'"),
    "Meesho connector must import ExcelJS for XLSX generation.",
  );
  assert(
    source.includes("new ExcelJS.Workbook()"),
    "generateExportFile must instantiate an ExcelJS Workbook.",
  );
  assert(
    source.includes("workbook.xlsx.writeBuffer()"),
    "generateExportFile must write the workbook to a buffer via xlsx.writeBuffer().",
  );

  // Capabilities declaration
  assert(
    source.includes("'EXCEL_EXPORT'"),
    "MeeshoConnector capabilities must include EXCEL_EXPORT.",
  );
  assert(
    source.includes("'VALIDATE'"),
    "MeeshoConnector capabilities must include VALIDATE.",
  );
  assert(
    !source.includes("'PUBLISH'"),
    "MeeshoConnector must NOT declare PUBLISH capability — Meesho is Excel-upload-only.",
  );

  // implementationStatus must be honest
  assert(
    source.includes("implementationStatus = 'partial'"),
    "MeeshoConnector.implementationStatus must be 'partial' until M-2 (API access) ships.",
  );

  // generateExportFile signature
  assert(
    source.includes("async generateExportFile("),
    "generateExportFile must be an async method.",
  );

  // Return shape
  assert(
    source.includes("filename: `meesho_upload_"),
    "Export filename must follow the meesho_upload_<date>.xlsx pattern.",
  );
  assert(
    source.includes(".xlsx`"),
    "Export filename must end with .xlsx.",
  );
  assert(
    source.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    "Export mimeType must be the OOXML XLSX MIME type.",
  );
  assert(
    source.includes("Buffer.from("),
    "Export buffer must be wrapped in Buffer.from() for downstream compatibility.",
  );

  // Required columns — Meesho standard template (18 columns)
  const requiredHeaders = [
    "SKU ID",
    "Product Name",
    "Brand",
    "Category",
    "MRP",
    "Selling Price",
    "HSN Code",
    "GST Rate (%)",
    "Description",
    "Colour",
    "Size",
    "Material",
    "Country of Origin",
    "Image URL 1",
    "Image URL 2",
    "Image URL 3",
    "Image URL 4",
    "Image URL 5",
  ];
  for (const header of requiredHeaders) {
    assert(
      source.includes(`'${header}'`),
      `MEESHO_COLUMNS must include column header '${header}'.`,
    );
  }

  // Worksheet setup
  assert(
    source.includes("workbook.addWorksheet('Products')"),
    "generateExportFile must add a worksheet named 'Products'.",
  );
  assert(
    source.includes("sheet.columns = MEESHO_COLUMNS"),
    "Worksheet columns must be set from the MEESHO_COLUMNS definition.",
  );
  assert(
    source.includes("headerRow.font = { bold: true }"),
    "Header row must be bold.",
  );
  assert(
    source.includes("sheet.autoFilter"),
    "Worksheet must enable autoFilter on the header row.",
  );

  // countryOfOrigin default
  assert(
    source.includes("countryOfOrigin ?? 'India'"),
    "countryOfOrigin must default to 'India' when not supplied on the product payload.",
  );

  // publishProduct intentionally absent
  assert(
    !source.includes("async publishProduct("),
    "MeeshoConnector must NOT implement publishProduct() — Meesho new product creation is Excel-upload-only.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "meesho_exceljs_import_present",
          "meesho_capabilities_validate_and_excel_export_only",
          "meesho_no_publish_capability",
          "meesho_implementation_status_partial",
          "meesho_generate_export_file_async",
          "meesho_filename_pattern_meesho_upload_date_xlsx",
          "meesho_mime_type_ooxml",
          "meesho_buffer_wrapped_correctly",
          "meesho_all_18_standard_columns_present",
          "meesho_worksheet_named_products",
          "meesho_header_row_bold",
          "meesho_autofilter_enabled",
          "meesho_country_of_origin_defaults_to_india",
          "meesho_publish_product_intentionally_absent",
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
  console.error("Meesho export contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
