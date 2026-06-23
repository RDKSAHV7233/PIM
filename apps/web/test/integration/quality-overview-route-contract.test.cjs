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
    source.includes('type SharedReadState = "available" | "restricted" | "unavailable";') &&
      source.includes("async function loadSharedRead<T>(promise: Promise<T>): Promise<SharedReadResult<T>>") &&
      source.includes("Promise.all([") &&
      source.includes("loadSharedRead(getDashboardHealth({ role: actorRole, authHeader }))") &&
      source.includes("loadSharedRead(getStats({ role: actorRole, authHeader }))") &&
      source.includes("loadSharedRead(getIssueInbox({ limit: 50 }, { role: actorRole, authHeader }))"),
    "Quality overview must wrap health, stats, and issue inbox reads so restricted and unavailable states stay explicit.",
  );
  assert(
    source.includes("function toPercent(numerator: number, denominator: number): number") &&
      source.includes("const completenessState: SharedReadState =") &&
      source.includes("const completeness =") &&
      source.includes('label="Blocking Issues"') &&
      source.includes('label="Warnings"') &&
      source.includes('label="Completeness"') &&
      source.includes('label="Rejected Risk High"'),
    "Quality overview must derive its KPI cards from live quality health and catalog stats.",
  );
  assert(
    source.includes("Some quality data is temporarily unavailable") &&
      source.includes("Some quality data is restricted") &&
      source.includes("Blocking-issue totals are temporarily unavailable.") &&
      source.includes("Completeness metrics are limited for your role.") &&
      source.includes("Issue inbox insights are temporarily unavailable.") &&
      source.includes("Completeness unavailable"),
    "Quality overview must distinguish restricted and unavailable shared reads instead of defaulting to healthy counts.",
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
    source.includes('if (error instanceof ApiHttpError && error.status === 401)') &&
      source.includes('redirect(buildLoginRedirect("/quality", error));'),
    "Quality overview must redirect only expired sessions while preserving restricted shared-read states in-page.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "quality_overview_route_uses_shared_server_auth_context",
          "quality_overview_route_fetches_health_stats_and_issue_inputs_with_explicit_shared_read_states",
          "quality_overview_route_derives_live_quality_kpis",
          "quality_overview_route_distinguishes_restricted_and_unavailable_truth",
          "quality_overview_route_adjusts_triage_and_approval_copy_by_role",
          "quality_overview_route_links_to_core_quality_workspaces",
          "quality_overview_route_redirects_only_expired_sessions",
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
