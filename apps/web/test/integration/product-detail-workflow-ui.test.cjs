#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PRODUCT_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PRODUCT_PAGE, "utf8");

  assert(
    source.includes("<CardTitle>Product overview</CardTitle>"),
    "Product detail must lead with a product overview section.",
  );
  assert(
    source.includes("<CardTitle>Fix blockers before publish</CardTitle>") &&
      source.includes("Open channel readiness"),
    "Product detail must expose a fix-blockers section with direct readiness action.",
  );
  assert(
    source.includes("<CardTitle>Channel readiness and queued exports</CardTitle>") &&
      source.includes("Queue channel export") &&
      !source.includes("Publish to a channel"),
    "Product detail must use truthful queued-export language before diagnostics.",
  );
  assert(
    source.includes("Advanced channel diagnostics") &&
      source.includes("View queued export attempts and recovery actions"),
    "Technical channel diagnostics must be demoted behind collapsible queued-export disclosure controls.",
  );
  assert(
    source.includes("<SideRailCard title=\"Next actions\">") &&
      !source.includes("<SideRailCard title=\"Workflow\">"),
    "Product detail side rail must expose next actions instead of raw workflow metadata.",
  );
  assert(
    !source.includes("<CardTitle>Pre-Export Jobs</CardTitle>"),
    "Product detail must not foreground pre-export jobs as a primary merchandiser panel.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "product_detail_leads_with_overview_and_fix_blockers",
          "product_detail_uses_truthful_queued_export_language",
          "product_detail_demotes_diagnostics_and_workflow_metadata",
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
  console.error("Product detail workflow UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
