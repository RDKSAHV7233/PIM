#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CONTROLLER = path.join(REPO_ROOT, "apps", "api", "src", "marketplace", "marketplace.controller.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(CONTROLLER, "utf8");

  assert(
    source.includes("import { APP_ROLES, AppRole, Roles } from \"../common/rbac/roles\";"),
    "Marketplace controller must import APP_ROLES so readiness reads can align with the supported operator role matrix.",
  );
  assert(
    source.includes('@Get("products/:id/simulate")') &&
      source.includes('@Post("products/:id/simulate")') &&
      source.includes('@Post("readiness/batch")') &&
      source.includes("@Roles(...APP_ROLES)"),
    "Marketplace readiness endpoints must grant simulation and batch-summary access to the full supported app-role set instead of admin-only access.",
  );
  assert(
    source.includes('@Get("products/:id/simulate")\n  @AdminBoundaryAccess({ capability: "manage_product_data" })') &&
      source.includes('@Post("products/:id/simulate")\n  @AdminBoundaryAccess({ capability: "manage_product_data" })') &&
      source.includes('@Post("readiness/batch")\n  @HttpCode(200)\n  @AdminBoundaryAccess({ capability: "manage_product_data" })'),
    "Marketplace readiness reads must keep manage_product_data admin-boundary gating so product_admin can use them while system_admin remains outside the product-data boundary.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "marketplace_readiness_endpoints_use_full_app_role_set",
          "marketplace_readiness_endpoints_keep_product_data_admin_boundary",
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
  console.error("Marketplace readiness role contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
