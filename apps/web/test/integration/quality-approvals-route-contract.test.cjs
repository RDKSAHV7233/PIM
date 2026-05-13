#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const APPROVALS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "quality", "approvals", "page.tsx");
const ROLE_CAPABILITIES = path.join(REPO_ROOT, "apps", "web", "src", "lib", "role-capabilities.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const approvalsSource = fs.readFileSync(APPROVALS_PAGE, "utf8");
  const capabilitiesSource = fs.readFileSync(ROLE_CAPABILITIES, "utf8");

  assert(
    approvalsSource.includes('if (!authHeader) {') &&
      approvalsSource.includes('redirect(buildLoginRedirect("/quality/approvals", 401));'),
    "Approval Queue must redirect unauthenticated access through the centralized login helper before loading page data.",
  );
  assert(
    approvalsSource.includes("Promise.all([") &&
      approvalsSource.includes("getStats({ role: actorRole, authHeader })") &&
      approvalsSource.includes("getIssueInbox(") &&
      approvalsSource.includes('productStatus: "in_review",') &&
      approvalsSource.includes("limit: 50,") &&
      approvalsSource.includes("getProductList({ slim: true }, { role: actorRole, authHeader })"),
    "Approval Queue must load stats, in-review issue inbox data, and slim product projections together from the shared auth context.",
  );
  assert(
    approvalsSource.includes("const blockingProducts = new Set(") &&
      approvalsSource.includes('item.severity === "BLOCKING"') &&
      approvalsSource.includes("const warningProducts = new Set(") &&
      approvalsSource.includes('item.severity === "WARNING"') &&
      approvalsSource.includes("const approvalQueueRedacted =") &&
      approvalsSource.includes('stats.redactedSections.includes("approval_queue")') &&
      approvalsSource.includes("const cleanForDecision = approvalQueueRedacted ? 0 : Math.max(0, stats.pendingApprovals - reviewedProductIds);"),
    "Approval Queue must derive blocking, warning, and clean-for-decision metrics from the real in-review inbox state while honoring restricted approval-queue counts.",
  );
  assert(
    capabilitiesSource.includes('return role === "admin" || role === "editor" || role === "reviewer";') &&
      approvalsSource.includes("const decisionEnabled = canDecideApproval(actorRole);"),
    "Approval Queue must rely on the shared reviewer-capable decision rule instead of duplicating local role logic.",
  );
  assert(
    approvalsSource.includes('const returnTo = "/quality/approvals";') &&
      approvalsSource.includes('href={`/products/${encodeURIComponent(product.id)}?tab=quality&returnTo=${encodeURIComponent(returnTo)}`}'),
    "Approval Queue must preserve a stable return path when operators jump from the queue into product detail.",
  );
  assert(
    approvalsSource.includes("const inReviewProducts = products") &&
      approvalsSource.includes('.filter((product) => product.status === "in_review")') &&
      approvalsSource.includes('.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));'),
    "Approval Queue must only render real in-review products and keep the newest items at the top of the decision list.",
  );
  assert(
    approvalsSource.includes("getProductRevisions(product.id, { role: actorRole, authHeader })") &&
      approvalsSource.includes("const revisionsByProduct = new Map(") &&
      approvalsSource.includes("Revision Evidence Coverage") &&
      approvalsSource.includes("with revision evidence") &&
      approvalsSource.includes("ApprovalEvidenceDrawer") &&
      approvalsSource.includes("productQualityHref") &&
      approvalsSource.includes("productHref"),
    "Approval Queue must fetch product revisions and hand them into an in-workspace evidence drawer instead of forcing reviewers to infer what changed.",
  );
  assert(
    approvalsSource.includes("approvalQueueRedacted") &&
      approvalsSource.includes("Approval queue restricted") &&
      approvalsSource.includes("Approval queue counts require reviewer, editor, or admin access.") &&
      approvalsSource.includes("Approval queue counts are restricted for your role."),
    "Approval Queue must render an honest restricted state when approval-count visibility is redacted for the current role.",
  );
  assert(
    approvalsSource.includes('const canApprove = summary.blocking === 0;') &&
      approvalsSource.includes('name="status"') &&
      approvalsSource.includes('value="approved"') &&
      approvalsSource.includes('value="rejected"') &&
      approvalsSource.includes("Reviewer note") &&
      approvalsSource.includes('disabled={!canApprove}') &&
      approvalsSource.includes("Clear blocking issues before approving."),
    "Approval Queue must keep reviewer note capture inside the decision form, disable approval when blockers remain, and explain that constraint inline.",
  );
  assert(
    approvalsSource.includes('query.decisionStatus ? (') &&
      approvalsSource.includes('tone="success"') &&
      approvalsSource.includes('title="Review decision recorded"') &&
      approvalsSource.includes("Product review decision recorded: ${query.decisionStatus}.") &&
      approvalsSource.includes('query.decisionError ? (') &&
      approvalsSource.includes('tone="error"') &&
      approvalsSource.includes('title="Review decision could not be applied"') &&
      approvalsSource.includes("Refresh the queue and verify blocking issues are cleared before recording the decision again."),
    "Approval Queue must surface success and failure feedback after decision actions redirect back to the queue.",
  );
  assert(
    approvalsSource.includes("Reviewer Decision Guide") &&
      approvalsSource.includes("Use the same evidence path on every item so approval stays consistent across the review queue.") &&
      approvalsSource.includes("Check blockers.") &&
      approvalsSource.includes("Open product context.") &&
      approvalsSource.includes("Use rejection intentionally.") &&
      approvalsSource.includes("Approval decisions here reflect the live in-review queue and the current issue inbox, not a demo-only workflow."),
    "Approval Queue must guide reviewers through a consistent decision workflow before they approve or reject items.",
  );
  assert(
    approvalsSource.includes('if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {') &&
      approvalsSource.includes('redirect(buildLoginRedirect("/quality/approvals", error));'),
    "Approval Queue must redirect expired or forbidden sessions through the centralized login redirect helper.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "quality_approvals_route_redirects_unauthenticated_access",
          "quality_approvals_route_fetches_review_queue_inputs_in_parallel",
          "quality_approvals_route_derives_review_metrics_from_issue_inbox_state",
          "quality_approvals_route_uses_shared_reviewer_decision_capability",
          "quality_approvals_route_preserves_product_return_context",
          "quality_approvals_route_fetches_revision_evidence",
          "quality_approvals_route_blocks_approval_until_blockers_clear",
          "quality_approvals_route_surfaces_decision_feedback_and_auth_redirects",
          "quality_approvals_route_guides_reviewer_decisions",
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
  console.error("Quality approvals route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
