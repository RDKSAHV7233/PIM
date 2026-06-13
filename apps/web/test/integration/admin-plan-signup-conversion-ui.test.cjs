#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PLAN_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "plan", "page.tsx");
const COMMERCIAL_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "commercial", "page.tsx");
const SIGNUP_CONVERSION = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "plan", "_components", "signup-conversion.tsx");
const PLAN_MANAGEMENT = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "plan", "_components", "plan-management.tsx");
const PLAN_COMPARISON = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "plan", "_components", "plan-comparison.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const planSource = fs.readFileSync(PLAN_PAGE, "utf8");
  const commercialSource = fs.readFileSync(COMMERCIAL_PAGE, "utf8");
  const conversionSource = fs.readFileSync(SIGNUP_CONVERSION, "utf8");
  const managementSource = fs.readFileSync(PLAN_MANAGEMENT, "utf8");
  const comparisonSource = fs.readFileSync(PLAN_COMPARISON, "utf8");

  assert(
    planSource.includes('title="Plan & Usage"') &&
      planSource.includes("getBillingPlans") &&
      planSource.includes("<PlanComparisonWrapper") &&
      !planSource.includes("getKpiTrends") &&
      !planSource.includes("<SignupConversionSection") &&
      !planSource.includes("Open commercial ops"),
    "Plan page must stay buyer-facing: usage, API-backed plans, and no internal signup/commercial ops section.",
  );

  assert(
    commercialSource.includes("hasCommercialOpsAccess") &&
      commercialSource.includes('adminBoundaryRoles.includes("system_admin")') &&
      commercialSource.includes('adminBoundaryRoles.includes("super_admin")') &&
      commercialSource.includes("<SignupConversionSection") &&
      commercialSource.includes("getKpiTrends({ days: signupTrendDays }") &&
      commercialSource.includes("signupExportHref"),
    "Commercial Ops page must own signup conversion analytics and require system/super boundary roles.",
  );

  assert(
    conversionSource.includes("Self-Serve Signup Conversion") &&
      conversionSource.includes("Workspace Signups") &&
      conversionSource.includes("Verified Workspaces") &&
      conversionSource.includes("Verification Rate") &&
      conversionSource.includes("Median Verify Time"),
    "Signup conversion component must preserve KPI labels after moving to Commercial Ops.",
  );

  assert(
    managementSource.includes("Plan changes are managed by Vexa commercial ops.") &&
      managementSource.includes("updateBillingContactAction") &&
      managementSource.includes("requestPlanUpgradeAction") &&
      managementSource.includes("requestedPlanTier") &&
      managementSource.includes("resolveNextPlanTier") &&
      managementSource.includes("Upgrade request pending"),
    "Plan management must preserve tenant admin billing-contact and tracked upgrade-request self-service.",
  );

  assert(
    comparisonSource.includes("type { PlanMetadata }") &&
      comparisonSource.includes('name="requestedPlanTier"') &&
      comparisonSource.includes('name="source" value="admin_plan_card"') &&
      comparisonSource.includes("hasOpenUpgradeRequest") &&
      comparisonSource.includes("canRequestUpgrade") &&
      !comparisonSource.includes("PLAN_TIERS ="),
    "Plan comparison must render API-backed metadata and submit requested target tiers from plan cards.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "plan_page_is_buyer_facing",
          "commercial_ops_owns_signup_conversion",
          "signup_conversion_component_preserved",
          "tenant_admin_billing_self_service_preserved",
          "plan_cards_submit_requested_plan_tier",
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
  console.error("Admin plan commercial split UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
