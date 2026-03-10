#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const ISSUE_INBOX_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "quality", "issues", "page.tsx");
const PRODUCT_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "page.tsx");
const ACTIONS_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "actions.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const issueInboxSource = fs.readFileSync(ISSUE_INBOX_PAGE, "utf8");
  const productPageSource = fs.readFileSync(PRODUCT_PAGE, "utf8");
  const actionsSource = fs.readFileSync(ACTIONS_FILE, "utf8");

  assert(
    issueInboxSource.includes("?returnTo=${encodeURIComponent(returnTo)}") &&
      issueInboxSource.includes('buildReturnTo(filterParams)'),
    "Issue Inbox Fix Now links must encode a safe returnTo back-link for the current inbox scope.",
  );
  assert(
    productPageSource.includes("Back to inbox") &&
      productPageSource.includes('params.set("returnTo", returnTo)') &&
      productPageSource.includes('name="returnTo" value={returnTo}'),
    "Product detail must expose and preserve the inbox return path across tab navigation and edits.",
  );
  assert(
    actionsSource.includes('const returnToRaw = String(formData.get("returnTo") ?? "").trim();') &&
      actionsSource.includes("returnTo,") &&
      actionsSource.includes('tab: currentTab,'),
    "Product update action must preserve returnTo and currentTab when redirecting after save.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "issue_inbox_fix_now_preserves_return_context",
          "product_detail_keeps_return_link_visible",
          "product_update_redirect_preserves_return_and_tab",
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
  console.error("Issue inbox UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
