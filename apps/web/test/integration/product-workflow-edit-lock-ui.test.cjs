#!/usr/bin/env node
/* eslint-disable no-console */
// PIM#581: an operator on an approved/published product had no discoverable path to
// edit it. Root cause was threefold — this test pins all three fixes so they can't
// silently regress:
//   1. The Status <select> offered all 5 statuses unconditionally, so an operator
//      naturally picked "in_review" (the intuitive "go back a step") and hit a dead
//      end. The real transition is approved -> draft. The select must now be filtered
//      to only the transitions the backend will actually accept.
//   2. updateProductAction's catch block only ever set a raw errorMessage, bypassing
//      the existing lib/errors.ts ERROR_MAP entirely, so WORKFLOW_CONTENT_LOCKED (which
//      already had a friendly "Change the workflow status to Draft first" message
//      defined) rendered as a raw dump instead. It must route through the same
//      resolveProductWriteErrorParams() helper the variant actions already use.
//   3. The single-product PATCH endpoint threw a plain-string BadRequestException for
//      an invalid transition, so it could never resolve to the WORKFLOW_ENTRY_INVALID
//      ERROR_MAP entry that already existed for it. It must use the same structured
//      { code, message, ... } body WORKFLOW_CONTENT_LOCKED already uses.
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CONTENT_TAB = path.join(REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "_components", "content-tab.tsx");
const ACTIONS = path.join(REPO_ROOT, "apps", "web", "src", "app", "actions.ts");
const CATALOG_SERVICE = path.join(REPO_ROOT, "apps", "api", "src", "catalog", "catalog.service.ts");
const WORKFLOW_TRANSITIONS_FILE = path.join(REPO_ROOT, "apps", "api", "src", "common", "workflow", "workflow-transitions.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const contentTab = fs.readFileSync(CONTENT_TAB, "utf8");
  const actions = fs.readFileSync(ACTIONS, "utf8");
  const catalogService = fs.readFileSync(CATALOG_SERVICE, "utf8");
  const workflowTransitions = fs.readFileSync(WORKFLOW_TRANSITIONS_FILE, "utf8");

  assert(
    contentTab.includes("function getSelectableStatuses(") &&
      contentTab.includes("getSelectableStatuses(data.product.status, data.actorRole).map("),
    "Product Content tab's editable Status select must be driven by getSelectableStatuses(), not a hardcoded list of all 5 statuses.",
  );
  // The read-only (canWrite=false) status display further down is a disabled <select>
  // that only ever shows the current value — its fixed option list is harmless there
  // and intentionally out of scope for this fix.
  assert(
    contentTab.includes("canDecideApproval(actorRole)") &&
      contentTab.includes('target === "draft"'),
    "Product Content tab's status-option filter must hide the approved/active -> draft revert option for roles that can't use it (matches allowedRevertRoles in catalog.service.ts), not just show it and let the backend 403.",
  );

  assert(
    actions.includes("function resolveProductWriteErrorParams(error: unknown)"),
    "actions.ts must expose a shared error-to-query-params resolver (renamed from the variant-only resolveVariantErrorParams) so every product write action can surface known governance codes through the ERROR_MAP.",
  );
  const updateProductActionBody = actions.slice(
    actions.indexOf("export async function updateProductAction"),
    actions.indexOf("export async function revertProductToDraftAction"),
  );
  assert(
    updateProductActionBody.includes("...resolveProductWriteErrorParams(error)") &&
      !updateProductActionBody.includes('updateStatus: "error",'),
    "updateProductAction's catch-all redirect must spread resolveProductWriteErrorParams(error) (so WORKFLOW_CONTENT_LOCKED etc. resolve through ERROR_MAP) instead of only setting a raw updateStatus/errorMessage pair.",
  );

  assert(
    catalogService.includes('code: "WORKFLOW_ENTRY_INVALID"') &&
      catalogService.includes("currentStatus: current.status,") &&
      catalogService.includes("requestedStatus: nextStatus,"),
    "catalog.service.ts must throw a structured { code: WORKFLOW_ENTRY_INVALID, ... } body for invalid workflow transitions on the single-product PATCH endpoint, matching the WORKFLOW_CONTENT_LOCKED pattern, so the web client's ERROR_MAP entry for it is reachable.",
  );

  // Keep the web-side transition table honest against the backend's source of truth —
  // fails loudly if either drifts instead of silently mismatching.
  const apiTransitions = {};
  const tableMatch = workflowTransitions.match(/WORKFLOW_TRANSITIONS[^{]*\{([\s\S]*?)\};/);
  assert(tableMatch, "Could not locate WORKFLOW_TRANSITIONS table in workflow-transitions.ts to cross-check against the web client's copy.");
  for (const line of tableMatch[1].split("\n")) {
    const rowMatch = line.match(/^\s*(\w+):\s*\[(.*)\]/);
    if (!rowMatch) continue;
    const [, status, valuesRaw] = rowMatch;
    apiTransitions[status] = valuesRaw
      .split(",")
      .map((v) => v.trim().replace(/["']/g, ""))
      .filter(Boolean);
  }
  const webTableMatch = contentTab.match(/const WORKFLOW_TRANSITIONS[^{]*\{([\s\S]*?)\};/);
  assert(webTableMatch, "Could not locate the mirrored WORKFLOW_TRANSITIONS constant in content-tab.tsx.");
  for (const [status, apiTargets] of Object.entries(apiTransitions)) {
    for (const target of apiTargets) {
      assert(
        webTableMatch[1].includes(`"${target}"`) || webTableMatch[1].includes(`'${target}'`),
        `content-tab.tsx's mirrored transition table appears to be missing "${target}" somewhere it's referenced from the API's WORKFLOW_TRANSITIONS["${status}"] — the two tables have drifted.`,
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "content_tab_status_select_filtered_to_valid_transitions",
          "content_tab_hides_unusable_revert_option_by_role",
          "update_product_action_routes_errors_through_error_map",
          "catalog_service_throws_structured_workflow_entry_invalid",
          "web_transition_table_not_obviously_drifted_from_api",
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
  console.error("Product workflow edit-lock UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
