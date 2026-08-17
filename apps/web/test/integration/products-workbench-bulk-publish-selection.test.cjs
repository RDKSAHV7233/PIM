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
const ACTIONS_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "actions.ts");

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
  const actionsSource = fs.readFileSync(ACTIONS_FILE, "utf8");

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
  // product-status facet filter — both now use structurally distinct query keys.
  assert(
    pageSource.includes("const publishConnectors = installedConnectors") &&
      pageSource.includes('item.status === "ACTIVE" && item.capabilities.includes("PUBLISH")') &&
      pageSource.includes("publishConnectors={publishConnectors}"),
    "Catalog products route must derive the publish-capable, active connector list from the already-fetched installed connectors and pass it into the workbench.",
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

  // ─── PIM#596 regression: dedicated bulkPublishStatus key, not an overloaded `status` ───
  //
  // PIM#595 originally reused the Products page's `status` query key for the bulk-publish
  // outcome, disambiguated by a "bulk-publish-" prefix check. That still let
  // appendQueryParams(returnTo, { status: "bulk-publish-queued", ... }) *overwrite* whatever
  // `status=<facet>` was already in returnTo's query string — so submitting bulk publish while
  // a status facet filter was active silently cleared that filter after redirect. Fixed by
  // giving the outcome its own query key so the two can never collide, structurally.

  // appendQueryParams must only set the specific keys passed to it, never touch any other
  // existing query param on returnTo (categoryId, brand, search, view, page, status, ...).
  assert(
    actionsSource.includes(
      "function appendQueryParams(basePath: string, params: Record<string, string | undefined>): string {",
    ) &&
      actionsSource.includes("const [path, query = \"\"] = basePath.split(\"?\");") &&
      actionsSource.includes("const search = new URLSearchParams(query);") &&
      actionsSource.includes("for (const [key, value] of Object.entries(params)) {") &&
      actionsSource.includes("search.set(key, value.trim());"),
    "appendQueryParams must parse returnTo's existing query string and only .set() the specific keys passed to it — every other existing param (categoryId, brand, search, view, page, status, ...) must survive untouched. If this text drifts, re-verify the behavior by hand before changing the assertion.",
  );

  // All five triggerBulkPublishAction outcome branches must redirect under the dedicated
  // bulkPublishStatus key — none may still use the shared `status` key.
  const bulkPublishStatusKeyMatches = actionsSource.match(/bulkPublishStatus: "bulk-publish-[a-z-]+"/g) || [];
  assert(
    bulkPublishStatusKeyMatches.length === 5,
    `triggerBulkPublishAction must redirect all five outcome branches (queued, none-eligible, too-large, timeout, error) under the dedicated bulkPublishStatus query key — found ${bulkPublishStatusKeyMatches.length}.`,
  );
  assert(
    !/\bstatus:\s*"bulk-publish-/.test(actionsSource),
    "triggerBulkPublishAction must no longer write any bulk-publish outcome under the shared `status` key — that's exactly what collided with the Products workbench's product-status facet filter.",
  );

  // Products route: no filter active → outcome still resolves cleanly, and — critically — the
  // product-status facet filter is read as a plain value with no bulk-publish special-casing
  // (the prefix-disambiguation hack from PIM#595 must be gone).
  assert(
    pageSource.includes("const facetStatus = query.status?.trim() || undefined;") &&
      !pageSource.includes("isBulkPublishOutcomeStatus") &&
      !pageSource.includes('startsWith("bulk-publish-")'),
    "Catalog products route must read the product-status facet filter as a plain, untouched value — the prefix-disambiguation hack is no longer needed now that the outcome lives under its own key.",
  );
  assert(
    pageSource.includes("resolveBulkPublishStatusMessage(query.bulkPublishStatus, {") &&
      pageSource.includes("bulkPublishStatus?: string;"),
    "Catalog products route must resolve the bulk-publish outcome from its own dedicated bulkPublishStatus query key, independent of the status facet filter.",
  );

  // Regression: status=approved (or any other facet, e.g. categoryId/brand) must survive a
  // bulk-publish redirect unchanged, and the outcome banner must render as a separate concern.
  // facetStatus feeds the product search query; bulkPublishStatusMessage feeds a separate
  // banner prop — neither reads or derives from the other, so an active facet filter can never
  // be clobbered by a bulk-publish redirect (and vice versa).
  assert(
    pageSource.includes("status: facetStatus, offset, limit") &&
      pageSource.includes("bulkPublishStatusMessage={bulkPublishStatusMessage}") &&
      !pageSource.includes("facetStatus ? undefined") &&
      !pageSource.includes("bulkPublishStatusMessage ? resolveBulkPublishStatusMessage"),
    "Product-status facet filter (facetStatus) and the bulk-publish outcome banner (bulkPublishStatusMessage) must be derived unconditionally and independently, so an active facet filter (status=approved, categoryId=..., brand=...) survives a bulk-publish redirect unchanged and the outcome still renders as its own banner.",
  );

  // Connector Sync tab caller: must keep working end-to-end with the renamed shared key. Every
  // other action on that page (credentials, publication targets, delta sync, schedule, ...)
  // keeps using `status` unchanged; only the bulk-publish branch now also checks
  // bulkPublishStatus, since triggerBulkPublishAction is the same shared action used by the
  // Products workbench.
  assert(
    connectorDetailSource.includes("connectorDetailStatusMessage(query.status ?? query.bulkPublishStatus, {") &&
      connectorDetailSource.includes("bulkPublishStatus?: string;"),
    "Connector Sync tab must read the shared bulk-publish outcome via the renamed bulkPublishStatus key (falling back from status), so its own bulk-publish banner keeps working unchanged after the shared action's key rename.",
  );

  // Sanity: a bulkPublishStatus value can never be misread as a product lifecycle `status`
  // value anywhere — trivially true once the two are read from structurally distinct keys on
  // both pages, asserted explicitly so a future refactor can't quietly re-merge them.
  assert(
    pageSource.includes("query.status") &&
      pageSource.includes("query.bulkPublishStatus") &&
      !pageSource.includes("resolveBulkPublishStatusMessage(query.status"),
    "Bulk-publish outcome values (bulk-publish-queued/too-large/...) must never be read from the same query key the product-status facet filter reads from — the Products route must reference query.status and query.bulkPublishStatus as two independent fields.",
  );
  assert(
    connectorDetailSource.includes("query.status ?? query.bulkPublishStatus") &&
      !connectorDetailSource.includes("query.bulkPublishStatus ?? query.status"),
    "Connector Sync tab must prefer its own action-outcome `status` values first and only fall back to bulkPublishStatus for the bulk-publish case, keeping every other status branch's precedence unchanged.",
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
          "catalog_products_route_supplies_publish_connectors",
          "bulk_publish_status_helper_covers_all_redirect_outcomes",
          "append_query_params_only_sets_passed_keys",
          "trigger_bulk_publish_action_uses_dedicated_bulk_publish_status_key",
          "catalog_products_route_facet_status_no_longer_special_cased",
          "catalog_products_route_facet_and_outcome_derived_independently",
          "connector_sync_tab_reads_renamed_bulk_publish_status_key",
          "bulk_publish_status_never_misreadable_as_facet_status",
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
