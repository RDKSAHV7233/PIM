#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "operations", "bulk-edit", "page.tsx");
const ACCESS_POLICY = path.join(REPO_ROOT, "apps", "api", "src", "common", "access-policy", "access-policy.service.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const pageSource = fs.readFileSync(PAGE, "utf8");
  const policySource = fs.readFileSync(ACCESS_POLICY, "utf8");

  // 1. All supported statuses appear in the scope filter dropdown
  const ALL_STATUSES = ["draft", "in_review", "approved", "rejected", "active", "archived"];
  for (const status of ALL_STATUSES) {
    assert(
      pageSource.includes(`<option value="${status}">${status}</option>`),
      `Status filter dropdown must include option for "${status}".`,
    );
  }

  // 2. Selected status reaches the preview query scope
  assert(
    pageSource.includes("bulkEditStatus") &&
      pageSource.includes("scope.status = bulkEditStatus"),
    "Selected bulkEditStatus must be passed into the preview scope object.",
  );
  assert(
    pageSource.includes('name="bulkEditStatus"') &&
      pageSource.includes("defaultValue={bulkEditStatus}"),
    "Status filter must be a named form input with defaultValue preserving the current selection.",
  );

  // 3. Statuses restricted by backend policy are NOT offered in the scope filter
  //    (The scope filter is a read-only query filter — no backend restriction applies.
  //    However, the BULK EDIT FIELD "status" is admin-only. Verify the policy constant
  //    only restricts the bulk-edit write operation, not the scope filter.)
  assert(
    policySource.includes('const RESTRICTED_BULK_EDIT_FIELDS = ["status"]'),
    "Backend must restrict bulk-edit writes on 'status' field to admin only.",
  );
  assert(
    policySource.includes("this.isAdmin(actor)"),
    "Backend bulk-edit field restriction must check isAdmin before allowing restricted fields.",
  );
  // The scope filter is a GET param (read operation) — verify it does NOT gate statuses
  // behind a role check in the page source.
  assert(
    !pageSource.match(/if\s*\(\s*actorRole\s*!==\s*["']admin["']\s*\)[\s\S]{0,200}bulkEditStatus/),
    "Scope filter must NOT restrict status options to admin-only — it is a read filter, not a write.",
  );

  // 4. Existing query params are preserved (form uses method=get with named inputs)
  assert(
    pageSource.includes('method="get"') || pageSource.includes("method={'get'}"),
    "Bulk edit scope form must use method=get so all named inputs become URL params.",
  );
  assert(
    pageSource.includes('name="bulkEditStatus"') &&
      pageSource.includes('name="bulkEditCategoryId"') &&
      pageSource.includes('name="bulkEditBrandContains"') &&
      pageSource.includes('name="bulkEditProductIds"'),
    "All scope filter inputs must have name attributes to be preserved as query params on submit.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "all_supported_statuses_appear_in_scope_filter",
          "selected_status_reaches_preview_query",
          "backend_restricts_status_writes_not_scope_reads",
          "existing_query_params_preserved_via_get_form",
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
  console.error("Bulk edit status filter test FAILED:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
