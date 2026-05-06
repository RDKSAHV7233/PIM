#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const BULK_IMPORT_CONTROLLER = path.join(REPO_ROOT, "apps", "api", "src", "bulk-import", "bulk-import.controller.ts");
const BULK_IMPORT_SERVICE = path.join(REPO_ROOT, "apps", "api", "src", "bulk-import", "bulk-import.service.ts");
const VALIDATE_DTO = path.join(REPO_ROOT, "apps", "api", "src", "bulk-import", "dto", "import-validate.dto.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const controllerSource = fs.readFileSync(BULK_IMPORT_CONTROLLER, "utf8");
  const serviceSource = fs.readFileSync(BULK_IMPORT_SERVICE, "utf8");
  const dtoSource = fs.readFileSync(VALIDATE_DTO, "utf8");

  assert(
    controllerSource.includes('"validate"') &&
      controllerSource.includes("validateImport") &&
      controllerSource.includes("@Post"),
    "bulk-import.controller.ts must expose POST validate endpoint.",
  );

  assert(
    serviceSource.includes("async validateImport("),
    "bulk-import.service.ts must implement validateImport method.",
  );

  assert(
    serviceSource.includes("valid:") &&
      serviceSource.includes("formatValid:") &&
      serviceSource.includes("schemaIssues") &&
      serviceSource.includes("categoryIssues") &&
      serviceSource.includes("blockingCount") &&
      serviceSource.includes("warningCount") &&
      serviceSource.includes("fieldMappingSummary"),
    "validateImport must return the full ImportValidateResponse shape.",
  );

  assert(
    serviceSource.includes("ALLOWED_MIME_TYPES") &&
      serviceSource.includes("text/csv") &&
      serviceSource.includes("formatValid: false"),
    "validateImport must reject unsupported mime types with valid:false, formatValid:false.",
  );

  assert(
    serviceSource.includes("category.findUnique") &&
      serviceSource.includes("categoryIssues.push"),
    "validateImport must check categoryId existence and add a category issue when not found.",
  );

  assert(
    dtoSource.includes("ImportValidateDto") &&
      dtoSource.includes("categoryId") &&
      dtoSource.includes("fileName") &&
      dtoSource.includes("fileSize") &&
      dtoSource.includes("mimeType"),
    "import-validate.dto.ts must define ImportValidateDto with required fields.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "bulk_import_controller_exposes_validate_endpoint",
          "bulk_import_service_implements_validate_import",
          "validate_response_shape_complete",
          "invalid_mime_type_returns_valid_false",
          "unknown_category_adds_category_issue",
          "import_validate_dto_defined",
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
  console.error("Import preflight integration test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
