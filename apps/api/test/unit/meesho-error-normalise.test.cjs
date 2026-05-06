#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.resolve(__dirname, "../../src/connectors/meesho/meesho.connector.ts"),
  "utf8",
);

const REQUIRED_CODES = [
  "TITLE_TOO_LONG",
  "IMAGE_NOT_SQUARE",
  "HSN_REQUIRED",
  "MRP_REQUIRED",
  "CATEGORY_MISMATCH",
  "IMAGE_MISSING",
  "HSN_INVALID",
  "MRP_INVALID",
  "BRAND_NOT_APPROVED",
  "DESCRIPTION_TOO_SHORT",
  "COLOUR_INVALID",
  "SIZE_INVALID",
];

for (const code of REQUIRED_CODES) {
  if (!source.includes(`'${code}'`)) {
    throw new Error(`Missing error code mapping: ${code}`);
  }
}

if (source.includes("// TODO P5-S3: map Meesho-specific error codes")) {
  throw new Error("TODO stub not replaced — normaliseError() must be implemented");
}

// Verify fallback pattern is present
if (!source.includes("Meesho returned error:")) {
  throw new Error("Missing fallback error message in normaliseError()");
}

// Verify severity values are used
if (!source.includes("severity: 'error'") || !source.includes("severity: 'warning'")) {
  throw new Error("normaliseError() must use both 'error' and 'warning' severity levels");
}

console.log(
  JSON.stringify(
    {
      status: "ok",
      validated: ["meesho_error_map_present", "todo_removed", "fallback_present", "severity_values_present"],
      codesVerified: REQUIRED_CODES,
    },
    null,
    2,
  ),
);
