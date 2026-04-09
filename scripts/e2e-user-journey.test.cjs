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
