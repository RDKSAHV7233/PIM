#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const VARIANTS_TAB = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "products",
  "[id]",
  "_components",
  "variants-tab.tsx",
);
const ACTIONS = path.join(REPO_ROOT, "apps", "web", "src", "app", "actions.ts");
const CATALOG_CONTROLLER = path.join(REPO_ROOT, "apps", "api", "src", "catalog", "catalog.controller.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const variantsSource = fs.readFileSync(VARIANTS_TAB, "utf8");
  const actionsSource = fs.readFileSync(ACTIONS, "utf8");
  const controllerSource = fs.readFileSync(CATALOG_CONTROLLER, "utf8");

  assert(
    controllerSource.includes('@Patch("variants/:id")') &&
      controllerSource.includes('@Delete("variants/:id")') &&
      controllerSource.includes('updateVariant(') &&
      controllerSource.includes('deleteVariant('),
    "Backend variant update/delete endpoints must exist before exposing lifecycle controls.",
  );
  assert(
    actionsSource.includes("export async function updateVariantAction") &&
      actionsSource.includes("patchJsonForAction(formData, `/catalog/variants/${encodeURIComponent(variantId)}`") &&
      actionsSource.includes("export async function deleteVariantAction") &&
      actionsSource.includes("deleteJsonForAction(formData, `/catalog/variants/${encodeURIComponent(variantId)}`"),
    "Web server actions must call existing variant PATCH and DELETE contracts.",
  );
  assert(
    variantsSource.includes("updateVariantAction") &&
      variantsSource.includes("deleteVariantAction") &&
      variantsSource.includes('data-variant-lifecycle-actions="true"'),
    "Variants tab must expose lifecycle actions in the variant row.",
  );
  assert(
    variantsSource.includes("Update variant") &&
      variantsSource.includes('form={editFormId}') &&
      variantsSource.includes('name="skuCode"') &&
      variantsSource.includes('name="inventoryQty"') &&
      variantsSource.includes('name="status"'),
    "Variant edit controls must be visible and submit editable SKU, inventory, and status fields.",
  );
  assert(
    variantsSource.includes("<details") &&
      variantsSource.includes("Remove variant") &&
      variantsSource.includes('name="confirmRemove"') &&
      variantsSource.includes("required") &&
      variantsSource.includes('variant="destructive"'),
    "Variant removal must be protected by an explicit confirmation control.",
  );
  assert(
    variantsSource.includes("data.canWrite ?") &&
      variantsSource.includes("Read-only") &&
      variantsSource.includes("Your role cannot create variants."),
    "Variant lifecycle controls must stay role-aware for read-only users.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "backend_variant_update_delete_contracts_exist",
          "web_variant_update_delete_actions_call_existing_contracts",
          "variant_rows_expose_edit_controls",
          "variant_delete_requires_confirmation",
          "variant_lifecycle_controls_are_role_aware",
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
  console.error("Product variant lifecycle UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
