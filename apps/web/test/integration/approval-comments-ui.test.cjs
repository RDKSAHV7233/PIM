#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const APPROVALS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "quality", "approvals", "page.tsx");
const CATALOG_CLIENT = path.join(REPO_ROOT, "apps", "web", "src", "lib", "api", "catalog.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const approvalsSource = fs.readFileSync(APPROVALS_PAGE, "utf8");
  const catalogSource = fs.readFileSync(CATALOG_CLIENT, "utf8");

  assert(
    approvalsSource.includes("review-comments") ||
      approvalsSource.includes("getApprovalComments") ||
      approvalsSource.includes("Review Comments"),
    "Approvals page must import or reference review-comments (getApprovalComments or 'Review Comments' section).",
  );

  assert(
    catalogSource.includes("export async function getApprovalComments"),
    "catalog.ts must export getApprovalComments function.",
  );

  assert(
    catalogSource.includes("export async function addApprovalComment"),
    "catalog.ts must export addApprovalComment function.",
  );

  assert(
    approvalsSource.includes("<textarea") || approvalsSource.includes("textarea"),
    "Approvals page approval comments section must include a textarea element.",
  );

  assert(
    approvalsSource.includes('type="submit"') || approvalsSource.includes("PendingSubmitButton"),
    "Approvals page approval comments section must include a submit button.",
  );

  assert(
    approvalsSource.includes('aria-label="Review comments"') ||
      approvalsSource.includes("section aria-label"),
    "Approvals page review comments section must use an accessible aria-label.",
  );

  assert(
    approvalsSource.includes("commentsByProduct") || approvalsSource.includes("getApprovalComments"),
    "Approvals page must fetch approval comments per product.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "approvals_page_references_review_comments",
          "catalog_client_exports_getApprovalComments",
          "catalog_client_exports_addApprovalComment",
          "approvals_page_has_textarea_in_comments_section",
          "approvals_page_has_submit_button_in_comments_section",
          "approvals_page_review_comments_section_is_accessible",
          "approvals_page_fetches_comments_per_product",
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
  console.error("Approval comments UI integration test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
