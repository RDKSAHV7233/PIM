#!/usr/bin/env node
/* eslint-disable no-console */
//
// Regression test for PIM#619: no STARTER-tier customer had any working path to approve a
// product. The Content tab's edit form always renders the (optional) international tax code
// table, so its `taxCode_{MARKET}_{KEY}_value` inputs are always present in the submitted
// FormData — even when every value is blank. `parseTaxCodes()` gated on field *presence*
// (`formData.has(...)`) rather than on whether any value was actually filled in, so it
// returned `[]` (a defined-but-empty array) on every single Content-tab submission, never
// `undefined`. The backend's approval-transition guard
// (apps/api/src/catalog/catalog.service.ts) treats `dto.taxCodes !== undefined` as "content
// changed," so it fired unconditionally on every approve/reject attempt submitted through
// this form — even with zero actual edits. Approval Queue (the only other path) is
// Growth-plan-gated, so STARTER customers had no working path to approve anything.
//
// This test extracts and executes the real `parseTaxCodes` function (plus its
// `INTL_TAX_CODE_ROWS` constant and `parseNumber` helper) out of the actual source file
// (via the TypeScript compiler, not a reimplementation), so it runs the exact logic that
// ships in the Content tab's save action.
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const ACTIONS_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "actions.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function extractFunction(source, fnName) {
  const startPattern = new RegExp(`function ${fnName}\\s*\\(`);
  const match = source.match(startPattern);
  assert(match, `Could not locate function ${fnName} in source.`);
  const startIndex = match.index;

  // Find the parameter list's closing paren first, so a return-type annotation containing
  // its own braces (e.g. `): Array<{ regimeKey: string }> | undefined {`) can't be mistaken
  // for the body's closing brace.
  const openParenIndex = source.indexOf("(", startIndex);
  let parenDepth = 0;
  let paramsEndIndex = -1;
  for (let i = openParenIndex; i < source.length; i++) {
    if (source[i] === "(") parenDepth++;
    else if (source[i] === ")") {
      parenDepth--;
      if (parenDepth === 0) {
        paramsEndIndex = i;
        break;
      }
    }
  }
  assert(paramsEndIndex !== -1, `Could not find end of parameter list for ${fnName}.`);

  // From there, walk the return-type annotation tracking a combined nesting depth for `<`/`>`
  // and `{`/`}` together — the body's opening brace is the first `{` seen while that combined
  // depth is 0 (i.e., not nested inside a generic or object-type literal in the return type).
  let typeDepth = 0;
  let bodyStart = -1;
  for (let i = paramsEndIndex + 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      if (typeDepth === 0) {
        bodyStart = i;
        break;
      }
      typeDepth++;
    } else if (ch === "<") {
      typeDepth++;
    } else if (ch === "}" || ch === ">") {
      typeDepth--;
    }
  }
  assert(bodyStart !== -1, `Could not find body start for ${fnName}.`);

  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === "{") {
      depth++;
    } else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(startIndex, i + 1);
      }
    }
  }
  throw new Error(`Could not find closing brace for ${fnName}.`);
}

function extractConst(source, constName) {
  const startPattern = new RegExp(`const ${constName} = \\[`);
  const match = source.match(startPattern);
  assert(match, `Could not locate const ${constName} in source.`);
  const startIndex = match.index;
  const endMarker = "] as const;";
  const endIndex = source.indexOf(endMarker, startIndex);
  assert(endIndex !== -1, `Could not find end of const ${constName}.`);
  return source.slice(startIndex, endIndex + endMarker.length);
}

/**
 * Loads the real `parseTaxCodes` implementation (plus its real dependencies) out of the
 * actual source file by transpiling exactly that code through the TypeScript compiler and
 * evaluating it, so the test exercises the exact logic that ships in production.
 */
