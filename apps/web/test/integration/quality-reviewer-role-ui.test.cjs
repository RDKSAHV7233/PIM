#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const ROLE_CAPABILITIES = path.join(REPO_ROOT, "apps", "web", "src", "lib", "role-capabilities.ts");
const APPROVALS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "quality", "approvals", "page.tsx");
const ISSUES_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "quality", "issues", "page.tsx");
const PRODUCTS_TAB = path.join(REPO_ROOT, "apps", "web", "src", "components", "product", "products-tab.tsx");
const PRODUCT_DETAIL = path.join(REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "page.tsx");
const ROLE_BADGE = path.join(REPO_ROOT, "apps", "web", "src", "components", "ui", "role-badge.tsx");
const ADMIN_USERS = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "users", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const capabilitiesSource = fs.readFileSync(ROLE_CAPABILITIES, "utf8");
  const approvalsSource = fs.readFileSync(APPROVALS_PAGE, "utf8");
  const issuesSource = fs.readFileSync(ISSUES_PAGE, "utf8");
  const productsTabSource = fs.readFileSync(PRODUCTS_TAB, "utf8");
  const productDetailSource = fs.readFileSync(PRODUCT_DETAIL, "utf8");
  const roleBadgeSource = fs.readFileSync(ROLE_BADGE, "utf8");
  const adminUsersSource = fs.readFileSync(ADMIN_USERS, "utf8");

  assert(
    capabilitiesSource.includes('role === "admin" || role === "editor"') &&
      capabilitiesSource.includes('role === "admin" || role === "approver" || role === "reviewer"'),
    "Role capabilities must keep approval authority distinct from workspace editing: reviewers and approvers can record decisions, while editors stay focused on catalog edits.",
  );
  assert(
    approvalsSource.includes("decideProductReviewAction") &&
      approvalsSource.includes("getAllProductsSlim({ role: actorRole, authHeader })") &&
      approvalsSource.includes("canDecideApproval(actorRole)") &&
      approvalsSource.includes("Approve") &&
      approvalsSource.includes("Reject"),
    "Approval Queue must expose explicit approve/reject actions driven by the reviewer-capable decision path.",
  );
  assert(
    issuesSource.includes("canResolveIssueInboxWarnings(actorRole)") &&
      !issuesSource.includes('const canResolveWarnings = actorRole !== "viewer";'),
    "Issue Inbox must restrict warning-resolution controls to editor-capable roles instead of any non-viewer role.",
  );
  assert(
    productsTabSource.includes("canEditWorkspace(role)") &&
      productDetailSource.includes("canEditWorkspace(actorRole)"),
    "Catalog surfaces must use shared role capabilities so reviewer users stay read-only outside approval actions.",
  );
  assert(
    roleBadgeSource.includes('reviewer:') && roleBadgeSource.includes('"Reviewer"') &&
      roleBadgeSource.includes('const manageRolesHref = pathname === "/admin/users" ? "#workspace-users" : "/admin/users#workspace-users";') &&
      roleBadgeSource.includes('href={manageRolesHref}') &&
      adminUsersSource.includes('id="workspace-users"') &&
      adminUsersSource.includes('persona: "Reviewer"'),
    "Reviewer role must be surfaced consistently in the badge and admin role matrix, and team-role navigation must deep-link to the live users table.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "reviewer_role_capabilities_are_centralized",
          "approval_queue_exposes_reviewer_decision_actions",
          "reviewer_stays_read_only_outside_approval_decisions",
          "reviewer_role_is_visible_in_role_surfaces",
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
  console.error("Quality reviewer role UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
