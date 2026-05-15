const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  const apiPackage = read("apps/api/package.json");
  const jobDto = read("apps/api/src/bulk-import/dto/create-bulk-import-job.dto.ts");
  const templateDto = read("apps/api/src/bulk-import/dto/create-bulk-import-template.dto.ts");
  const service = read("apps/api/src/bulk-import/bulk-import.service.ts");
  const webActions = read("apps/web/src/app/actions.ts");
  const importsPage = read("apps/web/src/app/operations/imports/page.tsx");
  const preflightForm = read("apps/web/src/components/operations/import-preflight-form.tsx");
  const apiTypes = read("apps/web/src/lib/api/core.ts");

  assert(!apiPackage.includes('"xlsx"'), "apps/api/package.json must not include xlsx.");
  assert(!service.includes('from "xlsx"') && !service.includes("require(\"xlsx\")"), "BulkImportService must not import xlsx.");
  assert(!service.includes("XLSX.read") && !service.includes("sheet_to_json"), "BulkImportService must not parse spreadsheets.");
  assert(!service.includes("parseSpreadsheetBase64"), "BulkImportService must not keep the spreadsheet parser reachable.");

  assert(jobDto.includes('const SOURCE_FORMATS = ["csv", "json"] as const;'), "CreateBulkImportJobDto must allow only csv/json.");
  assert(templateDto.includes('const SOURCE_FORMATS = ["csv", "json"] as const;'), "CreateBulkImportTemplateDto must allow only csv/json.");
  assert(webActions.includes("Spreadsheet imports are temporarily disabled."), "Server action must explain spreadsheet imports are disabled.");
  assert(preflightForm.includes('accept=".csv,.json"'), "Operations import upload must only accept csv/json.");
  assert(!apiTypes.includes('"xlsx" | "xls"'), "Web API bulk import types must not expose xlsx/xls.");

  console.log("bulk-import-spreadsheet-disabled: ok");
} catch (error) {
  console.error("bulk-import-spreadsheet-disabled integration test failed");
  console.error(error);
  process.exit(1);
}
