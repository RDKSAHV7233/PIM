#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT_PATH = path.join(REPO_ROOT, "scripts", "e2e-user-journey.cjs");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");

  assert(
    script.includes("async function ensureEnterprisePlanTier(reason)"),
    "e2e-user-journey must define ensureEnterprisePlanTier",
  );
  assert(
    script.includes('api("POST", "/billing/plan-tier"') &&
      script.includes('planTier: "ENTERPRISE"'),
    "e2e-user-journey must be able to elevate the smoke tenant to ENTERPRISE",
  );
  assert(
    script.includes('withEnterprisePlanRetry("catalog:create_product_draft"'),
    "draft product creation must retry after smoke-tenant plan elevation",
  );
  assert(
    script.includes('withEnterprisePlanRetry("catalog:reject_non_draft_entry"'),
    "non-draft entry rejection must retry after smoke-tenant plan elevation",
  );
  assert(
    script.includes("function hasConfiguredAmazonInstallCredentials()") &&
      script.includes("STAGING_AMAZON_SELLER_ID") &&
      script.includes("STAGING_AMAZON_CLIENT_ID") &&
      script.includes("STAGING_AMAZON_CLIENT_SECRET") &&
      script.includes("STAGING_AMAZON_REFRESH_TOKEN"),
    "e2e-user-journey must support optional staging Amazon credentials",
  );
  assert(
    script.includes('skip("staging amazon seller credentials not configured")'),
    "amazon install check must skip cleanly when staging Amazon credentials are absent",
  );
  assert(
    script.includes('skip("staging workspace users have no shared initial password configured")'),
    "locked user check must skip cleanly when staging workspace users do not have a shared initial password",
  );
  assert(
    script.includes('web("GET", "/admin/users?showInvite=true"') &&
      script.includes('assert(html.includes("Close Invite"), "invite toggle missing")') &&
      script.includes('assert(html.includes("Create User"), "invite form submit button missing")') &&
      script.includes("Admin role is required to invite users, change roles, or change account access state."),
    "admin users page check must verify controls without treating role-matrix read-only copy as a non-admin fallback",
  );
  assert(
    script.includes("const parentProductId = variant?.productId ?? ctx.productId;") &&
      script.includes("await normalizeProductForDelete(String(parentProductId));"),
    "variant cleanup must normalize the parent product before deleting workflow-locked variants",
  );
  assert(
    script.includes("async function purgeCreatedProductsForCategory(categoryId)") &&
      script.includes('api("DELETE", `/catalog/products/${encodeURIComponent(productId)}/purge`') &&
      script.includes("purgeStats = await purgeCreatedProductsForCategory(ctx.categoryId);") &&
      script.includes("productPurge=${purgeStats.purged}/${purgeStats.attempted}"),
    "category cleanup must hard-purge journey-created products via the DELETE purge route before deleting temporary categories",
  );
  assert(
    script.includes('String(getErrorMessageFromBody(result.body)).includes("Current status is approved")') &&
      script.includes("const product = await getProduct(ctx.productId);") &&
      script.includes('assert(product.status === "approved"'),
    "workflow approval smoke must tolerate only the already-approved post-condition after proving current product status",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "enterprise_plan_retry_helper_present",
          "billing_plan_tier_endpoint_used_for_smoke_capacity",
          "draft_product_creation_retries_after_plan_elevation",
          "non_draft_entry_check_retries_after_plan_elevation",
          "optional_amazon_connector_secrets_supported",
          "amazon_install_check_skips_without_staging_credentials",
          "locked_user_check_skips_without_shared_password",
          "admin_users_page_check_targets_non_admin_fallback",
          "variant_cleanup_normalizes_parent_product",
          "category_cleanup_purges_journey_products",
          "workflow_approval_smoke_tolerates_already_approved_postcondition",
        ],
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error("e2e-user-journey test failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
