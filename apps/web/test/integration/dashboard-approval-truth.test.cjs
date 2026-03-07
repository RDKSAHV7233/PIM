#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_FILE = path.join(REPO_ROOT, "apps", "web", "src", "lib", "api.ts");
const DASHBOARD_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "dashboard", "page.tsx");
const APPROVALS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "quality", "approvals", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const apiSource = fs.readFileSync(API_FILE, "utf8");
  const dashboardSource = fs.readFileSync(DASHBOARD_PAGE, "utf8");
  const approvalsSource = fs.readFileSync(APPROVALS_PAGE, "utf8");

  assert(
    apiSource.includes("pendingApprovals: number;"),
    "CatalogStats must expose pendingApprovals.",
  );
  assert(
    dashboardSource.includes("const pendingApprovals = Number(stats.pendingApprovals ?? 0);"),
    "Dashboard must derive pending approvals from real stats.",
  );
  assert(
    !dashboardSource.includes('StatusChip label="0"'),
    "Dashboard must not hardcode zero pending approvals.",
  );
  assert(
    approvalsSource.includes("getStats({ role: actorRole, authHeader })"),
    "Approval Queue must load real catalog stats.",
  );
  assert(
    approvalsSource.includes('productStatus: "in_review"'),
    "Approval Queue must read issue inbox for in_review workflow items.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "dashboard_uses_real_pending_approval_count",
          "approval_queue_reads_real_review_workflow_data",
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
  console.error("Dashboard approval truth test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
