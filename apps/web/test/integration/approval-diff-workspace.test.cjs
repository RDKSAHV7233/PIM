#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const APPROVALS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "quality", "approvals", "page.tsx");
const REVISIONS_CLIENT = path.join(REPO_ROOT, "apps", "web", "src", "lib", "api", "revisions.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const approvalsSource = fs.readFileSync(APPROVALS_PAGE, "utf8");
  const revisionsSource = fs.readFileSync(REVISIONS_CLIENT, "utf8");

  assert(
    approvalsSource.includes("getProductRevisions") &&
      approvalsSource.includes('from "@/lib/api/revisions"'),
    "Approvals page must import the revision client function getProductRevisions from @/lib/api/revisions.",
  );

  assert(
    revisionsSource.includes("export async function getProductRevisions") &&
      revisionsSource.includes("ProductRevision") &&
      revisionsSource.includes("ProductRevisionsResponse"),
    "revisions.ts must export getProductRevisions and define ProductRevision and ProductRevisionsResponse types.",
  );

  assert(
    approvalsSource.includes("revisionsByProduct") &&
      approvalsSource.includes("revisionsByProduct.get(product.id)"),
    "Approvals page must build a revisionsByProduct map and look up revisions per product.",
  );

  assert(
    approvalsSource.includes("What Changed") &&
      approvalsSource.includes("changedFields") &&
      approvalsSource.includes("change.before") &&
      approvalsSource.includes("change.after"),
    "Approvals page must render a 'What Changed' section with before/after diff values.",
  );

  assert(
    approvalsSource.includes("Graceful degradation") ||
      (approvalsSource.includes("try {") && approvalsSource.includes("} catch {")),
    "Approvals page must handle revision fetch failure gracefully without breaking the approval flow.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "approvals_page_imports_revision_client",
          "revisions_ts_exports_correct_types",
          "approvals_page_fetches_revisions_per_product",
          "approvals_page_renders_before_after_diff",
          "approvals_page_handles_revision_fetch_failure_gracefully",
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
  console.error("Approval diff workspace integration test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