function loadRealParseTaxCodes() {
  const source = fs.readFileSync(ACTIONS_FILE, "utf8");
  const intlRows = extractConst(source, "INTL_TAX_CODE_ROWS");
  const parseNumberFn = extractFunction(source, "parseNumber");
  const parseTaxCodesFn = extractFunction(source, "parseTaxCodes");

  const combined = [intlRows, parseNumberFn, parseTaxCodesFn].join("\n\n");
  const transpiled = ts.transpileModule(combined, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const factory = new Function(`${transpiled}\nreturn parseTaxCodes;`);
  return factory();
}

function run() {
  const parseTaxCodes = loadRealParseTaxCodes();

  // Case 1 (PIM#619's exact bug): the Content tab's form always renders the international
  // tax fields, but a customer who never touches them submits them as present-but-blank.
  // This MUST return undefined — the pre-fix bug returned [] here, which the backend
  // guard treats identically to "content changed," unconditionally blocking approval.
  const blankIntlForm = new FormData();
  blankIntlForm.set("taxCode_GB_COMMODITY_CODE_value", "");
  blankIntlForm.set("taxCode_AE_HS_CODE_value", "");
  blankIntlForm.set("taxCode_US_TAX_CATEGORY_value", "");
  blankIntlForm.set("taxCode_AU_COMMODITY_CODE_value", "");
  assert(
    parseTaxCodes(blankIntlForm) === undefined,
    "PIM#619: a Content-tab submission with the international tax fields present but blank " +
      "must return undefined (no signal), not [] — otherwise the approval-transition guard " +
      "fires on every submission, blocking approval entirely.",
  );

  // Case 2: no tax-related fields in the FormData at all (e.g. a partial-update context that
  // doesn't render the tax section) — must also return undefined.
  const noTaxFieldsForm = new FormData();
  noTaxFieldsForm.set("title", "Some Product");
  assert(
    parseTaxCodes(noTaxFieldsForm) === undefined,
    "A form with no tax-related fields at all must return undefined.",
  );

  // Case 3: a real international value is filled in — must be collected.
  const filledIntlForm = new FormData();
  filledIntlForm.set("taxCode_GB_COMMODITY_CODE_value", "6109100010");
  filledIntlForm.set("taxCode_GB_COMMODITY_CODE_rate", "20");
  filledIntlForm.set("taxCode_AE_HS_CODE_value", "");
  filledIntlForm.set("taxCode_US_TAX_CATEGORY_value", "");
  filledIntlForm.set("taxCode_AU_COMMODITY_CODE_value", "");
  const filledIntlResult = parseTaxCodes(filledIntlForm);
  assert(Array.isArray(filledIntlResult) && filledIntlResult.length === 1, "A real UK value must produce exactly one entry.");
  assert(filledIntlResult[0].regimeKey === "GB" && filledIntlResult[0].value === "6109100010" && filledIntlResult[0].rate === 20, "The collected UK entry must carry the real value and rate.");

  // Case 4: only the India hsnCode is filled — must be collected as the IN entry.
  const indiaOnlyForm = new FormData();
  indiaOnlyForm.set("hsnCode", "61091000");
  indiaOnlyForm.set("gstRate", "12");
  indiaOnlyForm.set("taxCode_GB_COMMODITY_CODE_value", "");
  indiaOnlyForm.set("taxCode_AE_HS_CODE_value", "");
  indiaOnlyForm.set("taxCode_US_TAX_CATEGORY_value", "");
  indiaOnlyForm.set("taxCode_AU_COMMODITY_CODE_value", "");
  const indiaOnlyResult = parseTaxCodes(indiaOnlyForm);
  assert(Array.isArray(indiaOnlyResult) && indiaOnlyResult.length === 1, "A filled India hsnCode with blank international fields must produce exactly one (IN) entry.");
  assert(indiaOnlyResult[0].regimeKey === "IN" && indiaOnlyResult[0].value === "61091000" && indiaOnlyResult[0].rate === 12, "The collected IN entry must carry the real hsnCode value and gstRate.");

  // Case 5: both India and one international market filled — both collected.
  const bothForm = new FormData();
  bothForm.set("hsnCode", "61091000");
  bothForm.set("taxCode_US_TAX_CATEGORY_value", "6109.10.00.10");
  bothForm.set("taxCode_GB_COMMODITY_CODE_value", "");
  bothForm.set("taxCode_AE_HS_CODE_value", "");
  bothForm.set("taxCode_AU_COMMODITY_CODE_value", "");
  const bothResult = parseTaxCodes(bothForm);
  assert(Array.isArray(bothResult) && bothResult.length === 2, "India + one international market filled must produce exactly two entries.");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "blank_but_present_intl_fields_return_undefined_pim619_fix",
          "no_tax_fields_at_all_returns_undefined",
          "real_international_value_is_collected",
          "india_only_value_is_collected",
          "india_plus_international_both_collected",
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
  console.error("Product content taxCodes approval-guard test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
