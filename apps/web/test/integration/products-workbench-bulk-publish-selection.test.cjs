#!/usr/bin/env node
/* eslint-disable no-console */
// PIM#595: the connector Sync tab's "Bulk publish" control only ever submits an
// auto-computed "every approved/active product in this connector workspace" batch — there is
// no manual selection UI anywhere, so operators cannot narrow a batch below the connector's
// bulk-publish ceiling once the workspace crosses it (live-verified against production
// Shopify: 53 approved products auto-selected, submit rejected as "over the 50-product
// limit", no in-UI recovery path). This test pins the fix: the Products workbench now
// exposes a real per-channel checkbox selection UI that submits exactly the operator-chosen
// productIds through the existing, unchanged bulk-publish backend endpoint — and pins that
// the connector Sync tab's original auto-computed flow is untouched.
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PRODUCTS_TAB = path.join(REPO_ROOT, "apps", "web", "src", "components", "product", "products-tab.tsx");
const PRODUCTS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "catalog", "products", "page.tsx");
const CONNECTOR_DETAIL_PAGE = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "channels",
  "connectors",
  "[installationId]",
  "page.tsx",
);
const CONFIRM_FORM = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "channels",
  "connectors",
  "[installationId]",
  "bulk-publish-confirm-form.tsx",
);
const BULK_PUBLISH_STATUS_LIB = path.join(REPO_ROOT, "apps", "web", "src", "lib", "bulk-publish-status.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const tabSource = fs.readFileSync(PRODUCTS_TAB, "utf8");
  const pageSource = fs.readFileSync(PRODUCTS_PAGE, "utf8");
  const connectorDetailSource = fs.readFileSync(CONNECTOR_DETAIL_PAGE, "utf8");
  const confirmFormSource = fs.readFileSync(CONFIRM_FORM, "utf8");

  // (a) Products workbench renders a real checkbox per row, gated by per-channel readiness —
  // not a fixed/auto-computed selection.
  assert(
    tabSource.includes('type="checkbox"') &&
      tabSource.includes("checked={selectedProductIds.has(product.id)}") &&
      tabSource.includes("disabled={!eligible}") &&
      tabSource.includes("onChange={() => toggleProductSelected(product.id)}"),
    "Products workbench must render a per-row checkbox bound to explicit client-side selection state, disabled when the row is ineligible.",
  );
  assert(
    tabSource.includes("const isEligibleForBulkPublish = useCallback(") &&
      tabSource.includes('readinessState[product.id]?.[selectedPublishChannel]?.status === "ready"') &&
      (tabSource.includes('product.status === "approved" || product.status === "active"')),
    "Bulk-publish row eligibility must reuse the existing per-product per-channel readiness state and approval status instead of re-deriving readiness logic.",
  );
  assert(
    tabSource.includes("const selectedPublishConnector = useMemo(") &&
      tabSource.includes("publishConnectors.find((connector) => connector.id === selectedPublishConnectorId)"),
    "Products workbench must let the operator pick exactly one connector/channel to target per bulk-publish batch.",
  );
  assert(
    tabSource.includes("function toggleSelectAllEligibleVisible()") &&
      tabSource.includes("new Set(eligiblePublishProductIds)") &&
      tabSource.includes(
        "visibleProducts.filter((product) => isEligibleForBulkPublish(product)).map((product) => product.id)",
      ),
    "Select-all must be scoped to the currently visible page's eligible rows only, not the full catalog.",
  );
  assert(
    tabSource.includes("setSelectedProductIds(new Set());") &&
      tabSource.includes("[visibleProductIdKey, selectedPublishConnectorId]"),
    "Bulk-publish selection must reset when the visible page or target connector changes — no cross-page persisted selection.",
  );

  // (b) Submitting sends exactly the operator-selected productIds, not an auto-computed
  // "every approved product" list.
  assert(
    tabSource.includes('productIds={Array.from(selectedProductIds)}') &&
      tabSource.includes("action={triggerBulkPublishAction}"),
    "Products workbench bulk-publish submission must send exactly the operator-selected product IDs through the existing triggerBulkPublishAction, not an auto-derived list.",
  );
  assert(
    !tabSource.includes('.filter((product) => product.status === "approved" || product.status === "active")\n    .map((product) => product.id)'),
    "Products workbench must not auto-compute a full 'every approved product' batch the way the connector Sync tab's bulkPublishProductIds does — selection must stay operator-driven.",
  );
  assert(
    tabSource.includes("import { triggerBulkPublishAction, updateProductStatusAction } from \"@/app/actions\";") &&
      tabSource.includes(
        'import { BulkPublishConfirmForm } from "@/app/channels/connectors/[installationId]/bulk-publish-confirm-form";',
      ),
    "Products workbench must reuse the existing server action and confirm-dialog form rather than duplicating bulk-publish plumbing.",
  );

  // Soft, non-authoritative ceiling warning: must be clearly commented as UX-only, not
  // enforcement — the server remains the source of truth for the real ceiling.
  assert(
    tabSource.includes("bulkPublishSoftWarningCeiling") &&
      tabSource.includes("UX-only soft-warning ceiling") &&
      tabSource.includes("NOT authoritative"),
    "Any client-side bulk-publish batch-size ceiling must be explicitly documented as a non-authoritative UX warning, since the real ceiling is not exposed by the backend.",
  );

  // (c) The connector Sync tab's original auto-computed "everything approved" flow must be
  // unchanged: same bulkPublishProductIds derivation, same BulkPublishConfirmForm call site.
  assert(
    connectorDetailSource.includes("const bulkPublishProductIds = products") &&
      connectorDetailSource.includes('.filter((product) => product.status === "approved" || product.status === "active")') &&
      connectorDetailSource.includes("productIds={bulkPublishProductIds}"),
    "Connector Sync tab must keep auto-computing its bulk-publish batch from every approved/active product in the connector workspace, unchanged by the Products workbench's manual-selection feature.",
  );
  assert(
    connectorDetailSource.includes("<BulkPublishConfirmForm") &&
      !connectorDetailSource.includes("summaryLabel=") &&
      !connectorDetailSource.includes("idleLabelWhenEmpty="),
    "Connector Sync tab's BulkPublishConfirmForm call site must not need any new props — the generalized copy-override props must default to the original connector-page wording.",
  );

  // The shared confirm-dialog/hidden-form component must stay generic (copy-override props
  // with defaults) instead of being duplicated for the Products workbench.
  assert(
    confirmFormSource.includes("summaryLabel = (count) =>") &&
      confirmFormSource.includes("confirmDescription = (count) =>") &&
      confirmFormSource.includes('idleLabelWhenEmpty = "No approved products"') &&
      confirmFormSource.includes("selected from this connector workspace"),
    "BulkPublishConfirmForm must expose copy-override props with defaults that preserve the original connector Sync tab wording, so both callers share one component.",
  );

  // Products route (server component) must supply the publish-capable connector list and
  // resolve the bulk-publish redirect outcome without colliding with the pre-existing
  // product-status facet filter that already uses the same `status` query key.
  assert(
    pageSource.includes("const publishConnectors = installedConnectors") &&
      pageSource.includes('item.status === "ACTIVE" && item.capabilities.includes("PUBLISH")') &&
      pageSource.includes("publishConnectors={publishConnectors}"),
    "Catalog products route must derive the publish-capable, active connector list from the already-fetched installed connectors and pass it into the workbench.",
  );
  assert(
    pageSource.includes('rawStatusParam?.startsWith("bulk-publish-")') &&
      pageSource.includes("const facetStatus = isBulkPublishOutcomeStatus ? undefined : rawStatusParam;") &&
      pageSource.includes("bulkPublishStatusMessage={bulkPublishStatusMessage}"),
    "Catalog products route must disambiguate the shared `status` query key between the product-status facet filter and a bulk-publish redirect outcome, and surface the resolved outcome banner into the workbench.",
  );
  assert(
    pageSource.includes('import { resolveBulkPublishStatusMessage } from "@/lib/bulk-publish-status";'),
    "Catalog products route must resolve bulk-publish redirect outcomes through the shared status-message helper instead of re-deriving the copy.",
  );

  // Shared status-message helper must exist and cover every outcome triggerBulkPublishAction
  // can redirect with.
  const statusLibSource = fs.readFileSync(BULK_PUBLISH_STATUS_LIB, "utf8");
  assert(
    statusLibSource.includes('"bulk-publish-queued"') &&
      statusLibSource.includes('"bulk-publish-none-eligible"') &&
      statusLibSource.includes('"bulk-publish-too-large"') &&
      statusLibSource.includes('"bulk-publish-timeout"') &&
      statusLibSource.includes('"bulk-publish-error"'),
    "Shared bulk-publish status-message helper must cover every outcome triggerBulkPublishAction can redirect with.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "products_workbench_renders_channel_gated_checkboxes",
          "products_workbench_reuses_existing_readiness_and_approval_data_for_eligibility",
          "products_workbench_select_all_scoped_to_visible_eligible_rows",
          "products_workbench_selection_resets_on_page_or_connector_change",
          "products_workbench_submits_exact_operator_selection_not_auto_computed_batch",
          "products_workbench_reuses_existing_server_action_and_confirm_form",
          "products_workbench_soft_ceiling_warning_documented_as_non_authoritative",
          "connector_sync_tab_auto_computed_bulk_publish_flow_unchanged",
          "bulk_publish_confirm_form_generalized_with_backward_compatible_defaults",
          "catalog_products_route_supplies_publish_connectors_and_disambiguates_status_param",
          "bulk_publish_status_helper_covers_all_redirect_outcomes",
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
  console.error("Products workbench bulk-publish selection test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
