#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const pricingClient = read("apps/web/src/lib/api/pricing.ts");
  const pricingProxy = read("apps/web/src/app/api/pricing/price-lists/route.ts");
  const priceRowsProxy = read("apps/web/src/app/api/pricing/price-lists/[priceListId]/prices/route.ts");
  const actions = read("apps/web/src/app/actions.ts");
  const errors = read("apps/web/src/lib/errors.ts");
  const variantsTab = read("apps/web/src/app/products/[id]/_components/variants-tab.tsx");
  const dashboard = read("apps/web/src/app/dashboard/page.tsx");
  const sidebar = read("apps/web/src/components/nav/app-sidebar.tsx");
  const navigation = read("apps/web/src/lib/admin-navigation.ts");
  const accessPolicy = read("apps/api/src/common/access-policy/access-policy.service.ts");

  assert(
    pricingClient.includes("shouldUseBrowserPricingProxy") &&
      pricingClient.includes("fetch(`/api${path}`") &&
      pricingProxy.includes("resolveBearerToken(request)") &&
      pricingProxy.includes("AUTH_REQUIRED") &&
      priceRowsProxy.includes("resolveBearerToken(request)") &&
      priceRowsProxy.includes("validateCsrf(request)"),
    "Pricing tab client reads/writes must proxy through the web session and return sanitized auth failures.",
  );

  assert(
    pricingClient.includes('{ method: "PUT", body: JSON.stringify({ prices }) }') &&
      priceRowsProxy.includes("export async function PUT(") &&
      !pricingClient.includes("postJson<{ upserted: number }>(`/pricing/price-lists/${priceListId}/prices`"),
    "Product price upsert must use the backend PUT contract, not the obsolete POST call.",
  );

  assert(
    actions.includes('return { error: "VARIANT_ATTRIBUTES_INVALID", errorMessage: message };') &&
      actions.indexOf('try {\n    const attributes = parseJsonObject(formData.get("variantAttributes"), "Attributes");') >
        actions.indexOf("export async function createVariantAction") &&
      actions.indexOf('try {\n    const attributes = parseJsonObject(formData.get("variantAttributes"), "Attributes");') <
        actions.indexOf("await postJsonForAction(formData, `/catalog/products/${productId}/variants`") &&
      errors.includes("VARIANT_ATTRIBUTES_INVALID") &&
      variantsTab.includes('Optional JSON object, for example {"{\\"color\\":\\"blue\\"}"}.'),
    "Plain-text variant attributes must be handled as a validation error instead of crashing the product page.",
  );

  assert(
    dashboard.includes("const canCreateProducts = canEditWorkspace(actorRole);") &&
      dashboard.includes("const canFixIssues = canResolveIssueInboxWarnings(actorRole);") &&
      dashboard.includes("const canImportCatalog = canEditWorkspace(actorRole);") &&
      dashboard.includes("const canOpenApprovalQueue = canDecideApproval(actorRole);") &&
      dashboard.includes("const canOpenMappingManager = canManageChannels(actorRole);") &&
      dashboard.includes("{canCreateProducts ? (") &&
      dashboard.includes("{canFixIssues ? (") &&
      dashboard.includes("{canImportCatalog ? ("),
    "Dashboard action buttons must be filtered by role instead of being visible to restricted roles.",
  );

  assert(
    navigation.includes('"channel_manager_plus"') &&
      navigation.includes('"approval_decider"') &&
      sidebar.includes('visibility: "channel_manager_plus"') &&
      sidebar.includes('visibility: "approval_decider"') &&
      sidebar.includes('visibility: "editor_plus"') &&
      sidebar.includes('visibility: "admin"'),
    "Sidebar navigation must hide restricted pages using role-aware navigation audiences.",
  );

  assert(
    accessPolicy.includes('role === "admin" || role === "editor" || role === "approver" || role === "reviewer"'),
    "Approver and reviewer roles must both be allowed to see the approval queue count.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "pricing_tab_uses_authenticated_sanitized_web_proxy",
          "pricing_upsert_uses_backend_put_contract",
          "variant_attributes_plain_text_redirects_to_validation_error",
          "dashboard_actions_are_role_filtered",
          "sidebar_restricted_routes_are_role_filtered",
          "approver_can_read_approval_queue_count",
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
  console.error("Pilot GO conditions remediation UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
