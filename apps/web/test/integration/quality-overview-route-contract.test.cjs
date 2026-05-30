#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const QUALITY_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "quality", "page.tsx");
const ROLE_CAPABILITIES = path.join(REPO_ROOT, "apps", "web", "src", "lib", "role-capabilities.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(QUALITY_PAGE, "utf8");
  const roleCapabilitiesSource = fs.readFileSync(ROLE_CAPABILITIES, "utf8");

  assert(
      source.includes("await getServerSession();"),
    "Quality overview must derive shared auth/session context from the server helpers.",
  );
  assert(
    source.includes("Promise.all([") &&
      source.includes("getDashboardHealth({ role: actorRole, authHeader })") &&
      source.includes("getStats({ role: actorRole, authHeader })") &&
      source.includes("getIssueInbox({ limit: 50 }, { role: actorRole, authHeader })"),
    "Quality overview must fetch health, stats, and issue inbox inputs together from the shared auth context.",
  );
  assert(
    source.includes("function toPercent(numerator: number, denominator: number): number") &&
      source.includes("const completeness = toPercent(health.snapshot.completeSkus, stats.products);") &&
      source.includes('label="Blocking Issues"') &&
      source.includes('label="Warnings"') &&
      source.includes('label="Completeness"') &&
      source.includes('label="Rejected Risk High"'),
    "Quality overview must derive its KPI cards from live quality health and catalog stats.",
  );
  assert(
      roleCapabilitiesSource.includes('return role === "admin" || role === "editor";') &&
      roleCapabilitiesSource.includes('return role === "admin" || role === "approver" || role === "reviewer";') &&
      source.includes("const canTriageWarnings = canEditWorkspace(actorRole);") &&
      source.includes("const canRecordReviewDecisions = canDecideApproval(actorRole);") &&
      source.includes("Workspace editors and admins resolve warnings.") &&
      source.includes("Final approval decisions require reviewer, approver, or admin access.") &&
      source.includes('{canRecordReviewDecisions ? "Open Approval Queue" : "Review Approval Queue"}'),
    "Quality overview must describe issue-triage and approval actions honestly for roles without write or decision capability.",
  );
  assert(
    source.includes('href="/quality/issues"') &&
      source.includes('href="/quality/validation"') &&
      source.includes('href="/quality/completeness"') &&
      source.includes('href="/rejection"') &&
      source.includes('href="/quality/approvals"'),
    "Quality overview must deep-link operators into the issue, validation, completeness, rejection, and approval workspaces.",
  );
  assert(
    source.includes('redirect(buildLoginRedirect("/quality", error));'),
    "Quality overview must redirect expired or forbidden sessions through the centralized login redirect helper.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "quality_overview_route_uses_shared_server_auth_context",
          "quality_overview_route_fetches_health_stats_and_issue_inputs_in_parallel",
          "quality_overview_route_derives_live_quality_kpis",
          "quality_overview_route_adjusts_triage_and_approval_copy_by_role",
          "quality_overview_route_links_to_core_quality_workspaces",
          "quality_overview_route_redirects_auth_failures",
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
  console.error("Quality overview route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
