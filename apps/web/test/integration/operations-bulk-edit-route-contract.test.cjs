#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "operations", "bulk-edit", "page.tsx");
const ROLE_CAPABILITIES = path.join(REPO_ROOT, "apps", "web", "src", "lib", "role-capabilities.ts");
// The structured builder was extracted out of page.tsx into its own client component
// (commit 9dfd6b10, "make structured change builder reactive") so changing Field/
// Operation could update the New Value input without a full page reload. The markup
// this test's structured-builder assertion checks for lives here now, not in page.tsx.
const STRUCTURED_CHANGE_BUILDER = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "components",
  "bulk-edit",
  "structured-change-builder.tsx",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PAGE, "utf8");
  const roleSource = fs.readFileSync(ROLE_CAPABILITIES, "utf8");
  const builderSource = fs.readFileSync(STRUCTURED_CHANGE_BUILDER, "utf8");

  assert(
    source.includes('const normalized = String(value ?? "").trim().toLowerCase();') &&
      source.includes('normalized === "false" || normalized === "0" || normalized === "off"') &&
      source.includes("return true;"),
    "Operations bulk edit must default hideTestData to true and only opt out on explicit false/0/off values.",
  );
  assert(
    source.includes("value") &&
      source.includes(".split(/[\\n,]/)") &&
      source.includes(".map((item) => item.trim())") &&
      source.includes(".filter((item) => item.length > 0)") &&
      source.includes("new Set("),
    "Operations bulk edit must normalize scoped product IDs by splitting comma/newline input and deduping values.",
  );
  assert(
      source.includes("await getServerSession();") &&
      source.includes("const canWrite = canEditWorkspace(actorRole);"),
    "Operations bulk edit must derive shared auth/session context and write capability on the server.",
  );
  assert(
    roleSource.includes('return role === "admin" || role === "editor";') &&
      source.includes("canEditWorkspace(actorRole)"),
    "Operations bulk edit must use the shared admin/editor workspace-edit rule.",
  );
  assert(
    source.includes("const [operations, categories, products] = await Promise.all([") &&
      source.includes("getBulkEditOperations(100, { role: actorRole, authHeader })") &&
      source.includes("getCategoryTree({ all: true }, { role: actorRole, authHeader") &&
      source.includes("getProducts({ role: actorRole, authHeader })"),
    "Operations bulk edit must load operations, categories, and products together from the shared auth context.",
  );
  assert(
    source.includes("const filteredCategories = filterTestData(categories, hideTestData);") &&
      source.includes("const filteredProducts = filterTestData(products, hideTestData);") &&
      source.includes("const matchedProducts = filteredProducts.filter((product) => {"),
    "Operations bulk edit must apply hide-test-data filtering before building the scoped product preview set.",
  );
  assert(
    source.includes('const bulkEditMode = String(query.bulkEditMode ?? "").trim().toLowerCase() === "advanced" ? "advanced" : "structured";') &&
      source.includes('const bulkEditField = resolveStructuredBulkEditField(query.bulkEditField);') &&
      source.includes('const bulkEditOperation = resolveStructuredBulkEditOperation(query.bulkEditOperation);') &&
      source.includes('const shouldPreviewBulkEdit = String(query.bulkEditPreview ?? "") === "1";') &&
      source.includes("if (shouldPreviewBulkEdit) {") &&
      source.includes('if (bulkEditMode === "advanced") {') &&
      source.includes("buildStructuredBulkEditUpdates(bulkEditField, bulkEditOperation, bulkEditValue)") &&
      source.includes("JSON.parse(bulkEditUpdatesText)") &&
      source.includes('throw new Error("Bulk edit updates must be a JSON object.");'),
    "Operations bulk edit must only preview when explicitly requested and must validate both structured and advanced JSON update input.",
  );
  assert(
    source.includes("previewResult = await getBulkEditPreview(scope, parsedUpdates, { role: actorRole, authHeader });") &&
      source.includes("previewErrorCode = extractErrorCode(error instanceof Error ? error.message : String(error ?? \"\"));") &&
      source.includes('let previewErrorMessage: string | null = null;'),
    "Operations bulk edit must surface preview results and validation failures through the shared preview/error flow.",
  );
  assert(
    // Structured builder markup lives in its own client component now (see
    // STRUCTURED_CHANGE_BUILDER above) — page.tsx renders it via <StructuredChangeBuilder>
    // and still owns the advanced-JSON and apply-wiring markup directly.
    source.includes("import { StructuredChangeBuilder } from \"@/components/bulk-edit/structured-change-builder\";") &&
      source.includes("<StructuredChangeBuilder") &&
      builderSource.includes('Structured change builder') &&
      builderSource.includes('name="bulkEditField"') &&
      builderSource.includes('name="bulkEditOperation"') &&
      builderSource.includes('Generated update payload') &&
      source.includes('Advanced JSON mode') &&
      source.includes('Preview advanced JSON changes') &&
      source.includes("applyAction={applyBulkEditAction}") &&
      builderSource.includes('Preview affected products'),
    "Operations bulk edit must default to a structured builder, keep advanced JSON secondary, and only wire apply through the diff preview component.",
  );
  assert(
    source.includes('Your role cannot run or apply bulk edits.') &&
      source.includes('No bulk edit operations found yet.') &&
      source.includes('redirect(buildLoginRedirect("/operations/bulk-edit", error));'),
    "Operations bulk edit must surface honest read-only/history-empty states and redirect auth failures through the shared login helper.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "operations_bulk_edit_route_normalizes_hide_test_data",
          "operations_bulk_edit_route_normalizes_and_dedupes_product_ids",
          "operations_bulk_edit_route_uses_shared_auth_and_write_capability",
          "operations_bulk_edit_route_fetches_operations_categories_and_products_in_parallel",
          "operations_bulk_edit_route_filters_test_data_before_scoping_preview",
          "operations_bulk_edit_route_requires_explicit_preview_and_json_object_updates",
          "operations_bulk_edit_route_surfaces_preview_and_error_flow",
          "operations_bulk_edit_route_uses_preview_first_apply_contract",
          "operations_bulk_edit_route_handles_read_only_empty_and_auth_redirect_states",
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
  console.error("Operations bulk edit route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
