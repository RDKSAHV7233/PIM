#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const ISSUES_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "quality", "issues", "page.tsx");
const ROLE_CAPABILITIES = path.join(REPO_ROOT, "apps", "web", "src", "lib", "role-capabilities.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const issuesSource = fs.readFileSync(ISSUES_PAGE, "utf8");
  const capabilitiesSource = fs.readFileSync(ROLE_CAPABILITIES, "utf8");

  assert(
    issuesSource.includes('if (!normalized) {') &&
      issuesSource.includes('normalized === "false" || normalized === "0" || normalized === "off"') &&
      issuesSource.includes("return true;"),
    "Issue Inbox must default hideTestData to true and only opt out on explicit false/0/off values.",
  );
  assert(
    issuesSource.includes("const parsed = Number.parseInt(String(value ?? \"\").trim(), 10);") &&
      issuesSource.includes("return Math.min(200, Math.max(1, parsed));"),
    "Issue Inbox must clamp page size into a safe 1-200 range.",
  );
  assert(
    issuesSource.includes("const authHeader = await getServerAuthHeader();") &&
      issuesSource.includes("const actorRole = await getServerActorRole();") &&
      issuesSource.includes("const canResolveWarnings = canResolveIssueInboxWarnings(actorRole);"),
    "Issue Inbox must derive auth context and warning-resolution capability from the shared server session helpers.",
  );
  assert(
    capabilitiesSource.includes('return role === "admin" || role === "editor";') &&
      issuesSource.includes("canResolveIssueInboxWarnings(actorRole)"),
    "Issue Inbox must rely on the shared editor-capable warning-resolution rule.",
  );
  assert(
    issuesSource.includes("Promise.all([") &&
      issuesSource.includes("getIssueInbox(") &&
      issuesSource.includes("getCategoryTree({ all: true }, { role: actorRole, authHeader })") &&
      issuesSource.includes("getInstalledConnectors({ role: actorRole, authHeader })"),
    "Issue Inbox must load inbox items, categories, and installed connectors together from the shared auth context.",
  );
  assert(
    issuesSource.includes('filterParams.set("limit", String(limit));') &&
      issuesSource.includes('if (query.hideTestData === "false") {') &&
      issuesSource.includes('const returnTo = buildReturnTo(filterParams);'),
    "Issue Inbox must preserve normalized filter state when building its stable return path.",
  );
  assert(
    issuesSource.includes('href={`/products/${encodeURIComponent(issue.productId)}?returnTo=${encodeURIComponent(returnTo)}`}') &&
      issuesSource.includes('const previousParams = new URLSearchParams(filterParams.toString());') &&
      issuesSource.includes('const nextParams = new URLSearchParams(filterParams.toString());'),
    "Issue Inbox must preserve the current filter scope when navigating into product detail and across pagination.",
  );
  assert(
    issuesSource.includes('Blocking issues must be fixed from the product editor.') &&
      issuesSource.includes("{canResolveWarnings ? (") &&
      issuesSource.includes('name="issueIds"'),
    "Issue Inbox must only expose bulk warning-resolution controls for editor-capable roles and keep blocking issues out of that shortcut path.",
  );
  assert(
    issuesSource.includes('title="No open issues found"') &&
      issuesSource.includes('description="Your current filter scope has no open compliance issues."'),
    "Issue Inbox must surface a truthful empty state when the current filter scope has no open issues.",
  );
  assert(
    issuesSource.includes('if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {') &&
      issuesSource.includes('redirect(buildLoginRedirect("/quality/issues", error));'),
    "Issue Inbox must redirect expired or forbidden sessions through the centralized login redirect helper.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "quality_issues_route_normalizes_filters_and_page_size",
          "quality_issues_route_uses_shared_warning_resolution_capability",
          "quality_issues_route_fetches_inbox_categories_and_installations_in_parallel",
          "quality_issues_route_preserves_filter_scope_for_return_and_pagination",
          "quality_issues_route_limits_bulk_resolution_to_warning_workflow",
          "quality_issues_route_surfaces_empty_state_and_auth_redirects",
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
  console.error("Quality issues route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
